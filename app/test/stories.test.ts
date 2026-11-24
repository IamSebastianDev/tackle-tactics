import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { careerRng, endSeason, newCareer, playMatchday, resolveLetter, simulateScore, today, trainingDay, userClub } from '../src/meta/career';
import { applyTalk, isDerby, matchEdge, prepFor } from '../src/meta/prep';
import { rivalOf, story } from '../src/meta/story';

const cfg = defaultConfig;
const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('stories and match prep', () => {
    it('runs seasons with prep, derbies, promises and follow-up letters without breaking', () => {
        const kinds = new Set<string>();
        let derbies = 0;
        for (const seed of [3, 11, 19]) {
            const c = newCareer(cfg, seed, settings);
            for (let season = 1; season <= 2; season++) {
                for (let guard = 0; guard < 200; guard++) {
                    const t = today(cfg, c);
                    if (t.kind === 'seasonEnd') { endSeason(cfg, c); break; }
                    const l = story(c).inbox;
                    if (l) { kinds.add(l.kind); resolveLetter(cfg, c, (l.kind.length + c.day) % 2); }
                    if (t.kind === 'match') {
                        const p = prepFor(cfg, c, t.fixture);
                        p.plan = (['press', 'deep', 'direct', 'possession', 'balanced'] as const)[c.day % 5]!;
                        p.talk = (['calm', 'fire', 'demand'] as const)[c.day % 3]!;
                        if (isDerby(c, t.fixture)) derbies++;
                        const rng = careerRng(c);
                        applyTalk(cfg, c, t.fixture, p, rng);
                        const score = simulateScore(cfg, rng, c, t.fixture, 1, matchEdge(cfg, c, t.fixture, p));
                        c.rngState = rng.state();
                        playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
                    } else trainingDay(cfg, c);
                    const m = story(c).morale;
                    expect(m).toBeGreaterThanOrEqual(10);
                    expect(m).toBeLessThanOrEqual(100);
                }
            }
            expect(rivalOf(c)).not.toBeNull();
        }
        if (process.env.TT_VERBOSE) console.log('letter kinds', [...kinds].join(', '), 'derbies', derbies);
        expect(derbies).toBeGreaterThan(0);
        expect(kinds.size).toBeGreaterThan(6);
    }, 120000);
});
