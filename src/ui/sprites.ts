import type { GameConfig } from '../config';
import type { Facing, Piece, Player } from '../types';
import { defaultConfig } from '../config';
import { pickHairIndex } from '../world/generate';
import { castUrl } from './castPack';
import { recolored } from './recolor';

/** Keepers and outfielders have different strips; map requests onto what exists. */
const KEEPER_MAP: Record<string, string> = {
    dribble: 'run',
    kick: 'gk_punt',
    pass: 'gk_throw',
    trap: 'gk_catch',
    slide_tackle: 'run',
    fall: 'sad',
    tired: 'idle',
    header: 'gk_punch',
    get_up: 'idle',
    clap: 'gk_ready',
    juggle: 'idle',
};
const OUTFIELD_MAP: Record<string, string> = {
    gk_ready: 'idle',
    gk_hold: 'idle',
    gk_catch: 'trap',
    gk_punch: 'header',
    gk_punt: 'kick',
    gk_throw: 'pass',
};

export const resolveAnim = (p: Piece, anim: string) =>
    p.player.cls === 'keeper' ? (KEEPER_MAP[anim] ?? anim) : (OUTFIELD_MAP[anim] ?? anim);

const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

/** A player's looks: stored on new players, derived from their id for older saves. */
export const lookOf = (p: Player): { skin: number; hair: number } => {
    if (p.skin !== undefined && p.hair !== undefined) return { skin: p.skin, hair: p.hair };
    const h = hash(p.id);
    return { skin: h % defaultConfig.looks.skinTones, hair: pickHairIndex(defaultConfig.looks.hairWeights, ((h >>> 8) % 1000) / 1000) };
};

const stripUrl = (sprite: string, anim: string, facing: Facing, player?: Player) => {
    const profile = facing === 'left' ? 'left' : 'right';
    const src = castUrl(`assets/cast/${sprite}/${anim}_${profile}.png`);
    if (!player) return src;
    const l = lookOf(player);
    return recolored(src, l.skin, l.hair);
};

export const spriteStyle = (cfg: GameConfig, sprite: string, anim: string, facing: Facing, player?: Player) => {
    const s = cfg.sprites;
    const frames = cfg.animFrames[anim] ?? 8;
    const R = s.renderPx;
    return [
        `background-image:url(${stripUrl(sprite, anim, facing, player)})`,
        `background-size:${frames * R}px ${R}px`,
        `--strip:${frames * R}px`,
        `--frames:${frames}`,
        `animation-duration:${frames * s.msPerFrame}ms`,
        `animation-timing-function:steps(${frames})`,
    ].join(';');
};

/** Strips worth preparing before kickoff so nobody flickers into their real colours. */
export const prewarmPlayer = (player: Player) => {
    const keeper = player.cls === 'keeper';
    const anims = keeper ? ['gk_ready', 'idle', 'run', 'gk_hold', 'celebrate'] : ['idle', 'run', 'dribble', 'celebrate'];
    for (const a of anims) for (const f of ['left', 'right'] as const) stripUrl(player.sprite, a, f, player);
};
