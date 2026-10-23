const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const url = require('url');

// Optional squirrel handling for windows installers
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch (e) {
  // Not using squirrel or package not installed
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 680,
    title: 'ZenterPrime - Business Accounting & ERP',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false, // Allows local file:// resources to load seamlessly
    },
    show: false,
  });

  // Show window smoothly when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Route external links to the default system web browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
      shell.openExternal(targetUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Load dev server or built production assets
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';

  if (isDev) {
    mainWindow.loadURL(devUrl);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath).catch(() => {
      mainWindow.loadURL(url.format({
        pathname: indexPath,
        protocol: 'file:',
        slashes: true,
      }));
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance lock to prevent duplicate app windows
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// Native IPC handlers for window controls & info
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('window:isMaximized', () => mainWindow ? mainWindow.isMaximized() : false);
ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });

// Quit application when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
