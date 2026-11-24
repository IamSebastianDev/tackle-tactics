import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { migrateNations, newCareer, type Career } from '../src/meta/career';
import { createRng } from '../src/rng';
import { NATION_IDS, NATIONS } from '../src/world/nations';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('nations', () => {
    it('every nation can name a whole pyramid with distinct towns', () => {
        for (const id of NATION_IDS) {
            const places = NATIONS[id].places(createRng(1));
            expect(new Set(places).size).toBe(places.length);
            expect(places.length).toBeGreaterThanOrEqual(cfg.career.divisions * cfg.career.clubsPerDivision);
        }
    });

    it('names are printable in the bundled Latin font (no characters outside Latin-1)', () => {
        for (const id of NATION_IDS) {
            const rng = createRng(3);
            const n = NATIONS[id];
            const text = [
                ...n.places(rng),
                ...Array.from({ length: 200 }, () => n.playerName(rng)),
                ...n.places(rng).map((p) => n.clubName(rng, p)),
            ].join(' ');
            expect(`${id}: ${text}`).toMatch(/^[a-z]+: [\u0020-\u00ff]*$/);
        }
    });

    it('a career is set in the chosen nation: local clubs, mostly local players, a market from everywhere', () => {
        const c = newCareer(cfg, 7, settings, { nation: 'nordhavn' });
        expect(c.nation).toBe('nordhavn');
        const players = Object.values(c.clubs).flatMap((club) => club.squad);
        expect(players.every((p) => p.nation)).toBe(true);
        const local = players.filter((p) => p.nation === 'nordhavn').length / players.length;
        expect(local).toBeGreaterThan(0.7);
        expect(local).toBeLessThan(0.9);
        expect(new Set(c.market.map((p) => p.nation)).size).toBeGreaterThanOrEqual(8);
        expect(c.market.length).toBe(cfg.career.market.size);
    });

    it('older saves become Highmarch careers with Highmarch players', () => {
        const c = newCareer(cfg, 7, settings);
        delete (c as Partial<Career>).nation;
        for (const club of Object.values(c.clubs)) for (const p of club.squad) delete p.nation;
        c.market = c.market.slice(0, 30);
        for (const p of c.market) delete p.nation;
        migrateNations(cfg, c);
        expect(c.nation).toBe('highmarch');
        expect(Object.values(c.clubs).every((club) => club.squad.every((p) => p.nation === 'highmarch'))).toBe(true);
        // the old market stays, topped up with players from abroad
        expect(c.market.length).toBe(cfg.career.market.size);
        expect(c.market.slice(0, 30).every((p) => p.nation === 'highmarch')).toBe(true);
        expect(c.market.slice(30).every((p) => p.nation !== 'highmarch')).toBe(true);
        // and it only happens once
        migrateNations(cfg, c);
        expect(c.market.length).toBe(cfg.career.market.size);
    });
});
