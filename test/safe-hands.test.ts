import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { hasPassive } from '../src/engine/abilities';
import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import type { Cell, Piece } from '../src/types';
import { generateClub } from '../src/world/generate';

const make = () => {
    const rng = createRng(11);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names);
    return new Match(cfg, [a, b], 11);
};

/** A loose ball `dx` cells in front of the home keeper, with nobody else nearby. */
const looseNear = (m: Match, dx: number, restrictedTo: 0 | 1 | null = null) => {
    const gk = m.state.pieces.find((p) => p.team === 0 && p.player.cls === 'keeper')! as Piece;
    const at: Cell = { x: gk.pos.x + dx, y: gk.pos.y };
    for (const p of m.state.pieces)
        if (p !== gk && Math.abs(p.pos.x - at.x) <= 4 && Math.abs(p.pos.y - at.y) <= 4) p.pos = { x: 25, y: p.pos.y };
    m.state.ball = { kind: 'loose', at, restrictedTo };
    gk.reactionReady = true;
    return { gk, at };
};

describe('safe hands: keepers claim nearby loose balls', () => {
    it('every keeper has it, outfielders do not', () => {
        const m = make();
        for (const p of m.state.pieces) expect(hasPassive(cfg, p.player, 'safeHands')).toBe(p.player.cls === 'keeper');
    });

    it('walks onto a loose ball within 3 and holds it, spending the reaction', () => {
        const m = make();
        const { gk, at } = looseNear(m, 3);
        const ev = m.keeperClaims();
        expect(m.carrier()?.id).toBe(gk.id);
        expect(gk.pos).toEqual(at);
        expect(gk.reactionReady).toBe(false);
        expect(ev.map((e) => e.t)).toEqual(['move', 'pickup']);
    });

    it('happens on its own between turns', () => {
        const m = make();
        const { gk } = looseNear(m, 2);
        m.state.phase = 'done';
        m.nextTurn();
        expect(m.carrier()?.id).toBe(gk.id);
    });

    it('leaves balls out of range, or only the other side may take', () => {
        const m = make();
        looseNear(m, 4);
        expect(m.keeperClaims()).toEqual([]);
        looseNear(m, 1, 1);
        expect(m.keeperClaims()).toEqual([]);
        expect(m.state.ball.kind).toBe('loose');
    });

    it('needs the reaction, unless it is the keeper whose turn starts', () => {
        const m = make();
        const { gk } = looseNear(m, 1);
        gk.reactionReady = false;
        expect(m.keeperClaims()).toEqual([]);
    });
});
