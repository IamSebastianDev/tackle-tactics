// `npm version <patch|minor|major>` runs this (the "version" lifecycle script) after bumping
// package.json: it copies the new version into src-tauri/Cargo.toml and Cargo.lock so the Rust
// crate matches. tauri.conf.json reads package.json directly. npm then commits and tags.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const bump = (file, pattern) => {
    const text = readFileSync(file, 'utf8');
    const next = text.replace(pattern, `$1${version}$2`);
    if (next === text && !text.includes(version)) throw new Error(`could not update the version in ${file}`);
    writeFileSync(file, next);
};
bump('src-tauri/Cargo.toml', /^(version = ")[^"]+(")/m);
bump('src-tauri/Cargo.lock', /(name = "tackle-tactics"\nversion = ")[^"]+(")/);
console.log(`version ${version}: package.json, Cargo.toml and Cargo.lock agree`);
