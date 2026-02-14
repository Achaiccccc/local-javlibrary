const path = require('path');
const fs = require('fs');
const glob = require('fast-glob');
const { parseNfoFile } = require('../utils/xmlParser');
const { getNfoFiles, getImagePaths, checkVideoFile } = require('../utils/fileUtils');
const { getSequelize } = require('../config/database');
const { Op } = require('sequelize');

/** 启动时 diff 的批次大小，避免主进程长时间阻塞 */
const STARTUP_REMOVE_BATCH = 80;
const STARTUP_ADD_BATCH = 15;

/**
 * 规范化相对路径，便于与库中 folder_path 比较（Windows 与 Linux 可能存 \ 或 /）
 */
function normalizeFolderPath(relativePath) {
  return relativePath ? relativePath.replace(/\\/g, '/') : '';
}

/**
 * 启动时与磁盘 diff，更新数据库：删除库中已有但磁盘已不存在的记录，新增磁盘有但库中没有的记录。
 * 分批处理并穿插 setImmediate，避免大量数据时卡死。
 * @param {string[]} dataPaths - 数据根路径数组
 * @param {BrowserWindow} [mainWindow] - 主窗口，用于发送进度事件
 * @param {(phase: string, current: number, total: number, message?: string) => void} [progressCallback] - 进度回调
 */
async function runStartupSync(dataPaths, mainWindow = null, progressCallback = null) {
  if (!dataPaths || dataPaths.length === 0) {
    return { added: 0, removed: 0, addedList: [], duplicateList: [], failedList: [] };
  }

  const sendProgress = (phase, current, total, message) => {
    if (progressCallback) progressCallback(phase, current, total, message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:startupProgress', { phase, current, total, message });
    }
  };

  const sequelize = getSequelize();
  const Movie = sequelize.models.Movie;
  if (!Movie) return { added: 0, removed: 0, addedList: [], duplicateList: [], failedList: [] };

  /** 磁盘上的作品：key = `${dataPathIndex}:${normalizedFolderPath}` */
  const diskKeys = new Set();
  /** key -> 作品目录绝对路径（用于后续 handleNewMovie） */
  const diskKeyToFullPath = new Map();

  sendProgress('scan_disk', 0, 0, '正在扫描磁盘…');

  for (let dataPathIndex = 0; dataPathIndex < dataPaths.length; dataPathIndex++) {
    const dataPath = dataPaths[dataPathIndex];
    if (!dataPath) continue;
    try {
      const nfoPaths = await glob('**/*.nfo', {
        cwd: dataPath,
        absolute: true,
        ignore: ['**/node_modules/**']
      });
      for (const nfoPath of nfoPaths) {
        const folderPath = path.dirname(nfoPath);
        const relativePath = path.relative(dataPath, folderPath);
        const key = `${dataPathIndex}:${normalizeFolderPath(relativePath)}`;
        diskKeys.add(key);
        diskKeyToFullPath.set(key, folderPath);
      }
    } catch (err) {
      console.error('启动同步：扫描路径失败', dataPath, err);
    }
  }

  sendProgress('scan_db', 0, 0, '正在读取数据库…');

  const allMovies = await Movie.findAll({
    attributes: ['id', 'folder_path', 'data_path_index']
  });

  const toRemove = [];
  const dbKeys = new Set();
  for (const m of allMovies) {
    const key = `${m.data_path_index ?? 0}:${normalizeFolderPath(m.folder_path)}`;
    dbKeys.add(key);
    if (!diskKeys.has(key)) toRemove.push({ id: m.id });
  }

  const toAddKeys = [...diskKeys].filter(k => !dbKeys.has(k));
  const totalRemove = toRemove.length;
  const totalAdd = toAddKeys.length;

  /** 真正新增列表：{ path }（库中原本无此番号） */
  const addedList = [];
  /** 重复数据列表：{ path }（库中已有同番号，仅更新路径等信息） */
  const duplicateList = [];
  /** 新增失败列表：{ path, reason } */
  const failedList = [];

  if (totalRemove === 0 && totalAdd === 0) {
    sendProgress('done', 0, 0, '数据已与磁盘一致');
    return { added: 0, removed: 0, addedList: [], duplicateList: [], failedList: [] };
  }

  sendProgress('remove', 0, totalRemove, `待删除 ${totalRemove} 条，待新增 ${totalAdd} 条`);

  const removeBatch = (start) => {
    const end = Math.min(start + STARTUP_REMOVE_BATCH, totalRemove);
    const batch = toRemove.slice(start, end);
    return (async () => {
      for (const { id } of batch) {
        await deleteMovieById(id);
      }
      sendProgress('remove', end, totalRemove);
      if (end < totalRemove) {
        return new Promise((resolve) => setImmediate(() => removeBatch(end).then(resolve)));
      }
    })();
  };

  await removeBatch(0);

  sendProgress('add', 0, totalAdd, `正在新增 ${totalAdd} 条…`);

  const addBatch = (start) => {
    const end = Math.min(start + STARTUP_ADD_BATCH, totalAdd);
    const keys = toAddKeys.slice(start, end);
    return (async () => {
      for (const key of keys) {
        const colonAt = key.indexOf(':');
        const dataPathIndex = parseInt(key.substring(0, colonAt), 10);
        const dataPath = dataPaths[dataPathIndex];
        const fullPath = diskKeyToFullPath.get(key);
        const displayPath = fullPath ? path.relative(dataPath, fullPath).replace(/\\/g, '/') : key;
        if (!dataPath || !fullPath) {
          failedList.push({ path: displayPath, reason: '路径无效' });
          continue;
        }
        try {
          const { created } = await handleNewMovie(fullPath, dataPath, dataPathIndex);
          if (created) {
            addedList.push({ path: displayPath });
          } else {
            duplicateList.push({ path: displayPath });
          }
        } catch (err) {
          console.error('启动同步：新增失败', fullPath, err);
          failedList.push({ path: displayPath, reason: (err && err.message) ? err.message : String(err) });
        }
      }
      sendProgress('add', end, totalAdd);
      if (end < totalAdd) {
        return new Promise((resolve) => setImmediate(() => addBatch(end).then(resolve)));
      }
    })();
  };

  await addBatch(0);

  const addedCount = addedList.length;
  const duplicateCount = duplicateList.length;
  const failedCount = failedList.length;
  sendProgress('done', 0, 0, `已删除 ${totalRemove} 条，新增 ${addedCount} 条${duplicateCount > 0 ? `，重复 ${duplicateCount} 条` : ''}${failedCount > 0 ? `，失败 ${failedCount} 条` : ''}`);
  return {
    added: addedCount,
    removed: totalRemove,
    addedList,
    duplicateList,
    failedList
  };
}

/**
 * 按影片 id 删除记录（含关联表），用于启动 diff 批量删除
 */
async function deleteMovieById(movieId) {
  const sequelize = getSequelize();
  const Movie = sequelize.models.Movie;
  const MovieActorFromNfo = sequelize.models.MovieActorFromNfo;
  const MovieGenre = sequelize.models.MovieGenre;
  const MovieActor = sequelize.models.MovieActor;
  if (MovieActorFromNfo) await MovieActorFromNfo.destroy({ where: { movie_id: movieId } });
  if (MovieGenre) await MovieGenre.destroy({ where: { movie_id: movieId } });
  if (MovieActor) await MovieActor.destroy({ where: { movie_id: movieId } });
  await Movie.destroy({ where: { id: movieId } });
}

/**
 * 临时监听指定文件夹的 NFO 文件变化（仅用于用户编辑影片时同步）
 * @param {string} folderPath - 文件夹路径
 * @param {BrowserWindow} mainWindow - 主窗口
 * @param {number} timeout - 超时时间（毫秒），默认 5 秒
 */
async function watchFolderTemporarily(folderPath, mainWindow, timeout = 5000) {
  const chokidar = require('chokidar');
  const { getDataPaths } = require('../config/paths');

  const dataPaths = getDataPaths();
  if (!dataPaths || dataPaths.length === 0) return;

  let dataPath = null;
  let dataPathIndex = 0;
  for (let i = 0; i < dataPaths.length; i++) {
    if (folderPath.startsWith(dataPaths[i])) {
      dataPath = dataPaths[i];
      dataPathIndex = i;
      break;
    }
  }
  if (!dataPath) return;

  const nfoFiles = await getNfoFiles(folderPath);
  if (!nfoFiles || nfoFiles.length === 0) return;

  const tempWatcher = chokidar.watch(nfoFiles, {
    persistent: false,
    ignoreInitial: true,
    usePolling: false
  });

  tempWatcher.on('change', async (filePath) => {
    try {
      await handleMovieUpdate(folderPath, dataPath, dataPathIndex);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:changed', { type: 'movie_updated', path: folderPath });
      }
    } catch (error) {
      console.error('临时监听：处理NFO变化失败:', error);
    }
  });

  setTimeout(() => {
    try {
      tempWatcher.close();
    } catch (e) {
      console.error('关闭临时监听失败:', e);
    }
  }, timeout);

  return tempWatcher;
}

/**
 * 处理新增作品
 */
async function handleNewMovie(movieFolderPath, dataPath, dataPathIndex = 0) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;

  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) return;
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);

  const { poster, fanart } = await getImagePaths(movieFolderPath);
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);

  let folderUpdatedAt = null;
  try {
    const stat = fs.statSync(movieFolderPath);
    if (stat && stat.mtime) folderUpdatedAt = stat.mtime;
  } catch (e) {}

  let director = null;
  if (movieData.director && movieData.director.trim() !== '' && movieData.director.trim() !== '----') {
    [director] = await Director.findOrCreate({
      where: { name: movieData.director },
      defaults: { name: movieData.director }
    });
  }
  let studio = null;
  if (movieData.studio && movieData.studio.trim() !== '' && movieData.studio.trim() !== '----') {
    [studio] = await Studio.findOrCreate({
      where: { name: movieData.studio },
      defaults: { name: movieData.studio }
    });
  }

  const [movie, created] = await Movie.findOrCreate({
    where: { code: movieData.code },
    defaults: {
      title: movieData.title,
      code: movieData.code,
      runtime: movieData.runtime,
      premiered: movieData.premiered,
      director_id: director ? director.id : null,
      studio_id: studio ? studio.id : null,
      poster_path: poster ? path.relative(dataPath, poster) : null,
      fanart_path: fanart ? path.relative(dataPath, fanart) : null,
      nfo_path: path.relative(dataPath, nfoPath),
      folder_path: path.relative(dataPath, movieFolderPath),
      playable: playable,
      video_path: videoPath ? path.relative(dataPath, videoPath) : null,
      data_path_index: dataPathIndex,
      folder_updated_at: folderUpdatedAt
    }
  });

  if (!created) {
    await movie.update({
      title: movieData.title,
      runtime: movieData.runtime,
      premiered: movieData.premiered,
      director_id: director ? director.id : null,
      studio_id: studio ? studio.id : null,
      poster_path: poster ? path.relative(dataPath, poster) : null,
      fanart_path: fanart ? path.relative(dataPath, fanart) : null,
      nfo_path: path.relative(dataPath, nfoPath),
      folder_path: path.relative(dataPath, movieFolderPath),
      playable: playable,
      video_path: videoPath ? path.relative(dataPath, videoPath) : null,
      data_path_index: dataPathIndex,
      folder_updated_at: folderUpdatedAt
    });
  }

  await movie.setActorsFromNfo([]);
  await movie.setGenres([]);
  if (movieData.actors && Array.isArray(movieData.actors)) {
    for (const actorName of movieData.actors) {
      if (!actorName) continue;
      const [nfoActor] = await ActorFromNfo.findOrCreate({
        where: { name: actorName },
        defaults: { name: actorName }
      });
      await movie.addActorsFromNfo(nfoActor);
    }
  }
  if (movieData.genres && Array.isArray(movieData.genres)) {
    for (const genreName of movieData.genres) {
      if (!genreName) continue;
      const [genre] = await Genre.findOrCreate({
        where: { name: genreName },
        defaults: { name: genreName }
      });
      await movie.addGenre(genre);
    }
  }
  return { created };
}

/**
 * 处理影片更新（NFO 变更）
 */
async function handleMovieUpdate(movieFolderPath, dataPath, dataPathIndex = 0) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;

  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) return;
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);

  const { poster, fanart } = await getImagePaths(movieFolderPath);
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);

  let folderUpdatedAt = null;
  try {
    const stat = fs.statSync(movieFolderPath);
    if (stat && stat.mtime) folderUpdatedAt = stat.mtime;
  } catch (e) {}

  const movie = await Movie.findOne({ where: { code: movieData.code } });
  if (!movie) {
    await handleNewMovie(movieFolderPath, dataPath, dataPathIndex);
    return; // handleNewMovie 内部已处理，无需返回值
  }

  let director = null;
  if (movieData.director && movieData.director.trim() !== '' && movieData.director.trim() !== '----') {
    [director] = await Director.findOrCreate({
      where: { name: movieData.director },
      defaults: { name: movieData.director }
    });
  }
  let studio = null;
  if (movieData.studio && movieData.studio.trim() !== '' && movieData.studio.trim() !== '----') {
    [studio] = await Studio.findOrCreate({
      where: { name: movieData.studio },
      defaults: { name: movieData.studio }
    });
  }

  await movie.update({
    title: movieData.title,
    runtime: movieData.runtime,
    premiered: movieData.premiered,
    director_id: director ? director.id : null,
    studio_id: studio ? studio.id : null,
    poster_path: poster ? path.relative(dataPath, poster) : null,
    fanart_path: fanart ? path.relative(dataPath, fanart) : null,
    nfo_path: path.relative(dataPath, nfoPath),
    folder_path: path.relative(dataPath, movieFolderPath),
    playable: playable,
    video_path: videoPath ? path.relative(dataPath, videoPath) : null,
    data_path_index: dataPathIndex,
    folder_updated_at: folderUpdatedAt
  });

  await movie.setActorsFromNfo([]);
  if (movieData.actors && Array.isArray(movieData.actors)) {
    for (const nfoActorName of movieData.actors) {
      if (!nfoActorName) continue;
      const [nfoActor] = await ActorFromNfo.findOrCreate({
        where: { name: nfoActorName },
        defaults: { name: nfoActorName }
      });
      await movie.addActorsFromNfo(nfoActor);
    }
  }
  await movie.setGenres([]);
  if (movieData.genres && Array.isArray(movieData.genres)) {
    for (const genreName of movieData.genres) {
      if (!genreName) continue;
      const [genre] = await Genre.findOrCreate({
        where: { name: genreName },
        defaults: { name: genreName }
      });
      await movie.addGenre(genre);
    }
  }
}

module.exports = {
  runStartupSync,
  watchFolderTemporarily
};
