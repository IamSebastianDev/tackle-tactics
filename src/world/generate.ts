import type { ClassId, GameConfig, Stats, StatId } from '../config';
import type { Club, Player } from '../types';
import type { Rng } from '../rng';

const SYL_A = [
    'Bra',
    'Kel',
    'Mor',
    'Tav',
    'Ul',
    'Fen',
    'Dar',
    'Ise',
    'Rho',
    'Sel',
    'Vak',
    'Or',
    'Lio',
    'Jas',
    'Ner',
    'Qua',
    'Zel',
    'Ash',
    'Bel',
    'Cor',
];
const SYL_B = ['an', 'ric', 'o', 'enn', 'is', 'ard', 'ion', 'el', 'us', 'wyn', 'ek', 'ara', 'im', 'oth', 'ay', 'en'];
const SUR_A = [
    'Ash',
    'Stone',
    'Iron',
    'Wyn',
    'Hollow',
    'Thorn',
    'Brook',
    'Gale',
    'Mire',
    'Frost',
    'Oak',
    'Ember',
    'Raven',
    'Silver',
    'Marsh',
];
const SUR_B = ['ford', 'vale', 'wick', 'hart', 'more', 'shaw', 'by', 'well', 'den', 'ley', 'ridge', 'crest'];
const CLUB_PLACE = [
    'Mirewick',
    'Thornvale',
    'Galehaven',
    'Emberfall',
    'Ravenmoor',
    'Oakshaw',
    'Frostcrest',
    'Silverbrook',
    'Ironridge',
    'Hollowden',
];
const CLUB_SUFFIX = ['Wanderers', 'Rovers', 'Athletic', 'Guild', 'Company', 'Vanguard', 'Wardens', 'Fellowship'];

const STATS: StatId[] = ['speed', 'pace', 'passing', 'shooting', 'dribbling', 'tackling', 'reflexes', 'composure'];

export const playerName = (rng: Rng) => `${rng.pick(SYL_A)}${rng.pick(SYL_B)} ${rng.pick(SUR_A)}${rng.pick(SUR_B)}`;

/** Weighted pick of a hair colour index (config.looks.hairWeights). */
export const pickHairIndex = (weights: number[], roll: number) => {
    let r = roll * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]!) <= 0) return i;
    return 0;
};

const OUTFIELD: ClassId[] = ['defender', 'midfielder', 'winger', 'striker'];

/** Split a total level between a primary class and (sometimes) a secondary one. */
const distributeLevels = (cfg: GameConfig, rng: Rng, cls: ClassId, total: number): Partial<Record<ClassId, number>> => {
    const w = cfg.world;
    if (cls === 'keeper' || total < 3 || !rng.chance(w.multiclassChance)) return { [cls]: total };
    const second = rng.pick(OUTFIELD.filter((c) => c !== cls));
    const share = w.multiclassShare[0] + rng() * (w.multiclassShare[1] - w.multiclassShare[0]);
    const sub = Math.max(1, Math.min(total - 1, Math.round(total * share)));
    return { [cls]: total - sub, [second]: sub };
};

export type GenOpts = { levelRange?: [number, number]; talentShift?: number; age?: [number, number] };

export const generatePlayer = (
    cfg: GameConfig,
    rng: Rng,
    cls: ClassId,
    sprite: string,
    number: number,
    id: string,
    opts: GenOpts = {},
): Player => {
    const w = cfg.world;
    const lr = opts.levelRange ?? w.levelRange;
    const level = rng.int(lr[0], lr[1]);
    const levels = distributeLevels(cfg, rng, cls, level);
    const talent = Math.max(0.7, Math.min(1.4, rng.normal(w.talentMean + (opts.talentShift ?? 0), w.talentSd)));
    const [gLo, gHi] = cfg.career.growthRange;
    // growth is independent of talent: four quadrants (gifted/plateau, late bloomer, generational, depth)
    let growth = gLo + Math.max(0, Math.min(1, rng.normal(0.45, 0.2))) * (gHi - gLo);
    if (rng.chance(cfg.career.gemChance)) growth = gHi + rng() * 1.5; // a rare gem
    const peakAge = rng.int(cfg.career.peakAgeRange[0], cfg.career.peakAgeRange[1]);
    const ageR = opts.age ?? [18, 33];
    // stat emphasis is the level-weighted blend of each class profile
    const profile = {} as Stats;
    for (const s of STATS) {
        let v = 0;
        for (const [c, l] of Object.entries(levels) as Array<[ClassId, number]>) v += cfg.classes[c].statProfile[s] * (l / level);
        profile[s] = v;
    }
    const stats = {} as Stats;
    for (const s of STATS) {
        // emphasis decides where the class sits; level & talent lift everything.
        const base = 30 + profile[s] * 30 + level * 1.6 * (0.4 + profile[s] * 0.6);
        const v = base * talent + rng.normal(0, 5);
        stats[s] = Math.round(Math.max(w.statFloor, Math.min(w.statCeil, v)));
    }
    const look = (rng.chance(0.5) ? 1 : 2) as 1 | 2;
    const skin = rng.int(0, cfg.looks.skinTones - 1);
    const hair = pickHairIndex(cfg.looks.hairWeights, rng());
    return {
        id,
        name: playerName(rng),
        cls,
        level,
        levels,
        age: rng.int(ageR[0], ageR[1]),
        talent: +talent.toFixed(2),
        stats,
        sprite,
        number,
        look,
        skin,
        hair,
        growth: +growth.toFixed(2),
        peakAge,
        xp: {},
    };
};

export const generateClub = (
    cfg: GameConfig,
    rng: Rng,
    id: string,
    kit: string,
    keeperKit: string,
    formationId: string,
    nameTaken: Set<string>,
): Club => {
    let name = '';
    do name = `${rng.pick(CLUB_PLACE)} ${rng.pick(CLUB_SUFFIX)}`;
    while (nameTaken.has(name.split(' ')[0]!));
    nameTaken.add(name.split(' ')[0]!);
    const formation = cfg.formations.find((f) => f.id === formationId) ?? cfg.formations[0]!;
    const squad = formation.slots.map((slot, i) => {
        const sprite = slot.cls === 'keeper' ? keeperKit : `${kit}_player_${(i % 2) + 1}`;
        return generatePlayer(cfg, rng, slot.cls, sprite, i + 1, `${id}-p${i}`);
    });
    const short = name.split(' ')[0]!.slice(0, 3).toUpperCase();
    // substitutes: a keeper plus one of each outfield class
    const benchCls: ClassId[] = ['keeper', 'defender', 'midfielder', 'winger', 'striker'].slice(0, cfg.subs.bench) as ClassId[];
    const bench = benchCls.map((cls, i) => {
        const p = generatePlayer(cfg, rng, cls, '', 12 + i, `${id}-b${i}`, {
            levelRange: [Math.max(1, cfg.world.levelRange[0]), Math.max(2, cfg.world.levelRange[1] - 3)],
        });
        p.sprite = cls === 'keeper' ? keeperKit : `${kit}_player_${p.look}`;
        return p;
    });
    return { id, name, short, kit, keeperKit, formationId: formation.id, squad, bench };
};
