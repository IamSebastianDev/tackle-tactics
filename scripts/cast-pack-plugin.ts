/**
 * Packs the player sprite strips (dist/assets/cast/**.png, ~1,400 files) into one binary file,
 * dist/assets/cast.pack, after a build. Hosts such as itch.io cap a web game at 1,000 files, and
 * one request beats a thousand. Dev serves the loose files; src/ui/castPack.ts reads the pack.
 * Only the web build (TT_WEB=1) deletes the loose files afterwards.
 *
 * Format: "TTPK", a uint32 (little-endian) index length, the JSON index
 * { "assets/cast/<kit>/<anim>_<facing>.png": [offset, length] } (offsets into the data block), then the data.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export const castPackPlugin = (): Plugin => {
    let outDir = 'dist';
    return {
        name: 'tt-cast-pack',
        apply: 'build',
        configResolved(cfg) {
            outDir = cfg.build.outDir;
        },
        closeBundle() {
            const castDir = join(outDir, 'assets', 'cast');
            let dirs: string[];
            try {
                dirs = readdirSync(castDir);
            } catch {
                return; // no art copied (e.g. CI without the pack)
            }
            const index: Record<string, [number, number]> = {};
            const parts: Buffer[] = [];
            let offset = 0;
            // only real kit folders and strips: skip dotfiles such as macOS "._*" metadata
            for (const d of dirs.sort().filter((d) => !d.startsWith('.') && statSync(join(castDir, d)).isDirectory()))
                for (const f of readdirSync(join(castDir, d)).sort()) {
                    if (f.startsWith('.') || !f.endsWith('.png')) continue;
                    const buf = readFileSync(join(castDir, d, f));
                    index[
                        relative(outDir, join(castDir, d, f))
                            .split('\\')
                            .join('/')
                    ] = [offset, buf.length];
                    parts.push(buf);
                    offset += buf.length;
                }
            const json = Buffer.from(JSON.stringify(index));
            const head = Buffer.alloc(8);
            head.write('TTPK', 0, 'ascii');
            head.writeUInt32LE(json.length, 4);
            writeFileSync(join(outDir, 'assets', 'cast.pack'), Buffer.concat([head, json, ...parts]));
            // the web zip drops the loose strips (TT_WEB=1, set by scripts/publish-web.sh); other builds
            // keep them as a fallback in case the pack can't be read
            if (process.env.TT_WEB === '1') rmSync(castDir, { recursive: true });
        },
    };
};
