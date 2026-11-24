import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import {
    autoLineup,
    buy,
    careerRng,
    divisionOf,
    endSeason,
    fixtureClubs,
    newCareer,
    playMatchday,
    resolveLetter,
    sell,
    simulateScore,
    simulatedWinChance,
    table,
    today,
    trainingDay,
    userClub,
    wageBill,
} from '../src/meta/career';
import { ovr, playerValue, wage } from '../src/meta/player';
import { story } from '../src/meta/story';

const cfg = defaultConfig;
const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('career', () => {
    it('estimates a simulated finish from the current score and the player’s side', () => {
        const oddsCfg = withOverrides({ career: { sim: { baseGoals: 2, exponent: 0, home: 0 } } });
        const c = newCareer(oddsCfg, 42, settings);
        const opponent = divisionOf(c, c.userClubId).clubs.find((id) => id !== c.userClubId)!;
        const home = { id: 'home', round: 0, home: c.userClubId, away: opponent };
        const away = { ...home, home: opponent, away: c.userClubId };
        const savedRng = c.rngState;

        expect(simulatedWinChance(oddsCfg, c, home, [0, 0], 0.5)).toBe(0);
        expect(simulatedWinChance(oddsCfg, c, home, [1, 0], 0.5)).toBeCloseTo(Math.exp(-1), 10);
        expect(simulatedWinChance(oddsCfg, c, away, [0, 0], 0.5)).toBeCloseTo(1 - Math.exp(-1), 10);
        expect(simulatedWinChance(oddsCfg, c, away, [0, 2], 0)).toBe(1);
        expect(c.rngState).toBe(savedRng);
    });

    it('builds a 5×10 pyramid with full squads, fixtures and a market', () => {
        const c = newCareer(cfg, 42, settings);
        expect(c.divisions.length).toBe(5);
        for (const d of c.divisions) {
            expect(d.clubs.length).toBe(10);
            expect(d.fixtures.length).toBe(45);
            for (const id of d.clubs) {
                const club = c.clubs[id]!;
                expect(club.squad.length).toBe(16);
                expect(new Set(club.lineup).size).toBe(11);
            }
        }
        expect(userClub(c).tier).toBe(4);
        expect(c.market.length).toBe(cfg.career.market.size);
        const t = today(cfg, c);
        const [h, a] = fixtureClubs(cfg, c, t.kind === 'match' ? t.fixture : c.divisions[4]!.fixtures[0]!);
        expect(h.squad.length).toBe(11);
        expect(a.kit).not.toBe(h.kit);
    });

    it('records session and rest reports on the completed days even with a full news feed', () => {
        const c = newCareer(cfg, 42, settings);
        const p = userClub(c).squad[0]!;
        c.plan = { [p.id]: { cls: p.cls, intensity: 'light' } };
        expect(trainingDay(cfg, c)).toBeUndefined();
        playMatchday(cfg, c, { score: [0, 0], knocks: {}, played: [] });
        c.news = Array.from({ length: 80 }, (_, i) => ({ season: c.season, day: 1, text: `Entry ${i}`, tone: 'info' }));

        const day = c.day;
        const report = trainingDay(cfg, c)!;
        expect(report.summary).toMatch(/^1 training session completed · \d+ XP earned\.$/);
        expect(c.news[0]).toMatchObject({ season: c.season, day, text: report.summary });

        c.plan = {};
        const rest = trainingDay(cfg, c)!;
        expect(c.news[0]).toMatchObject({ season: c.season, day: day + 1, text: 'Rest day. No training sessions ran.' });
        expect(rest.summary).toBe(c.news[0]!.text);
        expect(c.news).toHaveLength(82);
    });

    it('plays three seasons headless: money flows, players grow, promotion/relegation move clubs', () => {
        const c = newCareer(cfg, 7, settings);
        const u0 = userClub(c);
        const startBudget = u0.budget;
        const lvl0 = u0.squad.reduce((a, p) => a + p.level, 0);
        const log: string[] = [];
        let letters = 0;
        for (let season = 1; season <= 3; season++) {
            for (let guard = 0; guard < 200; guard++) {
                const t = today(cfg, c);
                if (t.kind === 'seasonEnd') {
                    const u = userClub(c);
                    const pos = table(divisionOf(c, u.id)).findIndex((r) => r.club === u.id) + 1;
                    const s = endSeason(cfg, c);
                    log.push(
                        `S${season}: tier ${u.tier + 1} pos ${pos} budget ${Math.round(u.budget / 1000)}k wages/md ${Math.round(wageBill(cfg, u) / 1000)}k morale ${story(c).morale} ${s.lines.join(' | ')} | awards: ${s.awards.map((a) => `${a.title}=${a.who}`).join(', ')}`,
                    );
                    break;
                }
                // answer any letter with a random choice, like a player would
                if (story(c).inbox) {
                    letters++;
                    resolveLetter(cfg, c, Math.floor(Math.random() * 2));
                }
                if (t.kind === 'match') {
                    const rng = careerRng(c);
                    const score = simulateScore(cfg, rng, c, t.fixture);
                    c.rngState = rng.state();
                    playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
                } else trainingDay(cfg, c);
            }
        }
        console.log(log.join('\n'));
        console.log(
            'letters answered',
            letters,
            'quests',
            JSON.stringify(story(c).quests.map((q) => `${q.title} ${q.progress}/${q.target}`)),
        );
        expect(letters).toBeGreaterThan(2);
        const u = userClub(c);
        const lvl1 = u.squad.reduce((a, p) => a + p.level, 0);
        expect(lvl1).toBeGreaterThan(lvl0);
        expect(c.season).toBe(4);
        expect(u.budget).not.toBe(startBudget);
        for (const d of c.divisions) expect(d.clubs.length).toBe(10);
        // tiers really differ in quality
        const avg = (t: number) => {
            const clubs = c.divisions[t]!.clubs.map((id) => c.clubs[id]!);
            return clubs.reduce((a, cl) => a + cl.squad.reduce((x, p) => x + ovr(cfg, p), 0) / cl.squad.length, 0) / clubs.length;
        };
        console.log('avg ovr by tier', [0, 1, 2, 3, 4].map((t) => avg(t).toFixed(1)).join(' '));
        expect(avg(0)).toBeGreaterThan(avg(4));
    });

    it('market: buy and sell move money and players', () => {
        const c = newCareer(cfg, 9, settings);
        const u = userClub(c);
        u.budget = 10_000_000;
        const p = c.market[0]!;
        expect(buy(cfg, c, p.id)).toBeNull();
        expect(u.squad.some((q) => q.id === p.id)).toBe(true);
        const before = u.budget;
        expect(sell(cfg, c, p.id)).toBeNull();
        expect(u.budget).toBeGreaterThan(before);
        console.log(
            'sample values (bottom tier):',
            u.squad
                .slice(0, 6)
                .map((q) => `${q.name} ovr ${ovr(cfg, q)} age ${q.age} → ${Math.round(playerValue(cfg, q) / 1000)}k, wage ${wage(cfg, q)}`)
                .join('\n'),
        );
        expect(autoLineup(cfg, u).length).toBe(11);
    });
});
