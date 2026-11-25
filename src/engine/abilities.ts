/**
 * Which abilities / passives a player has. At each perk tier (config.perkTiers) the player picks one
 * option and keeps it; `player.perks` lists the picks. Players without a perk list (older data)
 * fall back to "everything their class levels unlock".
 */
import type { ClassId, GameConfig } from '../config';
import type { Piece, Player } from '../types';

export type AbilityId = keyof GameConfig['abilities'];
export type PassiveId = keyof GameConfig['passives'];
export type AbilityPhase = 'pre' | 'move' | 'act';

export const classLevel = (p: Player, cls: ClassId) => p.levels[cls] ?? 0;

export const abilityDef = (cfg: GameConfig, id: AbilityId) =>
    cfg.abilities[id] as GameConfig['abilities'][AbilityId] & {
        cls: ClassId;
        unlock: number;
        phase: AbilityPhase;
        cooldown: number;
        label: string;
        key: string;
        icon: string;
        desc: string;
        short: string;
        how: string;
    };

export const allAbilities = (cfg: GameConfig) => Object.keys(cfg.abilities) as AbilityId[];

export type PerkId = AbilityId | PassiveId;
export type PerkTier = { cls: ClassId; level: number; options: PerkId[] };

/** The class and level a perk belongs to. */
export const perkDef = (cfg: GameConfig, id: PerkId): { cls: ClassId; unlock: number; label: string; kind: 'ability' | 'passive' } => {
    if (id in cfg.abilities) {
        const a = abilityDef(cfg, id as AbilityId);
        return { cls: a.cls, unlock: a.unlock, label: a.label, kind: 'ability' };
    }
    const d = cfg.passives[id as PassiveId] as { cls: ClassId; unlock: number; label: string };
    return { cls: d.cls, unlock: d.unlock, label: d.label, kind: 'passive' };
};

/** Does the player have this perk: picked (or kept from older data) and the class level is there. */
const owns = (cfg: GameConfig, p: Player, id: PerkId) => {
    const d = perkDef(cfg, id);
    const innate = (cfg.passives[id as PassiveId] as { innate?: boolean } | undefined)?.innate === true;
    return classLevel(p, d.cls) >= d.unlock && (innate || !p.perks || p.perks.includes(id));
};

/** Tiers the player has reached in their classes but hasn't picked from yet. */
export const pendingPerks = (cfg: GameConfig, p: Player): PerkTier[] => {
    const out: PerkTier[] = [];
    for (const [cls, lvl] of Object.entries(p.levels) as Array<[ClassId, number]>)
        for (const t of cfg.perkTiers[cls] ?? [])
            if (lvl >= t.level && !t.options.some((o) => p.perks?.includes(o as PerkId)))
                out.push({ cls, level: t.level, options: t.options as PerkId[] });
    return out.sort((a, b) => a.level - b.level);
};

/** The perk tiers still ahead in a class (for "next choice" hints). */
export const nextPerkTier = (cfg: GameConfig, p: Player, cls: ClassId): PerkTier | null => {
    const t = (cfg.perkTiers[cls] ?? []).find((x) => x.level > classLevel(p, cls));
    return t ? { cls, level: t.level, options: t.options as PerkId[] } : null;
};

/** Take a perk from a pending tier. Returns false if it isn't on offer. */
export const pickPerk = (cfg: GameConfig, p: Player, id: PerkId): boolean => {
    if (!pendingPerks(cfg, p).some((t) => t.options.includes(id))) return false;
    p.perks = [...(p.perks ?? []), id];
    return true;
};

/** Settle every pending tier: single-option tiers always; choices at random (AI and generated players). */
export const settlePerks = (cfg: GameConfig, p: Player, roll: () => number, choices = true) => {
    p.perks ??= [];
    for (const t of pendingPerks(cfg, p)) {
        if (t.options.length === 1) pickPerk(cfg, p, t.options[0]!);
        else if (choices) pickPerk(cfg, p, t.options[Math.floor(roll() * t.options.length)]!);
    }
};

/** Abilities the player has. */
export const abilitiesOf = (cfg: GameConfig, p: Player): AbilityId[] => allAbilities(cfg).filter((id) => owns(cfg, p, id));

export const passivesOf = (cfg: GameConfig, p: Player): PassiveId[] =>
    (Object.keys(cfg.passives) as PassiveId[]).filter((id) => owns(cfg, p, id));

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
