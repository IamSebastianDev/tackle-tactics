/**
 * Vite plugin: the in-game radio's playlist comes straight from a folder (assets/music).
 *
 * - Every audio file there becomes a track. Titles come from file names:
 *   "Artist - Title.wav" → artist + title, "Title.mp3" → title (credited to the station).
 *   An optional leading number ("01 ", "02 - ") sets the order and is dropped from the title;
 *   the first track opens the station, the rest shuffle.
 * - WAV/AIFF are transcoded to AAC (.m4a) with macOS `afconvert` (or ffmpeg, if installed),
 *   cached in node_modules/.cache/tt-music so it only happens once per file. MP3/M4A/AAC/OGG ship as-is.
 * - Dev: files are served from /music/…, and the playlist reloads when the folder changes.
 *   Build: the files are emitted into dist/music/.
 *
 * The app imports the list as `virtual:playlist`.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const DIRECT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus']);
const TRANSCODE = new Set(['.wav', '.aif', '.aiff', '.flac']);
const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg' };
const VIRTUAL = 'virtual:playlist';
const RESOLVED = '\0' + VIRTUAL;

type Entry = { src: string; out: string; title: string; artist: string | null; order: number };

const has = (cmd: string) => spawnSync('which', [cmd]).status === 0;

/** "03 - Artist - Title" → { order: 3, artist, title } */
export const parseName = (file: string) => {
    let name = basename(file, extname(file)).replace(/_/g, ' ').trim();
    let order = Number.POSITIVE_INFINITY;
    const num = name.match(/^(\d{1,3})\s*[-.)]?\s+/);
    if (num) { order = Number(num[1]); name = name.slice(num[0].length); }
    const parts = name.split(/\s+[-–—]\s+/);
    const [artist, title] = parts.length >= 2 ? [parts[0]!.trim(), parts.slice(1).join(' - ').trim()] : [null, name];
    return { order, artist, title };
};

export const musicPlugin = (dir: string, cacheDir: string): Plugin => {
    let entries: Entry[] = [];
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const transcode = (src: string) => {
        mkdirSync(cacheDir, { recursive: true });
        const st = statSync(src);
        const out = join(cacheDir, `${slug(basename(src, extname(src)))}-${st.size}-${Math.round(st.mtimeMs)}.m4a`);
        if (existsSync(out)) return out;
        // 192 kbps AAC; low-rate or mono sources can't take that, so fall back to the encoder's default
        const ok = has('afconvert')
            ? spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '192000', src, out]).status === 0
                || spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', src, out]).status === 0
            : has('ffmpeg') && spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'aac', '-b:a', '192k', out]).status === 0;
        return ok && existsSync(out) ? out : null;
    };

    const scan = () => {
        if (!existsSync(dir)) { entries = []; return; }
        const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const next: Entry[] = [];
        for (const f of files) {
            const ext = extname(f).toLowerCase();
            const src = join(dir, f);
            let out: string | null = null;
            if (DIRECT.has(ext)) out = src;
            else if (TRANSCODE.has(ext)) out = transcode(src) ?? (ext === '.wav' ? src : null);
            if (!out) continue;
            const { order, artist, title } = parseName(f);
            next.push({ src, out, title, artist, order });
        }
        // numbered tracks first in their order, then the rest alphabetically
        entries = next.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    };
    const urlOf = (e: Entry, i: number) => `music/${String(i + 1).padStart(2, '0')}-${slug(e.title) || 'track'}${extname(e.out).toLowerCase()}`;

    return {
        name: 'tt-music',
        buildStart() { scan(); },
        resolveId(id) { return id === VIRTUAL ? RESOLVED : null; },
        load(id) {
            if (id !== RESOLVED) return null;
            const list = entries.map((e, i) => ({ url: urlOf(e, i), title: e.title, artist: e.artist }));
            return `export default ${JSON.stringify(list)};`;
        },
        configureServer(server) {
            scan();
            server.watcher.add(dir);
            const changed = (p: string) => {
                if (!resolve(p).startsWith(resolve(dir))) return;
                scan();
                const mod = server.moduleGraph.getModuleById(RESOLVED);
                if (mod) server.moduleGraph.invalidateModule(mod);
                server.ws.send({ type: 'full-reload' });
            };
            server.watcher.on('add', changed);
            server.watcher.on('unlink', changed);
            server.middlewares.use((req, res, next) => {
                const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
                const i = entries.findIndex((e, k) => '/' + urlOf(e, k) === url);
                if (i < 0) return next();
                const file = entries[i]!.out;
                const size = statSync(file).size;
                const type = MIME[extname(file).toLowerCase()] ?? 'audio/wav';
                // range requests let the browser seek and stream
                const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
                if (range) {
                    const start = range[1] ? Number(range[1]) : 0;
                    const end = range[2] ? Number(range[2]) : size - 1;
                    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
                    createReadStream(file, { start, end }).pipe(res);
                } else {
                    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
                    createReadStream(file).pipe(res);
                }
            });
        },
        generateBundle() {
            entries.forEach((e, i) => this.emitFile({ type: 'asset', fileName: urlOf(e, i), source: readFileSync(e.out) }));
        },
    };
};
