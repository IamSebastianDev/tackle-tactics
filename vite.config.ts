import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { musicPlugin } from './scripts/music-plugin.ts';

// package.json is the one place the version lives (tauri.conf.json reads it too)
const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
const commit = (() => {
    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return '';
    }
})();

// Shared by the browser dev server and the Tauri desktop shell (src-tauri).
export default defineConfig({
    clearScreen: false,
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __APP_COMMIT__: JSON.stringify(commit),
    },
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
