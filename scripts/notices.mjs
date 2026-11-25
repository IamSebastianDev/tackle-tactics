// THIRD-PARTY-NOTICES.txt: the licenses of everything bundled into a build that isn't ours.
//   - the JavaScript packages that ship in the bundle (package.json "dependencies", recursively),
//     fonts included (Open Font License: the license text must travel with the fonts);
//   - the Rust crates of the desktop app, when a cargo-about report is given (TT_RUST_NOTICES; the
//     release workflow makes one with src-tauri/about.toml). The web build has no Rust in it.
// Used by the build (scripts/notices-plugin.ts); `node scripts/notices.mjs [rust.txt]` prints it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const LICENSE_FILE = /^(licen[cs]e|copying|ofl)(\.(md|txt))?$|^licen[cs]e-/i;

const pkgDir = (name) => join(root, 'node_modules', name);
const readPkg = (name) => JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'));

/** The runtime packages: package.json dependencies and theirs, each once. */
const runtimePackages = () => {
    const seen = new Map();
    const visit = (name) => {
        if (seen.has(name) || !existsSync(pkgDir(name))) return;
        const p = readPkg(name);
        seen.set(name, p);
        for (const dep of Object.keys(p.dependencies ?? {})) visit(dep);
    };
    for (const dep of Object.keys(readPkg('..').dependencies ?? {})) visit(dep);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const repoUrl = (p) => (typeof p.repository === 'string' ? p.repository : (p.repository?.url ?? p.homepage ?? '')).replace(/^git\+/, '');

const jsSection = () =>
    runtimePackages()
        .map(([name, p]) => {
            const files = readdirSync(pkgDir(name)).filter((f) => LICENSE_FILE.test(f) && !f.endsWith('.spdx'));
            const texts = files.map((f) => readFileSync(join(pkgDir(name), f), 'utf8').trim());
            const head = `${name} ${p.version}\nLicense: ${p.license ?? 'see below'}${repoUrl(p) ? `\nSource: ${repoUrl(p)}` : ''}`;
            const body = texts.length
                ? texts.join('\n\n')
                : `(No license text in the package; ${p.license ?? 'its license'} applies, see the source above.)`;
            return `${'-'.repeat(80)}\n${head}\n${'-'.repeat(80)}\n\n${body}\n`;
        })
        .join('\n');

export const buildNotices = (rustFile = process.env.TT_RUST_NOTICES) => {
    const rust = rustFile && existsSync(rustFile) ? readFileSync(rustFile, 'utf8').trim() : '';
    return [
        'Tackle Tactics: third-party notices',
        '',
        "The game's own code is MIT-licensed (see LICENSE in the source repository). This file lists the",
        'licenses of the open-source software and fonts bundled with it. The art (by bubbabba,',
        "https://bubbabba.itch.io) and the radio's songs are used under their own licenses and are not",
        'covered by any license below.',
        '',
        '================================================================================',
        'JavaScript packages and fonts',
        '================================================================================',
        '',
        jsSection(),
        ...(rust
            ? [
                  '',
                  '================================================================================',
                  'Rust crates (desktop app)',
                  '================================================================================',
                  '',
                  rust,
                  '',
              ]
            : []),
    ].join('\n');
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.stdout.write(buildNotices(process.argv[2]));
