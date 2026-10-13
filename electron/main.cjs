const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('PaperRead');
const isolatedProfile = process.argv.some(arg => arg.startsWith('--user-data-dir='));
// Preserve the established profile and IndexedDB origin after the rename.
if (!isolatedProfile) app.setPath('userData', path.join(app.getPath('appData'), 'PaperLens'));
let mainWindow;
let localServer;
let localOrigin;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function openExplicitHttps(url) {
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url);
  } catch { /* Ignore malformed or unsupported links. */ }
}

async function createWindow() {
  if (jobsClosing || jobsClosed) return;
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(path.join(__dirname, '../public/app-icon.png'));
  }
  if (!localServer) {
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
    localServer = await startServer({
      // Keep a stable origin: IndexedDB and localStorage are scoped to the port.
      port: isolatedProfile ? 0 : 41829,
      production: true,
      staticDir: path.join(__dirname, '../dist'),
      jobDir: path.join(app.getPath('userData'), 'jobs'),
      backupDir: path.join(app.getPath('userData'), 'Automatic Backups'),
    });
    localOrigin = `http://127.0.0.1:${localServer.address().port}`;
  }
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 990,
    minWidth: 1000,
    minHeight: 660,
    title: 'PaperRead',
    icon: path.join(__dirname, '../public/app-icon.png'),
    backgroundColor: '#f5f5f7',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 21 },
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExplicitHttps(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === localOrigin) return;
    } catch { /* Reject unsupported navigation. */ }
    event.preventDefault();
    openExplicitHttps(url);
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  await mainWindow.loadURL(localOrigin);
}

if (hasLock) {
  app.whenReady().then(createWindow).catch((error) => {
    dialog.showErrorBox('PaperRead 启动失败', error.code === 'EADDRINUSE'
      ? '本机端口 41829 已被占用。请关闭占用该端口的程序后重试。为了保持文献库的存储位置一致，PaperRead 不会自动切换端口。'
      : `${error.message}\n\n请先在项目目录运行 npm run build，再启动桌面应用。`);
    app.quit();
  });
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on('activate', () => {
    if (!mainWindow && !jobsClosing && !jobsClosed) createWindow().catch((error) => dialog.showErrorBox('PaperRead 启动失败', error.message));
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let jobsClosed = false;
let jobsClosing = false;
app.on('before-quit', (event) => {
  if (jobsClosed) return;
  if (!localServer?.jobs) { localServer?.close(); return; }
  event.preventDefault();
  if (jobsClosing) return;
  jobsClosing = true;
  Promise.resolve(localServer.jobs.close()).then(() => {
    jobsClosed = true;
    localServer.close();
    localServer.closeAllConnections?.();
    // All job checkpoints are durable before quitting. A stale native window
    // must not leave a headless process holding the single-instance lock.
    const exitFallback = setTimeout(() => app.exit(0), 1500);
    exitFallback.unref();
    app.quit();
  }).catch(error => {
    jobsClosing = false;
    dialog.showErrorBox('PaperRead 暂未退出', '后台任务保存未完成，请重新尝试退出。\n' + error.message);
  });
});
