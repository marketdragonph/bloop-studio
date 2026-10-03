// Electron entry: starts the local server on 127.0.0.1 and opens the studio window on it.
import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.js';
import { SettingsStore, settingsPath } from './settings-store.js';
import { createUpdater } from './updater.js';
import { attachWindowChrome, overlayFor } from './window-chrome.js';

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

async function boot() {
    const settings = new SettingsStore(settingsPath(app.getPath('userData')));
    let chrome = null;
    const { url } = await createServer({
        settings,
        dataDir: app.getPath('userData'),
        reveal: (fullPath) => shell.showItemInFolder(fullPath),
        openExternal: (target) => shell.openExternal(target), // bloop sign-in opens in the real browser
        updates: createUpdater(app),
        onThemeChange: () => chrome?.themeChanged(),
    });

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false, // shown maximized once the first paint is ready (no flash of a small window)
        backgroundColor: '#09090b',
        title: 'Bloop Studio',
        // No separate title bar: our top bar is the title bar, with Windows' own controls at its right end.
        titleBarStyle: 'hidden',
        titleBarOverlay: overlayFor(settings.get('theme')),
        // The installed app takes its icon from the .exe; a dev run (npm start) needs it set here.
        icon: app.isPackaged ? undefined : fileURLToPath(new URL('../../build/icon.ico', import.meta.url)),
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    chrome = attachWindowChrome(mainWindow, () => settings.get('theme'));
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        if (settings.get('windowMode') === 'fullscreen') mainWindow.setFullScreen(true);
        mainWindow.show();
    });

    // F11 toggles true full screen (no window controls); the choice is remembered for the next launch.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            event.preventDefault();
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
    });
    mainWindow.on('enter-full-screen', () => settings.update({ windowMode: 'fullscreen' }));
    mainWindow.on('leave-full-screen', () => settings.update({ windowMode: 'maximized' }));

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
