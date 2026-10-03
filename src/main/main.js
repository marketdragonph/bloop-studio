// Electron entry: starts the local server on 127.0.0.1 and opens the studio window on it.
import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.js';
import { SettingsStore, settingsPath } from './settings-store.js';
import { createUpdater } from './updater.js';

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

async function boot() {
    const settings = new SettingsStore(settingsPath(app.getPath('userData')));
    const { url } = await createServer({
        settings,
        dataDir: app.getPath('userData'),
        reveal: (fullPath) => shell.showItemInFolder(fullPath),
        updates: createUpdater(app),
    });

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false, // shown maximized once the first paint is ready (no flash of a small window)
        backgroundColor: '#09090b',
        title: 'Bloop Studio',
        // The installed app takes its icon from the .exe; a dev run (npm start) needs it set here.
        icon: app.isPackaged ? undefined : fileURLToPath(new URL('../../build/icon.ico', import.meta.url)),
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        if (settings.get('fullscreen')) mainWindow.setFullScreen(true);
        mainWindow.show();
    });

    // F11 toggles true full screen; the choice is remembered for the next launch.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            event.preventDefault();
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
    });
    mainWindow.on('enter-full-screen', () => settings.update({ fullscreen: true }));
    mainWindow.on('leave-full-screen', () => settings.update({ fullscreen: false }));

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
