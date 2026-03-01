const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 影片相关
  movies: {
    getList: (params) => ipcRenderer.invoke('movies:getList', params),
    getById: (id) => ipcRenderer.invoke('movies:getById', id),
    create: (data) => ipcRenderer.invoke('movies:create', data),
    update: (id, data) => ipcRenderer.invoke('movies:update', id, data),
    delete: (id, deleteFile) => ipcRenderer.invoke('movies:delete', id, deleteFile),
    getSeries: (code, options) => ipcRenderer.invoke('movies:getSeries', code, options),
    getImage: (path, dataPathIndex) => ipcRenderer.invoke('movies:getImage', path, dataPathIndex),
    getDetailExtras: (id) => ipcRenderer.invoke('movies:getDetailExtras', id),
    openFileLocation: (id) => ipcRenderer.invoke('movies:openFileLocation', id)
  },
  
  // 演员相关
  actors: {
    getList: (params) => ipcRenderer.invoke('actors:getList', params),
    getById: (id, params) => ipcRenderer.invoke('actors:getById', id, params),
    getMovies: (id, params) => ipcRenderer.invoke('actors:getMovies', id, params)
  },
  
  // 分类相关
  genres: {
    getList: () => ipcRenderer.invoke('genres:getList'),
    getById: (id) => ipcRenderer.invoke('genres:getById', id),
    getMovies: (id, params) => ipcRenderer.invoke('genres:getMovies', id, params),
    getOrCreateByName: (name) => ipcRenderer.invoke('genres:getOrCreateByName', name)
  },
  
  // 制作商相关
  studios: {
    getList: () => ipcRenderer.invoke('studios:getList'),
    getMovies: (id, params) => ipcRenderer.invoke('studios:getMovies', id, params)
  },
  
  // 导演相关
  directors: {
    getList: () => ipcRenderer.invoke('directors:getList'),
    getMovies: (id, params) => ipcRenderer.invoke('directors:getMovies', id, params)
  },
  
  // 搜索相关
  search: {
    simple: (keyword, options) => ipcRenderer.invoke('search:simple', keyword, options),
    advanced: (params) => ipcRenderer.invoke('search:advanced', params)
  },
  
  // 配置相关
  config: {
    getDataPath: () => ipcRenderer.invoke('config:getDataPath'),
    getDataPaths: () => ipcRenderer.invoke('config:getDataPaths'),
    setDataPath: () => ipcRenderer.invoke('config:setDataPath'),
    addDataPath: () => ipcRenderer.invoke('config:addDataPath'),
    removeDataPath: (path) => ipcRenderer.invoke('config:removeDataPath', path),
    validatePath: (path) => ipcRenderer.invoke('config:validatePath', path),
    onDataPathChanged: (callback) => {
      ipcRenderer.on('config:dataPathChanged', (event, path) => callback(path));
    }
  },
  
  // 系统相关
  system: {
    scan: () => ipcRenderer.invoke('system:scan'),
    runStartupSync: () => ipcRenderer.invoke('system:runStartupSync'),
    getScanStatus: () => ipcRenderer.invoke('system:getScanStatus'),
    getStats: () => ipcRenderer.invoke('system:getStats'),
    isDatabaseReady: () => ipcRenderer.invoke('system:isDatabaseReady'),
    onFileChange: (callback) => {
      ipcRenderer.on('file:changed', (event, data) => callback(data));
    },
    onDatabaseReady: (callback) => {
      ipcRenderer.on('database:ready', () => callback());
    },
    onScanCompleted: (callback) => {
      ipcRenderer.on('scan:completed', (event, data) => callback(data));
    },
    onScanError: (callback) => {
      ipcRenderer.on('scan:error', (event, error) => callback(error));
    },
    onScanProgress: (callback) => {
      ipcRenderer.on('scan:progress', (event, data) => callback(data));
    },
    onStartupSyncProgress: (callback) => {
      ipcRenderer.on('sync:startupProgress', (event, data) => callback(data));
    }
  },
  
  // 设置相关
  settings: {
    getFilterPlayable: () => ipcRenderer.invoke('settings:getFilterPlayable'),
    setFilterPlayable: (value) => ipcRenderer.invoke('settings:setFilterPlayable', value),
    getAutoScanOnStartup: () => ipcRenderer.invoke('settings:getAutoScanOnStartup'),
    setAutoScanOnStartup: (value) => ipcRenderer.invoke('settings:setAutoScanOnStartup', value)
  },
  
  // 播放相关
  movie: {
    playVideo: (movieId) => ipcRenderer.invoke('movie:playVideo', movieId)
  }
});
