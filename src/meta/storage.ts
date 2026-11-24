/**
 * The one career save slot.
 *
 * Desktop (Tauri): a JSON file in the app's data folder, written by Rust (src-tauri/src/lib.rs)
 * atomically (temp file + rename) with the previous save kept as `career.json.bak`; a damaged
 * file falls back to the backup. The file is read once at startup (`initStorage`), so reads stay
 * synchronous; writes are queued so the newest one always wins.
 *
 * Browser: localStorage, as before.
 */
const KEY = 'tackle-tactics:career';
const desktop = typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;

let cache: string | null = null;
let writing: Promise<void> = Promise.resolve();
let pending: string | null | undefined;

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);

/** Desktop: load the save file (moving an older in-app localStorage save into it once). */
export const initStorage = async () => {
    if (!desktop) return;
    try {
        cache = await invoke<string | null>('read_save');
        if (cache === null) {
            const legacy = localStorage.getItem(KEY);
            if (legacy) {
                await invoke('write_save', { data: legacy });
                cache = legacy;
                localStorage.removeItem(KEY);
            }
        }
    } catch (e) {
        console.error('Could not read the save file', e);
    }
};

export const readSave = (): string | null => {
    if (desktop) return cache;
    try {
        return localStorage.getItem(KEY);
    } catch {
        return null;
    }
};

const flush = () => {
    writing = writing.then(async () => {
        const data = pending;
        pending = undefined;
        if (data === undefined) return;
        try {
            if (data === null) await invoke('delete_save');
            else await invoke('write_save', { data });
        } catch (e) {
            console.error('Could not write the save file', e);
        }
    });
};

export const writeSave = (data: string): boolean => {
    if (desktop) {
        cache = data;
        pending = data;
        flush();
        return true;
    }
    try {
        localStorage.setItem(KEY, data);
        return true;
    } catch {
        return false;
    }
};

export const deleteSave = () => {
    if (desktop) {
        cache = null;
        pending = null;
        flush();
        return;
    }
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* ignore */
    }
};

/** Resolves once every queued save write has reached the disk (call before quitting). */
export const whenSaved = () => writing;

/** Where the save lives, for the settings screen. */
export const saveLocation = async (): Promise<string> => (desktop ? invoke<string>('save_path') : 'Browser storage (this browser only)');
