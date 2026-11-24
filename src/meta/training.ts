import type { ClassId, GameConfig, StatId } from '../config';
import { classLevel } from '../engine/abilities';
import type { Player } from '../types';

type Focus = { label: string; cls: ClassId; stats: readonly [StatId, StatId] };

export const TRAINING_FOCUSES = {
    passing: { label: 'Passing', cls: 'midfielder', stats: ['passing', 'composure'] },
    tackling: { label: 'Tackling', cls: 'defender', stats: ['tackling', 'reflexes'] },
    dribbling: { label: 'Dribbling', cls: 'winger', stats: ['dribbling', 'pace'] },
    finishing: { label: 'Finishing', cls: 'striker', stats: ['shooting', 'composure'] },
    goalkeeping: { label: 'Goalkeeping', cls: 'keeper', stats: ['reflexes', 'composure'] },
} as const satisfies Record<string, Focus>;

export type TrainingFocus = keyof typeof TRAINING_FOCUSES;
export const TRAINING_FOCUS_IDS = Object.keys(TRAINING_FOCUSES) as TrainingFocus[];
export const DEFAULT_TRAINING_FOCUS: TrainingFocus = 'passing';

/** The same forecast drives the squad preview and the session itself. */
export const trainingGain = (cfg: GameConfig, p: Player, focus: TrainingFocus) => {
    if (p.injury) return null;
    const {
        cls,
        stats: [main, support],
    } = TRAINING_FOCUSES[focus];
    const xp = cfg.training.xp;
    // A player can learn another outfield role, while keepers and outfielders run separate drills.
    if ((p.cls === 'keeper') !== (cls === 'keeper')) return { cls: p.cls, amount: xp.base };
    const aptitude = Math.max(0, Math.min(1, (2 * p.stats[main] + p.stats[support]) / 300));
    const roleBonus = p.cls === cls ? xp.primary : classLevel(p, cls) > 0 ? xp.secondary : 0;
    return { cls, amount: Math.round(xp.base + aptitude * xp.attributes + roleBonus) };
};
