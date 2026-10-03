// Self-update from the public releases repo (package.json "publish"): check on launch and every few
// hours, download in the background, and let the person restart into the new version from the top bar.
// Installers carry no secrets; the updater only reads public GitHub Releases.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/**
 * Returns { state(), check(), install() } for the server's routes.
 * state: { version, status: dev | idle | checking | downloading | ready | current | error, available, progress, error }
 */
export function createUpdater(app) {
    const state = { version: app.getVersion(), status: 'idle', available: null, progress: 0, error: null };
    if (!app.isPackaged) {
        // npm start has no installer to update.
        return { state: () => ({ ...state, status: 'dev' }), check: async () => {}, install: () => {} };
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // closing the app also installs a downloaded update
    const set = (values) => Object.assign(state, values);
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info.version, progress: 0 }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: p.percent / 100 }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, progress: 1 }));
    autoUpdater.on('update-not-available', () => set({ status: 'current' }));
    autoUpdater.on('error', (error) => {
        // Offline or no release yet: say so in Settings, never interrupt the work.
        console.error('updater:', error.message);
        set({ status: state.status === 'ready' ? 'ready' : 'error', error: error.message.split('\n')[0] });
    });

    const check = () => autoUpdater.checkForUpdates().catch(() => {}); // failures land in the 'error' handler
    check();
    setInterval(check, CHECK_EVERY_MS).unref();

    return {
        state: () => ({ ...state }),
        check,
        install: () => {
            if (state.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall());
        },
    };
}
