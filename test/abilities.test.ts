import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import type { Club, Piece } from '../src/types';
import { generateClub } from '../src/world/generate';

/** Build a match and hand the turn to `pick(m)` with a cleared board around it. */
const setup = (seed = 1, cfg = defaultConfig) => {
    const rng = createRng(seed);
    const names = new Set<string>();
    const clubs: [Club, Club] = [
        generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names),
        generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names),
    ];
    const m = new Match(cfg, clubs, seed);
    // park everyone in a far corner grid so tests can place pieces precisely
    m.state.pieces.forEach((p, i) => (p.pos = { x: 2 + (i % 11) * 2, y: i < 11 ? 0 : 29 }));
    return m;
};
const giveTurn = (m: Match, p: Piece, phase: 'move' | 'act' = 'move') => {
    const o = m.state.order;
    o.splice(o.indexOf(p.id), 1);
    o.splice(m.state.turnIndex, 0, p.id);
    m.state.phase = phase;
};
const byCls = (m: Match, team: 0 | 1, cls: string, n = 0) => m.state.pieces.filter((p) => p.team === team && p.player.cls === cls)[n]!;

describe('abilities', () => {
    it('through ball: nearest teammate runs onto the drop', () => {
        const m = setup();
        const mf = byCls(m, 0, 'midfielder');
        const st = byCls(m, 0, 'striker');
        mf.player.levels = { midfielder: 5 };
        mf.player.stats.passing = 99;
        mf.pos = { x: 20, y: 15 };
        st.pos = { x: 28, y: 15 };
        m.state.ball = { kind: 'held', by: mf.id };
        giveTurn(m, mf, 'act');
        const ev = m.kick({ x: 30, y: 15 }, 'through');
        expect(ev.some((e) => e.t === 'runOnto' && e.by === st.id)).toBe(true);
        expect(m.carrier()?.id).toBe(st.id);
        expect(mf.cooldowns.through).toBeGreaterThan(m.state.round);
    });

    it('cross: only into the box, and a teammate in range attacks it', () => {
        const m = setup(2);
        const wg = byCls(m, 0, 'winger');
        const st = byCls(m, 0, 'striker');
        wg.player.levels = { winger: 7 };
        wg.pos = { x: 40, y: 3 };
        st.pos = { x: 45, y: 14 };
        m.state.ball = { kind: 'held', by: wg.id };
        giveTurn(m, wg, 'act');
        expect(m.kickKind(wg, { x: 30, y: 14 }, 'cross')).toBeNull();
        expect(m.kickKind(wg, { x: 45, y: 14 }, 'cross')).toBe('pass');
        const keeper = m.keeperOf(1)!;
        keeper.pos = { x: 49, y: 3 }; // out of the way
        const ev = m.kick({ x: 45, y: 14 }, 'cross');
        const header = ev.find((e) => e.t === 'header');
        const ended = ev.some((e) => ['goal', 'save', 'wide', 'loose', 'receive', 'out', 'intercept'].includes(e.t));
        expect(ended).toBe(true);
        expect(!header || (header.t === 'header' && header.by === st.id)).toBe(true);
    });

    it('foul in the box gives a penalty; second yellow sends off and keeps the order valid', () => {
        const cfg = withOverrides({ abilities: { foul: { yellowChance: 1 } } });
        const m = setup(3, cfg);
        const df = byCls(m, 1, 'defender');
        const st = byCls(m, 0, 'striker');
        df.player.levels = { defender: 8 };
        df.yellows = 1;
        st.pos = { x: 45, y: 15 }; // in team 1's box
        df.pos = { x: 46, y: 15 };
        m.state.ball = { kind: 'held', by: st.id };
        giveTurn(m, df, 'act');
        const before = m.state.pieces.length;
        const ev = m.foul();
        expect(ev.find((e) => e.t === 'foul')).toMatchObject({ penalty: true });
        expect(ev.some((e) => e.t === 'card' && e.card === 'red')).toBe(true);
        expect(m.state.pieces.length).toBe(before - 1);
        expect(m.state.order).not.toContain(df.id);
        expect(ev.some((e) => ['goal', 'save', 'wide'].includes(e.t))).toBe(true);
        m.state.phase = 'done';
        expect(() => m.nextTurn()).not.toThrow();
    });

    it('foul outside the box freezes the carrier for their next turn', () => {
        const cfg = withOverrides({ abilities: { foul: { yellowChance: 0 } } });
        const m = setup(4, cfg);
        const df = byCls(m, 1, 'defender');
        const st = byCls(m, 0, 'striker');
        df.player.levels = { defender: 8 };
        st.pos = { x: 25, y: 15 };
        df.pos = { x: 26, y: 15 };
        m.state.ball = { kind: 'held', by: st.id };
        giveTurn(m, df, 'act');
        m.foul();
        expect(st.status.fouled).toBe(true);
        expect(m.reachable(st).size).toBe(1);
        expect(m.canTackle(df)).toBe(false); // free kick: no tackling a fouled carrier
    });

    it('set tempo moves a teammate to act next', () => {
        const m = setup(5);
        const mf = byCls(m, 0, 'midfielder');
        mf.player.levels = { midfielder: 7 };
        giveTurn(m, mf, 'act');
        const target = m.tempoTargets(mf).at(-1)!;
        m.tempo(target.id);
        expect(m.state.order[m.state.turnIndex + 1]).toBe(target.id);
    });

    it('man-mark: marker steps in when the target receives', () => {
        const cfg = withOverrides({ reactions: { maxChance: 1, minChance: 1 } });
        const m = setup(6, cfg);
        const df = byCls(m, 1, 'defender');
        const st = byCls(m, 0, 'striker');
        const mf = byCls(m, 0, 'midfielder');
        df.player.levels = { defender: 5 };
        st.pos = { x: 30, y: 15 };
        df.pos = { x: 32, y: 15 };
        mf.pos = { x: 22, y: 15 };
        giveTurn(m, df, 'act');
        m.mark(st.id);
        expect(df.status.markOn).toBe(st.id);
        m.state.ball = { kind: 'held', by: mf.id };
        giveTurn(m, mf, 'act');
        mf.player.stats.passing = 99;
        const ev = m.kick({ x: 30, y: 15 });
        expect(ev.some((e) => e.t === 'tackle' && e.by === df.id)).toBe(true);
    });

    it('trick burns adjacent reactions and leaves the carrier in the move phase', () => {
        const cfg = withOverrides({ reactions: { maxChance: 1, minChance: 1 } });
        const m = setup(7, cfg);
        const wg = byCls(m, 0, 'winger');
        const df = byCls(m, 1, 'defender');
        wg.player.levels = { winger: 5 };
        wg.pos = { x: 25, y: 15 };
        df.pos = { x: 26, y: 15 };
        m.state.ball = { kind: 'held', by: wg.id };
        giveTurn(m, wg, 'move');
        m.trick();
        expect(df.reactionReady).toBe(false);
        expect(m.state.phase).toBe('move');
        expect(m.abilityUsable(wg, 'trick')).toBe(false);
    });
});
