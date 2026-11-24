/**
 * The life of the club between matches: morale, letters in the inbox (choices with
 * consequences), season quests, season statistics and the end-of-season awards.
 * Everything here hangs off the `Career` object and is driven by career.ts hooks.
 */
import type { ClassId, GameConfig } from '../config';
import type { Rng } from '../rng';
import type { Player } from '../types';
import { generatePlayer } from '../world/generate';
import { NATION_IDS, nationOf } from '../world/nations';
import type { Career, CareerClub, Fixture } from './career';
import { CUP_NAME, INTL_CUP_NAME, cupWinner, isCupFixture } from './cup';
import { gainXp, money, ovr } from './player';

// ------------------------------------------------------------------ types

export type SeasonLine = { apps: number; goals: number; assists: number; ratingSum: number; motm: number };
export type Choice = { label: string; hint: string };
export type Letter = {
    id: string;
    kind: string;
    from: string;
    title: string;
    body: string;
    choices: Choice[];
    subject?: string;
    amount?: number;
    trainingDay?: number;
    trainingClass?: ClassId;
    /** Transfer bids: the club making the offer. */
    buyer?: string;
};
export type Quest = { id: string; title: string; desc: string; target: number; progress: number; reward: number; done: boolean };
export type Award = { season: number; title: string; who: string };
export type PlayerMatchLine = { goals: number; assists: number; rating: number };

export type Story = {
    morale: number;
    inbox: Letter | null;
    quests: Quest[];
    seasonStats: Record<string, SeasonLine>;
    streak: number;
    awards: Award[];
    /** Letters already received this season (no repeats). */
    seenLetters: string[];
    /** The club's rival (see meta/prep `rivalOf`). */
    rival?: string;
    /** Consecutive matchdays a fit, good-enough player has missed out. */
    benched?: Record<string, number>;
    /** A start you promised a player for the next match. */
    promise?: { id: string; name: string };
    /** Letters that follow up an earlier choice, due on a day. */
    followUps?: Array<{ kind: string; day: number; subject?: string; amount?: number }>;
    lossRun?: number;
};

const MORALE = { start: 60, win: 9, draw: 2, loss: -9, min: 10, max: 100 };

const storyOf = (c: Career): Story => {
    const s = c as Career & { story?: Story };
    if (!s.story) s.story = { morale: MORALE.start, inbox: null, quests: [], seasonStats: {}, streak: 0, awards: [], seenLetters: [] };
    return s.story;
};
/** The story state of a career (created on first access, so old saves just work). */
export const story = Object.assign(storyOf, {
    recordFixture: (c: Career, lines: Record<string, PlayerMatchLine>) => recordFixture(c, lines),
});

const hashKey = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

/** The club's rival: picked once per division stay, from the clubs in the same division. */
export const rivalOf = (c: Career): CareerClub | null => {
    const s = storyOf(c);
    const u = c.clubs[c.userClubId]!;
    const div = c.divisions.find((d) => d.clubs.includes(u.id));
    if (!div) return null;
    if (!s.rival || !div.clubs.includes(s.rival)) {
        const others = div.clubs.filter((id) => id !== u.id);
        if (!others.length) return null;
        s.rival = others[hashKey(`${c.seed}-${c.season}-${u.tier}`) % others.length]!;
    }
    return c.clubs[s.rival] ?? null;
};

export const moraleLabel = (m: number) =>
    m >= 85 ? 'Euphoric' : m >= 70 ? 'Buoyant' : m >= 55 ? 'Settled' : m >= 40 ? 'Uneasy' : m >= 25 ? 'Low' : 'Mutinous';
export const shiftMorale = (c: Career, d: number) => {
    const s = story(c);
    s.morale = Math.max(MORALE.min, Math.min(MORALE.max, Math.round(s.morale + d)));
};

const line = (c: Career, id: string) => {
    const st = story(c).seasonStats;
    return (st[id] ??= { apps: 0, goals: 0, assists: 0, ratingSum: 0, motm: 0 });
};
export const seasonLine = (c: Career, id: string): SeasonLine | undefined => story(c).seasonStats[id];
export const avgRating = (l?: SeasonLine) => (l && l.apps ? l.ratingSum / l.apps : 0);

// ------------------------------------------------------------------ simulated scorers

const SCORE_W: Record<ClassId, number> = { striker: 5, winger: 3, midfielder: 2, defender: 0.6, keeper: 0 };
const ASSIST_W: Record<ClassId, number> = { midfielder: 3, winger: 3, striker: 1.5, defender: 1, keeper: 0.2 };

const weighted = (rng: Rng, items: Player[], w: (p: Player) => number) => {
    const total = items.reduce((a, p) => a + Math.max(0, w(p)), 0);
    let r = rng() * total;
    for (const p of items) if ((r -= Math.max(0, w(p))) <= 0) return p;
    return items[0];
};

/** Invent plausible per-player lines for a match that wasn't played on the board. */
export const simLines = (rng: Rng, club: CareerClub, goals: number, conceded: number): Record<string, PlayerMatchLine> => {
    const xi = club.lineup.map((id) => club.squad.find((p) => p.id === id)).filter(Boolean) as Player[];
    const out: Record<string, PlayerMatchLine> = {};
    for (const p of xi)
        out[p.id] = { goals: 0, assists: 0, rating: 6.2 + (rng() - 0.5) * 1.2 + (goals > conceded ? 0.3 : goals < conceded ? -0.3 : 0) };
    for (let g = 0; g < goals; g++) {
        const scorer = weighted(rng, xi, (p) => SCORE_W[p.cls] * (p.stats.shooting / 50));
        if (!scorer) continue;
        out[scorer.id]!.goals++;
        out[scorer.id]!.rating += 1;
        if (rng.chance(0.7)) {
            const a = weighted(
                rng,
                xi.filter((p) => p.id !== scorer.id),
                (p) => ASSIST_W[p.cls] * (p.stats.passing / 50),
            );
            if (a) {
                out[a.id]!.assists++;
                out[a.id]!.rating += 0.6;
            }
        }
    }
    for (const p of xi) if (p.cls === 'keeper' || p.cls === 'defender') out[p.id]!.rating -= conceded * 0.2;
    for (const l of Object.values(out)) l.rating = Math.round(Math.max(3, Math.min(10, l.rating)) * 10) / 10;
    return out;
};

export const recordLines = (c: Career, lines: Record<string, PlayerMatchLine>) => {
    story.recordFixture(c, lines);
};

const recordFixture = (c: Career, lines: Record<string, PlayerMatchLine>) => {
    const best = Object.entries(lines).sort((a, b) => b[1].rating - a[1].rating)[0]?.[0];
    for (const [id, l] of Object.entries(lines)) {
        const s = line(c, id);
        s.apps++;
        s.goals += l.goals;
        s.assists += l.assists;
        s.ratingSum += l.rating;
        if (id === best) s.motm++;
    }
};

// ------------------------------------------------------------------ quests

type QuestDef = { id: string; title: string; desc: (t: number) => string; target: number; reward: number };
const QUESTS: QuestDef[] = [
    { id: 'streak', title: 'Hot Streak', desc: (t) => `Win ${t} league matches in a row.`, target: 3, reward: 3 },
    { id: 'goals', title: 'Goal Rush', desc: (t) => `Score ${t} league goals this season.`, target: 12, reward: 2 },
    { id: 'cleans', title: 'The Wall', desc: (t) => `Keep ${t} league clean sheets.`, target: 3, reward: 2.5 },
    { id: 'bigwin', title: 'Statement Win', desc: () => 'Win a league match by three goals or more.', target: 1, reward: 2 },
    { id: 'scorer', title: 'Talisman', desc: (t) => `Have one player score ${t} league goals.`, target: 5, reward: 2 },
    { id: 'newclass', title: 'Jack of All Trades', desc: () => 'Train a player into a brand-new class.', target: 1, reward: 1.5 },
    { id: 'motm', title: 'Star Turn', desc: (t) => `Win ${t} Man of the Match awards in league matches you play.`, target: 3, reward: 2 },
    { id: 'unbeaten', title: 'Iron Will', desc: (t) => `Go ${t} league matches unbeaten.`, target: 5, reward: 3 },
];

const newQuests = (rng: Rng): Quest[] => {
    const pool = [...QUESTS].sort(() => rng() - 0.5).slice(0, 3);
    return pool.map((q) => ({
        id: q.id,
        title: q.title,
        desc: q.desc(q.target),
        target: q.target,
        progress: 0,
        reward: q.reward,
        done: false,
    }));
};

export const bumpQuest = (
    cfg: GameConfig,
    c: Career,
    id: string,
    value: number,
    mode: 'set' | 'add' | 'max',
    reward: (amount: number, title: string) => void,
) => {
    for (const q of story(c).quests) {
        if (q.id !== id || q.done) continue;
        q.progress = mode === 'add' ? q.progress + value : mode === 'max' ? Math.max(q.progress, value) : value;
        if (q.progress >= q.target) {
            q.done = true;
            q.progress = q.target;
            const fee = cfg.career.matchFee[c.clubs[c.userClubId]!.tier]!;
            reward(Math.round(fee * q.reward), q.title);
            shiftMorale(c, 6);
        }
    }
};

// ------------------------------------------------------------------ letters (the writer's room)

type LetterDef = {
    id: string;
    from: string;
    title: string;
    when: (c: Career, u: CareerClub) => boolean;
    training?: true;
    body: (v: Vars) => string;
    choices: (v: Vars) => Choice[];
    /** Returns a one-line outcome for the news feed. */
    resolve: (choice: number, v: Vars, ctx: Ctx) => string;
};
type Vars = { p: Player | null; club: string; amount: number; fee: number; rival: string; trainingClass?: ClassId; buyer?: string };
type Ctx = { cfg: GameConfig; c: Career; u: CareerClub; rng: Rng; pay: (label: string, amount: number) => void };
export type Trainee = { player: Player; cls: ClassId };

const LETTERS: LetterDef[] = [
    {
        id: 'bard',
        from: 'Odo Lutewright, Bard',
        title: 'An anthem for the ages',
        when: () => true,
        body: (v) =>
            `Esteemed manager! I have heard tales of ${v.club} and my lute aches to sing them. For a modest ${money(v.amount)} I shall compose an anthem so stirring that grown blacksmiths will weep into their aprons. Your players will march out to it every match. Decline, and, well, a bard must sing about *something*.`,
        choices: (v) => [
            { label: `Commission it (${money(v.amount)})`, hint: 'Morale up a lot' },
            { label: 'Politely decline', hint: 'Risk a mocking ballad' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('Club anthem', -v.amount);
                shiftMorale(x.c, 12);
                return 'The new anthem echoes round the ground. The squad walks taller.';
            }
            shiftMorale(x.c, -3);
            followUp(x.c, 'ballad', 4, { amount: v.amount });
            return 'Odo has written a ballad about your "tight purse". It is catchy. Annoyingly so.';
        },
    },
    {
        id: 'extra',
        from: 'Your captain',
        title: 'Extra sessions',
        when: () => true,
        training: true,
        body: (v) =>
            `Boss, ${v.p!.name} stayed behind after today's ${v.trainingClass!} drills. They want to run them again tomorrow before the rest of the squad turns up. The physio says they've already done enough for one day.`,
        choices: () => [
            { label: 'Let them push on', hint: 'Big XP, small injury risk' },
            { label: 'Order them to rest', hint: 'Safe, slightly deflating' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 1) {
                shiftMorale(x.c, -2);
                return `${p.name} rests, grumbling.`;
            }
            const ready = gainXp(x.cfg, p, 90);
            if (x.rng.chance(0.22)) {
                p.injury = Math.max(p.injury ?? 0, 3);
                return `${p.name} overdid it: strained something, out 3 days.${ready ? ' But they earned a level-up first: choose their class in the squad.' : ''}`;
            }
            return ready
                ? `${p.name}'s extra work pays off: they're ready to level up. Choose their class in the squad.`
                : `${p.name} banks a heap of experience.`;
        },
    },
    {
        id: 'openTraining',
        from: 'Your groundskeeper',
        title: 'Open training',
        when: () => true,
        training: true,
        body: (v) =>
            `Supporters gathered at the gates to watch today's drills. They'd love to come inside for the next one. The local guild has offered ${money(v.amount)} for a private coaching session at the same time. We only have one pitch, boss.`,
        choices: (v) => [
            { label: 'Open the gates', hint: 'The supporters lift squad morale' },
            { label: 'Coach the guild', hint: `Earn ${money(v.amount)} for the club` },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                shiftMorale(x.c, 7);
                return 'The supporters cheered every drill. The squad left training in high spirits.';
            }
            x.pay('Guild coaching session', v.amount);
            return `The guild paid ${money(v.amount)} for the coaching session.`;
        },
    },
    {
        id: 'trialist',
        from: 'A muddy stranger',
        title: 'Knock at the gate',
        when: (_c, u) => u.squad.length < 20,
        body: (v) =>
            `A youngster turned up at the training ground at dawn, boots tied round their neck, and asked for a trial. Name's ${v.p!.name}, ${v.p!.age} years old, plays ${v.p!.cls}. The lads say they've got something. Wages would be modest.`,
        choices: (v) => [
            { label: 'Sign them on', hint: `Free, ~${money(v.amount)}/matchday` },
            { label: 'Send them home', hint: 'Nothing happens' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return `${v.p!.name} trudges off into the rain.`;
            const p = v.p!;
            p.number = Math.max(0, ...x.u.squad.map((q) => q.number)) + 1;
            x.u.squad.push(p);
            shiftMorale(x.c, 2);
            followUp(x.c, 'trialistBuzz', 8, { subject: p.id });
            return `${p.name} signs on a handshake. Welcome to the club.`;
        },
    },
    {
        id: 'taunt',
        from: 'The Gazette',
        title: 'Rival mouths off',
        when: () => true,
        body: (v) =>
            `The manager of ${v.rival} has told the Gazette your squad "couldn't pass a ball to each other in an empty corridor". The paper wants your response for tomorrow's edition.`,
        choices: () => [
            { label: 'Fire back publicly', hint: 'Fires the squad up… usually' },
            { label: 'Rise above it', hint: 'Stay calm' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) {
                shiftMorale(x.c, 1);
                return 'You say nothing. Dignified. Slightly boring.';
            }
            if (x.rng.chance(0.7)) {
                shiftMorale(x.c, 9);
                return `"See you on the pitch." The squad pins the article to the dressing-room wall.`;
            }
            shiftMorale(x.c, -6);
            return `Your reply is misquoted as a love letter to ${v.rival}. The dressing room is merciless.`;
        },
    },
    {
        id: 'sponsor',
        from: 'The Gilded Goose Alehouse',
        title: 'A sponsorship offer',
        when: () => true,
        body: (v) =>
            `Greetings! The Gilded Goose would be honoured to put its name across your shirts for the rest of the season. We offer ${money(v.amount)}, paid today. Our logo is a goose. It is gold. It is large.`,
        choices: (v) => [
            { label: `Take the gold (${money(v.amount)})`, hint: 'Cash now, fans grumble' },
            { label: 'Keep the shirts clean', hint: 'Fans approve' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('Shirt sponsor: Gilded Goose', v.amount);
                shiftMorale(x.c, -4);
                followUp(x.c, 'goose', 6, { amount: Math.round((v.amount * 0.3) / 1000) * 1000 });
                return 'The goose is on the shirts. It is very large indeed.';
            }
            shiftMorale(x.c, 3);
            return 'The supporters club sends a thank-you pie.';
        },
    },
    {
        id: 'homesick',
        from: 'Club physio',
        title: 'A homesick player',
        when: (_c, u) => u.squad.length > 0,
        body: (v) =>
            `${v.p!.name} hasn't been themselves. Missing home, by all accounts — barely touched their stew at supper. A couple of days' leave might do wonders, but they'd miss training and possibly a match.`,
        choices: () => [
            { label: 'Grant leave', hint: 'Out 3 days, morale up' },
            { label: 'Keep them here', hint: 'Morale down' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                v.p!.injury = Math.max(v.p!.injury ?? 0, 3);
                shiftMorale(x.c, 6);
                return `${v.p!.name} heads home for a few days. The squad appreciates the gesture.`;
            }
            shiftMorale(x.c, -6);
            return `${v.p!.name} stays, sulking. The mood in the camp dips.`;
        },
    },
    {
        id: 'scout',
        from: 'Mags, your scout',
        title: 'A whisper from the road',
        when: () => true,
        body: (v) =>
            `Gaffer — I've seen something special. A kid playing in a village up past the moors, raw as anything but the potential is ridiculous. For ${money(v.amount)} in travel and bribes I can get their name on the transfer list where only we know to look.`,
        choices: (v) => [
            { label: `Fund the trip (${money(v.amount)})`, hint: 'Adds a high-potential youngster to the market' },
            { label: 'Not now, Mags', hint: 'Nothing happens' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return 'Mags shrugs and goes back to her pipe.';
            x.pay("Scout's expedition", -v.amount);
            const classes: ClassId[] = ['defender', 'midfielder', 'winger', 'striker'];
            const gem = generatePlayer(x.cfg, x.rng, x.rng.pick(classes), '', 0, `p${x.c.nextId++}`, {
                levelRange: [1, 3],
                age: [17, 18],
                nation: x.rng.pick([...NATION_IDS]),
            });
            gem.growth = x.cfg.career.growthRange[1] + 1 + x.rng() * 1.2;
            x.c.market.unshift(gem);
            return `Mags is back from ${nationOf(gem.nation).name}: ${gem.name} (${gem.cls}, ${gem.age}) is on the market. Five-star potential. Move fast.`;
        },
    },
    {
        id: 'feast',
        from: 'The town council',
        title: 'Feast of the Harvest Moon',
        when: () => true,
        body: () =>
            'The whole town is feasting tonight in honour of the Harvest Moon, and the council has invited your squad as guests of honour. There will be roast boar. There will be mead. There will be, inevitably, dancing.',
        choices: () => [
            { label: 'Let them celebrate', hint: 'Morale soars, someone may overdo it' },
            { label: 'Early night, lads', hint: 'Safe and sober' },
        ],
        resolve: (ch, _v, x) => {
            if (ch === 1) {
                shiftMorale(x.c, -2);
                return 'The squad watches the fireworks from the dormitory window.';
            }
            shiftMorale(x.c, 12);
            const fit = x.u.squad.filter((p) => !p.injury);
            if (fit.length && x.rng.chance(0.3)) {
                const p = x.rng.pick(fit);
                p.injury = 2;
                return `A legendary night. ${p.name} fell off a table during the jig and is out for 2 days.`;
            }
            return 'A legendary night. Nobody fell off anything. Mostly.';
        },
    },
    {
        // a real club wants one of your players: delivered by the transfer market, never drawn at random
        id: 'transferBid',
        from: 'A transfer offer',
        title: 'An offer for your player',
        when: () => false,
        body: (v) =>
            `${v.rival} want to sign ${v.p!.name} and are offering ${money(v.amount)}, more than the market would pay. Their scout has been in the stands for weeks, and their chairman is not a patient man.`,
        choices: (v) => [
            { label: `Sell (${money(v.amount)})`, hint: `${v.p!.name} joins ${v.rival}` },
            { label: 'Not for sale', hint: 'The squad notices your loyalty' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            const buyer = v.buyer ? x.c.clubs[v.buyer] : undefined;
            if (ch === 1 || !buyer || !x.u.squad.includes(p)) {
                shiftMorale(x.c, 3);
                return `You turn ${v.rival} down. ${p.name} stays, and the dressing room approves.`;
            }
            x.u.squad = x.u.squad.filter((q) => q.id !== p.id);
            x.u.lineup = x.u.lineup.filter((id) => id !== p.id);
            p.number = Math.max(0, ...buyer.squad.map((q) => q.number)) + 1;
            buyer.squad.push(p);
            buyer.budget -= v.amount;
            buyer.lineup = []; // rebuilt before their next match
            x.pay(`Sold ${p.name} to ${buyer.name}`, v.amount);
            return `${p.name} joins ${v.rival} for ${money(v.amount)}.`;
        },
    },
    {
        id: 'healer',
        from: 'Hedda the herbalist',
        title: 'Poultices and promises',
        when: (_c, u) => u.squad.some((p) => (p.injury ?? 0) >= 3),
        body: (v) =>
            `I hear ${v.p!.name} is laid up. My poultices — moss, honey, and one ingredient I shan't name — have mended broken knights. For ${money(v.amount)} they'll be running by morning. Probably.`,
        choices: (v) => [
            { label: `Pay Hedda (${money(v.amount)})`, hint: 'Probably heals the injury' },
            { label: 'Trust the physio', hint: 'Let nature take its course' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return 'The physio nods approvingly. Hedda does not.';
            x.pay("Hedda's poultice", -v.amount);
            if (x.rng.chance(0.8)) {
                delete v.p!.injury;
                return `${v.p!.name} is up and running by morning. Nobody asks about the ingredient.`;
            }
            return `${v.p!.name} now smells of moss. Still injured.`;
        },
    },
    // ---- situational letters
    {
        id: 'minutes',
        from: 'A frustrated player',
        title: 'A word about minutes',
        when: (c) => Object.values(story(c).benched ?? {}).some((n) => n >= 3) && !story(c).promise,
        body: (v) =>
            `Gaffer, it's ${v.p!.name}. I've sat on that bench for ${v.amount} matches now. I train hard, I'm ready, and I didn't come here to keep a seat warm. Give me a chance.`,
        choices: () => [
            { label: 'Promise a start next match', hint: 'Break it and the dressing room will know' },
            { label: 'Tell them to earn it', hint: 'Morale dips a little' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            (story(x.c).benched ??= {})[p.id] = 0;
            if (ch === 0) {
                story(x.c).promise = { id: p.id, name: p.name };
                return `You promise ${p.name} a start in the next match. Better pick them.`;
            }
            shiftMorale(x.c, -3);
            return `${p.name} nods, jaw tight. "I'll earn it, then."`;
        },
    },
    {
        id: 'curse',
        from: 'Old Mother Grimble',
        title: 'A curse on your house?',
        when: (c) => (story(c).lossRun ?? 0) >= 3,
        body: (v) =>
            `Three defeats on the bounce? That'll be the curse, dearie. Somebody buried a hexed boot under your centre spot — I can smell it from here. For ${money(v.amount)} I'll dig it up and say the proper words.`,
        choices: (v) => [
            { label: `Pay her (${money(v.amount)})`, hint: "The squad believes it, even if you don't" },
            { label: 'We make our own luck', hint: 'Shrug it off' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('Curse removal', -v.amount);
                shiftMorale(x.c, 9);
                return 'Grimble digs up a rotten old boot. The squad cheers. Nobody asks how it got there.';
            }
            if (x.rng.chance(0.5)) {
                shiftMorale(x.c, -3);
                return 'The players keep glancing at the centre spot.';
            }
            return 'You laugh it off. Somehow that helps.';
        },
    },
    {
        id: 'clearAir',
        from: 'Your captain',
        title: 'Clear the air',
        when: (c) => story(c).morale < 36,
        body: (v) =>
            `Boss, ${v.p!.name} here. The lads are low and some are whispering in corners. I think we need a proper sit-down: everyone says their piece, no grudges after. Or we just run it off on the training pitch. Your call.`,
        choices: () => [
            { label: 'Hold the meeting', hint: 'Usually a big lift; can get heated' },
            { label: 'Run it off', hint: 'Small XP for everyone, mood stays low' },
        ],
        resolve: (ch, _v, x) => {
            if (ch === 0) {
                if (x.rng.chance(0.7)) {
                    shiftMorale(x.c, 13);
                    return 'Words were said, hands were shaken. The dressing room feels lighter.';
                }
                shiftMorale(x.c, 3);
                return 'It got heated. A chair was thrown. But something shifted, a little.';
            }
            for (const p of x.u.squad.filter((q) => !q.injury)) gainXp(x.cfg, p, 20);
            shiftMorale(x.c, -1);
            return 'Laps until dusk. Fitter, if not happier.';
        },
    },
    {
        id: 'veteran',
        from: 'Your oldest player',
        title: 'One more season?',
        when: (_c, u) => u.squad.some((p) => p.age >= 32),
        body: (v) =>
            `It's ${v.p!.name}. I'm ${v.p!.age} now and my knees sound like a cart going over cobbles. I've been thinking this might be my last year... unless you still need me out there.`,
        choices: () => [
            { label: 'We need you', hint: 'Morale up; they age a little more gracefully' },
            { label: 'Ask them to coach the kids', hint: 'Young players gain XP now' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 0) {
                shiftMorale(x.c, 5);
                p.peakAge += 1;
                return `${p.name} grins. "One more, then." The squad loves it.`;
            }
            const kids = x.u.squad.filter((q) => q.age <= 21 && q.id !== p.id);
            for (const q of kids) gainXp(x.cfg, q, 45);
            return `${p.name} takes the youngsters under their wing. ${kids.length} of them are already sharper.`;
        },
    },
    // ---- follow-ups (only ever arrive as consequences)
    {
        id: 'ballad',
        from: 'Odo Lutewright, Bard',
        title: 'The Ballad of the Tight Purse',
        when: () => false,
        body: (v) =>
            `Manager! My little ballad about your purse has become a tavern favourite from here to the coast. Children sing it. Goats, I'm told, hum it. I could write a second verse — a kinder one — for, say, ${money(v.amount)}.`,
        choices: (v) => [
            { label: `Buy the kinder verse (${money(v.amount)})`, hint: 'Morale up' },
            { label: 'Let them sing', hint: 'Morale down' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('A kinder verse', -v.amount);
                shiftMorale(x.c, 7);
                return 'Verse two calls you "wise beyond your purse". The squad hums it on the bus.';
            }
            shiftMorale(x.c, -4);
            return 'The away fans have learned the ballad. All of it.';
        },
    },
    {
        id: 'goose',
        from: 'The Gilded Goose Alehouse',
        title: 'The goose wants a word',
        when: () => false,
        body: () =>
            'Per section nine of our sponsorship (the small print, beneath the goose), your squad shall attend the annual Goose Festival. There will be geese. Your players will be asked to wear beaks. Decline, and we keep a slice of the fee.',
        choices: (v) => [
            { label: 'Beaks on', hint: 'Keep the money, lose some dignity' },
            { label: 'Absolutely not', hint: `Pay back ${money(v.amount)}, squad approves` },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                shiftMorale(x.c, -4);
                return 'Photographs of your striker in a beak are now on every tavern wall.';
            }
            x.pay('Goose Festival penalty', -v.amount);
            shiftMorale(x.c, 5);
            return 'You refuse the beaks. The squad would follow you anywhere. Except a Goose Festival.';
        },
    },
    {
        id: 'trialistBuzz',
        from: 'Mags, your scout',
        title: 'The trialist is turning heads',
        when: () => false,
        body: (v) =>
            `${v.p!.name} — the muddy kid from the gate — has been tearing up training. Two of the senior lads asked me where on earth you found them. Give them a run and I reckon they'll grow fast. Or let them simmer.`,
        choices: () => [
            { label: 'Fast-track them', hint: 'Big XP now' },
            { label: 'Let them simmer', hint: 'Higher growth for the rest of their career' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 0) {
                const ready = gainXp(x.cfg, p, 120);
                shiftMorale(x.c, 2);
                return ready ? `${p.name} is ready to level up already. What a find.` : `${p.name} soaks it all up.`;
            }
            p.growth = +(p.growth + 0.35).toFixed(2);
            return `${p.name} will be given time. Mags reckons patience will pay.`;
        },
    },
];

const followUp = (c: Career, kind: string, inDays: number, extra: { subject?: string; amount?: number } = {}) => {
    (story(c).followUps ??= []).push({ kind, day: c.day + inDays, ...extra });
};

/** A club's offer for one of the manager's players, delivered to the inbox (career.ts decides when). */
export const deliverBid = (c: Career, bid: { buyer: string; buyerName: string; player: Player; amount: number }) => {
    const s = story(c);
    if (s.inbox) return null;
    const def = LETTERS.find((l) => l.id === 'transferBid')!;
    const u = c.clubs[c.userClubId]!;
    const v: Vars = { p: bid.player, club: u.name, amount: bid.amount, fee: 0, rival: bid.buyerName, buyer: bid.buyer };
    s.inbox = {
        id: `bid-${c.season}-${c.day}`,
        kind: def.id,
        from: bid.buyerName,
        title: def.title,
        body: def.body(v),
        choices: def.choices(v),
        subject: bid.player.id,
        amount: bid.amount,
        buyer: bid.buyer,
    };
    (s.inbox as Letter & { rival?: string }).rival = bid.buyerName;
    return s.inbox;
};

/** Maybe deliver a new letter (one at a time, no repeats in a season). */
export const maybeLetter = (cfg: GameConfig, c: Career, rng: Rng, trainees: readonly Trainee[] = []) => {
    const s = story(c);
    if (s.inbox) return;
    const u = c.clubs[c.userClubId]!;
    const due = (s.followUps ?? []).find((x) => x.day <= c.day && (!x.subject || u.squad.some((p) => p.id === x.subject)));
    s.followUps = (s.followUps ?? []).filter((x) => x !== due && (!x.subject || u.squad.some((p) => p.id === x.subject)));
    let def: LetterDef;
    if (due) def = LETTERS.find((l) => l.id === due.kind)!;
    else {
        // situational letters are likelier when their moment comes
        const pool = LETTERS.filter((l) => (!l.training || trainees.length > 0) && !s.seenLetters.includes(l.id) && l.when(c, u));
        const urgent = pool.filter((l) => ['minutes', 'curse', 'clearAir'].includes(l.id));
        if (!pool.length || !rng.chance(urgent.length ? 0.5 : 0.24)) return;
        const training = pool.filter((l) => l.training);
        const priority = urgent.length && rng.chance(0.7) ? urgent : training;
        def = rng.pick(priority.length && (priority === urgent || rng.chance(0.5)) ? priority : pool);
    }
    const fee = cfg.career.matchFee[u.tier]!;
    const rivals = c.divisions.find((d) => d.clubs.includes(u.id))!.clubs.filter((id) => id !== u.id);
    const rival = c.clubs[s.rival && rivals.includes(s.rival) ? s.rival : rng.pick(rivals)]!.name;
    let p: Player | null = null;
    let amount = 0;
    let trainingClass: ClassId | undefined;
    switch (def.id) {
        case 'bard':
            amount = Math.round((fee * 0.6) / 1000) * 1000;
            break;
        case 'sponsor':
            amount = Math.round((fee * 2.2) / 1000) * 1000;
            break;
        case 'scout':
            amount = Math.round((fee * 0.8) / 1000) * 1000;
            break;
        case 'healer':
            p = rng.pick(u.squad.filter((q) => (q.injury ?? 0) >= 3));
            amount = Math.round((fee * 0.5) / 1000) * 1000;
            break;
        case 'extra': {
            const trainee = rng.pick(trainees);
            p = trainee.player;
            trainingClass = trainee.cls;
            break;
        }
        case 'openTraining':
            amount = Math.round((fee * 0.35) / 1000) * 1000;
            break;
        case 'homesick':
            p = rng.pick(u.squad);
            break;
        case 'ballad':
        case 'goose':
            amount = due?.amount ?? Math.round((fee * 0.4) / 1000) * 1000;
            break;
        case 'trialistBuzz':
            p = u.squad.find((q) => q.id === due?.subject) ?? null;
            break;
        case 'curse':
            amount = Math.round((fee * 0.4) / 1000) * 1000;
            break;
        case 'clearAir':
            p = [...u.squad].sort((a, b) => b.level - a.level)[0]!;
            break;
        case 'veteran':
            p = [...u.squad].sort((a, b) => b.age - a.age)[0]!;
            break;
        case 'minutes': {
            const [id, n] = Object.entries(s.benched ?? {}).sort((a, b) => b[1] - a[1])[0]!;
            p = u.squad.find((q) => q.id === id) ?? null;
            amount = n;
            if (!p) return;
            break;
        }
        case 'trialist': {
            const classes: ClassId[] = ['defender', 'midfielder', 'winger', 'striker'];
            p = generatePlayer(cfg, rng, rng.pick(classes), '', 0, `p${c.nextId++}`, {
                levelRange: cfg.career.tierLevels[u.tier],
                talentShift: cfg.career.tierTalent[u.tier],
                age: [17, 20],
                nation: c.nation,
            });
            amount = 600;
            break;
        }
    }
    const v: Vars = { p, club: u.name, amount, fee, rival, trainingClass };
    s.inbox = {
        id: `${def.id}-${c.season}-${c.day}`,
        kind: def.id,
        from: def.from,
        title: def.title,
        body: def.body(v),
        choices: def.choices(v),
        subject: p?.id,
        amount,
        trainingClass,
    };
    // stash the generated trialist so the choice can sign them
    if (def.id === 'trialist' && p) (s.inbox as Letter & { player?: Player }).player = p;
    (s.inbox as Letter & { rival?: string }).rival = rival;
    s.seenLetters.push(def.id);
    return s.inbox;
};

/** Apply the user's answer to the pending letter; returns the outcome line. */
export const answerLetter = (
    cfg: GameConfig,
    c: Career,
    rng: Rng,
    choice: number,
    pay: (label: string, amount: number) => void,
): string => {
    const s = story(c);
    const letter = s.inbox as (Letter & { player?: Player; rival?: string }) | null;
    if (!letter) return '';
    const def = LETTERS.find((l) => l.id === letter.kind)!;
    const u = c.clubs[c.userClubId]!;
    const p = letter.player ?? u.squad.find((q) => q.id === letter.subject) ?? null;
    const v: Vars = {
        p,
        club: u.name,
        amount: letter.amount ?? 0,
        fee: cfg.career.matchFee[u.tier]!,
        rival: letter.rival ?? 'a rival',
        trainingClass: letter.trainingClass,
        buyer: letter.buyer,
    };
    s.inbox = null;
    return def.resolve(choice, v, { cfg, c, u, rng, pay });
};

// ------------------------------------------------------------------ hooks called by career.ts

export const initStory = (c: Career, rng: Rng) => {
    const s = story(c);
    s.quests = newQuests(rng);
};

/** After every matchday: morale, streaks, quests, season stats. */
export const afterMatchday = (
    cfg: GameConfig,
    c: Career,
    rng: Rng,
    f: Fixture,
    gf: number,
    ga: number,
    lines: Record<string, PlayerMatchLine>,
    played: boolean,
    pay: (label: string, amount: number) => void,
    news: (t: string, tone: 'good' | 'bad' | 'info') => void,
) => {
    const s = story(c);
    rivalOf(c);
    const cup = isCupFixture(f);
    const outcome = cup ? (cupWinner(f) === c.userClubId ? 1 : -1) : Math.sign(gf - ga);
    shiftMorale(c, outcome > 0 ? MORALE.win : outcome === 0 ? MORALE.draw : MORALE.loss);
    s.lossRun = outcome < 0 ? (s.lossRun ?? 0) + 1 : 0;
    const u0 = c.clubs[c.userClubId]!;
    // the derby swings the mood harder, both ways
    if (s.rival && (f.home === s.rival || f.away === s.rival)) {
        const rival = c.clubs[s.rival]!;
        const sw = cfg.career.prep.derbySwing;
        if (outcome > 0) {
            shiftMorale(c, sw);
            news(`Derby win over ${rival.name}! The town will be talking about it for weeks.`, 'good');
        } else if (outcome < 0) {
            shiftMorale(c, -sw);
            news(`Derby defeat to ${rival.name}. Nobody in town will let you forget it.`, 'bad');
        } else news(`Honours even in the derby with ${rival.name}.`, 'info');
    }
    // promises and playing time
    if (s.promise) {
        const kept = u0.lineup.includes(s.promise.id);
        shiftMorale(c, kept ? 4 : -10);
        news(
            kept
                ? `You kept your word: ${s.promise.name} started.`
                : `You promised ${s.promise.name} a start and didn't deliver. The dressing room noticed.`,
            kept ? 'good' : 'bad',
        );
        delete s.promise;
    }
    const starters = u0.lineup
        .map((id) => u0.squad.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => ovr(cfg, p!));
    const bar = starters.length ? [...starters].sort((a, b) => a - b)[Math.floor(starters.length / 3)]! : 0;
    const benched = (s.benched ??= {});
    for (const p of u0.squad) {
        const eligible = !p.injury && p.age >= 19 && p.cls !== 'keeper' && ovr(cfg, p) >= bar;
        benched[p.id] = eligible && !u0.lineup.includes(p.id) ? (benched[p.id] ?? 0) + 1 : 0;
    }
    if (cup) {
        maybeLetter(cfg, c, rng);
        return;
    }
    s.streak = gf > ga ? Math.max(1, s.streak + 1) : gf === ga ? (s.streak > 0 ? 0 : s.streak - 1) : 0;
    const unbeaten = c as Career & { unbeatenRun?: number };
    unbeaten.unbeatenRun = gf >= ga ? (unbeaten.unbeatenRun ?? 0) + 1 : 0;
    recordLines(c, lines);
    const reward = (amount: number, title: string) => {
        pay(`Quest complete: ${title}`, amount);
        news(`Quest complete: ${title}! +${money(amount)} and the squad is buzzing.`, 'good');
    };
    bumpQuest(cfg, c, 'streak', Math.max(0, s.streak), 'max', reward);
    bumpQuest(cfg, c, 'goals', gf, 'add', reward);
    if (ga === 0) bumpQuest(cfg, c, 'cleans', 1, 'add', reward);
    if (gf - ga >= 3) bumpQuest(cfg, c, 'bigwin', 1, 'add', reward);
    bumpQuest(cfg, c, 'unbeaten', unbeaten.unbeatenRun, 'max', reward);
    const u = c.clubs[c.userClubId]!;
    const topScorer = Math.max(0, ...u.squad.map((p) => s.seasonStats[p.id]?.goals ?? 0));
    bumpQuest(cfg, c, 'scorer', topScorer, 'max', reward);
    if (played) {
        const best = Object.entries(lines).sort((a, b) => b[1].rating - a[1].rating)[0];
        if (best && u.squad.some((p) => p.id === best[0])) bumpQuest(cfg, c, 'motm', 1, 'add', reward);
    }
    maybeLetter(cfg, c, rng);
};

export const afterTraining = (cfg: GameConfig, c: Career, rng: Rng, training: { trainees: readonly Trainee[] }) => {
    // morale drifts back towards "settled"
    const s = story(c);
    s.morale += Math.sign(60 - s.morale);
    return maybeLetter(cfg, c, rng, training.trainees);
};

/** Season awards + reset. Returns ceremony lines. */
export const seasonAwards = (c: Career): Array<{ title: string; who: string; detail: string; icon: 'cup' | 'medal' | 'boot' | 'star' }> => {
    const s = story(c);
    const u = c.clubs[c.userClubId]!;
    const out: Array<{ title: string; who: string; detail: string; icon: 'cup' | 'medal' | 'boot' | 'star' }> = [];
    if (c.cup?.champion) out.push({ title: CUP_NAME, who: c.clubs[c.cup.champion]!.name, detail: 'Cup winners', icon: 'cup' });
    if (c.intl?.champion)
        out.push({ title: INTL_CUP_NAME, who: c.clubs[c.intl.champion]!.name, detail: 'Champions of the continent', icon: 'cup' });
    const div = c.divisions.find((d) => d.clubs.includes(u.id))!;
    // golden boot across the user's division
    const everyone = div.clubs.flatMap((id) => c.clubs[id]!.squad.map((p) => ({ p, club: c.clubs[id]!, l: s.seasonStats[p.id] })));
    const boot = everyone.filter((x) => x.l).sort((a, b) => b.l!.goals - a.l!.goals)[0];
    if (boot && boot.l!.goals > 0)
        out.push({ title: 'Golden Boot', who: `${boot.p.name} (${boot.club.short})`, detail: `${boot.l!.goals} goals`, icon: 'boot' });
    const mine = u.squad.map((p) => ({ p, l: s.seasonStats[p.id] })).filter((x) => x.l && x.l.apps >= 3);
    const pots = mine.sort((a, b) => avgRating(b.l) - avgRating(a.l))[0];
    if (pots)
        out.push({ title: 'Player of the Season', who: pots.p.name, detail: `avg rating ${avgRating(pots.l).toFixed(2)}`, icon: 'star' });
    const done = s.quests.filter((q) => q.done).length;
    out.push({
        title: 'Quests completed',
        who: `${done} of ${s.quests.length}`,
        detail: s.quests.map((q) => `${q.done ? '✓' : '✗'} ${q.title}`).join(' · '),
        icon: 'medal',
    });
    for (const a of out.filter((x) => x.icon !== 'medal')) s.awards.push({ season: c.season, title: a.title, who: a.who });
    return out;
};

export const resetSeason = (c: Career, rng: Rng) => {
    const s = story(c);
    s.seasonStats = {};
    s.seenLetters = [];
    s.quests = newQuests(rng);
};
