/**
 * 获取 electron-store 的配置文件名，用于区分开发/正式/测试环境，避免数据混用。
 * 开发：javlibrary-dev；测试包（JavLibrary_beta）：javlibrary-test；正式包：javlibrary。
 */
const { app } = require('electron');

function getStoreName() {
  if (process.env.NODE_ENV === 'development') return 'javlibrary-dev';
  if (app.getName() === 'JavLibrary_beta') return 'javlibrary-test';
  return 'javlibrary';
}

module.exports = { getStoreName };
