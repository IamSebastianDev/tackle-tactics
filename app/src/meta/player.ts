/** Player-level meta formulas: rating, value, wage, XP & level-ups, aging. All tunables in config.career. */
import type { ClassId, GameConfig, StatId, Stats } from '../config';
import { classLevel } from '../engine/abilities';
import type { Rng } from '../rng';
import type { Player } from '../types';

const STATS: StatId[] = ['speed', 'pace', 'passing', 'shooting', 'dribbling', 'tackling', 'reflexes', 'composure'];

/** Level-weighted blend of class stat profiles (what this player is "for"). */
export const profileOf = (cfg: GameConfig, p: Player): Stats => {
    const out = {} as Stats;
    for (const s of STATS) {
        let v = 0;
        for (const [c, l] of Object.entries(p.levels) as Array<[ClassId, number]>) v += cfg.classes[c].statProfile[s] * (l / Math.max(1, p.level));
        out[s] = v;
    }
    return out;
};

/** Overall rating 1..99: stats weighted by what the player's classes care about, plus a level bonus. */
export const ovr = (cfg: GameConfig, p: Player, asClass?: ClassId): number => {
    const prof = asClass ? cfg.classes[asClass].statProfile : profileOf(cfg, p);
    let sum = 0;
    let w = 0;
    for (const s of STATS) {
        sum += p.stats[s] * prof[s];
        w += prof[s];
    }
    const lvl = asClass ? classLevel(p, asClass) : p.level;
    return Math.round(Math.min(99, sum / w + lvl * 0.6));
};

/** How well `p` fits a formation slot of class `cls` (used for auto lineups). */
export const fitFor = (cfg: GameConfig, p: Player, cls: ClassId) => {
    const lvl = classLevel(p, cls);
    // out of position is a big deal (no abilities), in goal it's a disaster
    const misfit = lvl ? 0 : cls === 'keeper' ? 80 : 25;
    return ovr(cfg, p, cls) + lvl * 2 - misfit - (p.injury ? 1000 : 0);
};

const ageFactor = (p: Player) => {
    const d = p.peakAge - p.age;
    return d >= 0 ? 1 + Math.min(d, 8) * 0.07 : Math.max(0.15, 1 + d * 0.13);
};

export const playerValue = (cfg: GameConfig, p: Player) => {
    const v = cfg.career.value;
    const growthF = 0.7 + p.growth * 0.12;
    const raw = v.base * Math.pow(ovr(cfg, p) / 50, v.ovrExp) * ageFactor(p) * growthF;
    return Math.round(raw / 1000) * 1000;
};

export const wage = (cfg: GameConfig, p: Player) => Math.max(500, Math.round((playerValue(cfg, p) * cfg.career.value.wageRate) / 100) * 100);

export const xpToNext = (cfg: GameConfig, p: Player, cls: ClassId) => cfg.career.xpBase + cfg.career.xpPerLevel * classLevel(p, cls);

/** Hand out stat points for one level, weighted by the class profile. */
const growStats = (cfg: GameConfig, rng: Rng, p: Player, cls: ClassId) => {
    const prof = cfg.classes[cls].statProfile;
    let points = Math.round(p.growth * (0.7 + rng() * 0.6));
    const total = STATS.reduce((a, s) => a + prof[s], 0);
    while (points-- > 0) {
        let r = rng() * total;
        for (const s of STATS) {
            if ((r -= prof[s]) <= 0) {
                p.stats[s] = Math.min(cfg.world.statCeil + 4, p.stats[s] + 1);
                break;
            }
        }
    }
};

/** Bank XP in a class; returns how many levels were gained (stats grow per level). */
export const gainXp = (cfg: GameConfig, rng: Rng, p: Player, cls: ClassId, amount: number): number => {
    let gained = 0;
    p.xp[cls] = (p.xp[cls] ?? 0) + amount;
    for (;;) {
        const need = xpToNext(cfg, p, cls);
        if ((p.xp[cls] ?? 0) < need) break;
        p.xp[cls] = (p.xp[cls] ?? 0) - need;
        p.levels[cls] = classLevel(p, cls) + 1;
        p.level += 1;
        growStats(cfg, rng, p, cls);
        gained++;
    }
    // primary class follows the most levels
    p.cls = (Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1])[0]![0];
    return gained;
};

/** End-of-season aging; returns the average stat delta applied. */
export const ageOneSeason = (cfg: GameConfig, rng: Rng, p: Player): number => {
    const d = p.age - p.peakAge;
    const band = cfg.career.aging.find((b) => d <= b.upTo) ?? cfg.career.aging.at(-1)!;
    for (const s of STATS) {
        const delta = Math.round(band.delta * (0.6 + rng() * 0.8));
        p.stats[s] = Math.max(cfg.world.statFloor - 10, Math.min(cfg.world.statCeil + 4, p.stats[s] + delta));
    }
    p.age += 1;
    return band.delta;
};

/** 1..5 stars for growth (shown as "Potential"). */
export const potentialStars = (cfg: GameConfig, p: Player) => {
    const [lo, hi] = cfg.career.growthRange;
    return Math.max(1, Math.min(5, Math.round(1 + ((p.growth - lo) / (hi - lo)) * 4)));
};

export const money = (n: number) => {
    const sign = n < 0 ? '−' : '';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 2)}M g`;
    if (a >= 1_000) return `${sign}${Math.round(a / 1_000)}k g`;
    return `${sign}${a} g`;
};
