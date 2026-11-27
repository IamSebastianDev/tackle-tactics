// Cloud builds: download the art and songs that git doesn't have from the private R2 bucket
// (uploaded by `npm run assets:upload`) and unpack them into public/assets and assets/music.
// Called by scripts/ensure-assets.sh when the art is missing and R2 credentials are set:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (an R2 API token with read access)
//   R2_BUCKET    optional, defaults to tackle-tactics-assets
//   R2_ENDPOINT  optional, e.g. https://<account>.eu.r2.cloudflarestorage.com for an EU bucket
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const bucket = process.env.R2_BUCKET || 'tackle-tactics-assets';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('fetch-assets: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
    process.exit(1);
}

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
const endpoint = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const key = 'game-assets-goals-in-pixels.tar.gz';
const url = `${endpoint}/${bucket}/${key}`;
const res = await r2.fetch(url);
if (!res.ok) {
    console.error(`fetch-assets: ${res.status} ${res.statusText} for r2://${bucket}/${key}`);
    process.exit(1);
}

// unpacked by a relative name from the repo folder: on Windows, a tar that reads "C:\…" as
// host:path (Git Bash's GNU tar) can't open an absolute path
mkdirSync('assets', { recursive: true });
const stage = mkdtempSync('assets/.game-assets-');
const file = `${stage}/download.tar.gz`;
const art = 'public/assets';
const incoming = `${stage}/${art}`;
const previous = `${stage}/previous`;
try {
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    // skip macOS metadata ("._*") that older archives may carry
    execFileSync('tar', ['-xzf', file, '-C', stage, '--exclude', '._*', '--exclude', '.DS_Store'], { stdio: 'inherit' });
    if (!existsSync(`${incoming}/football-roll.png`)) throw new Error('fetch-assets: expected Goals in Pixels art in the archive');

    if (existsSync(`${stage}/assets/music`)) cpSync(`${stage}/assets/music`, 'assets/music', { recursive: true });
    mkdirSync('public', { recursive: true });
    if (existsSync(art)) renameSync(art, previous);
    try {
        renameSync(incoming, art);
    } catch (error) {
        if (existsSync(previous)) renameSync(previous, art);
        throw error;
    }
} finally {
    rmSync(stage, { recursive: true, force: true });
}
console.log('fetch-assets: art and music unpacked from R2');
