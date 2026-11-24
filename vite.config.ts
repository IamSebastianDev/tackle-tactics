import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { musicPlugin } from './scripts/music-plugin.ts';

// Shared by the browser dev server and the Tauri desktop shell (src-tauri).
export default defineConfig({
    clearScreen: false,
    plugins: [
        // the radio: every song in assets/music becomes a playlist track (see scripts/music-plugin.ts)
        musicPlugin(resolve(import.meta.dirname, 'assets/music'), resolve(import.meta.dirname, 'node_modules/.cache/tt-music')),
    ],
    server: {
        // the Rust build tree is huge and changes constantly while cargo runs
        watch: { ignored: ['**/src-tauri/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
        // WebKit on macOS (Tauri) and current Chromium
        target: ['es2022', 'safari16'],
    },
});
