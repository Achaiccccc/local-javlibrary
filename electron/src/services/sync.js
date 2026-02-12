const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const { scanDataFolder } = require('./scanner');
const { parseNfoFile } = require('../utils/xmlParser');
const { getNfoFiles, getImagePaths, isMovieFolder, checkVideoFile } = require('../utils/fileUtils');
const { getSequelize } = require('../config/database');
const { Op } = require('sequelize');

let watchers = [];
let isWatching = false; // 监听状态标志
// 新增 .nfo 防抖：同一作品目录在短时间内的多次 add 只处理一次
const addNfoDebounceMap = new Map();
const ADD_NFO_DEBOUNCE_MS = 400;
// addDir 延迟重试：目录刚出现时可能还在写入，延迟后再判断一次
const addDirRetryMap = new Map();
const ADD_DIR_RETRY_MS = 2500;

/**
 * 初始化文件监听（支持多个路径）
 * @param {string|string[]} dataPaths - data文件夹路径或路径数组
 * @param {BrowserWindow} mainWindow - 主窗口
 * @returns {Promise<chokidar.FSWatcher[]>} - 文件监听器数组
 */
async function initFileWatcher(dataPaths, mainWindow) {
  // 如果已经在监听，先停止
  if (isWatching) {
    await stopFileWatcher();
  }
  
  // 确保是数组
  const paths = Array.isArray(dataPaths) ? dataPaths : [dataPaths];
  
  // 为每个路径创建监听器
  for (let dataPathIndex = 0; dataPathIndex < paths.length; dataPathIndex++) {
    const dataPath = paths[dataPathIndex];
    if (!dataPath) continue;

    const watcher = chokidar.watch(dataPath, {
      // 忽略不需要的文件和目录
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        /node_modules/, // 忽略 node_modules
        /\.git/, // 忽略 .git
        // 忽略常见的非 NFO 文件（使用正则匹配文件扩展名）
        /\.(jpg|jpeg|png|gif|bmp|webp|mp4|mkv|avi|mov|wmv|flv|webm|m4v|3gp|ts|mpg|mpeg|txt|log|tmp|bak|swp)$/i,
        // 只保留 .nfo 结尾的文件（任意文件名）
        (filePath) => {
          const lowerPath = filePath.toLowerCase();
          const ext = path.extname(lowerPath);
          // 如果是文件且有扩展名，但不是 .nfo，则忽略
          if (ext && ext !== '.nfo') {
            return true;
          }
          return false;
        }
      ],
      persistent: true,
      ignoreInitial: true,
      // 监听足够深的目录层级，支持「数据根/多级分类/演员/作品」等 2～3 层目录一次性移入
      depth: 6,
      // 不使用轮询模式（使用系统原生监听，性能更好）
      // 如果系统不支持原生监听，chokidar 会自动降级到轮询
      usePolling: false,
      // 限制并发操作
      awaitWriteFinish: {
        stabilityThreshold: 200, // 增加稳定性阈值
        pollInterval: 100
      },
      // 不跟随符号链接
      followSymlinks: false,
      // 限制同时打开的文件数
      atomic: true // 使用原子操作，减少文件句柄使用
    });
    
    // 监听新增文件夹（新女优或新作品，或整层目录移入）
    watcher.on('addDir', async (dirPath) => {
      console.log('新增文件夹:', dirPath);
      try {
        if (await isMovieFolder(dirPath)) {
          await handleNewMovie(dirPath, dataPath, dataPathIndex);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file:changed', { type: 'movie_added', path: dirPath });
          }
          return;
        }
        // 可能是新女优/分类文件夹，扫描其下所有作品
        await scanActorFolder(dirPath, dataPath, dataPathIndex);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', { type: 'actor_added', path: dirPath });
        }
        // 若当前没有子目录（例如整包还在复制中），延迟重试一次，避免漏掉「先建目录再拷文件」
        const existing = addDirRetryMap.get(dirPath);
        if (existing) clearTimeout(existing);
        const tid = setTimeout(async () => {
          addDirRetryMap.delete(dirPath);
          try {
            if (!isWatching) return;
            if (await isMovieFolder(dirPath)) {
              await handleNewMovie(dirPath, dataPath, dataPathIndex);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('file:changed', { type: 'movie_added', path: dirPath });
              }
              return;
            }
            await scanActorFolder(dirPath, dataPath, dataPathIndex);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('file:changed', { type: 'actor_added', path: dirPath });
            }
          } catch (e) {
            console.error('addDir 延迟重试失败:', e);
          }
        }, ADD_DIR_RETRY_MS);
        addDirRetryMap.set(dirPath, tid);
      } catch (error) {
        console.error('处理新增文件夹失败:', error);
      }
    });

  // 监听删除文件夹
  watcher.on('unlinkDir', async (dirPath) => {
    console.log('删除文件夹:', dirPath);
    try {
      await handleDeletedFolder(dirPath, dataPath, dataPathIndex);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:changed', { type: 'folder_deleted', path: dirPath });
      }
    } catch (error) {
      console.error('处理删除文件夹失败:', error);
    }
  });

  // 监听删除 NFO 文件：仅删除 .nfo 时也从库中移除对应影片
  watcher.on('unlink', (filePath) => {
    if (path.extname(filePath).toLowerCase() !== '.nfo') return;
    const folderPath = path.dirname(filePath);
    console.log('删除NFO文件，尝试从库移除对应影片:', filePath);
    handleDeletedFolder(folderPath, dataPath, dataPathIndex)
      .then((removed) => {
        if (removed && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', { type: 'folder_deleted', path: folderPath });
        }
      })
      .catch((error) => console.error('处理删除NFO失败:', error));
  });

  // 监听 NFO 文件内容变化（修改）
  watcher.on('change', async (filePath) => {
    if (path.extname(filePath).toLowerCase() === '.nfo') {
      console.log('NFO文件变化:', filePath);
      try {
        const folderPath = path.dirname(filePath);
        await handleMovieUpdate(folderPath, dataPath, dataPathIndex);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', { type: 'movie_updated', path: folderPath });
        }
      } catch (error) {
        console.error('处理NFO文件变化失败:', error);
      }
    }
  });

  // 监听新增 NFO 文件：先建空文件夹再拷入 nfo 时，靠此事件入库
  watcher.on('add', (filePath) => {
    if (path.extname(filePath).toLowerCase() !== '.nfo') return;
    const folderPath = path.dirname(filePath);
    const existing = addNfoDebounceMap.get(folderPath);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(async () => {
      addNfoDebounceMap.delete(folderPath);
      if (!isWatching) return;
      console.log('新增NFO文件，尝试入库:', filePath);
      try {
        await handleMovieUpdate(folderPath, dataPath, dataPathIndex);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', { type: 'movie_added', path: folderPath });
        }
      } catch (error) {
        console.error('处理新增NFO失败:', error);
      }
    }, ADD_NFO_DEBOUNCE_MS);
    addNfoDebounceMap.set(folderPath, tid);
  });
  
  // 添加错误处理，避免未处理的 Promise 拒绝
  watcher.on('error', (error) => {
    console.error('文件监听器错误:', error);
    // 如果是 EMFILE 错误，提示用户
    if (error.code === 'EMFILE') {
      console.warn('警告: 文件句柄过多，建议减少监听的文件数量或重启应用');
    }
  });
    
    watchers.push(watcher);
  }

  isWatching = true;
  return watchers;
}

/**
 * 停止所有文件监听器
 */
async function stopFileWatcher() {
  console.log('停止文件监听器...');
  isWatching = false;
  addNfoDebounceMap.forEach((tid) => clearTimeout(tid));
  addNfoDebounceMap.clear();
  addDirRetryMap.forEach((tid) => clearTimeout(tid));
  addDirRetryMap.clear();
  watchers.forEach(watcher => {
    if (watcher) {
      try {
        watcher.close();
      } catch (error) {
        console.error('关闭监听器失败:', error);
      }
    }
  });
  watchers = [];
  console.log('文件监听器已停止');
}

/**
 * 临时监听指定文件夹的NFO文件变化（用于编辑时同步）
 * @param {string} folderPath - 文件夹路径
 * @param {BrowserWindow} mainWindow - 主窗口
 * @param {number} timeout - 超时时间（毫秒），默认5秒
 */
async function watchFolderTemporarily(folderPath, mainWindow, timeout = 5000) {
  const chokidar = require('chokidar');
  const path = require('path');
  const { getDataPaths } = require('../config/paths');
  
  const dataPaths = getDataPaths();
  if (!dataPaths || dataPaths.length === 0) {
    return;
  }
  
  // 找到对应的数据路径及索引
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

  // 查找该文件夹下的所有 NFO 文件
  const nfoFiles = await getNfoFiles(folderPath);
  if (!nfoFiles || nfoFiles.length === 0) {
    return;
  }
  
  // 创建临时监听器（可能同时监听多个 NFO 文件）
  const tempWatcher = chokidar.watch(nfoFiles, {
    persistent: false,
    ignoreInitial: true,
    usePolling: false
  });
  
  // 监听NFO文件变化
  tempWatcher.on('change', async (filePath) => {
    console.log('临时监听：NFO文件变化:', filePath);
    try {
      await handleMovieUpdate(folderPath, dataPath, dataPathIndex);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:changed', { type: 'movie_updated', path: folderPath });
      }
    } catch (error) {
      console.error('临时监听：处理NFO文件变化失败:', error);
    }
  });
  
  // 超时后自动关闭
  setTimeout(() => {
    try {
      tempWatcher.close();
      console.log('临时监听器已关闭');
    } catch (error) {
      console.error('关闭临时监听器失败:', error);
    }
  }, timeout);
  
  return tempWatcher;
}

/**
 * 处理新增作品
 * @param {string} movieFolderPath - 作品目录绝对路径
 * @param {string} dataPath - 数据根路径
 * @param {number} dataPathIndex - 数据路径索引（多路径时必填，用于 data_path_index 字段）
 */
async function handleNewMovie(movieFolderPath, dataPath, dataPathIndex = 0) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;

  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) {
    console.warn('handleNewMovie: 未找到 NFO 文件，跳过', movieFolderPath);
    return;
  }
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);

  const { poster, fanart } = await getImagePaths(movieFolderPath);
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);

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
      data_path_index: dataPathIndex
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
      data_path_index: dataPathIndex
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
}

/**
 * 扫描演员/分类文件夹下的作品并入库
 * @param {string} actorFolderPath - 演员或分类目录绝对路径
 * @param {string} dataPath - 数据根路径
 * @param {number} dataPathIndex - 数据路径索引
 */
async function scanActorFolder(actorFolderPath, dataPath, dataPathIndex = 0) {
  const fs = require('fs-extra');
  const entries = await fs.readdir(actorFolderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const movieFolderPath = path.join(actorFolderPath, entry.name);
      if (await isMovieFolder(movieFolderPath)) {
        await handleNewMovie(movieFolderPath, dataPath, dataPathIndex);
      }
    }
  }
}

/**
 * 处理影片更新（NFO 变更或新增后补全）
 * @param {string} movieFolderPath - 作品目录绝对路径
 * @param {string} dataPath - 数据根路径
 * @param {number} dataPathIndex - 数据路径索引
 */
async function handleMovieUpdate(movieFolderPath, dataPath, dataPathIndex = 0) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;

  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) {
    console.warn('handleMovieUpdate: 未找到 NFO 文件，跳过', movieFolderPath);
    return;
  }
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);

  const { poster, fanart } = await getImagePaths(movieFolderPath);
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);

  const movie = await Movie.findOne({ where: { code: movieData.code } });
  if (!movie) {
    await handleNewMovie(movieFolderPath, dataPath, dataPathIndex);
    return;
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
    data_path_index: dataPathIndex
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

/**
 * 规范化相对路径，便于与库中 folder_path 比较（Windows 与 Linux 可能存 \ 或 /）
 */
function normalizeFolderPath(relativePath) {
  return relativePath ? relativePath.replace(/\\/g, '/') : '';
}

/**
 * 处理删除的文件夹或作品目录（含：整目录删除、仅删除 .nfo 文件）
 * @param {string} dirPath - 被删目录的绝对路径（或 .nfo 所在目录）
 * @param {string} dataPath - 数据根路径
 * @param {number} dataPathIndex - 数据路径索引，多路径时用于精确匹配
 * @returns {Promise<boolean>} - 是否删除了至少一条影片记录
 */
async function handleDeletedFolder(dirPath, dataPath, dataPathIndex = 0) {
  const sequelize = getSequelize();
  const Movie = sequelize.models.Movie;
  const MovieActorFromNfo = sequelize.models.MovieActorFromNfo;
  const MovieGenre = sequelize.models.MovieGenre;
  const MovieActor = sequelize.models.MovieActor;

  const relativePath = path.relative(dataPath, dirPath);
  const normalized = normalizeFolderPath(relativePath);
  const normalizedBackslash = normalized.replace(/\//g, '\\');

  const movies = await Movie.findAll({
    where: {
      data_path_index: dataPathIndex,
      [Op.or]: [
        { folder_path: relativePath },
        { folder_path: normalized },
        { folder_path: normalizedBackslash }
      ]
    }
  });

  for (const movie of movies) {
    const movieId = movie.id;
    // 先删除关联表记录，避免外键约束导致 DELETE movies 失败（SQLite 表可能未建 ON DELETE CASCADE）
    if (MovieActorFromNfo) {
      await MovieActorFromNfo.destroy({ where: { movie_id: movieId } });
    }
    if (MovieGenre) {
      await MovieGenre.destroy({ where: { movie_id: movieId } });
    }
    if (MovieActor) {
      await MovieActor.destroy({ where: { movie_id: movieId } });
    }
    await movie.destroy();
  }
  return movies.length > 0;
}

module.exports = {
  initFileWatcher,
  stopFileWatcher,
  watchFolderTemporarily,
  getWatcherStatus: () => isWatching
};
