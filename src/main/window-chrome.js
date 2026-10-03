// Window controls without a separate title bar: Windows draws its own minimize / maximize / close
// buttons over the right end of our top bar (titleBarOverlay), in the top bar's colours for the
// current theme. The page keeps that corner free with env(titlebar-area-*) (see .topbar in app.css).
import { nativeTheme } from 'electron';

// Mirrors --bg-secondary (top bar) and --text-secondary in public/css/tokens.css.
const COLORS = {
    dark: { color: '#111113', symbolColor: '#a1a1aa' },
    light: { color: '#FFFFFF', symbolColor: '#475569' },
};
// Mirrors --topbar-height in tokens.css (3.5rem at the 16 px root size).
export const TITLE_BAR_HEIGHT = 56;

const isDark = (theme) => theme === 'light' ? false : theme === 'system' ? nativeTheme.shouldUseDarkColors : true;

export const overlayFor = (theme) => ({ ...COLORS[isDark(theme) ? 'dark' : 'light'], height: TITLE_BAR_HEIGHT });

/** Keeps the overlay in step with the app theme and, for "system", with Windows. Returns { themeChanged }. */
export function attachWindowChrome(win, getTheme) {
    const apply = () => {
        if (!win.isDestroyed()) win.setTitleBarOverlay(overlayFor(getTheme()));
    };
    nativeTheme.on('updated', apply);
    win.on('closed', () => nativeTheme.off('updated', apply));
    return { themeChanged: apply };
}
