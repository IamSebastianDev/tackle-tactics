import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { abilitiesOf } from '../src/engine/abilities';
import { line } from '../src/engine/grid';
import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import { simulate } from '../src/sim';
import type { Club } from '../src/types';
import { generateClub } from '../src/world/generate';

const setup = (seed: number) => {
    const cfg = defaultConfig;
    const rng = createRng(seed);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names);
    return { cfg, m: new Match(cfg, [a, b], seed), clubs: [a, b] as [Club, Club] };
};

describe('engine', () => {
    it('bresenham includes both ends', () => {
        expect(line({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
        ]);
    });

    it('kickoff places 22 pieces on distinct in-pitch cells with the ball held', () => {
        const { m, cfg } = setup(1);
        const keys = new Set(m.state.pieces.map((p) => `${p.pos.x},${p.pos.y}`));
        expect(keys.size).toBe(22);
        for (const p of m.state.pieces) {
            expect(p.pos.x).toBeGreaterThanOrEqual(0);
            expect(p.pos.x).toBeLessThan(cfg.pitch.cols);
        }
        expect(m.state.ball.kind).toBe('held');
        expect(m.state.order.length).toBe(22);
    });

    it('turn order alternates teams', () => {
        const { m } = setup(2);
        const teams = m.state.order.map((id) => m.piece(id).team);
        for (let i = 1; i < teams.length; i++) expect(teams[i]).not.toBe(teams[i - 1]);
    });

    it('config overrides deep-merge', () => {
        const c = withOverrides({ match: { timerSeconds: 45 } });
        expect(c.match.timerSeconds).toBe(45);
        expect(c.match.rounds).toBe(defaultConfig.match.rounds);
    });

    it('abilities come from the perks picked at each class tier; multiclass players pick in both', () => {
        const { clubs } = setup(3);
        const p = { ...clubs[0].squad[5]!, levels: { midfielder: 6, striker: 3 }, perks: ['press', 'tempo', 'run'] };
        const ab = abilitiesOf(defaultConfig, p);
        expect(ab).toEqual(expect.arrayContaining(['press', 'tempo', 'run']));
        // the other option at each tier is gone, and higher tiers need the class level
        expect(ab).not.toContain('through');
        expect(ab).not.toContain('placed');
        expect(abilitiesOf(defaultConfig, { ...p, levels: { midfielder: 6, striker: 3 }, perks: [...p.perks, 'power'] })).not.toContain(
            'power',
        );
    });

    it('sprint only reaches straight lines', () => {
        const { m } = setup(4);
        const p = m.state.pieces.find((q) => q.player.cls === 'winger')!;
        p.player.levels = { winger: 5 };
        // advance until it's this winger's turn
        let guard = 0;
        while (m.active().id !== p.id && guard++ < 30) {
            m.state.phase = 'done';
            m.nextTurn();
        }
        const reach = m.reachable(p, 'sprint');
        for (const k of reach.keys()) {
            const [x, y] = k.split(',').map(Number);
            const dx = x! - p.pos.x,
                dy = y! - p.pos.y;
            expect(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)).toBe(true);
        }
    });

    it('AI vs AI plays full matches to completion and uses abilities', () => {
        const total: Record<string, number> = {};
        for (const seed of [3, 4, 5, 6, 7, 8]) {
            const { m, st } = simulate(defaultConfig, seed);
            console.log(seed, JSON.stringify({ ...st, abilities: undefined }));
            for (const [k, v] of Object.entries(st.abilities)) total[k] = (total[k] ?? 0) + v;
            expect(m.state.over).toBe(true);
        }
        console.log('abilities', JSON.stringify(total));
        expect(Object.keys(total).length).toBeGreaterThan(6);
    }, 60_000);
});
