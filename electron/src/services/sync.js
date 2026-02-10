const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const { scanDataFolder } = require('./scanner');
const { parseNfoFile } = require('../utils/xmlParser');
const { getNfoFiles, getImagePaths, isMovieFolder, checkVideoFile } = require('../utils/fileUtils');
const { getSequelize } = require('../config/database');

let watchers = [];
let isWatching = false; // 监听状态标志

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
  for (const dataPath of paths) {
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
      // 只监听目录变化，不监听文件变化（除了 NFO 文件通过 change 事件处理）
      depth: 3, // 进一步减少监听深度（从5降到3）
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
    
    // 监听新增文件夹（新女优或新作品）
    watcher.on('addDir', async (dirPath) => {
      console.log('新增文件夹:', dirPath);
      try {
        // 检查是否为作品文件夹
        if (await isMovieFolder(dirPath)) {
        // 处理新增作品
        await handleNewMovie(dirPath, dataPath);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file:changed', { type: 'movie_added', path: dirPath });
          }
      } else {
        // 可能是新女优文件夹，扫描该文件夹下的所有作品
        await scanActorFolder(dirPath, dataPath);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file:changed', { type: 'actor_added', path: dirPath });
          }
      }
    } catch (error) {
      console.error('处理新增文件夹失败:', error);
        // 不抛出错误，避免未处理的 Promise 拒绝
    }
  });

  // 监听删除文件夹
  watcher.on('unlinkDir', async (dirPath) => {
    console.log('删除文件夹:', dirPath);
    try {
      await handleDeletedFolder(dirPath, dataPath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:changed', { type: 'folder_deleted', path: dirPath });
      }
    } catch (error) {
      console.error('处理删除文件夹失败:', error);
      // 不抛出错误，避免未处理的 Promise 拒绝
    }
  });

  // 监听NFO文件变化
  watcher.on('change', async (filePath) => {
    if (path.extname(filePath).toLowerCase() === '.nfo') {
      console.log('NFO文件变化:', filePath);
      try {
        const folderPath = path.dirname(filePath);
        await handleMovieUpdate(folderPath, dataPath);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', { type: 'movie_updated', path: folderPath });
        }
      } catch (error) {
        console.error('处理NFO文件变化失败:', error);
        // 不抛出错误，避免未处理的 Promise 拒绝
      }
    }
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
  isWatching = false;
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
  
  // 找到对应的数据路径
  let dataPath = null;
  for (const dp of dataPaths) {
    if (folderPath.startsWith(dp)) {
      dataPath = dp;
      break;
    }
  }
  
  if (!dataPath) {
    return;
  }

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
      await handleMovieUpdate(folderPath, dataPath);
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
 */
async function handleNewMovie(movieFolderPath, dataPath) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;

  // 解析NFO文件：支持任意文件名，只要是 .nfo 后缀
  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) {
    console.warn('handleNewMovie: 未找到 NFO 文件，跳过', movieFolderPath);
    return;
  }
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);
  
  // 获取图片路径
  const { poster, fanart } = await getImagePaths(movieFolderPath);
  
  // 检查是否有视频文件
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);
  
  // 获取或创建导演（"----" 表示空值）
  let director = null;
  if (movieData.director && movieData.director.trim() !== '' && movieData.director.trim() !== '----') {
    [director] = await Director.findOrCreate({
      where: { name: movieData.director },
      defaults: { name: movieData.director }
    });
  }
  
  // 获取或创建制作商（"----" 表示空值）
  let studio = null;
  if (movieData.studio && movieData.studio.trim() !== '' && movieData.studio.trim() !== '----') {
    [studio] = await Studio.findOrCreate({
      where: { name: movieData.studio },
      defaults: { name: movieData.studio }
    });
  }
  
  // 创建影片
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
      video_path: videoPath ? path.relative(dataPath, videoPath) : null
    }
  });
  
  // 如果不是新创建的，更新数据（包括playable和video_path）
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
      video_path: videoPath ? path.relative(dataPath, videoPath) : null
    });
  }
  
  // 先清除旧的关联关系
  await movie.setActorsFromNfo([]);
  await movie.setGenres([]);
  
  // 处理NFO文件中的演员（所有演员数据均来自NFO）
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
  
  // 处理分类
  for (const genreName of movieData.genres) {
    if (!genreName) continue;
    const [genre] = await Genre.findOrCreate({
      where: { name: genreName },
      defaults: { name: genreName }
    });
    await movie.addGenre(genre);
  }
}

/**
 * 扫描演员文件夹
 */
async function scanActorFolder(actorFolderPath, dataPath) {
  const fs = require('fs-extra');
  const entries = await fs.readdir(actorFolderPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const movieFolderPath = path.join(actorFolderPath, entry.name);
      if (await isMovieFolder(movieFolderPath)) {
        await handleNewMovie(movieFolderPath, dataPath);
      }
    }
  }
}

/**
 * 处理影片更新
 */
async function handleMovieUpdate(movieFolderPath, dataPath) {
  const sequelize = getSequelize();
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;
  
  // 解析NFO文件：支持任意文件名，只要是 .nfo 后缀
  const nfoFiles = await getNfoFiles(movieFolderPath);
  if (!nfoFiles || nfoFiles.length === 0) {
    console.warn('handleMovieUpdate: 未找到 NFO 文件，跳过', movieFolderPath);
    return;
  }
  const nfoPath = nfoFiles[0];
  const movieData = await parseNfoFile(nfoPath);
  
  // 获取图片路径
  const { poster, fanart } = await getImagePaths(movieFolderPath);
  
  // 检查是否有视频文件
  const { playable, videoPath } = await checkVideoFile(movieFolderPath);
  
  // 查找影片
  const movie = await Movie.findOne({ where: { code: movieData.code } });
  if (!movie) {
    // 如果不存在，按新增处理
    await handleNewMovie(movieFolderPath, dataPath);
    return;
  }
  
  // 获取或创建导演（"----" 表示空值）
  let director = null;
  if (movieData.director && movieData.director.trim() !== '' && movieData.director.trim() !== '----') {
    [director] = await Director.findOrCreate({
      where: { name: movieData.director },
      defaults: { name: movieData.director }
    });
  }
  
  // 获取或创建制作商（"----" 表示空值）
  let studio = null;
  if (movieData.studio && movieData.studio.trim() !== '' && movieData.studio.trim() !== '----') {
    [studio] = await Studio.findOrCreate({
      where: { name: movieData.studio },
      defaults: { name: movieData.studio }
    });
  }
  
  // 更新影片
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
    video_path: videoPath ? path.relative(dataPath, videoPath) : null
  });
  
  // 更新NFO文件中的演员（所有演员数据均来自NFO）
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
  
  // 更新分类
  await movie.setGenres([]); // 清空现有分类
  for (const genreName of movieData.genres) {
    if (!genreName) continue;
    const [genre] = await Genre.findOrCreate({
      where: { name: genreName },
      defaults: { name: genreName }
    });
    await movie.addGenre(genre);
  }
}

/**
 * 处理删除的文件夹
 */
async function handleDeletedFolder(dirPath, dataPath) {
  const sequelize = getSequelize();
  const Movie = sequelize.models.Movie;
  
  // 查找相关的影片记录
  const relativePath = path.relative(dataPath, dirPath);
  const movies = await Movie.findAll({
    where: {
      folder_path: relativePath
    }
  });
  
  // 删除影片记录（关联的演员和分类会自动处理）
  for (const movie of movies) {
    await movie.destroy();
  }
}

module.exports = {
  initFileWatcher,
  stopFileWatcher,
  watchFolderTemporarily,
  getWatcherStatus: () => isWatching
};
