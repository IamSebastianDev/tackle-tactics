// Cloud builds: download the art and songs that git doesn't have from the private R2 bucket
// (uploaded by `npm run assets:upload`) and unpack them into public/assets and assets/music.
// Called by scripts/ensure-assets.sh when the art is missing and R2 credentials are set:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (an R2 API token with read access)
//   R2_BUCKET    optional, defaults to tackle-tactics-assets
//   R2_ENDPOINT  optional, e.g. https://<account>.eu.r2.cloudflarestorage.com for an EU bucket
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AwsClient } from 'aws4fetch';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const bucket = process.env.R2_BUCKET || 'tackle-tactics-assets';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('fetch-assets: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
    process.exit(1);
}

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
const endpoint = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const url = `${endpoint}/${bucket}/game-assets.tar.gz`;
const res = await r2.fetch(url);
if (!res.ok) {
    console.error(`fetch-assets: ${res.status} ${res.statusText} for r2://${bucket}/game-assets.tar.gz`);
    process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'tt-assets-'));
const file = join(dir, 'game-assets.tar.gz');
writeFileSync(file, Buffer.from(await res.arrayBuffer()));
// skip macOS metadata ("._*") that older archives may carry
execFileSync('tar', ['-xzf', file, '--exclude', '._*', '--exclude', '.DS_Store', '-C', process.cwd()], { stdio: 'inherit' });
rmSync(dir, { recursive: true });
console.log('fetch-assets: art and music unpacked from R2');
