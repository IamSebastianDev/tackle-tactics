import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import {
    careerRng,
    newCareer,
    playMatchday,
    resolveLetter,
    seasonDays,
    simulateScore,
    today,
    trainingDay,
    userClub,
    type Career,
} from '../src/meta/career';
import { story } from '../src/meta/story';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

/** Play days until `stop` says so (or the season ends); letters are left in the inbox. */
const playDays = (cfg: typeof defaultConfig, c: Career, stop: () => boolean) => {
    while (c.day <= seasonDays(cfg, c) && !stop()) {
        const t = today(cfg, c);
        if (t.kind === 'match') {
            const rng = careerRng(c);
            const score = simulateScore(cfg, rng, c, t.fixture);
            c.rngState = rng.state();
            playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
        } else if (t.kind === 'training') trainingDay(cfg, c);
        else break;
    }
};

describe('transfers', () => {
    it('AI clubs sign players from the market through the season', () => {
        const cfg = defaultConfig;
        const c = newCareer(cfg, 21, settings);
        const before = new Map(Object.values(c.clubs).map((cl) => [cl.id, new Set(cl.squad.map((p) => p.id))]));
        playDays(cfg, c, () => {
            // keep the inbox clear so the season runs on
            if (story(c).inbox) resolveLetter(cfg, c, 1);
            return false;
        });
        const changed = Object.values(c.clubs).filter(
            (cl) => cl.id !== c.userClubId && cl.squad.some((p) => !before.get(cl.id)!.has(p.id)),
        );
        expect(changed.length).toBeGreaterThan(20);
        expect(c.market.length).toBeGreaterThan(0);
    }, 60_000);

    it('an offer for your player: accepting moves him and the money', () => {
        const cfg = withOverrides({ career: { transfers: { bidChance: 1 } } } as never, defaultConfig);
        const c = newCareer(cfg, 22, settings);
        // make the clubs above rich enough to bid
        for (const cl of Object.values(c.clubs)) if (cl.id !== c.userClubId) cl.budget = 50_000_000;
        playDays(cfg, c, () => story(c).inbox?.kind === 'transferBid');
        const bid = story(c).inbox!;
        expect(bid.kind).toBe('transferBid');
        const u = userClub(c);
        const player = u.squad.find((p) => p.id === bid.subject)!;
        const buyer = c.clubs[bid.buyer!]!;
        const budget = u.budget;
        resolveLetter(cfg, c, 0);
        expect(u.squad.some((p) => p.id === player.id)).toBe(false);
        expect(buyer.squad.some((p) => p.id === player.id)).toBe(true);
        expect(u.budget).toBe(budget + bid.amount!);
        expect(buyer.tier).toBeLessThanOrEqual(u.tier);
    }, 60_000);
});
