// Electron entry: starts the local server on 127.0.0.1 and opens the studio window on it.
import { app, BrowserWindow, shell } from 'electron';
import { createServer } from '../server/server.js';
import { SettingsStore, settingsPath } from './settings-store.js';

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

async function boot() {
    const settings = new SettingsStore(settingsPath(app.getPath('userData')));
    const { url } = await createServer({ settings, dataDir: app.getPath('userData') });

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#09090b',
        title: 'Bloop Studio',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });

    // Only our own server may load in the window; anything else opens in the real browser.
    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        if (target.startsWith('http')) shell.openExternal(target);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, target) => {
        if (!target.startsWith(url)) {
            event.preventDefault();
            shell.openExternal(target);
        }
    });

    await mainWindow.loadURL(url);
}

app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(boot).catch((error) => {
    console.error('Bloop Studio failed to start:', error);
    app.quit();
});
