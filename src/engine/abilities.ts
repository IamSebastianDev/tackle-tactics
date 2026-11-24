/** Which abilities / passives a player has, derived purely from class levels + config. */
import type { ClassId, GameConfig } from '../config';
import type { Piece, Player } from '../types';

export type AbilityId = keyof GameConfig['abilities'];
export type PassiveId = keyof GameConfig['passives'];
export type AbilityPhase = 'pre' | 'move' | 'act';

export const classLevel = (p: Player, cls: ClassId) => p.levels[cls] ?? 0;

export const abilityDef = (cfg: GameConfig, id: AbilityId) => cfg.abilities[id] as GameConfig['abilities'][AbilityId] & {
    cls: ClassId; unlock: number; phase: AbilityPhase; cooldown: number; label: string; key: string; icon: string; desc: string; short: string; how: string;
};

export const allAbilities = (cfg: GameConfig) => Object.keys(cfg.abilities) as AbilityId[];

/** Abilities whose class level requirement the player meets. */
export const abilitiesOf = (cfg: GameConfig, p: Player): AbilityId[] =>
    allAbilities(cfg).filter((id) => {
        const a = abilityDef(cfg, id);
        return classLevel(p, a.cls) >= a.unlock;
    });

export const passivesOf = (cfg: GameConfig, p: Player): PassiveId[] =>
    (Object.keys(cfg.passives) as PassiveId[]).filter((id) => {
        const d = cfg.passives[id] as { cls: ClassId; unlock: number };
        return classLevel(p, d.cls) >= d.unlock;
    });

export const hasAbility = (cfg: GameConfig, p: Player, id: AbilityId) => abilitiesOf(cfg, p).includes(id);
export const hasPassive = (cfg: GameConfig, p: Player, id: PassiveId) => passivesOf(cfg, p).includes(id);

/** Number value of a passive field if the player has the passive, else `fallback`. */
export const passiveValue = (cfg: GameConfig, p: Player, id: PassiveId, field: string, fallback: number): number =>
    hasPassive(cfg, p, id) ? ((cfg.passives[id] as Record<string, unknown>)[field] as number) : fallback;

export const cooldownLeft = (piece: Piece, id: AbilityId, round: number) => Math.max(0, (piece.cooldowns[id] ?? 0) - round);

export const classLabel = (cfg: GameConfig, p: Player) =>
    (Object.entries(p.levels) as Array<[ClassId, number]>)
        .sort((a, b) => b[1] - a[1])
        .map(([c, l]) => `${cfg.classes[c].short} ${l}`)
        .join(' / ');
