const { app, BrowserWindow, dialog, shell, net, ipcMain, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const {existsSync}=require('node:fs');
const {readFile,stat}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const { pathToFileURL } = require('node:url');

app.setName('PaperRead');
const isolatedProfile = process.argv.some(arg => arg.startsWith('--user-data-dir='));
// Preserve the established profile and IndexedDB origin after the rename.
if (!isolatedProfile) app.setPath('userData', path.join(app.getPath('appData'), 'PaperLens'));
const journalFile=path.join(app.getPath('userData'),'Journal Catalog','journals.json');
if(existsSync(journalFile))process.env.PAPERREAD_JOURNAL_FILE=journalFile;
let mainWindow;
let localServer;
let localOrigin;
let cacheManager;
const {createCacheManager}=require('./cache.cjs');
const pdfImports=[];let inFlightImport=null,windowCreation=null;
function notifyPdfImport(){mainWindow?.webContents.send('paperread:pdf-available');}
function enqueuePdf(file){if(typeof file!=='string'||!path.isAbsolute(file)||!file.toLowerCase().endsWith('.pdf'))return;if(!pdfImports.some(item=>item.path===file))pdfImports.push({id:randomUUID(),path:file});if(app.isReady()){if(!mainWindow)void createWindow();else{mainWindow.show();mainWindow.focus();notifyPdfImport();}}}
app.on('open-file',(event,file)=>{event.preventDefault();enqueuePdf(file);});
for(const argument of process.argv.slice(1))enqueuePdf(argument);
function trustedSender(event){if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame||!localOrigin||new URL(event.senderFrame.url).origin!==localOrigin)throw Error('此操作只接受本机窗口');}
ipcMain.handle('paperread:take-pdf',async event=>{trustedSender(event);if(inFlightImport||!pdfImports.length)return null;const item=pdfImports[0];inFlightImport=item.id;try{const info=await stat(item.path);if(!info.isFile()||info.size>150*1024*1024)throw Error('传入 PDF 超过 150 MB 或不是普通文件');const bytes=await readFile(item.path);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('传入的文件不是有效 PDF');return {id:item.id,name:path.basename(item.path),bytes:new Uint8Array(bytes)};}catch(e){return {id:item.id,name:path.basename(item.path),error:'无法接收 PDF：'+e.message};}});
ipcMain.handle('paperread:defer-pdf',(event,id)=>{trustedSender(event);if(id===inFlightImport)inFlightImport=null;});
ipcMain.handle('paperread:ack-pdf',(event,id)=>{trustedSender(event);if(id!==inFlightImport)return;const index=pdfImports.findIndex(item=>item.id===id);if(index>=0)pdfImports.splice(index,1);inFlightImport=null;notifyPdfImport();});
ipcMain.handle('paperread:set-theme',(event,theme)=>{trustedSender(event);if(theme!=='light'&&theme!=='dark')throw Error('无效外观设置');nativeTheme.themeSource=theme;return theme;});
ipcMain.handle('paperread:cache-status',async event=>{trustedSender(event);return cacheManager.status();});
ipcMain.handle('paperread:cache-clear',async event=>{trustedSender(event);return cacheManager.clear();});
ipcMain.handle('paperread:cache-interval',async(event,days)=>{trustedSender(event);return cacheManager.setIntervalDays(days);});
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function openExplicitHttps(url) {
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url);
  } catch { /* Ignore malformed or unsupported links. */ }
}

function createWindow(){return windowCreation||=(async()=>{try{await createWindowImpl();}finally{windowCreation=null;}})();}
async function createWindowImpl() {
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
      metadataFetchImpl: (url,options) => net.fetch(url,options),
      staticDir: path.join(__dirname, '../dist'),
      jobDir: path.join(app.getPath('userData'), 'jobs'),
      backupDir: path.join(app.getPath('userData'), 'Automatic Backups'),
      documentDir: path.join(isolatedProfile?app.getPath('userData'):app.getPath('documents'),'PaperRead文献库'),
      handoffDir: path.join(app.getPath('appData'),'PaperRead','Outbox'),
      launchPaperPost: async url => { await shell.openExternal(url); },
      openDocumentFolder: async folder => { const error=await shell.openPath(folder);if(error)throw Error(error); },
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
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 21 },
    show: false,
    webPreferences: {
      preload:path.join(__dirname,'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  if(!cacheManager){
    cacheManager=createCacheManager({session:mainWindow.webContents.session,directory:app.getPath('userData'),onChange:()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('paperread:cache-changed');}});
    // A failed preferences read must not prevent access to the library.
    void cacheManager.start().catch(()=>{});
    powerMonitor.on('resume',()=>void cacheManager.resume().catch(()=>{}));
  }
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
  mainWindow.webContents.on('did-finish-load',()=>{inFlightImport=null;notifyPdfImport();});
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
  app.on('second-instance', (_event,args) => {
    for(const argument of args)enqueuePdf(argument);
    if(!mainWindow)void createWindow();
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

app.on('will-quit',()=>{void cacheManager?.close();});
