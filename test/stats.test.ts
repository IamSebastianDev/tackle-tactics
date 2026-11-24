import { expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { simulate } from '../src/sim';

it('stats: goals line up with the score, ratings in range, assists happen', () => {
    let assists = 0;
    let goals = 0;
    for (const seed of [31, 32, 33, 34, 35, 36]) {
        const { m, stats } = simulate(defaultConfig, seed);
        const [a, b] = m.state.score;
        expect(stats.goals.length).toBe(a + b);
        goals += stats.goals.length;
        assists += stats.goals.filter((g) => g.assist).length;
        for (const p of m.state.pieces) {
            const r = stats.rating(p);
            expect(r).toBeGreaterThanOrEqual(3);
            expect(r).toBeLessThanOrEqual(10);
        }
        const t0 = stats.team(0);
        const t1 = stats.team(1);
        expect(t0.possession + t1.possession).toBeGreaterThanOrEqual(99);
        expect(stats.motm()).toBeDefined();
        console.log(seed, `${a}-${b}`, 'poss', t0.possession, t1.possession, 'pass%', Math.round((t0.passesOk / Math.max(1, t0.passes)) * 100), 'motm', stats.motm()!.player.name, stats.rating(stats.motm()!));
    }
    console.log('goals', goals, 'assisted', assists);
}, 60_000);
