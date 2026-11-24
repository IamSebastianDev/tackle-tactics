import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { attackGoalX } from '../src/engine/grid';
import { Match } from '../src/engine/match';
import { createRng, type Rng } from '../src/rng';
import type { Cell, MatchState, Piece } from '../src/types';
import { generateClub } from '../src/world/generate';

const setup = (seed: number) => {
    const rng = createRng(seed);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names);
    return new Match(cfg, [a, b], seed);
};

/** Put a piece on a cell, swapping out whoever stood there. */
const place = (m: Match, p: Piece, at: Cell) => {
    const other = m.pieceAt(at);
    if (other && other !== p) other.pos = { ...p.pos };
    p.pos = { ...at };
};

/** Take the same shot `n` times with fresh dice and count the goals. */
const goalRate = (m: Match, target: Cell, n: number) => {
    const snapshot: MatchState = structuredClone(m.state);
    const engine = m as unknown as { state: MatchState; rng: Rng };
    let goals = 0;
    for (let i = 0; i < n; i++) {
        engine.state = structuredClone(snapshot);
        engine.rng = createRng(7000 + i);
        if (m.kick(target).some((e) => e.t === 'goal')) goals++;
    }
    engine.state = snapshot;
    return goals / n;
};

const stageShot = (m: Match, distance: number) => {
    const s = m.state;
    const p = m.active();
    const gx = attackGoalX(cfg, p.team);
    const mid = Math.floor((cfg.pitch.rows - 1) / 2);
    place(m, p, { x: gx < 0 ? distance - 1 : cfg.pitch.cols - distance, y: mid });
    s.ball = { kind: 'held', by: p.id };
    s.phase = 'act';
    return { p, target: { x: gx, y: mid }, gx, mid };
};

describe('shot odds', () => {
    it('match how often the engine actually scores (clear lane)', () => {
        const m = setup(3);
        const { p, target, gx, mid } = stageShot(m, 12);
        // clear the lane so only scatter and the keeper matter
        for (const o of m.opponents(p.team))
            if (o.player.cls !== 'keeper' && Math.abs(o.pos.y - mid) <= 2) o.pos = { x: o.pos.x, y: (o.pos.y + 8) % cfg.pitch.rows };
        const odds = m.shotOdds(p, target);
        expect(odds.block).toBeLessThan(0.001);
        expect(odds.goal).toBeGreaterThan(0.05);
        expect(Math.abs(goalRate(m, target, 4000) - odds.goal)).toBeLessThan(0.03);
        expect(gx === -1 || gx === cfg.pitch.cols).toBe(true);
    });

    it('include a defender who can block on the line', () => {
        const m = setup(4);
        const { p, target, gx, mid } = stageShot(m, 14);
        const blocker = m.opponents(p.team).find((o) => o.player.cls === 'defender')!;
        place(m, blocker, { x: p.pos.x + (gx < 0 ? -4 : 4), y: mid });
        blocker.reactionReady = true;
        const odds = m.shotOdds(p, target);
        expect(odds.block).toBeGreaterThan(0.05);
        expect(Math.abs(goalRate(m, target, 4000) - odds.goal)).toBeLessThan(0.03);
    });

    it('is zero for anything that is not a shot', () => {
        const m = setup(5);
        const { p } = stageShot(m, 12);
        expect(m.shotOdds(p, { x: p.pos.x, y: p.pos.y + 3 }).goal).toBe(0);
    });
});
