/**
 * Desktop (Tauri) integration. Everything here is a no-op in a plain browser, so the same
 * build runs on the web and as the desktop app.
 */
import { grain } from '@grainular/grains';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Mirrors the window's fullscreen state for the settings toggle. */
export const fullscreen = grain(false);

const win = async () => (await import('@tauri-apps/api/window')).getCurrentWindow();

export const setFullscreen = async (on: boolean) => {
    if (!isDesktop) {
        // browsers: best effort via the Fullscreen API
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => undefined);
        if (!on && document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
        fullscreen.set(!!document.fullscreenElement);
        return;
    }
    const w = await win();
    await w.setFullscreen(on);
    fullscreen.set(await w.isFullscreen());
};

export const toggleFullscreen = () => setFullscreen(!fullscreen());

/** F11 (and Ctrl/Cmd+Enter) toggle fullscreen anywhere in the game. */
export const installDesktopKeys = () => {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'F11' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            void toggleFullscreen();
        }
    });
    if (isDesktop) void win().then(async (w) => fullscreen.set(await w.isFullscreen()));
    else document.addEventListener('fullscreenchange', () => fullscreen.set(!!document.fullscreenElement));
};
