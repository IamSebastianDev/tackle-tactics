import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { simulate } from '../src/sim';

describe('set pieces and the referee', () => {
    it('produces fouls, cards and corners over a batch of AI matches', () => {
        const tot = { shots: 0, tackles: 0, fouls: 0, cards: 0, reds: 0, corners: 0, freeKicks: 0, goals: 0, matches: 0 };
        for (let seed = 1; seed <= 12; seed++) {
            const { st } = simulate(defaultConfig, seed * 7919);
            tot.shots += st.shots;
            tot.tackles += st.tackles;
            tot.fouls += st.fouls;
            tot.cards += st.cards;
            tot.reds += st.reds;
            tot.corners += st.corners;
            tot.freeKicks += st.freeKicks;
            tot.goals += st.goals;
            tot.matches++;
        }
        if (process.env.TT_VERBOSE)
            console.log('per match', Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +(v / tot.matches).toFixed(2)])));
        expect(tot.fouls).toBeGreaterThan(0);
        expect(tot.corners).toBeGreaterThan(0);
    }, 60000);
});

import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import { generateClub } from '../src/world/generate';

describe('corner flow', () => {
    it('sets up, alternates placements and gives the taker the next turn', () => {
        const cfg = defaultConfig;
        const rng = createRng(42);
        const names = new Set<string>();
        const clubs = [
            generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names),
            generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names),
        ] as const;
        const m = new Match(cfg, [clubs[0], clubs[1]], 42);
        const award = (
            m as unknown as { awardSetPiece: (k: string, t: number, p: null, c: { x: number; y: number }) => unknown }
        ).awardSetPiece.bind(m);
        award('corner', 0, null, m.cornerSpot(0, 0));
        const sp = m.state.setPiece!;
        expect(sp.stage).toBe('setup');
        expect(m.carrier()?.id).toBe(sp.taker);
        // no two players share a cell after the arrangement
        expect(new Set(m.state.pieces.map((p) => `${p.pos.x},${p.pos.y}`)).size).toBe(m.state.pieces.length);
        const mover = m.state.pieces.find((p) => m.canPlacePiece(p))!;
        const to = m.placeZone(0).find((c) => !m.pieceAt(c))!;
        expect(m.place(mover.id, to)).toHaveLength(1);
        expect(sp.next).toBe(1);
        m.skipPlacements(1);
        m.skipPlacements(0);
        expect(sp.stage).toBe('take');
        m.state.phase = 'done';
        m.nextTurn();
        expect(m.active().id).toBe(sp.taker);
        expect(m.state.phase).toBe('act');
        expect(m.canTackle(m.state.pieces.find((p) => p.team === 1)!)).toBe(false);
    });
});
