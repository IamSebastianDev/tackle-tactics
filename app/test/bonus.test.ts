import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import type { Piece } from '../src/types';
import { generateClub } from '../src/world/generate';

const noFouls = { foulOnMiss: 0, foulOnWin: 0 };
const make = (foulOnWin = 0) => {
    const cfg = withOverrides({
        reactions: { tackleBase: 2 },
        referee: { styles: { lenient: { ...noFouls, foulOnWin }, fair: { ...noFouls, foulOnWin }, strict: { ...noFouls, foulOnWin } } },
    } as never, defaultConfig);
    const rng = createRng(5);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names);
    return new Match(cfg, [a, b], 5);
};

/** Make `tackler` the active piece in the act phase, next to an opposing carrier. */
const stage = (m: Match) => {
    const s = m.state;
    const tackler = m.active();
    const carrier = s.pieces.find((p) => p.team !== tackler.team && p.player.cls !== 'keeper')! as Piece;
    const spot = { x: tackler.pos.x + 1, y: tackler.pos.y };
    const occupant = m.pieceAt(spot);
    if (occupant && occupant !== carrier) occupant.pos = { ...carrier.pos };
    carrier.pos = spot;
    s.ball = { kind: 'held', by: carrier.id };
    s.phase = 'act';
    return { tackler, carrier };
};

describe('tackle winner gets an extra turn', () => {
    it('acts next, then the order resumes where it was', () => {
        const m = make();
        const { tackler } = stage(m);
        const nextInOrder = m.state.order[m.state.turnIndex + 1];
        const ev = m.tackle();
        expect(ev.some((e) => e.t === 'tackle' && e.success)).toBe(true);
        const bonus = m.nextTurn();
        expect(bonus).toEqual([{ t: 'bonus', id: tackler.id }]);
        expect(m.active().id).toBe(tackler.id);
        expect(m.state.phase).toBe('move');
        expect(m.carrier()?.id).toBe(tackler.id);
        m.state.phase = 'done';
        m.nextTurn();
        expect(m.active().id).toBe(nextInOrder);
    });

    it('no reward when the referee calls the tackle a foul', () => {
        const m = make(1);
        const { carrier } = stage(m);
        m.tackle();
        expect(m.carrier()?.id).toBe(carrier.id);
        expect(m.nextTurn().some((e) => e.t === 'bonus')).toBe(false);
    });

    it('can be switched off in config', () => {
        const m = make();
        (m.cfg.match as { tackleBonusTurn: boolean }).tackleBonusTurn = false;
        stage(m);
        m.tackle();
        expect(m.nextTurn().some((e) => e.t === 'bonus')).toBe(false);
        (m.cfg.match as { tackleBonusTurn: boolean }).tackleBonusTurn = true;
    });
});
