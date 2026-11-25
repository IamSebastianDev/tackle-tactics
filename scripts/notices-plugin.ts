/** Emits THIRD-PARTY-NOTICES.txt into every build (see scripts/notices.mjs). */
import type { Plugin } from 'vite';
// @ts-expect-error plain ESM script without types
import { buildNotices } from './notices.mjs';

export const noticesPlugin = (): Plugin => ({
    name: 'tt-notices',
    apply: 'build',
    generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: (buildNotices as () => string)() });
    },
});
