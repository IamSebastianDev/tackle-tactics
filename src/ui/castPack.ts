/**
 * The player sprite strips in a release build come as one file (see scripts/cast-pack-plugin.ts).
 * Loaded once before the first screen; each strip then gets an in-memory URL. In dev there is no
 * pack and the loose files are used as they are.
 */
const urls = new Map<string, string>();

export const loadCastPack = async () => {
    try {
        const res = await fetch('assets/cast.pack');
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const head = new DataView(buf, 0, 8);
        // dev servers answer unknown paths with index.html: only a real pack starts with TTPK
        if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'TTPK') return;
        const n = head.getUint32(4, true);
        const index = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))) as Record<string, [number, number]>;
        const data = 8 + n;
        for (const [path, [off, len]] of Object.entries(index))
            urls.set(path, URL.createObjectURL(new Blob([new Uint8Array(buf, data + off, len)], { type: 'image/png' })));
    } catch {
        /* no pack: loose files */
    }
};

/** The URL to load a cast strip from: from the pack when there is one. */
export const castUrl = (path: string) => urls.get(path) ?? path;
