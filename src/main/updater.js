// Self-update from the public releases repo (package.json "publish"): check on launch, every 30 minutes and when
// Settings opens (if the last check is a few minutes old), download in the background, and let the person restart
// into the new version from the top bar. The top bar shows the download too, so a release never arrives unseen.
// Installers carry no secrets; the updater only reads public GitHub Releases.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 30 * 60 * 1000; // was 4 h: a release made after launch went unseen for hours
const STALE_MS = 2 * 60 * 1000; // Settings › About checks again when the last check is older than this
// GitHub answers 500 for a few minutes after a release's files are uploaded: try again soon, not in 4 h.
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;

/**
 * Returns { state(), check(), checkIfStale(), install() } for the server's routes.
 * state: { version, status: dev | idle | checking | downloading | ready | current | error, available, progress, error }
 */
export function createUpdater(app) {
    const state = { version: app.getVersion(), status: 'idle', available: null, progress: 0, error: null };
    if (!app.isPackaged) {
        // npm start has no installer to update.
        return { state: () => ({ ...state, status: 'dev' }), check: async () => {}, checkIfStale: () => {}, install: () => {} };
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // closing the app also installs a downloaded update
    const set = (values) => Object.assign(state, values);
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info.version, progress: 0 }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: p.percent / 100 }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, progress: 1 }));
    autoUpdater.on('update-not-available', () => set({ status: 'current' }));
    let retry = null;
    autoUpdater.on('error', (error) => {
        // Offline, no release yet or a GitHub hiccup: say so in Settings, never interrupt the work.
        console.error('updater:', error.message.split('\n')[0]);
        set({ status: state.status === 'ready' ? 'ready' : 'error', error: error.message.split('\n')[0] });
        if (state.status === 'error' && !retry) {
            retry = setTimeout(() => {
                retry = null;
                check();
            }, RETRY_AFTER_ERROR_MS).unref();
        }
    });

    let lastCheck = 0;
    const check = () => {
        lastCheck = Date.now();
        // Say "checking" at once (the event comes later), but never step back from a download in hand.
        if (!['downloading', 'ready'].includes(state.status)) set({ status: 'checking', error: null });
        return autoUpdater.checkForUpdates().catch(() => {}); // failures land in the 'error' handler
    };
    check();
    setInterval(check, CHECK_EVERY_MS).unref();

    return {
        state: () => ({ ...state }),
        check,
        checkIfStale: () => {
            if (!['checking', 'downloading', 'ready'].includes(state.status) && Date.now() - lastCheck > STALE_MS) check();
        },
        install: () => {
            if (state.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall());
        },
    };
}
