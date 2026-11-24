/** Pure formulas: chances and radii. Everything reads from config; passives and statuses apply here. */
import type { GameConfig } from '../config';
import type { Piece } from '../types';
import { passiveValue } from './abilities';

/** Morale 60 is neutral; each point away shifts reaction odds by 1/400 (±10% at the extremes). */
export const moraleEdge = (p: Piece) => ((p.morale ?? 60) - 60) / 400;

const clamp = (cfg: GameConfig, p: number) => Math.max(cfg.reactions.minChance, Math.min(cfg.reactions.maxChance, p));

export const movePoints = (cfg: GameConfig, p: Piece, bonus = 0) => {
    if (p.status.fouled) return 0;
    const kit = cfg.classes[p.player.cls];
    const st = p.stamina ?? 100;
    const tired = st < cfg.fatigue.exhausted ? 2 : st < cfg.fatigue.tired ? 1 : 0;
    const base = Math.max(2, kit.move + Math.round((p.player.stats.pace - 50) / cfg.movement.paceStep) - tired) + bonus;
    return p.status.grounded ? Math.floor(base / 2) : base;
};

export type KickMods = { scatterMult?: number; header?: boolean };

export const scatterRadius = (cfg: GameConfig, kicker: Piece, distance: number, kind: 'pass' | 'shot', mods: KickMods = {}) => {
    const b = cfg.ball;
    const pl = kicker.player;
    const skill = kind === 'pass' ? pl.stats.passing : pl.stats.shooting;
    const raw = kind === 'pass' ? b.passScatterBase + distance * b.passScatterPerCell : b.shotScatterBase + distance * b.shotScatterPerCell;
    const factor = 0.55 + (skill / 100) * b.skillScale;
    let mult = mods.scatterMult ?? 1;
    if (kind === 'pass')
        mult *= Math.min(passiveValue(cfg, pl, 'distributor', 'passScatter', 1), passiveValue(cfg, pl, 'vision', 'passScatter', 1));
    else mult *= passiveValue(cfg, pl, 'clinical', 'shotScatter', 1);
    if (mods.header) mult *= passiveValue(cfg, pl, 'aerial', 'headerScatter', 1);
    if (kicker.status.pressured) mult *= cfg.abilities.press.pressureScatter;
    if (kicker.status.fouled) mult *= cfg.cards.freeKickScatterMult;
    mult *= 1 - moraleEdge(kicker);
    return Math.min(b.maxScatter, (raw / factor) * mult);
};

/** Exhausted players are a beat slow to react. */
export const fatiguePenalty = (cfg: GameConfig, p: Piece) =>
    (p.stamina ?? 100) < cfg.fatigue.exhausted ? cfg.fatigue.exhaustedReaction : 0;

export const tackleChance = (cfg: GameConfig, defender: Piece, carrier: Piece, active: boolean, bonus = 0) => {
    const r = cfg.reactions;
    const d = defender.player.stats;
    const a = carrier.player.stats;
    const diff = (d.tackling * 0.8 + d.composure * 0.2 - (a.dribbling * 0.8 + a.composure * 0.2)) / 100;
    let p = r.tackleBase + diff * r.tackleStatWeight + (active ? r.activeTackleBonus : 0) + bonus;
    p += passiveValue(cfg, defender.player, 'stopper', 'tackle', 0);
    p -= passiveValue(cfg, carrier.player, 'elusive', 'evade', 0);
    if (carrier.status.pressured) p += cfg.abilities.press.pressureTackle;
    if (defender.status.rushing) p += cfg.abilities.rush.tackleBonus;
    if (defender.status.commanded) p += cfg.abilities.command.bonus;
    p += moraleEdge(defender) - moraleEdge(carrier) * 0.5;
    p += fatiguePenalty(cfg, carrier) - fatiguePenalty(cfg, defender);
    return clamp(cfg, p);
};

export const interceptChance = (cfg: GameConfig, defender: Piece, kicker: Piece, onPath: boolean, kind: 'pass' | 'shot') => {
    const r = cfg.reactions;
    const d = defender.player.stats;
    const skill = kind === 'pass' ? kicker.player.stats.passing : kicker.player.stats.shooting;
    const diff = (d.reflexes * 0.7 + d.tackling * 0.3 - skill) / 100;
    const base = kind === 'pass' ? r.interceptBase : r.blockShotBase;
    let p = base + diff * r.interceptStatWeight + (onPath ? 0.1 : -0.06);
    p += passiveValue(cfg, defender.player, 'reader', 'intercept', 0);
    if (defender.status.commanded) p += cfg.abilities.command.bonus;
    p += moraleEdge(defender) - fatiguePenalty(cfg, defender);
    return clamp(cfg, p);
};

export const saveChance = (cfg: GameConfig, keeper: Piece, shooter: Piece, keeperDistance: number, shotDistance: number, saveMod = 0) => {
    const r = cfg.reactions;
    const diff = (keeper.player.stats.reflexes - shooter.player.stats.shooting) / 100;
    let p = r.saveBase + diff * r.saveStatWeight + saveMod;
    p += passiveValue(cfg, keeper.player, 'shotStopper', 'save', 0);
    p -= Math.max(0, keeperDistance - 1) * r.saveDistancePenalty;
    p -= Math.max(0, 10 - shotDistance) * r.saveCloseRangePenalty;
    p += Math.max(0, shotDistance - 10) * r.saveLongRangeBonus;
    if (!keeper.reactionReady || keeper.staggered) p *= 0.4;
    return clamp(cfg, p);
};

export const trickChance = (cfg: GameConfig, carrier: Piece, defender: Piece) => {
    const t = cfg.abilities.trick;
    const diff = (carrier.player.stats.dribbling - defender.player.stats.reflexes) / 100;
    return clamp(cfg, t.base + diff * t.statWeight);
};
