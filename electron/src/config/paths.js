const Store = require('electron-store');
const { dialog } = require('electron');
const fs = require('fs-extra');
const path = require('path');

// 用户数据存于 AppData（electron-store 默认），开发/正式环境通过 name 区分
const store = new Store({
  name: process.env.NODE_ENV === 'development' ? 'javlibrary-dev' : 'javlibrary'
});

/**
 * 获取所有data文件夹路径（兼容旧版本单个路径）
 * @returns {string[]} - 路径数组
 */
function getDataPaths() {
  const dataPath = store.get('dataPath');
  const dataPaths = store.get('dataPaths', []);
  
  // 兼容旧版本：如果存在单个路径但不存在路径数组，则迁移
  if (dataPath && (!dataPaths || dataPaths.length === 0)) {
    const paths = [dataPath];
    store.set('dataPaths', paths);
    return paths;
  }
  
  return dataPaths || [];
}

/**
 * 获取单个data文件夹路径（兼容旧代码）
 * @returns {string|null} - 第一个路径，如果不存在则返回null
 */
function getDataPath() {
  const paths = getDataPaths();
  return paths.length > 0 ? paths[0] : null;
}

/**
 * 添加data文件夹路径
 * @param {BrowserWindow} mainWindow - 主窗口
 * @returns {Promise<string|null>} - 返回新路径，如果取消则返回null
 */
async function addDataPath(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '请选择data文件夹'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const newPath = result.filePaths[0];
    if (validatePath(newPath)) {
      const currentPaths = getDataPaths();
      // 检查路径是否已存在
      if (currentPaths.includes(newPath)) {
        throw new Error('该路径已存在');
      }
      currentPaths.push(newPath);
      store.set('dataPaths', currentPaths);
      return newPath;
    } else {
      throw new Error('选择的路径无效');
    }
  }
  
  return null;
}

/**
 * 设置data文件夹路径（兼容旧代码，设置为单个路径）
 * @param {BrowserWindow} mainWindow - 主窗口
 * @returns {Promise<string|null>} - 返回新路径，如果取消则返回null
 */
async function setDataPath(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '请选择data文件夹'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const newPath = result.filePaths[0];
    if (validatePath(newPath)) {
      // 设置为单个路径数组（兼容旧版本）
      store.set('dataPaths', [newPath]);
      store.set('dataPath', newPath); // 保持兼容
      return newPath;
    } else {
      throw new Error('选择的路径无效');
    }
  }
  
  return null;
}

/**
 * 删除data文件夹路径
 * @param {string} pathToRemove - 要删除的路径
 * @returns {boolean} - 是否删除成功
 */
function removeDataPath(pathToRemove) {
  const currentPaths = getDataPaths();
  const index = currentPaths.indexOf(pathToRemove);
  if (index > -1) {
    currentPaths.splice(index, 1);
    store.set('dataPaths', currentPaths);
    // 如果删除后还有路径，更新单个路径为第一个（兼容）
    if (currentPaths.length > 0) {
      store.set('dataPath', currentPaths[0]);
    } else {
      store.delete('dataPath');
    }
    return true;
  }
  return false;
}

/**
 * 验证路径是否有效
 * @param {string} pathToValidate - 要验证的路径
 * @returns {boolean} - 路径是否有效
 */
function validatePath(pathToValidate) {
  if (!pathToValidate) {
    return false;
  }
  
  try {
    const stats = fs.statSync(pathToValidate);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * 确保至少有一个有效的data路径
 * @param {BrowserWindow} mainWindow - 主窗口
 * @returns {Promise<string[]>} - 返回有效的data路径数组
 */
async function ensureDataPaths(mainWindow) {
  let dataPaths = getDataPaths();
  
  // 过滤出有效的路径
  dataPaths = dataPaths.filter(p => validatePath(p));
  
  if (dataPaths.length === 0) {
    // 没有有效路径，让用户选择
    const newPath = await addDataPath(mainWindow);
    if (!newPath) {
      throw new Error('未选择data文件夹');
    }
    dataPaths = [newPath];
  }
  
  return dataPaths;
}

/**
 * 确保data路径存在且有效（兼容旧代码）
 * @param {BrowserWindow} mainWindow - 主窗口
 * @returns {Promise<string>} - 返回有效的data路径（第一个）
 */
async function ensureDataPath(mainWindow) {
  const paths = await ensureDataPaths(mainWindow);
  return paths[0];
}

module.exports = {
  getDataPath,
  getDataPaths,
  setDataPath,
  addDataPath,
  removeDataPath,
  validatePath,
  ensureDataPath,
  ensureDataPaths
};
