const { ipcMain, dialog, BrowserWindow, shell } = require('electron');
const { getDataPath, getDataPaths, setDataPath, addDataPath, removeDataPath, validatePath } = require('../config/paths');
const { getSequelize } = require('../config/database');
const { scanDataFolder } = require('../services/scanner');
const { Op } = require('sequelize');
const { parseNfoFile, writeNfoFile, updateNfoFilePartial, readNfoTagContent } = require('../utils/xmlParser');
const { getExtraFanartRelativePaths } = require('../utils/fileUtils');
const path = require('path');
const fs = require('fs-extra');
const Store = require('electron-store');

// 存储主窗口引用，用于动态获取
let mainWindowRef = null;

// 注册所有IPC处理器
function registerIpcHandlers(mainWindow, dataPath, store) {
  console.log('开始注册IPC处理器...');
  
  // 保存主窗口引用
  mainWindowRef = mainWindow;
  
  // 创建设置存储实例
  // 在开发环境中使用不同的配置名称，避免与生产环境共享数据
  const settingsStore = store || new Store({
    name: process.env.NODE_ENV === 'development' ? 'javlibrary-dev' : 'javlibrary'
  });

  /** 根据 sortBy 参数返回 Sequelize order 数组（支持 premiered/title/folder_updated_at 正序/倒序） */
  function getOrderFromSortBy(sortBy) {
    if (sortBy === 'title-asc') return [['title', 'ASC']];
    if (sortBy === 'title-desc') return [['title', 'DESC']];
    if (sortBy === 'premiered-asc') return [['premiered', 'ASC']];
    if (sortBy === 'premiered-desc') return [['premiered', 'DESC']];
    if (sortBy === 'folder_updated_at-asc') return [['folder_updated_at', 'ASC']];
    if (sortBy === 'folder_updated_at-desc') return [['folder_updated_at', 'DESC']];
    return [['premiered', 'DESC']];
  }
  
  // 注意：所有IPC处理器都将在运行时动态获取模型，确保数据库已初始化
  // 这样可以避免在注册时模型未初始化的问题

  // 配置相关IPC
  ipcMain.handle('config:getDataPath', () => {
    return getDataPath();
  });

  ipcMain.handle('config:getDataPaths', () => {
    return getDataPaths();
  });

  ipcMain.handle('config:addDataPath', async () => {
    try {
      const currentWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      const newPath = await addDataPath(currentWindow);
      if (newPath) {
        // 通知前端路径已更新
        currentWindow?.webContents.send('config:dataPathChanged', newPath);
        return { success: true, path: newPath, paths: getDataPaths() };
      } else {
        return { success: false, message: '操作已取消' };
      }
    } catch (error) {
      console.error('添加路径失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('config:removeDataPath', async (event, pathToRemove) => {
    try {
      if (!pathToRemove) {
        return { success: false, message: '路径不能为空' };
      }
      const removed = removeDataPath(pathToRemove);
      if (removed) {
        return { success: true, paths: getDataPaths() };
      } else {
        return { success: false, message: '路径不存在' };
      }
    } catch (error) {
      console.error('删除路径失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('config:setDataPath', async () => {
    try {
      // 动态获取当前主窗口（如果传入的mainWindow为null，尝试获取）
      const currentWindow = mainWindowRef || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!currentWindow) {
        return { success: false, message: '无法打开对话框：窗口未创建' };
      }
      
      const newPath = await setDataPath(currentWindow);
      if (newPath) {
        // 通知前端路径已更改
        if (currentWindow && !currentWindow.isDestroyed()) {
          currentWindow.webContents.send('config:dataPathChanged', newPath);
        }
        return { success: true, path: newPath };
      }
      return { success: false, message: '用户取消了选择' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('config:validatePath', (event, pathToValidate) => {
    return validatePath(pathToValidate);
  });

  // 设置相关IPC
  ipcMain.handle('settings:getFilterPlayable', () => {
    return settingsStore.get('filterPlayable', false);
  });

  ipcMain.handle('settings:setFilterPlayable', (event, value) => {
    settingsStore.set('filterPlayable', value);
    return { success: true };
  });

  // 播放相关IPC
  ipcMain.handle('movie:playVideo', async (event, movieId) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      const movieIdNum = parseInt(movieId);
      if (isNaN(movieIdNum)) {
        return { success: false, message: '无效的影片ID' };
      }
      
      const Movie = sequelize.models.Movie;
      const movie = await Movie.findByPk(movieIdNum);
      
      if (!movie) {
        return { success: false, message: '影片不存在' };
      }
      
      if (!movie.playable || !movie.video_path) {
        return { success: false, message: '该影片不可播放' };
      }
      
      // 根据 data_path_index 获取对应的数据路径
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: false, message: '数据路径未设置' };
      }
      
      const dataPathIndex = movie.data_path_index || 0;
      const dataPath = dataPaths[dataPathIndex] || dataPaths[0];
      if (!dataPath) {
        return { success: false, message: '数据路径未设置' };
      }
      
      const videoPath = path.join(dataPath, movie.video_path);
      
      // 检查文件是否存在
      if (!await fs.pathExists(videoPath)) {
        // 如果指定路径不存在，尝试在所有路径中查找
        let foundPath = null;
        for (const dp of dataPaths) {
          const testPath = path.join(dp, movie.video_path);
          if (await fs.pathExists(testPath)) {
            foundPath = testPath;
            break;
          }
        }
        
        if (!foundPath) {
          return { success: false, message: '视频文件不存在' };
        }
        
        // 使用找到的路径
        await shell.openPath(foundPath);
        return { success: true };
      }
      
      // 使用系统默认播放器打开视频文件
      await shell.openPath(videoPath);
      
      return { success: true };
    } catch (error) {
      console.error('播放视频失败:', error);
      return { success: false, message: error.message };
    }
  });

  // 影片相关IPC（暂时返回空实现，后续完善）
  ipcMain.handle('movies:getList', async (event, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      const Movie = sequelize.models.Movie;
      if (!Movie) {
        console.error('Movie模型未找到，已注册的模型:', Object.keys(sequelize.models || {}));
        return { success: false, message: 'Movie模型未初始化', data: [], total: 0 };
      }
      const { page = 1, pageSize = 20, sortBy = 'premiered', actorId, genreId, studioId } = params;
      
      // 检查是否启用可播放过滤
      const filterPlayable = settingsStore.get('filterPlayable', false);
      
      const where = {};
      if (filterPlayable) {
        where.playable = true;
      }
      const include = [];
      
      // 处理演员筛选
      if (actorId) {
        include.push({
          model: sequelize.models.Actor,
          where: { id: actorId },
          through: { attributes: [] },
          attributes: ['id', 'name'],
          required: true
        });
      } else {
        include.push({
          model: sequelize.models.Actor,
          through: { attributes: [] },
          attributes: ['id', 'name']
        });
      }
      
      // 处理分类筛选
      if (genreId) {
        include.push({
          model: sequelize.models.Genre,
          where: { id: genreId },
          through: { attributes: [] },
          attributes: ['id', 'name'],
          required: true
        });
      } else {
        include.push({
          model: sequelize.models.Genre,
          through: { attributes: [] },
          attributes: ['id', 'name']
        });
      }
      
      // 处理制作商筛选
      if (studioId) {
        where.studio_id = studioId;
      }
      
      include.push({
        model: sequelize.models.Studio,
        attributes: ['id', 'name'],
        required: false
      });
      
      const order = getOrderFromSortBy(sortBy);
      const { count, rows } = await Movie.findAndCountAll({
        where,
        include,
        order,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true
      });
      
      // 将Sequelize Model实例转换为普通对象，确保可以序列化
      const moviesData = rows.map(movie => {
        const movieData = {
          id: movie.id,
          title: movie.title,
          code: movie.code,
          runtime: movie.runtime,
          premiered: movie.premiered,
          director: movie.director,
          studio_id: movie.studio_id,
          poster_path: movie.poster_path,
          fanart_path: movie.fanart_path,
          nfo_path: movie.nfo_path,
          folder_path: movie.folder_path,
          playable: movie.playable,
          video_path: movie.video_path,
          data_path_index: movie.data_path_index || 0,
          folder_updated_at: movie.folder_updated_at,
          created_at: movie.created_at,
          updated_at: movie.updated_at
        };
        
        // 处理关联数据
        if (movie.Actors && Array.isArray(movie.Actors)) {
          movieData.actors = movie.Actors.map(actor => ({
            id: actor.id,
            name: actor.name
          }));
        }
        
        if (movie.Genres && Array.isArray(movie.Genres)) {
          movieData.genres = movie.Genres.map(genre => ({
            id: genre.id,
            name: genre.name
          }));
        }
        
        if (movie.Studio) {
          movieData.studio = {
            id: movie.Studio.id,
            name: movie.Studio.name
          };
        }
        
        return movieData;
      });
      
      return { success: true, data: moviesData, total: count };
    } catch (error) {
      console.error('获取影片列表失败:', error);
      const isTableMissing = error.message && /no such table:\s*movies/i.test(error.message);
      if (isTableMissing) {
        return { success: false, code: 'DB_NOT_READY', message: '数据库表尚未就绪，请稍候', data: [], total: 0 };
      }
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  ipcMain.handle('movies:getById', async (event, id) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      // 确保id是数字
      const movieId = parseInt(id);
      if (isNaN(movieId)) {
        console.error('无效的影片ID:', id);
        return { success: false, message: '无效的影片ID' };
      }
      
      const Movie = sequelize.models.Movie;
      const ActorFromNfo = sequelize.models.ActorFromNfo;
      
      // 所有演员数据均来自NFO
      const includeOptions = [
        { 
          model: ActorFromNfo, 
          through: { attributes: [] }, 
          attributes: ['id', 'name'],
          as: 'ActorsFromNfo'
        },
        { model: sequelize.models.Genre, through: { attributes: [] }, attributes: ['id', 'name'] },
        { model: sequelize.models.Studio, attributes: ['id', 'name'] },
        { model: sequelize.models.Director, attributes: ['id', 'name'] }
      ];
      
      const movie = await Movie.findByPk(movieId, {
        include: includeOptions
      });
      if (!movie) {
        return { success: false, message: '影片不存在' };
      }
      
      // 将Sequelize Model实例转换为普通对象，确保可以序列化
      const movieData = {
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director_id: movie.director_id,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        data_path_index: movie.data_path_index || 0,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      };
      
      // 处理关联数据 - 所有演员数据均来自NFO，都在数据库中
      const dbActors = movie.ActorsFromNfo && Array.isArray(movie.ActorsFromNfo) 
        ? movie.ActorsFromNfo.map(actor => ({ id: actor.id, name: actor.name, inDatabase: true }))
        : [];
      
      movieData.actors = dbActors;
      
      if (movie.Genres && Array.isArray(movie.Genres)) {
        movieData.genres = movie.Genres.map(genre => ({
          id: genre.id,
          name: genre.name
        }));
      }
      
      if (movie.Studio) {
        movieData.studio = {
          id: movie.Studio.id,
          name: movie.Studio.name
        };
      }
      
      if (movie.Director) {
        movieData.director = {
          id: movie.Director.id,
          name: movie.Director.name
        };
      } else {
        movieData.director = null;
      }
      
      return { success: true, data: movieData };
    } catch (error) {
      console.error('获取影片详情失败:', error);
      return { success: false, message: error.message };
    }
  });

  /** 获取详情页扩展数据：NFO 中的 originalplot（作品简介）、预览图列表（详情图 + extrafanart 文件夹内图片） */
  ipcMain.handle('movies:getDetailExtras', async (event, id) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: null };
      }
      const movieId = parseInt(id);
      if (isNaN(movieId)) {
        return { success: false, message: '无效的影片ID', data: null };
      }
      const Movie = sequelize.models.Movie;
      const movie = await Movie.findByPk(movieId, {
        attributes: ['folder_path', 'nfo_path', 'poster_path', 'fanart_path', 'data_path_index']
      });
      if (!movie || !movie.folder_path) {
        return { success: true, data: { originalplot: null, previewImagePaths: [] } };
      }
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: true, data: { originalplot: null, previewImagePaths: [] } };
      }
      // 解析实际根路径：优先用 data_path_index，若该根下文件不存在则依次尝试其他根（避免索引陈旧或迁移错误导致取不到数据）
      const dataPathIndex = movie.data_path_index != null ? movie.data_path_index : 0;
      const preferredRoot = dataPaths[dataPathIndex] || dataPaths[0];
      let dataPath = null;
      const checkPath = (root) => {
        if (movie.nfo_path) {
          return fs.pathExists(path.join(root, movie.nfo_path));
        }
        return fs.pathExists(path.join(root, movie.folder_path));
      };
      if (await checkPath(preferredRoot)) {
        dataPath = preferredRoot;
      } else {
        for (const root of dataPaths) {
          if (root === preferredRoot) continue;
          if (await checkPath(root)) {
            dataPath = root;
            break;
          }
        }
      }
      if (!dataPath) {
        return { success: true, data: { originalplot: null, previewImagePaths: [] } };
      }
      let originalplot = null;
      if (movie.nfo_path) {
        const nfoFullPath = path.join(dataPath, movie.nfo_path);
        try {
          if (await fs.pathExists(nfoFullPath)) {
            originalplot = await readNfoTagContent(nfoFullPath, 'originalplot');
          }
        } catch (e) {
          console.error('读取 NFO originalplot 失败:', e);
        }
      }
      const extraPaths = await getExtraFanartRelativePaths(dataPath, movie.folder_path);
      const mainPath = movie.fanart_path || movie.poster_path;
      const previewImagePaths = mainPath ? [mainPath, ...extraPaths] : [...extraPaths];
      return {
        success: true,
        data: { originalplot: originalplot || null, previewImagePaths }
      };
    } catch (error) {
      console.error('获取详情扩展数据失败:', error);
      return { success: false, message: error.message, data: null };
    }
  });

  ipcMain.handle('movies:create', async (event, data) => {
    // TODO: 实现影片创建
    return null;
  });

  ipcMain.handle('movies:update', async (event, id, data) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      const Movie = sequelize.models.Movie;
      const ActorFromNfo = sequelize.models.ActorFromNfo;
      const Genre = sequelize.models.Genre;
      const Studio = sequelize.models.Studio;
      const Director = sequelize.models.Director;
      
      // 确保id是数字
      const movieId = parseInt(id);
      if (isNaN(movieId)) {
        return { success: false, message: '无效的影片ID' };
      }
      
      // 查找影片（包含关联数据）
      const movie = await Movie.findByPk(movieId, {
        include: [
          { model: ActorFromNfo, through: { attributes: [] }, attributes: ['id', 'name'], as: 'ActorsFromNfo' },
          { model: Genre, through: { attributes: [] }, attributes: ['id', 'name'] },
          { model: Studio, attributes: ['id', 'name'] },
          { model: Director, attributes: ['id', 'name'] }
        ]
      });
      if (!movie) {
        return { success: false, message: '影片不存在' };
      }
      
      // 获取数据路径
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: false, message: '数据路径未设置' };
      }
      
      // 查找NFO文件路径（尝试所有数据路径）
      let nfoPath = null;
      let dataPath = null;
      for (const dp of dataPaths) {
        const fullNfoPath = path.join(dp, movie.nfo_path);
        if (await fs.pathExists(fullNfoPath)) {
          nfoPath = fullNfoPath;
          dataPath = dp;
          break;
        }
      }
      
      if (!nfoPath) {
        return { success: false, message: '找不到NFO文件' };
      }
      
      // 获取或创建导演（"----" 表示空值）
      let director = null;
      if (data.director && data.director.trim() !== '' && data.director.trim() !== '----') {
        [director] = await Director.findOrCreate({
          where: { name: data.director },
          defaults: { name: data.director }
        });
      }
      
      // 获取或创建制作商（"----" 表示空值）
      let studio = null;
      if (data.studio && data.studio.trim() !== '' && data.studio.trim() !== '----') {
        [studio] = await Studio.findOrCreate({
          where: { name: data.studio },
          defaults: { name: data.studio }
        });
      }
      
      // 更新数据库
      await movie.update({
        title: data.title || movie.title,
        runtime: data.runtime !== undefined ? (data.runtime || null) : movie.runtime,
        premiered: data.premiered || movie.premiered,
        director_id: director ? director.id : (data.director === null ? null : movie.director_id),
        studio_id: studio ? studio.id : (data.studio === null ? null : movie.studio_id)
      });
      
      // 更新演员关联（所有演员数据均来自NFO）
      if (data.actors !== undefined) {
        await movie.setActorsFromNfo([]);
        if (data.actors && Array.isArray(data.actors) && data.actors.length > 0) {
          const actorNames = data.actors.map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
          for (const actorName of actorNames) {
            const [actor] = await ActorFromNfo.findOrCreate({
              where: { name: actorName },
              defaults: { name: actorName }
            });
            await movie.addActorsFromNfo(actor);
          }
        }
      }
      
      // 更新分类关联
      if (data.genres !== undefined) {
        await movie.setGenres([]);
        if (data.genres && Array.isArray(data.genres) && data.genres.length > 0) {
          const genreNames = data.genres.map(g => typeof g === 'string' ? g : g.name).filter(Boolean);
          for (const genreName of genreNames) {
            const [genre] = await Genre.findOrCreate({
              where: { name: genreName },
              defaults: { name: genreName }
            });
            await movie.addGenre(genre);
          }
        }
      }
      
      // 准备NFO文件数据
      const movieData = {
        title: data.title || movie.title,
        code: movie.code, // 识别码不可修改
        runtime: data.runtime !== undefined ? (data.runtime || null) : movie.runtime,
        premiered: data.premiered || movie.premiered,
        director: director ? director.name : (data.director === null ? null : (movie.Director ? movie.Director.name : null)),
        studio: studio ? studio.name : (data.studio === null ? null : (movie.Studio ? movie.Studio.name : null)),
        actors: data.actors !== undefined 
          ? (data.actors && Array.isArray(data.actors) ? data.actors.map(a => typeof a === 'string' ? a : a.name).filter(Boolean) : [])
          : (movie.ActorsFromNfo && Array.isArray(movie.ActorsFromNfo) ? movie.ActorsFromNfo.map(a => a.name) : []),
        genres: data.genres !== undefined
          ? (data.genres && Array.isArray(data.genres) ? data.genres.map(g => typeof g === 'string' ? g : g.name).filter(Boolean) : [])
          : (movie.Genres && Array.isArray(movie.Genres) ? movie.Genres.map(g => g.name) : [])
      };
      
      // 仅更新 NFO 中可编辑字段，保留其余节点（若解析失败则全量覆盖）
      try {
        await updateNfoFilePartial(nfoPath, movieData);
      } catch (partialError) {
        console.warn('NFO 局部更新失败，改为全量写入:', partialError.message);
        await writeNfoFile(nfoPath, movieData);
      }
      
      // 编辑后临时监听该文件夹 NFO 变化（5 秒），便于外部修改 NFO 时同步
      const { watchFolderTemporarily } = require('../services/sync');
      const folderPath = path.dirname(nfoPath);
      watchFolderTemporarily(folderPath, mainWindow, 5000).catch(err => {
        console.error('临时监听失败:', err);
      });
      
      // 重新查询影片数据以返回最新信息（确保关联数据被正确加载）
      const updatedMovie = await Movie.findByPk(movieId, {
        include: [
          { model: ActorFromNfo, through: { attributes: [] }, attributes: ['id', 'name'], as: 'ActorsFromNfo' },
          { model: Genre, through: { attributes: [] }, attributes: ['id', 'name'] },
          { model: Studio, attributes: ['id', 'name'] },
          { model: Director, attributes: ['id', 'name'] }
        ]
      });
      
      if (!updatedMovie) {
        return { success: false, message: '重新加载影片数据失败' };
      }
      
      // 将Sequelize Model实例转换为普通对象，确保可以序列化
      // 格式与 movies:getById 保持一致
      const result = {
        id: updatedMovie.id,
        title: updatedMovie.title,
        code: updatedMovie.code,
        runtime: updatedMovie.runtime,
        premiered: updatedMovie.premiered,
        director_id: updatedMovie.director_id,
        studio_id: updatedMovie.studio_id,
        poster_path: updatedMovie.poster_path,
        fanart_path: updatedMovie.fanart_path,
        nfo_path: updatedMovie.nfo_path,
        folder_path: updatedMovie.folder_path,
        playable: updatedMovie.playable,
        video_path: updatedMovie.video_path,
        data_path_index: updatedMovie.data_path_index || 0,
        created_at: updatedMovie.created_at,
        updated_at: updatedMovie.updated_at
      };
      
      // 处理关联数据 - 所有演员数据均来自NFO，都在数据库中
      const dbActors = updatedMovie.ActorsFromNfo && Array.isArray(updatedMovie.ActorsFromNfo) 
        ? updatedMovie.ActorsFromNfo.map(actor => ({ id: actor.id, name: actor.name, inDatabase: true }))
        : [];
      
      result.actors = dbActors;
      
      if (updatedMovie.Genres && Array.isArray(updatedMovie.Genres)) {
        result.genres = updatedMovie.Genres.map(genre => ({
          id: genre.id,
          name: genre.name
        }));
      } else {
        result.genres = [];
      }
      
      if (updatedMovie.Studio) {
        result.studio = {
          id: updatedMovie.Studio.id,
          name: updatedMovie.Studio.name
        };
      } else {
        result.studio = null;
      }
      
      if (updatedMovie.Director) {
        result.director = {
          id: updatedMovie.Director.id,
          name: updatedMovie.Director.name
        };
      } else {
        result.director = null;
      }
      
      return { success: true, data: result, message: '影片信息已更新' };
    } catch (error) {
      console.error('更新影片失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('movies:delete', async (event, id, deleteFile) => {
    // TODO: 实现影片删除
    return null;
  });

  ipcMain.handle('movies:openFileLocation', async (event, id) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      const Movie = sequelize.models.Movie;
      const movieId = parseInt(id);
      if (isNaN(movieId)) {
        return { success: false, message: '无效的影片ID' };
      }
      
      const movie = await Movie.findByPk(movieId);
      if (!movie) {
        return { success: false, message: '影片不存在' };
      }
      
      // 获取数据路径
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: false, message: '数据路径未设置' };
      }
      
      // 根据 data_path_index 优先查找文件夹路径
      let folderPath = null;
      const dataPathIndex = movie.data_path_index || 0;
      const preferredDataPath = dataPaths[dataPathIndex] || dataPaths[0];
      
      // 先尝试使用 data_path_index 对应的路径
      if (preferredDataPath) {
        const fullFolderPath = path.join(preferredDataPath, movie.folder_path);
        if (await fs.pathExists(fullFolderPath)) {
          folderPath = fullFolderPath;
        }
      }
      
      // 如果指定路径不存在，尝试所有数据路径
      if (!folderPath) {
        for (const dp of dataPaths) {
          const fullFolderPath = path.join(dp, movie.folder_path);
          if (await fs.pathExists(fullFolderPath)) {
            folderPath = fullFolderPath;
            break;
          }
        }
      }
      
      if (!folderPath) {
        return { success: false, message: '找不到文件所在文件夹' };
      }
      
      // 尝试根据数据库中的 nfo_path 找到实际的 NFO 文件（支持任意文件名）
      let nfoFullPath = null;
      if (movie.nfo_path) {
        for (const dp of dataPaths) {
          const testPath = path.join(dp, movie.nfo_path);
          if (await fs.pathExists(testPath)) {
            nfoFullPath = testPath;
            break;
          }
        }
      }

      // 如果通过 nfo_path 没找到，则在影片文件夹中查找任意 .nfo 文件
      if (!nfoFullPath) {
        try {
          const files = await fs.readdir(folderPath);
          const nfoFile = files.find(f => path.extname(f).toLowerCase() === '.nfo');
          if (nfoFile) {
            nfoFullPath = path.join(folderPath, nfoFile);
          }
        } catch (e) {
          console.error('读取文件夹内容失败:', e);
        }
      }

      // 如果找到 NFO 文件，在文件管理器中显示并选中它，否则直接打开文件夹
      if (nfoFullPath && await fs.pathExists(nfoFullPath)) {
        shell.showItemInFolder(nfoFullPath);
      } else {
        await shell.openPath(folderPath);
      }
      
      return { success: true };
    } catch (error) {
      console.error('打开文件所在位置失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('movies:getSeries', async (event, codeOrPrefix) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [] };
      }
      const Movie = sequelize.models.Movie;
      
      // 检查是否启用可播放过滤
      const filterPlayable = settingsStore.get('filterPlayable', false);
      
      // 提取系列前缀（如CAWD-001 -> CAWD，或直接使用CAWD）
      const seriesPrefix = codeOrPrefix.includes('-') 
        ? codeOrPrefix.split('-')[0] 
        : codeOrPrefix;
      
      const where = {
        code: {
          [Op.like]: `${seriesPrefix}-%`
        }
      };
      
      if (filterPlayable) {
        where.playable = true;
      }
      
      const movies = await Movie.findAll({
        where,
        include: [
          { model: sequelize.models.Actor, through: { attributes: [] }, attributes: ['id', 'name'] },
          { model: sequelize.models.Genre, through: { attributes: [] }, attributes: ['id', 'name'] },
          { model: sequelize.models.Studio, attributes: ['id', 'name'] }
        ],
        order: [['code', 'ASC']]
      });
      
      // 将Sequelize Model实例转换为普通对象，确保可以序列化
      const moviesData = movies.map(movie => {
        const movieData = {
          id: movie.id,
          title: movie.title,
          code: movie.code,
          runtime: movie.runtime,
          premiered: movie.premiered,
          director: movie.director,
          studio_id: movie.studio_id,
          poster_path: movie.poster_path,
          fanart_path: movie.fanart_path,
          nfo_path: movie.nfo_path,
          folder_path: movie.folder_path,
          playable: movie.playable,
          video_path: movie.video_path,
          data_path_index: movie.data_path_index || 0,
          folder_updated_at: movie.folder_updated_at,
          created_at: movie.created_at,
          updated_at: movie.updated_at
        };
        
        // 处理关联数据
        if (movie.Actors && Array.isArray(movie.Actors)) {
          movieData.actors = movie.Actors.map(actor => ({
            id: actor.id,
            name: actor.name
          }));
        }
        
        if (movie.Genres && Array.isArray(movie.Genres)) {
          movieData.genres = movie.Genres.map(genre => ({
            id: genre.id,
            name: genre.name
          }));
        }
        
        if (movie.Studio) {
          movieData.studio = {
            id: movie.Studio.id,
            name: movie.Studio.name
          };
        }
        
        return movieData;
      });
      
      return { success: true, data: moviesData };
    } catch (error) {
      console.error('获取系列影片失败:', error);
      return { success: false, message: error.message, data: [] };
    }
  });

  ipcMain.handle('movies:getImage', async (event, imagePath, dataPathIndex = 0) => {
    try {
      if (!imagePath) {
        return null;
      }
      const fs = require('fs');
      const path = require('path');
      const { getDataPaths } = require('../config/paths');
      
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return null;
      }
      
      // 根据路径索引获取对应的数据路径
      const dataPath = dataPaths[dataPathIndex] || dataPaths[0];
      if (!dataPath) {
        return null;
      }
      
      const fullPath = path.join(dataPath, imagePath);
      if (!fs.existsSync(fullPath)) {
        // 如果指定路径不存在，尝试在所有路径中查找
        for (const dp of dataPaths) {
          const testPath = path.join(dp, imagePath);
          if (fs.existsSync(testPath)) {
            const imageBuffer = fs.readFileSync(testPath);
            const ext = path.extname(testPath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
            return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
          }
        }
        return null;
      }
      
      // 读取图片文件并转换为base64
      const imageBuffer = fs.readFileSync(fullPath);
      const base64 = imageBuffer.toString('base64');
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error('读取图片失败:', error);
      return null;
    }
  });

  // 演员相关IPC
  ipcMain.handle('actors:getList', async (event, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      // 获取显示模式：'folder' 文件目录模式 或 'actor' 女优目录模式
      const viewMode = params.viewMode || 'folder';
      
      const Movie = sequelize.models.Movie;
      const ActorFromNfo = sequelize.models.ActorFromNfo;
      
      let actorsData = [];
      
      if (viewMode === 'folder') {
        // 文件目录模式：从Movie的folder_path提取文件夹结构，按文件夹分组
        const movies = await Movie.findAll({
          attributes: ['id', 'folder_path', 'playable'],
          raw: true
        });
        
        // 按文件夹路径分组
        const folderMap = new Map();
        for (const movie of movies) {
          if (!movie.folder_path) continue;
          
          // 提取文件夹名（第一级目录，即演员文件夹名）
          // 支持两种路径分隔符：/ 和 \
          const pathParts = movie.folder_path.split(/[/\\]/);
          const folderName = pathParts[0];
          
          if (!folderName) continue; // 跳过空文件夹名
          
          if (!folderMap.has(folderName)) {
            folderMap.set(folderName, { movies: [], playableCount: 0, totalCount: 0 });
          }
          
          const folderData = folderMap.get(folderName);
          folderData.movies.push(movie);
          folderData.totalCount++;
          if (movie.playable === true || movie.playable === 1) {
            folderData.playableCount++;
          }
        }
        
        // 转换为数组格式
        actorsData = Array.from(folderMap.entries()).map(([name, data]) => ({
          id: `folder_${name}`, // 使用文件夹名作为ID的一部分
          name: name,
          totalCount: data.totalCount,
          playableCount: data.playableCount,
          viewMode: 'folder'
        }));
        
        // 按名称排序
        actorsData.sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`actors:getList 文件目录模式查询到 ${actorsData.length} 条记录`);
      } else {
        // 女优目录模式：使用ActorFromNfo表查询
        const includeOptions = {
          model: Movie,
          through: { attributes: [] },
          attributes: ['id', 'playable'],
          required: false,
          as: 'Movies'
        };
        
        const actors = await ActorFromNfo.findAll({
          include: [includeOptions],
          order: [['name', 'ASC']],
          raw: false
        });
        
        // 统计每个演员的电影数量和可播放数量
        actorsData = actors.map(actor => {
          const movies = actor.Movies || [];
          const totalCount = movies.length;
          const playableCount = movies.filter(m => m.playable === true || m.playable === 1).length;
          
          return {
            id: actor.id,
            name: actor.name,
            totalCount,
            playableCount,
            viewMode: 'actor',
            created_at: actor.created_at,
            updated_at: actor.updated_at
          };
        });
        
        console.log(`actors:getList 女优目录模式查询到 ${actorsData.length} 条记录`);
      }
      
      if (actorsData.length > 0) {
        console.log('actors:getList 返回数据示例:', actorsData[0]);
      }
      
      return { success: true, data: actorsData };
    } catch (error) {
      console.error('获取演员列表失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('actors:getById', async (event, id, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      
      // 获取显示模式
      const viewMode = params.viewMode || 'folder';
      
      let actorData;
      
      if (viewMode === 'folder') {
        // 文件目录模式：id是文件夹名
        const folderName = id;
        actorData = {
          id: `folder_${folderName}`,
          name: folderName,
          viewMode: 'folder'
        };
      } else {
        // 女优目录模式：使用ActorFromNfo查询
        const actorId = parseInt(id);
        if (isNaN(actorId)) {
          return { success: false, message: '无效的演员ID' };
        }
        
        const ActorFromNfo = sequelize.models.ActorFromNfo;
        const actor = await ActorFromNfo.findByPk(actorId);
        
        if (!actor) {
          return { success: false, message: '演员不存在' };
        }
        
        actorData = {
          id: actor.id,
          name: actor.name,
          viewMode: 'actor',
          created_at: actor.created_at,
          updated_at: actor.updated_at
        };
      }
      
      return { success: true, data: actorData };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('actors:getMovies', async (event, id, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      // 获取显示模式
      const viewMode = params.viewMode || 'folder';
      
      const Movie = sequelize.models.Movie;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      const { page = 1, pageSize = 20, sortBy = 'premiered' } = params;
      const order = getOrderFromSortBy(sortBy);
      let actorData;
      let where = {};
      
      if (viewMode === 'folder') {
        // 文件目录模式：根据文件夹路径查询
        const folderName = decodeURIComponent(id);
        // folder_path 格式是 "演员名/作品名" 或 "演员名\作品名"（取决于操作系统）
        // 需要匹配以 "文件夹名/" 或 "文件夹名\" 开头的路径
        // 使用 Op.or 同时匹配两种路径分隔符，确保跨平台兼容
        where.folder_path = { 
          [Op.or]: [
            { [Op.like]: `${folderName}/%` },
            { [Op.like]: `${folderName}\\%` }
          ]
        };
        
        if (filterPlayable) {
          where.playable = true;
        }
        
        actorData = {
          id: `folder_${folderName}`,
          name: folderName,
          viewMode: 'folder'
        };
        
        console.log('文件目录模式查询 - 文件夹名:', folderName, '查询条件:', JSON.stringify(where));
        
        const { count, rows } = await Movie.findAndCountAll({
          where,
          order,
          limit: pageSize,
          offset: (page - 1) * pageSize
        });
        
        const moviesData = rows.map(movie => ({
          id: movie.id,
          title: movie.title,
          code: movie.code,
          runtime: movie.runtime,
          premiered: movie.premiered,
          director: movie.director,
          studio_id: movie.studio_id,
          poster_path: movie.poster_path,
          fanart_path: movie.fanart_path,
          nfo_path: movie.nfo_path,
          folder_path: movie.folder_path,
          playable: movie.playable,
          video_path: movie.video_path,
          data_path_index: movie.data_path_index || 0,
          folder_updated_at: movie.folder_updated_at,
          created_at: movie.created_at,
          updated_at: movie.updated_at
        }));
        
        return {
          success: true,
          data: moviesData,
          total: count,
          actor: actorData
        };
      } else {
        // 女优目录模式：使用ActorFromNfo查询
        const actorId = parseInt(id);
        if (isNaN(actorId)) {
          return { success: false, message: '无效的演员ID', data: [], total: 0 };
        }
        
        const ActorFromNfo = sequelize.models.ActorFromNfo;
        const actor = await ActorFromNfo.findByPk(actorId);
        if (!actor) {
          return { success: false, message: '演员不存在', data: [], total: 0 };
        }
        
        actorData = {
          id: actor.id,
          name: actor.name,
          viewMode: 'actor',
          created_at: actor.created_at,
          updated_at: actor.updated_at
        };
        
        if (filterPlayable) {
          where.playable = true;
        }
        
        const includeOptions = {
          model: ActorFromNfo,
          where: { id: actorId },
          through: { attributes: [] },
          attributes: [],
          as: 'ActorsFromNfo'
        };
        
        const { count, rows } = await Movie.findAndCountAll({
          where,
          include: [includeOptions],
          order,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          distinct: true
        });
        
        const moviesData = rows.map(movie => ({
          id: movie.id,
          title: movie.title,
          code: movie.code,
          runtime: movie.runtime,
          premiered: movie.premiered,
          director: movie.director,
          studio_id: movie.studio_id,
          poster_path: movie.poster_path,
          fanart_path: movie.fanart_path,
          nfo_path: movie.nfo_path,
          folder_path: movie.folder_path,
          playable: movie.playable,
          video_path: movie.video_path,
          data_path_index: movie.data_path_index || 0,
          folder_updated_at: movie.folder_updated_at,
          created_at: movie.created_at,
          updated_at: movie.updated_at
        }));
        
        return {
          success: true,
          data: moviesData,
          total: count,
          actor: actorData
        };
      }
    } catch (error) {
      console.error('获取演员影片列表失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  // 分类相关IPC
  ipcMain.handle('genres:getList', async () => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [] };
      }
      const Genre = sequelize.models.Genre;
      const Movie = sequelize.models.Movie;
      
      const genres = await Genre.findAll({
        include: [{
          model: Movie,
          through: { attributes: [] },
          attributes: ['id', 'playable'],
          required: false
        }],
        order: [['name', 'ASC']],
        raw: false
      });
      
      // 统计每个分类的电影数量和可播放数量
      const genresData = genres.map(genre => {
        const movies = genre.Movies || [];
        const totalCount = movies.length;
        const playableCount = movies.filter(m => m.playable === true || m.playable === 1).length;
        
        return {
          id: genre.id,
          name: genre.name,
          totalCount,
          playableCount,
          created_at: genre.created_at,
          updated_at: genre.updated_at
        };
      });
      
      return { success: true, data: genresData };
    } catch (error) {
      console.error('获取分类列表失败:', error);
      return { success: false, message: error.message, data: [] };
    }
  });

  ipcMain.handle('genres:getById', async (event, id) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      const Genre = sequelize.models.Genre;
      const Movie = sequelize.models.Movie;
      const genre = await Genre.findByPk(id, {
        include: [{
          model: Movie,
          through: { attributes: [] }
        }]
      });
      return { success: true, data: genre };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 通过分类名称查找或创建分类
  ipcMain.handle('genres:getOrCreateByName', async (event, genreName) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化' };
      }
      const Genre = sequelize.models.Genre;
      
      // 查找或创建分类
      const [genre, created] = await Genre.findOrCreate({
        where: { name: genreName },
        defaults: { name: genreName }
      });
      
      return {
        success: true,
        data: {
          id: genre.id,
          name: genre.name,
          created_at: genre.created_at,
          updated_at: genre.updated_at
        },
        created
      };
    } catch (error) {
      console.error('查找或创建分类失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('genres:getMovies', async (event, id, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      const Movie = sequelize.models.Movie;
      const Genre = sequelize.models.Genre;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      const { page = 1, pageSize = 20, sortBy = 'premiered-desc' } = params;
      const order = getOrderFromSortBy(sortBy);
      const where = {};
      if (filterPlayable) {
        where.playable = true;
      }
      
      const includeOptions = {
        model: Genre,
        where: { id: parseInt(id) },
        through: { attributes: [] },
        attributes: [],
        required: true
      };
      
      const { count, rows } = await Movie.findAndCountAll({
        where,
        include: [includeOptions],
        order,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true
      });
      
      const moviesData = rows.map(movie => ({
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director: movie.director,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      }));
      
      // 获取分类信息
      const genre = await Genre.findByPk(parseInt(id));
      const genreData = genre ? {
        id: genre.id,
        name: genre.name
      } : null;
      
      return {
        success: true,
        data: moviesData,
        total: count,
        genre: genreData
      };
    } catch (error) {
      console.error('获取分类影片列表失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  // 制作商相关IPC
  ipcMain.handle('studios:getList', async () => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [] };
      }
      const Studio = sequelize.models.Studio;
      const Movie = sequelize.models.Movie;
      
      const studios = await Studio.findAll({
        include: [{
          model: Movie,
          attributes: ['id', 'playable'],
          required: false
        }],
        order: [['name', 'ASC']],
        raw: false
      });
      
      // 统计每个制作商的电影数量和可播放数量
      const studiosData = studios.map(studio => {
        const movies = studio.Movies || [];
        const totalCount = movies.length;
        const playableCount = movies.filter(m => m.playable === true || m.playable === 1).length;
        
        return {
          id: studio.id,
          name: studio.name,
          totalCount,
          playableCount,
          created_at: studio.created_at,
          updated_at: studio.updated_at
        };
      });
      
      return { success: true, data: studiosData };
    } catch (error) {
      console.error('获取制作商列表失败:', error);
      return { success: false, message: error.message, data: [] };
    }
  });

  // 导演相关IPC
  ipcMain.handle('directors:getList', async () => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [] };
      }
      const Director = sequelize.models.Director;
      const Movie = sequelize.models.Movie;
      
      const directors = await Director.findAll({
        include: [{
          model: Movie,
          attributes: ['id', 'playable'],
          required: false
        }],
        order: [['name', 'ASC']],
        raw: false
      });
      
      // 统计每个导演的电影数量和可播放数量
      const directorsData = directors.map(director => {
        const movies = director.Movies || [];
        const totalCount = movies.length;
        const playableCount = movies.filter(m => m.playable === true || m.playable === 1).length;
        
        return {
          id: director.id,
          name: director.name,
          totalCount,
          playableCount,
          created_at: director.created_at,
          updated_at: director.updated_at
        };
      });
      
      return { success: true, data: directorsData };
    } catch (error) {
      console.error('获取导演列表失败:', error);
      return { success: false, message: error.message, data: [] };
    }
  });

  ipcMain.handle('directors:getMovies', async (event, id, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      const Movie = sequelize.models.Movie;
      const Director = sequelize.models.Director;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      const { page = 1, pageSize = 20, sortBy = 'premiered-desc' } = params;
      const order = getOrderFromSortBy(sortBy);
      const where = {
        director_id: parseInt(id)
      };
      
      if (filterPlayable) {
        where.playable = true;
      }
      
      const { count, rows } = await Movie.findAndCountAll({
        where,
        order,
        limit: parseInt(pageSize),
        offset: (parseInt(page) - 1) * parseInt(pageSize),
        distinct: true
      });
      
      const moviesData = rows.map(movie => ({
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director_id: movie.director_id,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      }));
      
      // 获取导演信息
      const director = await Director.findByPk(parseInt(id));
      const directorData = director ? {
        id: director.id,
        name: director.name
      } : null;
      
      return {
        success: true,
        data: moviesData,
        total: count,
        director: directorData
      };
    } catch (error) {
      console.error('获取导演影片列表失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  ipcMain.handle('studios:getMovies', async (event, id, params = {}) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      const Movie = sequelize.models.Movie;
      const Studio = sequelize.models.Studio;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      const { page = 1, pageSize = 20, sortBy = 'premiered-desc' } = params;
      const order = getOrderFromSortBy(sortBy);
      const studioId = parseInt(id);
      if (isNaN(studioId)) {
        return { success: false, message: '无效的制作商ID', data: [], total: 0 };
      }
      
      const studio = await Studio.findByPk(studioId);
      if (!studio) {
        return { success: false, message: '制作商不存在', data: [], total: 0 };
      }
      
      const studioData = {
        id: studio.id,
        name: studio.name,
        created_at: studio.created_at,
        updated_at: studio.updated_at
      };
      
      const where = {
        studio_id: studioId
      };
      
      if (filterPlayable) {
        where.playable = true;
      }
      
      const { count, rows } = await Movie.findAndCountAll({
        where,
        order,
        limit: pageSize,
        offset: (page - 1) * pageSize
      });
      
      const moviesData = rows.map(movie => ({
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director: movie.director,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      }));
      
      return {
        success: true,
        data: moviesData,
        total: count,
        studio: studioData
      };
    } catch (error) {
      console.error('获取制作商影片列表失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  // 搜索相关IPC
  ipcMain.handle('search:simple', async (event, keyword) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      if (!keyword || keyword.trim() === '') {
        return { success: false, message: '请输入搜索关键词', data: [], total: 0 };
      }
      
      const Movie = sequelize.models.Movie;
      const ActorFromNfo = sequelize.models.ActorFromNfo;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      
      const searchKeyword = `%${keyword.trim()}%`;
      
      // 构建查询条件：搜索标题、识别码、演员名称
      const where = {
        [Op.or]: [
          { title: { [Op.like]: searchKeyword } },
          { code: { [Op.like]: searchKeyword } }
        ]
      };
      
      if (filterPlayable) {
        where.playable = true;
      }
      
      // 查询影片（包含演员关联）
      const movies = await Movie.findAll({
        where,
        include: [
          {
            model: ActorFromNfo,
            through: { attributes: [] },
            attributes: ['id', 'name'],
            as: 'ActorsFromNfo',
            required: false
          }
        ],
        order: [['premiered', 'DESC']],
        limit: 100 // 限制最多返回100条，避免数据过多
      });
      
      // 如果通过影片标题和识别码没有找到，尝试通过演员名称搜索
      let additionalMovies = [];
      if (movies.length < 100) {
        const actors = await ActorFromNfo.findAll({
          where: {
            name: { [Op.like]: searchKeyword }
          },
          include: [
            {
              model: Movie,
              through: { attributes: [] },
              attributes: ['id', 'title', 'code', 'runtime', 'premiered', 'director_id', 'studio_id', 'poster_path', 'fanart_path', 'nfo_path', 'folder_path', 'playable', 'video_path', 'created_at', 'updated_at'],
              as: 'Movies',
              required: true,
              where: filterPlayable ? { playable: true } : {}
            }
          ]
        });
        
        // 收集所有通过演员找到的影片
        const actorMovieIds = new Set(movies.map(m => m.id));
        for (const actor of actors) {
          if (actor.Movies && Array.isArray(actor.Movies)) {
            for (const movie of actor.Movies) {
              if (!actorMovieIds.has(movie.id)) {
                actorMovieIds.add(movie.id);
                // 重新查询完整数据（包含演员关联）
                const fullMovie = await Movie.findByPk(movie.id, {
                  include: [
                    {
                      model: ActorFromNfo,
                      through: { attributes: [] },
                      attributes: ['id', 'name'],
                      as: 'ActorsFromNfo',
                      required: false
                    }
                  ]
                });
                if (fullMovie) {
                  additionalMovies.push(fullMovie);
                }
              }
            }
          }
        }
      }
      
      // 合并结果
      const allMovies = [...movies, ...additionalMovies];
      
      // 转换为普通对象
      const moviesData = allMovies.map(movie => ({
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director_id: movie.director_id,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      }));
      
      return {
        success: true,
        data: moviesData,
        total: moviesData.length
      };
    } catch (error) {
      console.error('简单搜索失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  ipcMain.handle('search:advanced', async (event, params) => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { success: false, message: '数据库未初始化', data: [], total: 0 };
      }
      
      const Movie = sequelize.models.Movie;
      const ActorFromNfo = sequelize.models.ActorFromNfo;
      const Genre = sequelize.models.Genre;
      const Director = sequelize.models.Director;
      const Studio = sequelize.models.Studio;
      const filterPlayable = settingsStore.get('filterPlayable', false);
      
      // 构建查询条件
      const where = {};
      
      if (filterPlayable) {
        where.playable = true;
      }
      
      // 标题模糊匹配
      if (params.title && params.title.trim() !== '') {
        where.title = { [Op.like]: `%${params.title.trim()}%` };
      }
      
      // 发行日期范围
      if (params.dateFrom && params.dateTo) {
        where.premiered = {
          [Op.between]: [params.dateFrom, params.dateTo]
        };
      } else if (params.dateFrom) {
        where.premiered = {
          [Op.gte]: params.dateFrom
        };
      } else if (params.dateTo) {
        where.premiered = {
          [Op.lte]: params.dateTo
        };
      }
      
      // 构建关联查询条件
      const includeOptions = [
        {
          model: ActorFromNfo,
          through: { attributes: [] },
          attributes: ['id', 'name'],
          as: 'ActorsFromNfo',
          required: false
        },
        {
          model: Genre,
          through: { attributes: [] },
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Director,
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Studio,
          attributes: ['id', 'name'],
          required: false
        }
      ];
      
      // 导演筛选
      if (params.director && params.director.trim() !== '') {
        const directorName = params.director.trim();
        const director = await Director.findOne({
          where: { name: { [Op.like]: `%${directorName}%` } }
        });
        if (director) {
          where.director_id = director.id;
        } else {
          // 如果找不到匹配的导演，返回空结果
          return { success: true, data: [], total: 0 };
        }
      }
      
      // 制作商筛选
      if (params.studio && params.studio.trim() !== '') {
        const studioName = params.studio.trim();
        const studio = await Studio.findOne({
          where: { name: { [Op.like]: `%${studioName}%` } }
        });
        if (studio) {
          where.studio_id = studio.id;
        } else {
          // 如果找不到匹配的制作商，返回空结果
          return { success: true, data: [], total: 0 };
        }
      }
      
      // 分类筛选
      if (params.genre && params.genre.trim() !== '') {
        const genreName = params.genre.trim();
        const genre = await Genre.findOne({
          where: { name: { [Op.like]: `%${genreName}%` } }
        });
        if (genre) {
          // 需要包含该分类的影片
          includeOptions[1].required = true;
          includeOptions[1].where = { id: genre.id };
        } else {
          // 如果找不到匹配的分类，返回空结果
          return { success: true, data: [], total: 0 };
        }
      }
      
      // 演员筛选
      if (params.actor && params.actor.trim() !== '') {
        const actorName = params.actor.trim();
        const actor = await ActorFromNfo.findOne({
          where: { name: { [Op.like]: `%${actorName}%` } }
        });
        if (actor) {
          // 需要包含该演员的影片
          includeOptions[0].required = true;
          includeOptions[0].where = { id: actor.id };
        } else {
          // 如果找不到匹配的演员，返回空结果
          return { success: true, data: [], total: 0 };
        }
      }
      
      // 执行查询
      const movies = await Movie.findAll({
        where,
        include: includeOptions,
        order: [['premiered', 'DESC']],
        limit: 1000 // 限制最多返回1000条
      });
      
      // 转换为普通对象
      const moviesData = movies.map(movie => ({
        id: movie.id,
        title: movie.title,
        code: movie.code,
        runtime: movie.runtime,
        premiered: movie.premiered,
        director_id: movie.director_id,
        studio_id: movie.studio_id,
        poster_path: movie.poster_path,
        fanart_path: movie.fanart_path,
        nfo_path: movie.nfo_path,
        folder_path: movie.folder_path,
        playable: movie.playable,
        video_path: movie.video_path,
        folder_updated_at: movie.folder_updated_at,
        created_at: movie.created_at,
        updated_at: movie.updated_at
      }));
      
      return {
        success: true,
        data: moviesData,
        total: moviesData.length
      };
    } catch (error) {
      console.error('进阶搜索失败:', error);
      return { success: false, message: error.message, data: [], total: 0 };
    }
  });

  // 系统相关IPC
  ipcMain.handle('system:isDatabaseReady', async () => {
    try {
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        return { ready: false };
      }
      
      // 检查关键表是否存在
      const [results] = await sequelize.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name = 'movies'
      `);
      
      return { ready: results.length > 0 };
    } catch (error) {
      console.error('检查数据库就绪状态失败:', error);
      return { ready: false };
    }
  });

  ipcMain.handle('system:scan', async () => {
    try {
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: false, message: '未设置数据路径，请先在设置中选择数据文件夹' };
      }
      
      let totalSuccess = 0;
      let totalFailed = 0;
      let totalCount = 0;
      let totalProcessed = 0;
      let allPathsTotal = 0;
      /** @type {{ path: string, reason: string }[]} */
      let allFailedList = [];
      
      // 先统计所有路径的文件总数（用于准确计算进度）
      for (const dataPath of dataPaths) {
        if (!validatePath(dataPath)) {
          continue;
        }
        try {
          const glob = require('fast-glob');
          // 通过 .nfo 后缀匹配所有 NFO 文件，而不限制文件名
          const nfoFiles = await glob('**/*.nfo', {
            cwd: dataPath,
            absolute: true,
            ignore: ['**/node_modules/**']
          });
          allPathsTotal += nfoFiles.length;
        } catch (error) {
          console.error(`统计路径文件数失败: ${dataPath}`, error);
        }
      }
      
      // 扫描所有路径
      for (let i = 0; i < dataPaths.length; i++) {
        const dataPath = dataPaths[i];
        if (!validatePath(dataPath)) {
          console.warn(`路径无效，跳过: ${dataPath}`);
          continue;
        }
        
        console.log(`开始扫描路径 ${i + 1}/${dataPaths.length}: ${dataPath}`);
        
        // 创建进度回调，合并所有路径的进度
        const progressCallback = (current, total, success, failed) => {
          // 计算当前路径的进度
          const currentPathProgress = current;
          // 计算全局进度（当前路径已处理数 + 之前路径的总数）
          const globalCurrent = totalProcessed + currentPathProgress;
          const percentage = allPathsTotal > 0 ? Math.round((globalCurrent / allPathsTotal) * 100) : 0;
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(window => {
            if (!window.isDestroyed()) {
              window.webContents.send('scan:progress', {
                current: globalCurrent,
                total: allPathsTotal,
                success: totalSuccess + success,
                failed: totalFailed + failed,
                percentage: percentage,
                currentPath: dataPath
              });
            }
          });
        };
        
        try {
          // 只在第一个路径时清空数据，后续路径追加数据
          const clearTables = i === 0;
          const result = await scanDataFolder(dataPath, i, progressCallback, clearTables);
          totalSuccess += result.success || 0;
          totalFailed += result.failed || 0;
          totalCount += result.total || 0;
          totalProcessed += result.total || 0;
          if (result.failedList && result.failedList.length > 0) {
            allFailedList = allFailedList.concat(result.failedList.map(item => ({
              path: item.path,
              reason: item.reason
            })));
          }
        } catch (error) {
          console.error(`扫描路径失败: ${dataPath}`, error);
          totalFailed++;
          // 发送错误事件
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(window => {
            if (!window.isDestroyed()) {
              window.webContents.send('scan:error', {
                path: dataPath,
                error: error.message
              });
            }
          });
        }
      }
      
      // 发送完成事件
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach(window => {
        if (!window.isDestroyed()) {
          window.webContents.send('scan:completed', {
            total: totalCount,
            success: totalSuccess,
            failed: totalFailed,
            failedList: allFailedList
          });
        }
      });
      
      return {
        success: true,
        total: totalCount,
        successCount: totalSuccess,
        failed: totalFailed,
        failedList: allFailedList
      };
    } catch (error) {
      console.error('扫描失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('system:runStartupSync', async () => {
    try {
      const dataPaths = getDataPaths();
      if (!dataPaths || dataPaths.length === 0) {
        return { success: false, message: '未设置数据路径，请先添加数据文件夹' };
      }
      const { runStartupSync } = require('../services/sync');
      const mainWindow = mainWindowRef || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await runStartupSync(dataPaths, mainWindow);
      const { added, removed, addedList = [], duplicateList = [], failedList = [] } = result;
      if ((added > 0 || removed > 0) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:changed', { type: 'startup_sync_done', added, removed });
      }
      return { success: true, added, removed, addedList, duplicateList, failedList };
    } catch (error) {
      console.error('仅扫描新增或修改失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('system:getStats', async () => {
    console.log('system:getStats 被调用');
    try {
      // 动态获取模型，确保数据库已初始化
      const sequelize = getSequelize();
      if (!sequelize || !sequelize.models) {
        console.error('数据库未初始化');
        return { success: false, message: '数据库未初始化，请稍候再试' };
      }
      
      const Movie = sequelize.models.Movie;
      const Actor = sequelize.models.Actor;
      const Genre = sequelize.models.Genre;
      const Studio = sequelize.models.Studio;
      
      // 检查模型是否存在
      if (!Movie || !Actor || !Genre || !Studio) {
        console.error('数据库模型未加载');
        return { success: false, message: '数据库模型未加载，请稍候再试' };
      }
      
      console.log('开始统计数据...');
      const movieCount = await Movie.count();
      const actorCount = await Actor.count();
      const genreCount = await Genre.count();
      const studioCount = await Studio.count();
      
      console.log('统计数据:', { movieCount, actorCount, genreCount, studioCount });
      
      return {
        success: true,
        data: {
          movies: movieCount,
          actors: actorCount,
          genres: genreCount,
          studios: studioCount
        }
      };
    } catch (error) {
      console.error('获取统计信息失败:', error);
      return { success: false, message: error.message };
    }
  });
  
  // 验证所有处理器都已注册
  const registeredHandlers = [
    'config:getDataPath',
    'config:setDataPath',
    'config:validatePath',
    'system:getStats',
    'system:scan',
    'actors:getList',
    'actors:getById',
    'genres:getList',
    'genres:getById',
    'genres:getMovies',
    'studios:getList',
    'studios:getMovies'
  ];
  
  console.log('所有IPC处理器已注册完成');
  console.log('已注册的处理器:', registeredHandlers.join(', '));
  
  // 验证关键处理器是否注册（使用延迟检查，因为listenerCount可能不立即更新）
  setTimeout(() => {
    const statsCount = ipcMain.listenerCount('system:getStats');
    const configCount = ipcMain.listenerCount('config:setDataPath');
    if (statsCount > 0) {
      console.log('✓ system:getStats 处理器已成功注册');
    } else {
      console.warn('⚠ system:getStats 处理器可能未注册（listenerCount=' + statsCount + '）');
    }
    if (configCount > 0) {
      console.log('✓ config:setDataPath 处理器已成功注册');
    } else {
      console.warn('⚠ config:setDataPath 处理器可能未注册（listenerCount=' + configCount + '）');
    }
  }, 100);
}

// 更新主窗口引用的函数
function updateMainWindow(mainWindow) {
  mainWindowRef = mainWindow;
}

module.exports = {
  registerIpcHandlers,
  updateMainWindow
};
