import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg, type ClassId } from '../src/config';
import { newCareer, pickFormation } from '../src/meta/career';
import { createRng } from '../src/rng';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('formations', () => {
    it('every formation is eleven slots, one keeper, inside its own half, and fits a standard squad', () => {
        for (const f of cfg.formations) {
            expect(f.slots).toHaveLength(11);
            expect(f.slots.filter((s) => s.cls === 'keeper')).toHaveLength(1);
            expect(f.slots.every((s) => s.x >= 0 && s.x < 0.5 && s.y >= 0 && s.y <= 1)).toBe(true);
            expect(f.note.length).toBeGreaterThan(10);
            const need: Partial<Record<ClassId, number>> = {};
            for (const s of f.slots) need[s.cls] = (need[s.cls] ?? 0) + 1;
            for (const [cls, n] of Object.entries(need) as Array<[ClassId, number]>)
                expect(n).toBeLessThanOrEqual(cfg.career.squadMake[cls]);
        }
    });

    it('AI clubs pick shapes their squads fill, and not all the same one', () => {
        const c = newCareer(cfg, 3, settings);
        const used = new Set(Object.values(c.clubs).map((cl) => cl.formationId));
        expect(used.size).toBeGreaterThanOrEqual(4);
        for (const cl of Object.values(c.clubs)) expect(cfg.formations.some((f) => f.id === cl.formationId)).toBe(true);
        // with no tolerance the pick is the single best fit, and stable
        const club = Object.values(c.clubs)[5]!;
        expect(pickFormation(cfg, createRng(1), club, 0)).toBe(pickFormation(cfg, createRng(2), club, 0));
    });
});
