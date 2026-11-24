/** Small seeded PRNG (mulberry32) so matches and worlds are reproducible. */
export type Rng = {
    (): number;
    int: (min: number, maxInclusive: number) => number;
    pick: <T>(arr: readonly T[]) => T;
    normal: (mean: number, sd: number) => number;
    chance: (p: number) => boolean;
    state: () => number;
};

export const createRng = (seed: number): Rng => {
    let s = seed >>> 0;
    const next = (() => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }) as Rng;
    next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
    next.pick = (arr) => {
        if (arr.length === 0) throw new Error('pick from empty array');
        return arr[Math.floor(next() * arr.length)]!;
    };
    next.normal = (mean, sd) => {
        const u = Math.max(next(), 1e-9);
        const v = next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.chance = (p) => next() < p;
    next.state = () => s;
    return next;
};
