import { defineConfig } from 'vite';

// Shared by the browser dev server and the Tauri desktop shell (src-tauri).
export default defineConfig({
    clearScreen: false,
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
