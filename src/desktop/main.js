const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { EMBEDDED_LOGO_RIGHT } = require('../utils/embeddedLogo');

// Register custom privileged scheme before app ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// Enforce single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let splashWindow = null;
let mainWindow = null;

// Determine paths whether in development or production package
const isPackaged = app.isPackaged;
const appRootDir = isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '../..');

const logFile = path.join(appRootDir, 'app.log');
function logToFile(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
  try { fs.appendFileSync(logFile, line); } catch (e) { }
}
const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;
console.log = (...args) => { origLog(...args); logToFile('INFO', ...args); };
console.error = (...args) => { origErr(...args); logToFile('ERROR', ...args); };
console.warn = (...args) => { origWarn(...args); logToFile('WARN', ...args); };

console.log('[ELECTRON MAIN] Application initializing. isPackaged:', isPackaged, 'rootDir:', appRootDir);

const publicPath = isPackaged
  ? path.join(process.resourcesPath, 'app', 'public')
  : path.join(appRootDir, 'public');

const assetsPath = isPackaged
  ? path.join(process.resourcesPath, 'app', 'assets')
  : path.join(appRootDir, 'assets');

const appIconPath = path.join(assetsPath, 'app.ico');

// Build splash screen HTML - Karsh Industrial Digital Solutions brand
function getSplashHtml() {
  const html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }\n    html, body { width: 100%; height: 100%; overflow: hidden; }\n    body {\n      background: #ffffff;\n      border: 1px solid #cbd5e1;\n      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;\n      display: flex;\n      flex-direction: column;\n    }\n    .top-accent-line {\n      height: 4px;\n      background: linear-gradient(90deg, #0284c7 0%, #00b4d8 50%, #38bdf8 100%);\n      flex-shrink: 0;\n    }\n    .inner {\n      flex: 1;\n      display: flex;\n      flex-direction: column;\n      justify-content: space-between;\n      padding: 18px 30px 20px 30px;\n    }\n    .top-strip {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      font-family: ui-monospace, Consolas, monospace;\n      font-size: 10px;\n      letter-spacing: 1.5px;\n      color: #64748b;\n      font-weight: 700;\n      text-transform: uppercase;\n      padding-bottom: 10px;\n      border-bottom: 1px solid #f1f5f9;\n    }\n    .badge-runtime {\n      display: inline-flex;\n      align-items: center;\n      gap: 5px;\n      background: rgba(0,180,216,0.08);\n      border: 1px solid rgba(0,180,216,0.35);\n      color: #0077b6;\n      font-size: 9.5px;\n      font-weight: 700;\n      letter-spacing: 1px;\n      padding: 2px 8px;\n      border-radius: 10px;\n    }\n    .badge-dot {\n      width: 5px; height: 5px;\n      border-radius: 50%;\n      background: #00b4d8;\n      box-shadow: 0 0 6px #00b4d8;\n    }\n    .center-block {\n      flex: 1;\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      padding: 16px 0 10px;\n    }\n    .splash-logo {\n      height: 115px;\n      max-width: 500px;\n      width: auto;\n      object-fit: contain;\n      image-rendering: -webkit-optimize-contrast;\n    }\n    .main-title {\n      margin-top: 16px;\n      font-size: 15px;\n      font-weight: 800;\n      letter-spacing: 1.5px;\n      color: #0b1626;\n      text-transform: uppercase;\n    }\n    .bottom-block { width: 100%; display: flex; flex-direction: column; gap: 8px; }\n    .progress-bar-wrap {\n      width: 100%; height: 4px;\n      background: #e2e8f0;\n      border-radius: 2px;\n      overflow: hidden;\n    }\n    .progress-bar-fill {\n      width: 40%; height: 100%;\n      background: linear-gradient(90deg, #0284c7, #00b4d8, #38bdf8, #0284c7);\n      border-radius: 2px;\n      will-change: transform;\n      animation: indeterminate 1.6s ease-in-out infinite;\n    }\n    @keyframes indeterminate {\n      0%   { transform: translateX(-120%); }\n      100% { transform: translateX(360%); }\n    }\n    .status-text {\n      font-family: ui-monospace, Consolas, monospace;\n      font-size: 9.5px; color: #64748b;\n      letter-spacing: 1px;\n      display: flex; align-items: center; gap: 6px;\n      font-weight: 600; text-transform: uppercase;\n    }\n    .status-pulse {\n      width: 6px; height: 6px; border-radius: 50%;\n      background: #00b4d8; box-shadow: 0 0 6px #00b4d8;\n      will-change: opacity;\n      animation: pulse 1s ease-in-out infinite alternate;\n    }\n    @keyframes pulse { from { opacity: 0.3; } to { opacity: 1; } }\n  </style>\n</head>\n<body>\n  <div class=\"top-accent-line\"></div>\n  <div class=\"inner\">\n    <div class=\"top-strip\">\n      <span>RECORDKEEPER</span>\n      <span class=\"badge-runtime\"><span class=\"badge-dot\"></span>Digital Suite 4.0</span>\n    </div>\n    <div class=\"center-block\">\n      <img src=\"LOGO_PLACEHOLDER\" alt=\"Karsh Industrial Digital Solutions\" class=\"splash-logo\">\n      <div class=\"main-title\">DISPATCH MANAGEMENT SYSTEM</div>\n    </div>\n    <div class=\"bottom-block\">\n      <div class=\"progress-bar-wrap\"><div class=\"progress-bar-fill\"></div></div>\n      <div class=\"status-text\">\n        <span class=\"status-pulse\"></span>\n        <span>INITIALIZING RUNTIME...</span>\n      </div>\n    </div>\n  </div>\n</body>\n</html>";
  return html.replace('LOGO_PLACEHOLDER', EMBEDDED_LOGO_RIGHT);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 580,
    height: 360,
    frame: false,
    transparent: false,
    backgroundColor: '#ffffff',
    alwaysOnTop: true,
    center: true,
    resizable: false,
    show: false,
    skipTaskbar: false,
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Write splash to a temp file so we avoid expensive encodeURIComponent()
  // on the 480 KB embedded base64 logo blob (which was blocking the main thread).
  const os = require('os');
  const splashHtmlPath = require('path').join(os.tmpdir(), 'dispatch-splash.html');
  try {
    fs.writeFileSync(splashHtmlPath, getSplashHtml(), 'utf8');
    splashWindow.loadFile(splashHtmlPath);
  } catch (e) {
    splashWindow.loadURL('data:text/html,<body style="background:#fff"></body>');
  }

  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    show: false,
    autoHideMenuBar: false,
    title: 'RecordKeeper Dispatch',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: !isPackaged
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  // Notify renderer when window state changes (maximize / unmaximize)
  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-state-changed', { isMaximized: true });
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-state-changed', { isMaximized: false });
    }
  });

  // Intercept keyboard events: Block Alt menu trigger and disable DevTools/reloads in production
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Block Alt key from activating any OS/Chromium menu
    if (input.key === 'Alt') {
      event.preventDefault();
      return;
    }

    if (isPackaged) {
      const key = (input.key || '').toLowerCase();
      // Block DevTools shortcuts: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      const isDevTools = (input.control && input.shift && ['i', 'j', 'c'].includes(key)) || input.key === 'F12';
      // Block browser reloads: F5, Ctrl+R, Ctrl+Shift+R
      const isReload = (input.control && key === 'r') || input.key === 'F5';
      // Block page source / print: Ctrl+U, Ctrl+P
      const isSourceOrPrint = input.control && ['u', 'p'].includes(key);

      if (isDevTools || isReload || isSourceOrPrint) {
        event.preventDefault();
      }
    }
  });

  // In production, block right-click context menu (prevents "Inspect Element")
  if (isPackaged) {
    mainWindow.webContents.on('context-menu', (event) => {
      event.preventDefault();
    });
  }

  // Handle mailto: and external links via system default browser / mail client
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mailto:') || (url.startsWith('http:') && !url.includes('localhost') && !url.includes('127.0.0.1'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load via secure custom scheme app://
  mainWindow.loadURL('app://dispatch/index.html');

  mainWindow.webContents.once('did-finish-load', () => {
    // Smooth transition from splash to main window
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, 600);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Second instance focus
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

// App Ready Handler
app.whenReady().then(async () => {
  // Disable default application menu to prevent Alt key menu triggers
  Menu.setApplicationMenu(null);

  const SERVER_PORT = process.env.PORT || '4000';

  // Generate desktop secret and lock down backend in production mode or packaged exe.
  // In development mode (NODE_ENV=development), browser can still open localhost for dev.
  const isProduction = isPackaged || process.env.NODE_ENV === 'production';
  if (isProduction) {
    const DESKTOP_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.DESKTOP_SECRET = DESKTOP_SECRET;

    // Intercept all outgoing requests from Electron window and stamp the secret
    session.defaultSession.webRequest.onBeforeSendHeaders(
      {
        urls: [
          `http://127.0.0.1:${SERVER_PORT}/*`,
          `http://localhost:${SERVER_PORT}/*`,
          `ws://127.0.0.1:${SERVER_PORT}/*`,
          `ws://localhost:${SERVER_PORT}/*`
        ]
      },
      (details, callback) => {
        details.requestHeaders['X-Desktop-Secret'] = DESKTOP_SECRET;
        callback({ requestHeaders: details.requestHeaders });
      }
    );
  }

  // Register custom protocol app:// to serve local frontend files
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      let filePath;

      if (url.pathname.startsWith('/assets/')) {
        const assetFile = url.pathname.replace('/assets/', '');
        filePath = path.join(assetsPath, assetFile);
      } else {
        let sub = url.pathname.replace(/^\//, '');
        if (!sub || sub === '/') sub = 'index.html';
        filePath = path.join(publicPath, sub);
      }

      if (!fs.existsSync(filePath)) {
        if (url.pathname === '/favicon.ico') {
          const favPath = path.join(assetsPath, 'favicon.ico');
          if (fs.existsSync(favPath)) {
            return new Response(fs.readFileSync(favPath), { headers: { 'content-type': 'image/x-icon' } });
          }
        }
        return new Response('Not Found', { status: 404 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const fileBuffer = fs.readFileSync(filePath);

      return new Response(fileBuffer, {
        headers: {
          'content-type': contentType,
          'cache-control': 'no-cache'
        }
      });
    } catch (e) {
      console.error('[PROTOCOL ERROR]', e.message);
      return new Response('Internal Protocol Error', { status: 500 });
    }
  });

  // 1. Instant loading splash
  createSplashWindow();

  // 2. Bootstrap internal backend server
  try {
    let serverModule;
    const localServerJsc = path.join(__dirname, 'server.jsc');
    const localServerJs = path.join(__dirname, 'server.js');
    if (fs.existsSync(localServerJsc) || fs.existsSync(localServerJs)) {
      serverModule = require('./server');
    } else {
      serverModule = require('../server');
    }
    if (typeof serverModule.bootstrap === 'function') {
      await serverModule.bootstrap();
    }
  } catch (err) {
    console.error('[ELECTRON] Backend initialization error:', err.message);
  }

  // 3. Launch Main Window
  createMainWindow();
});

// Window IPC handlers
ipcMain.handle('get-desktop-secret', () => {
  return process.env.DESKTOP_SECRET || '';
});

// Synchronous port query — preload reads this once at startup
ipcMain.on('get-server-port-sync', (event) => {
  event.returnValue = process.env.PORT || '4000';
});

ipcMain.handle('open-license-folder', async () => {
  const targetDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
  await shell.openPath(targetDir);
  return true;
});

ipcMain.handle('read-legal-document', async (_event, docType) => {
  const filename = docType === 'license' ? 'LICENSE.md' : 'EULA.md';
  const candidates = [
    path.join(rootDir, filename),
    path.join(process.cwd(), filename),
    path.join(__dirname, '..', '..', filename),
    path.join(__dirname, '..', filename),
    isPackaged ? path.join(path.dirname(process.execPath), filename) : null,
    isPackaged ? path.join(path.dirname(process.execPath), 'resources', 'app', filename) : null
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return { success: true, filename, content: fs.readFileSync(p, 'utf8'), path: p };
    }
  }
  return { success: false, filename, error: `${filename} not found on workstation filesystem.` };
});

ipcMain.handle('open-external', async (_event, url) => {
  if (url && (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

/**
 * print-to-pdf: renders an HTML string in a hidden window and exports as PDF
 * Returns the saved file path on success, throws on failure.
 */
ipcMain.handle('print-to-pdf', async (_event, { html, filename }) => {
  const os = require('os');
  const outPath = path.join(os.tmpdir(), filename || `dispatch-manifest-${Date.now()}.pdf`);

  // Write HTML to a temp file so we can load it by file:// URL
  const htmlPath = path.join(os.tmpdir(), `dispatch-manifest-src-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  try {
    await pdfWin.loadFile(htmlPath);
    // Wait for images / fonts
    await new Promise(r => setTimeout(r, 600));

    const pdfData = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });

    fs.writeFileSync(outPath, pdfData);
    pdfWin.destroy();

    // Clean up temp HTML
    try { fs.unlinkSync(htmlPath); } catch (_) {}

    // Open the PDF with the system default viewer
    await shell.openPath(outPath);
    return { success: true, path: outPath };
  } catch (err) {
    pdfWin.destroy();
    try { fs.unlinkSync(htmlPath); } catch (_) {}
    throw err;
  }
});

/**
 * save-file-dialog: prompts native OS Save dialog and writes text content to disk
 */
ipcMain.handle('save-file-dialog', async (_event, { defaultFilename, content, filters }) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const defaultPath = path.join(app.getPath('downloads'), defaultFilename || 'export.csv');
    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: filters || [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }]
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, filePath: result.filePath };
    }
    return { canceled: true };
  } catch (err) {
    console.error('[ELECTRON] save-file-dialog error:', err.message);
    throw err;
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});
