const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { session } = require('electron');
const path = require('path');

// 添加错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});
const Store = require('electron-store');
const { initDatabase } = require('./src/config/database');
const { runStartupSync } = require('./src/services/sync');
const { registerIpcHandlers, updateMainWindow } = require('./src/ipc/handlers');

// 配置存储
// 在开发环境中使用不同的配置名称，避免与生产环境共享数据
const store = new Store({
  name: process.env.NODE_ENV === 'development' ? 'javlibrary-dev' : 'javlibrary'
});

let mainWindow = null;

// 创建主窗口
function createWindow() {
  console.log('正在创建窗口...');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    x: 100, // 设置窗口位置
    y: 100,
    show: true, // 立即显示窗口
    frame: true, // 显示窗口框架
    autoHideMenuBar: true, // 隐藏菜单栏
    skipTaskbar: false, // 在任务栏显示
    minimizable: true,
    maximizable: true,
    closable: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    // icon: path.join(__dirname, '../assets/icon.png') // 如果有图标的话
  });
  
  // 强制设置窗口属性
  mainWindow.setSkipTaskbar(false);
  mainWindow.setAlwaysOnTop(false);
  
  // 确保窗口在屏幕可见区域
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const winBounds = mainWindow.getBounds();
  
  // 如果窗口在屏幕外，移动到屏幕内
  if (winBounds.x < 0 || winBounds.y < 0 || 
      winBounds.x + winBounds.width > width || 
      winBounds.y + winBounds.height > height) {
    console.log('窗口在屏幕外，移动到屏幕内');
    mainWindow.setPosition(100, 100);
  }
  
  console.log('窗口位置:', mainWindow.getPosition());
  console.log('窗口大小:', mainWindow.getSize());
  console.log('窗口可见:', mainWindow.isVisible());

  // 窗口显示事件
  mainWindow.once('ready-to-show', () => {
    console.log('窗口准备就绪，准备显示');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      console.log('窗口已显示并聚焦');
    }
  });
  
  // 如果窗口已经准备好，立即显示
  if (mainWindow.webContents.isLoading()) {
    console.log('窗口正在加载，等待ready-to-show事件');
  } else {
    console.log('窗口已加载完成，立即显示');
    mainWindow.show();
    mainWindow.focus();
  }

  // 设置 Content Security Policy（修复安全警告）
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* data: blob:; img-src 'self' data: http://localhost:* file://*;"]
      }
    });
  });

  // 开发环境加载Vite开发服务器，生产环境加载打包后的文件
  if (process.env.NODE_ENV === 'development') {
    console.log('开发模式：加载 http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173').catch(err => {
      console.error('加载URL失败:', err);
      // 如果加载失败，显示错误页面（使用UTF-8编码）
      const errorPage = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>前端服务器未启动</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            h1 { color: #f56c6c; }
            p { color: #666; margin: 20px 0; }
            code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <h1>前端服务器未启动</h1>
          <p>请先运行以下命令启动前端服务器：</p>
          <p><code>cd frontend && npm run dev</code></p>
          <p>然后刷新此页面</p>
        </body>
        </html>
      `;
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorPage));
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    console.log('窗口已关闭');
    mainWindow = null;
  });

  // 错误处理
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('页面加载失败:', errorCode, errorDescription);
    // 如果是开发模式且连接失败，尝试重新加载
    if (process.env.NODE_ENV === 'development' && errorCode === -106) {
      console.log('连接失败，5秒后重试...');
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:5173');
        }
      }, 5000);
    }
  });
  
  // 监听页面导航
  mainWindow.webContents.on('did-navigate', (event, url) => {
    if (url && url.startsWith('http://localhost:5173')) {
      console.log('成功加载前端页面:', url);
    }
  });
}

// 检查并设置data路径
async function checkAndSetDataPath() {
  const fs = require('fs');
  let dataPath = store.get('dataPath');
  
  // 检查已保存的路径是否有效
  if (dataPath && fs.existsSync(dataPath)) {
    console.log('使用已配置的data路径:', dataPath);
    return dataPath;
  }
  
  // 尝试使用项目根目录下的data文件夹作为默认路径
  const defaultDataPath = path.join(__dirname, '..', 'data');
  if (fs.existsSync(defaultDataPath)) {
    console.log('使用默认data路径:', defaultDataPath);
    store.set('dataPath', defaultDataPath);
    return defaultDataPath;
  }
  
  // 如果没有默认路径，需要用户选择
  console.log('需要用户选择data路径，创建临时窗口...');
  let tempWindow = null;
  
  try {
    // 创建一个临时窗口用于显示对话框（需要显示才能弹出对话框）
    tempWindow = new BrowserWindow({
      show: true, // 需要显示窗口才能弹出对话框
      width: 400,
      height: 300,
      center: true,
      frame: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // 等待窗口准备好
    await new Promise(resolve => {
      if (tempWindow) {
        tempWindow.once('ready-to-show', () => {
          console.log('临时窗口已准备好');
          resolve();
        });
        setTimeout(resolve, 1000); // 超时保护
      } else {
        resolve();
      }
    });
    
    // 显示对话框
    console.log('显示文件夹选择对话框...');
    const result = await dialog.showOpenDialog(tempWindow, {
      properties: ['openDirectory'],
      title: '请选择data文件夹'
    });
    
    console.log('对话框结果:', result.canceled ? '已取消' : `已选择: ${result.filePaths[0]}`);

    if (!result.canceled && result.filePaths.length > 0) {
      dataPath = result.filePaths[0];
      store.set('dataPath', dataPath);
      return dataPath;
    } else {
      // 用户取消了选择，退出应用
      console.log('用户取消了路径选择，应用将退出');
      app.quit();
      return null;
    }
  } catch (error) {
    console.error('选择data路径时出错:', error);
    // 如果出错，尝试使用默认路径
    if (fs.existsSync(defaultDataPath)) {
      console.log('使用默认data路径作为后备:', defaultDataPath);
      store.set('dataPath', defaultDataPath);
      return defaultDataPath;
    }
    throw error;
  } finally {
    // 关闭临时窗口
    if (tempWindow && !tempWindow.isDestroyed()) {
      tempWindow.close();
      console.log('临时窗口已关闭');
    }
  }
}

// 应用准备就绪
app.whenReady().then(async () => {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
  
  let dataPath = null; // 在外层声明，供后续使用
  
  try {
    console.log('应用准备就绪，开始初始化...');
    
    // 先创建窗口（让用户看到界面，不阻塞）
    createWindow();
    console.log('窗口已创建');
    
    // 检查并设置data路径（使用刚创建的窗口）
    console.log('检查data路径...');
    dataPath = await checkAndSetDataPath();
    if (!dataPath) {
      console.log('未选择data路径，应用将退出');
      return;
    }
    console.log('Data路径:', dataPath);
    
    // 注册IPC处理器（传入mainWindow，但数据库可能还没初始化）
    console.log('注册IPC处理器...');
    try {
      registerIpcHandlers(mainWindow, dataPath, store);
      console.log('IPC处理器注册成功');
      
      // 验证关键处理器（使用延迟检查，因为listenerCount可能不立即更新）
      setTimeout(() => {
        const statsCount = ipcMain.listenerCount('system:getStats');
        const configCount = ipcMain.listenerCount('config:setDataPath');
        if (statsCount > 0) {
          console.log('✓ system:getStats 已注册');
        } else {
          console.warn('⚠ system:getStats 可能未注册（listenerCount=' + statsCount + '）');
        }
        if (configCount > 0) {
          console.log('✓ config:setDataPath 已注册');
        } else {
          console.warn('⚠ config:setDataPath 可能未注册（listenerCount=' + configCount + '）');
        }
      }, 100);
    } catch (error) {
      console.error('IPC处理器注册失败:', error);
      throw error;
    }
    
    // 初始化数据库（在后台异步进行，不阻塞窗口显示）
    console.log('开始初始化数据库（后台进行）...');
    initDatabase().then(async () => {
      console.log('数据库初始化完成');
      
      // 等待一小段时间，确保所有表都已经创建完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 验证关键表是否存在
      try {
        const { getSequelize } = require('./src/config/database');
        const sequelize = getSequelize();
        if (sequelize) {
          const [results] = await sequelize.query(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name = 'movies'
          `);
          if (results.length > 0) {
            console.log('数据库表验证通过，通知前端数据库已就绪');
            // 通知前端数据库已就绪
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('database:ready');
            }
          } else {
            console.warn('数据库表验证失败，movies表不存在');
          }
        }
      } catch (verifyError) {
        console.error('验证数据库表时出错:', verifyError);
        // 即使验证失败，也发送就绪事件（可能表已经存在但查询失败）
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('database:ready');
        }
      }
      
      // 数据库初始化完成后，与磁盘做 diff 并更新数据库（分批执行，避免卡死）
      setTimeout(() => {
        const { getDataPaths } = require('./src/config/paths');
        const dataPaths = getDataPaths();
        if (dataPaths && dataPaths.length > 0) {
          runStartupSync(dataPaths, mainWindow)
            .then(({ added, removed }) => {
              if (added > 0 || removed > 0) {
                console.log('启动同步完成：新增', added, '条，删除', removed, '条');
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('file:changed', { type: 'startup_sync_done', added, removed });
                }
              }
            })
            .catch((err) => console.error('启动同步失败:', err));
        }
        console.log('数据库初始化完成');
      }, 2000);
    }).catch((error) => {
      console.error('数据库初始化失败:', error);
      // 通知前端数据库初始化失败
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('database:error', error.message);
      }
    });
    
    console.log('窗口已创建，mainWindow存在:', !!mainWindow);
    
    // 强制显示窗口（多次尝试确保显示）
    if (mainWindow) {
      console.log('窗口状态 - isVisible:', mainWindow.isVisible(), 'isDestroyed:', mainWindow.isDestroyed());
      
      // 立即显示
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setSkipTaskbar(false);
      
      // 多次尝试确保显示
      [200, 500, 1000, 2000].forEach((delay, index) => {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const isVisible = mainWindow.isVisible();
            console.log(`尝试 ${index + 1} (${delay}ms) - isVisible:`, isVisible);
            if (!isVisible) {
              console.log('窗口未显示，强制显示');
              mainWindow.show();
              mainWindow.focus();
              mainWindow.moveTop();
              mainWindow.setSkipTaskbar(false);
              // 尝试恢复窗口（如果被最小化）
              if (mainWindow.isMinimized()) {
                mainWindow.restore();
              }
            }
          }
        }, delay);
      });
      
      console.log('已调用show()和focus()');
    } else {
      console.error('mainWindow为null，无法显示窗口！');
    }
    
    // 等待窗口加载完成（但不要阻塞太久，确保IPC处理器已注册）
    await new Promise(resolve => {
      if (mainWindow) {
        // 如果窗口已经加载完成，立即继续
        if (!mainWindow.webContents.isLoading()) {
          console.log('窗口已加载完成');
          resolve();
          return;
        }
        
        mainWindow.webContents.once('did-finish-load', () => {
          console.log('窗口加载完成');
          resolve();
        });
        // 超时保护（缩短到1秒，加快启动速度）
        setTimeout(() => {
          console.log('窗口加载超时，继续执行...');
          resolve();
        }, 1000);
      } else {
        setTimeout(resolve, 100);
      }
    });
    
    // 等待前端服务器（开发模式）- 优化：减少等待时间
    if (process.env.NODE_ENV === 'development') {
      console.log('等待前端服务器启动...');
      let serverReady = false;
      for (let i = 0; i < 10; i++) { // 减少到10次，最多等待5秒
        try {
          const http = require('http');
          await new Promise((resolve) => {
            const req = http.get('http://localhost:5173', (res) => {
              if (res.statusCode === 200) {
                serverReady = true;
                console.log('前端服务器已就绪');
                // 检查当前URL，如果是错误页面，重新加载正确页面
                if (mainWindow && !mainWindow.isDestroyed()) {
                  try {
                    const currentUrl = mainWindow.webContents.getURL();
                    if (currentUrl && currentUrl.startsWith('data:text/html')) {
                      console.log('检测到错误页面，重新加载前端服务器...');
                      setTimeout(() => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                          mainWindow.loadURL('http://localhost:5173');
                        }
                      }, 500);
                    }
                  } catch (error) {
                    // 如果获取URL失败，直接重新加载
                    console.log('无法获取当前URL，尝试重新加载...');
                    setTimeout(() => {
                      if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.loadURL('http://localhost:5173');
                      }
                    }, 500);
                  }
                }
              }
              resolve();
            });
            req.on('error', () => {
              setTimeout(resolve, 500);
            });
            req.setTimeout(500, () => {
              req.destroy();
              setTimeout(resolve, 500);
            });
          });
          if (serverReady) break;
        } catch (error) {
          // 继续重试
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!serverReady) {
        console.warn('前端服务器可能未启动，但继续执行...');
        console.warn('请确保前端服务器正在运行: cd frontend && npm run dev');
      } else {
        // 服务器已就绪，确保窗口加载正确页面
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const currentUrl = mainWindow.webContents.getURL();
            console.log('当前窗口URL:', currentUrl);
            if (currentUrl && currentUrl.startsWith('data:text/html')) {
              console.log('检测到错误页面，立即重新加载前端服务器...');
              setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.loadURL('http://localhost:5173');
                }
              }, 1000);
            } else if (!currentUrl || !currentUrl.startsWith('http://localhost:5173')) {
              // 如果URL不是前端服务器，也重新加载
              console.log('URL不正确，重新加载前端服务器...');
              setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.loadURL('http://localhost:5173');
                }
              }, 1000);
            }
          } catch (error) {
            console.log('检查URL时出错，尝试重新加载...', error);
            setTimeout(() => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL('http://localhost:5173');
              }
            }, 1000);
          }
        }
      }
    }

    // 注意：数据库、data路径和IPC处理器已经在窗口创建之前初始化完成
    // dataPath 已经在前面设置好了，这里直接使用
    if (!dataPath) {
      console.error('Data路径未设置，这不应该发生');
      return;
    }

    // 文件监听和扫描将在数据库初始化完成后执行（见上面的 initDatabase().then()）
  } catch (error) {
    console.error('应用启动失败:', error);
    console.error(error.stack);
    if (mainWindow) {
      dialog.showErrorBox('启动错误', error.message);
    }
    // 不立即退出，让用户看到错误信息
  }
});

// 所有窗口关闭时
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

