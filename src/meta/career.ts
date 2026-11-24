/**
 * The manager layer: a league of divisions, a 3-day rhythm (matchday → training → training),
 * money, transfers, injuries, levelling and aging. Pure data + functions; the UI calls these
 * and persists the `Career` object.
 */
import type { ClassId, Difficulty, GameConfig, TimeoutPolicy } from '../config';
import { deleteSave, readSave, writeSave } from './storage';
import { classLevel } from '../engine/abilities';
import { createRng, type Rng } from '../rng';
import type { Club, Player, TeamSide } from '../types';
import { generatePlayer } from '../world/generate';
import { generateStadium, type Stadium } from '../world/stadium';
import { ageOneSeason, fitFor, gainXp, money, ovr, playerValue, wage } from './player';
import { afterMatchday, afterTraining, answerLetter, initStory, resetSeason, seasonAwards, simLines, story, type PlayerMatchLine } from './story';

export type Fixture = { id: string; round: number; home: string; away: string; result?: [number, number] };
export type Division = { tier: number; clubs: string[]; fixtures: Fixture[] };
export type TableRow = { club: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number };
export type Intensity = 'light' | 'full';
export type Session = { cls: ClassId; intensity: Intensity };
export type News = { season: number; day: number; text: string; tone: 'good' | 'bad' | 'info' };
export type Ledger = { season: number; day: number; label: string; amount: number };
export type CareerSettings = { timerSeconds: number; rounds: number; difficulty: Difficulty; timeoutPolicy: TimeoutPolicy };

export type CareerClub = Club & {
    tier: number;
    budget: number;
    /** Player ids in formation-slot order (11). */
    lineup: string[];
};

export type Career = {
    version: 1;
    seed: number;
    rngState: number;
    season: number;
    /** 1-based day within the season. */
    day: number;
    userClubId: string;
    clubs: Record<string, CareerClub>;
    divisions: Division[];
    market: Player[];
    news: News[];
    ledger: Ledger[];
    /** Training plan for the user's squad: player id → session. */
    plan: Record<string, Session>;
    settings: CareerSettings;
    history: Array<{ season: number; tier: number; position: number }>;
    nextId: number;
};

export type Today =
    | { kind: 'match'; round: number; fixture: Fixture; division: Division }
    | { kind: 'training' }
    | { kind: 'seasonEnd' };

// ------------------------------------------------------------------ names & kits

const PLACES = ['Mirewick', 'Thornvale', 'Galehaven', 'Emberfall', 'Ravenmoor', 'Oakshaw', 'Frostcrest', 'Silverbrook', 'Ironridge', 'Hollowden',
    'Ashford', 'Brightwater', 'Coldharbour', 'Duskmere', 'Elderglen', 'Fallowmere', 'Greywatch', 'Highcairn', 'Ivywood', 'Kingsreach',
    'Larkspur', 'Mossbank', 'Northmarch', 'Oldcastle', 'Pinehold', 'Quarrydeep', 'Redwater', 'Stormhaven', 'Tallow Cross', 'Underhill',
    'Valewood', 'Westerfold', 'Yarrowby', 'Ambergate', 'Blackfen', 'Cindervale', 'Deepholm', 'Eastwatch', 'Foxhollow', 'Glimmerdell',
    'Harrowgate', 'Ironhaven', 'Juniper Bay', 'Kestrel Moor', 'Lanternfall', 'Marrowdeep', 'Nettlecombe', 'Owlbridge', 'Pyrewood', 'Ravensgate'];
const SUFFIX = ['Wanderers', 'Rovers', 'Athletic', 'Guild', 'Company', 'Vanguard', 'Wardens', 'Fellowship', 'Rangers', 'United', 'Order', 'Blades'];

const outfieldKit = (cfg: GameConfig, i: number) => cfg.kits.outfield[i % cfg.kits.outfield.length]!;
const keeperKit = (cfg: GameConfig, i: number) => cfg.kits.keepers[i % cfg.kits.keepers.length]!;

export const careerRng = (c: Career): Rng => createRng(c.rngState);
const saveRng = (c: Career, rng: Rng) => { c.rngState = rng.state(); };

// ------------------------------------------------------------------ creation

const newPlayer = (cfg: GameConfig, rng: Rng, c: Career, cls: ClassId, tier: number, number: number, ageR?: [number, number]) => {
    const p = generatePlayer(cfg, rng, cls, '', number, `p${c.nextId++}`, {
        levelRange: cfg.career.tierLevels[tier], talentShift: cfg.career.tierTalent[tier], age: ageR,
    });
    return p;
};

const buildSquad = (cfg: GameConfig, rng: Rng, c: Career, tier: number): Player[] => {
    const squad: Player[] = [];
    let n = 1;
    for (const [cls, count] of Object.entries(cfg.career.squadMake) as Array<[ClassId, number]>)
        for (let i = 0; i < count; i++) squad.push(newPlayer(cfg, rng, c, cls, tier, n++));
    return squad;
};

/** Round robin (circle method): every club plays every other once. */
const roundRobin = (clubs: string[], rng: Rng, prefix: string): Fixture[] => {
    const ids = [...clubs].sort(() => rng() - 0.5);
    if (ids.length % 2) ids.push('BYE');
    const n = ids.length;
    const out: Fixture[] = [];
    for (let r = 0; r < n - 1; r++) {
        for (let i = 0; i < n / 2; i++) {
            const a = ids[i]!;
            const b = ids[n - 1 - i]!;
            if (a === 'BYE' || b === 'BYE') continue;
            const [home, away] = (r + i) % 2 ? [a, b] : [b, a];
            out.push({ id: `${prefix}-r${r}-${i}`, round: r, home, away });
        }
        ids.splice(1, 0, ids.pop()!);
    }
    return out;
};

export const roundsPerSeason = (cfg: GameConfig) => cfg.career.clubsPerDivision - 1;
export const seasonDays = (cfg: GameConfig) => roundsPerSeason(cfg) * cfg.career.daysPerMatchday;

export const newCareer = (cfg: GameConfig, seed: number, settings: CareerSettings, opts: { name?: string; kit?: string } = {}): Career => {
    const rng = createRng(seed);
    const c: Career = {
        version: 1, seed, rngState: 0, season: 1, day: 1, userClubId: '', clubs: {}, divisions: [], market: [], news: [],
        ledger: [], plan: {}, settings, history: [], nextId: 1,
    };
    const places = [...PLACES].sort(() => rng() - 0.5);
    let ci = 0;
    for (let tier = 0; tier < cfg.career.divisions; tier++) {
        const ids: string[] = [];
        for (let k = 0; k < cfg.career.clubsPerDivision; k++, ci++) {
            const id = `c${ci}`;
            const formation = cfg.formations[Math.floor(rng() * cfg.formations.length)]!.id;
            const club: CareerClub = {
                id, name: `${places[ci % places.length]} ${rng.pick(SUFFIX)}`, short: places[ci % places.length]!.slice(0, 3).toUpperCase(),
                kit: outfieldKit(cfg, ci), keeperKit: keeperKit(cfg, ci), formationId: formation, squad: buildSquad(cfg, rng, c, tier),
                tier, budget: cfg.career.startingBudget[tier]!, lineup: [],
            };
            club.lineup = autoLineup(cfg, club);
            c.clubs[id] = club;
            ids.push(id);
        }
        c.divisions.push({ tier, clubs: ids, fixtures: [] });
    }
    // the user takes over a club in the bottom division
    const bottom = c.divisions.at(-1)!;
    const user = c.clubs[bottom.clubs[0]!]!;
    if (opts.name) {
        user.name = opts.name;
        user.short = opts.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || user.short;
    }
    if (opts.kit) user.kit = opts.kit;
    c.userClubId = user.id;
    for (const d of c.divisions) d.fixtures = roundRobin(d.clubs, rng, `s1-t${d.tier}`);
    c.market = buildMarket(cfg, rng, c);
    c.plan = defaultPlan(cfg, user);
    initStory(c, rng);
    c.news.push({ season: 1, day: 1, tone: 'info', text: `You take charge of ${user.name}, bottom of the pyramid. Promotion is the goal.` });
    saveRng(c, rng);
    return c;
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// ------------------------------------------------------------------ queries

export const userClub = (c: Career) => c.clubs[c.userClubId]!;
export const divisionOf = (c: Career, clubId: string) => c.divisions.find((d) => d.clubs.includes(clubId))!;

export const today = (cfg: GameConfig, c: Career): Today => {
    if (c.day > seasonDays(cfg)) return { kind: 'seasonEnd' };
    const k = cfg.career.daysPerMatchday;
    if ((c.day - 1) % k === 0) {
        const round = (c.day - 1) / k;
        const division = divisionOf(c, c.userClubId);
        const fixture = division.fixtures.find((f) => f.round === round && (f.home === c.userClubId || f.away === c.userClubId))!;
        return { kind: 'match', round, fixture, division };
    }
    return { kind: 'training' };
};

export const table = (d: Division): TableRow[] => {
    const rows = new Map<string, TableRow>(d.clubs.map((id) => [id, { club: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
    for (const f of d.fixtures) {
        if (!f.result) continue;
        const [h, a] = f.result;
        const H = rows.get(f.home)!;
        const A = rows.get(f.away)!;
        H.p++; A.p++;
        H.gf += h; H.ga += a; A.gf += a; A.ga += h;
        if (h > a) { H.w++; A.l++; H.pts += 3; } else if (h < a) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
    }
    return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
};

export const squadOvr = (cfg: GameConfig, club: CareerClub) => {
    const xi = club.lineup.map((id) => club.squad.find((p) => p.id === id)).filter(Boolean) as Player[];
    return xi.length ? xi.reduce((a, p) => a + ovr(cfg, p), 0) / xi.length : 0;
};

export const wageBill = (cfg: GameConfig, club: CareerClub) => club.squad.reduce((a, p) => a + wage(cfg, p), 0);

// ------------------------------------------------------------------ lineups & match clubs

/** Best fit for each formation slot, injured players excluded. */
export const autoLineup = (cfg: GameConfig, club: Club): string[] => {
    const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
    const used = new Set<string>();
    // fill the most specialised slots (keeper) first
    const order = formation.slots.map((s, i) => ({ s, i })).sort((a, b) => (a.s.cls === 'keeper' ? -1 : 0) - (b.s.cls === 'keeper' ? -1 : 0));
    const out: string[] = Array.from({ length: formation.slots.length }, () => '');
    for (const { s, i } of order) {
        const best = club.squad.filter((p) => !used.has(p.id)).sort((a, b) => fitFor(cfg, b, s.cls) - fitFor(cfg, a, s.cls))[0];
        if (best) { used.add(best.id); out[i] = best.id; }
    }
    return out;
};

/** Make sure a lineup is complete and has no injured or departed players. */
export const validLineup = (cfg: GameConfig, club: CareerClub) => {
    const ids = new Set(club.squad.map((p) => p.id));
    const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
    const bad = club.lineup.length !== formation.slots.length || club.lineup.some((id) => !ids.has(id) || club.squad.find((p) => p.id === id)!.injury);
    if (bad) club.lineup = autoLineup(cfg, club);
    return club.lineup;
};

/** A `Club` ready for the match engine: the XI in slot order, sprites from the kit. */
export const matchClub = (cfg: GameConfig, club: CareerClub, kitOverride?: string): Club => {
    validLineup(cfg, club);
    const kit = kitOverride ?? club.kit;
    const squad = club.lineup.map((id, i) => {
        const p = club.squad.find((q) => q.id === id)!;
        const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
        const isKeeper = formation.slots[i]?.cls === 'keeper';
        p.sprite = isKeeper ? club.keeperKit : `${kit}_player_${p.look ?? 1}`;
        return p;
    });
    // bench: the best fit players not starting, always a keeper if there is one
    const fresh = club.squad.filter((p) => !club.lineup.includes(p.id) && !p.injury);
    const gk = fresh.filter((p) => p.cls === 'keeper').sort((a, b) => ovr(cfg, b) - ovr(cfg, a))[0];
    const rest = fresh.filter((p) => p !== gk).sort((a, b) => ovr(cfg, b) - ovr(cfg, a));
    const bench = [...(gk ? [gk] : []), ...rest].slice(0, cfg.subs.bench).map((p) => {
        p.sprite = p.cls === 'keeper' ? club.keeperKit : `${kit}_player_${p.look ?? 1}`;
        return p;
    });
    return { id: club.id, name: club.name, short: club.short, kit, keeperKit: club.keeperKit, formationId: club.formationId, squad, bench, tier: club.tier, morale: club.morale, style: club.style };
};

/** Clubs for the engine, home first; away swaps to a different kit on a clash. */
export const fixtureClubs = (cfg: GameConfig, c: Career, f: Fixture): [Club, Club] => {
    const home = c.clubs[f.home]!;
    const away = c.clubs[f.away]!;
    for (const cl of [home, away]) cl.morale = cl.id === c.userClubId ? story(c).morale : 60;
    const awayKit = away.kit === home.kit ? cfg.kits.outfield.find((k) => k !== home.kit)! : away.kit;
    return [matchClub(cfg, home), matchClub(cfg, away, awayKit)];
};

// ------------------------------------------------------------------ simulation

const poisson = (rng: Rng, lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
};

export const simulateScore = (cfg: GameConfig, rng: Rng, c: Career, f: Fixture, fraction = 1, userEdge = 0): [number, number] => {
    const s = cfg.career.sim;
    validLineup(cfg, c.clubs[f.home]!);
    validLineup(cfg, c.clubs[f.away]!);
    const h = squadOvr(cfg, c.clubs[f.home]!);
    const a = squadOvr(cfg, c.clubs[f.away]!);
    const e = userEdge * cfg.career.prep.simEdge * (f.home === c.userClubId ? 1 : f.away === c.userClubId ? -1 : 0);
    const lh = s.baseGoals * Math.pow(h / a, s.exponent) * s.home * fraction * (1 + e);
    const la = s.baseGoals * Math.pow(a / h, s.exponent) * fraction * (1 - e);
    return [poisson(rng, lh), poisson(rng, la)];
};

// ------------------------------------------------------------------ the day loop

const news = (c: Career, text: string, tone: News['tone'] = 'info') => {
    c.news.unshift({ season: c.season, day: c.day, text, tone });
    if (c.news.length > 80) c.news.length = 80;
};
const book = (c: Career, label: string, amount: number) => {
    const u = userClub(c);
    u.budget += amount;
    c.ledger.unshift({ season: c.season, day: c.day, label, amount });
    if (c.ledger.length > 120) c.ledger.length = 120;
};

export type MatchReport = {
    score: [number, number]; knocks: Record<string, number>; played: string[];
    /** Per-player lines from a match played on the board (both teams); absent for quick sims. */
    lines?: Record<string, PlayerMatchLine>;
};

/**
 * Resolve the matchday: the user's fixture uses `report` (played or quick-simmed by the UI),
 * every other fixture in the pyramid is simulated. Pays wages and income, hands out match XP.
 */
export const playMatchday = (cfg: GameConfig, c: Career, report: MatchReport) => {
    const t = today(cfg, c);
    if (t.kind !== 'match') return;
    const rng = careerRng(c);
    const u = userClub(c);
    for (const d of c.divisions) {
        for (const f of d.fixtures.filter((x) => x.round === t.round)) {
            if (f.id === t.fixture.id) f.result = report.score;
            else {
                f.result = simulateScore(cfg, rng, c, f);
                // invented scorers & ratings feed the season stats and the Golden Boot race
                story.recordFixture(c, simLines(rng, c.clubs[f.home]!, f.result[0], f.result[1]));
                story.recordFixture(c, simLines(rng, c.clubs[f.away]!, f.result[1], f.result[0]));
            }
        }
    }
    // the user's result
    const f = t.fixture;
    const home = f.home === u.id;
    const [gf, ga] = home ? report.score : ([report.score[1], report.score[0]] as [number, number]);
    const opp = c.clubs[home ? f.away : f.home]!;
    const fee = cfg.career.matchFee[u.tier]!;
    book(c, `Match fee vs ${opp.short}`, fee);
    if (gf > ga) book(c, 'Win bonus', Math.round(fee * cfg.career.winBonus));
    else if (gf === ga) book(c, 'Draw bonus', Math.round(fee * cfg.career.drawBonus));
    book(c, 'Wages', -wageBill(cfg, u));
    news(c, `${gf > ga ? 'Won' : gf < ga ? 'Lost' : 'Drew'} ${gf}–${ga} ${home ? 'at home to' : 'away at'} ${opp.name}.`, gf > ga ? 'good' : gf < ga ? 'bad' : 'info');

    // match XP & injuries for the user's XI
    for (const id of report.played) {
        const p = u.squad.find((q) => q.id === id);
        if (!p) continue;
        const ups = gainXp(cfg, rng, p, p.cls, cfg.career.matchXp);
        if (ups) news(c, `${p.name} reached ${cfg.classes[p.cls].short} ${classLevel(p, p.cls)} through match experience.`, 'good');
        for (let k = 0; k < (report.knocks[id] ?? 0); k++) {
            if (rng.chance(cfg.training.knockInjuryChance)) {
                const days = rng.int(cfg.training.injuryDays[0], cfg.training.injuryDays[1]);
                p.injury = Math.max(p.injury ?? 0, days);
                news(c, `${p.name} picked up a knock: out for ${days} days.`, 'bad');
                break;
            }
        }
    }
    // the user's fixture: real lines when played on the board, invented ones for a quick sim
    const userLines = report.lines ?? simLines(rng, u, gf, ga);
    const oppLines = report.lines ?? simLines(rng, opp, ga, gf);
    const mineOnly = Object.fromEntries(Object.entries(userLines).filter(([id]) => u.squad.some((p) => p.id === id)));
    story.recordFixture(c, Object.fromEntries(Object.entries(oppLines).filter(([id]) => opp.squad.some((p) => p.id === id))));
    afterMatchday(cfg, c, rng, f, gf, ga, mineOnly, !!report.lines, (label, amount) => book(c, label, amount), (text, tone) => news(c, text, tone));

    // AI clubs: pay nothing we track, but their XI gains XP too
    for (const club of Object.values(c.clubs)) {
        if (club.id === u.id) continue;
        for (const id of club.lineup) {
            const p = club.squad.find((q) => q.id === id);
            if (p) gainXp(cfg, rng, p, p.cls, cfg.career.matchXp * 0.8);
        }
    }
    saveRng(c, rng);
    c.day++;
};

/** Training day: run the user's plan, heal/aggravate injuries, AI clubs train too. */
export const trainingDay = (cfg: GameConfig, c: Career) => {
    if (today(cfg, c).kind !== 'training') return;
    const rng = careerRng(c);
    const u = userClub(c);
    let used = 0;
    let newClass = false;
    for (const p of u.squad) {
        const s = c.plan[p.id];
        const intensity = s && used < cfg.training.slots ? s.intensity : undefined;
        if (intensity) used++;
        if (p.injury) {
            const heal = cfg.training.heal[intensity ?? 'rest'];
            p.injury -= heal;
            if (intensity === 'full' && rng.chance(cfg.training.aggravateChance)) {
                p.injury += 2;
                news(c, `${p.name} trained through the pain and made it worse.`, 'bad');
            }
            if (p.injury <= 0) { delete p.injury; news(c, `${p.name} is fit again.`, 'good'); }
        }
        if (s && intensity) {
            const injuredPenalty = p.injury ? 0.5 : 1;
            const amount = Math.round(cfg.training.xp[intensity] * injuredPenalty * (0.85 + rng() * 0.3));
            const before = classLevel(p, s.cls);
            const ups = gainXp(cfg, rng, p, s.cls, amount);
            if (ups) {
                const lv = classLevel(p, s.cls);
                if (before === 0) newClass = true;
                news(c, before === 0 ? `${p.name} picked up a new class: ${cfg.classes[s.cls].label}!` : `${p.name} reached ${cfg.classes[s.cls].short} ${lv}.`, 'good');
            }
        }
    }
    for (const club of Object.values(c.clubs)) {
        if (club.id === u.id) continue;
        for (let i = 0; i < cfg.training.aiSessions; i++) {
            const p = rng.pick(club.squad);
            gainXp(cfg, rng, p, p.cls, cfg.training.xp.full * 0.8);
            if (p.injury) { p.injury -= 1; if (p.injury <= 0) delete p.injury; }
        }
    }
    afterTraining(cfg, c, rng, newClass, (label, amount) => book(c, label, amount), (text, tone) => news(c, text, tone));
    saveRng(c, rng);
    c.day++;
};

export type SeasonCeremony = {
    season: number; tier: number; position: number; champion: boolean; promoted: boolean; relegated: boolean;
    lines: string[]; awards: ReturnType<typeof seasonAwards>;
};

/** Season end: rewards, promotion/relegation, aging, retirements, new fixtures & market. */
export const endSeason = (cfg: GameConfig, c: Career): SeasonCeremony => {
    const rng = careerRng(c);
    const summary: string[] = [];
    const u = userClub(c);
    const userDiv = divisionOf(c, u.id);
    const pos = table(userDiv).findIndex((r) => r.club === u.id) + 1;
    const ceremony: SeasonCeremony = { season: c.season, tier: u.tier, position: pos, champion: pos === 1, promoted: false, relegated: false, lines: summary, awards: seasonAwards(cfg, c) };
    const fee = cfg.career.matchFee[u.tier]!;
    c.history.push({ season: c.season, tier: u.tier, position: pos });
    if (pos === 1) { book(c, 'Season goal: champions', fee * cfg.career.goalTitle); summary.push(`Champions of division ${u.tier + 1}!`); }
    else if (pos <= 4) { book(c, 'Season goal: top four', fee * cfg.career.goalTop4); summary.push(`Finished ${ordinal(pos)}: top-four bonus.`); }
    else summary.push(`Finished ${ordinal(pos)}.`);
    if (pos <= cfg.career.clubsPerDivision - cfg.career.relegate) book(c, 'Season goal: survival', fee * cfg.career.goalSurvive);

    // promotion / relegation between adjacent tiers
    const moves: Array<{ id: string; to: number }> = [];
    for (const d of c.divisions) {
        const t = table(d);
        if (d.tier > 0) for (const r of t.slice(0, cfg.career.promote)) moves.push({ id: r.club, to: d.tier - 1 });
        if (d.tier < c.divisions.length - 1) for (const r of t.slice(-cfg.career.relegate)) moves.push({ id: r.club, to: d.tier + 1 });
    }
    for (const mv of moves) {
        const from = divisionOf(c, mv.id);
        from.clubs = from.clubs.filter((x) => x !== mv.id);
        c.divisions[mv.to]!.clubs.push(mv.id);
        c.clubs[mv.id]!.tier = mv.to;
        if (mv.id === u.id) {
            summary.push(mv.to < from.tier ? `PROMOTED to division ${mv.to + 1}!` : `Relegated to division ${mv.to + 1}.`);
            if (mv.to < from.tier) ceremony.promoted = true; else ceremony.relegated = true;
        }
    }

    // aging & retirement across every squad
    for (const club of Object.values(c.clubs)) {
        // retirement replaces club.squad with a filtered copy, so iterating the original is safe
        for (const p of club.squad) {
            ageOneSeason(cfg, rng, p);
            if (p.age >= cfg.career.retireFrom && rng.chance(cfg.career.retireChance)) {
                club.squad = club.squad.filter((q) => q.id !== p.id);
                if (club.id === u.id) summary.push(`${p.name} retired at ${p.age}.`);
            }
        }
        // AI clubs refill with youth so squads stay playable; the user gets free trialists only below the minimum
        if (club.id === u.id) {
            const classes = Object.keys(cfg.career.squadMake) as ClassId[];
            while (club.squad.length < cfg.career.squadMin) {
                const needKeeper = !club.squad.some((p) => p.cls === 'keeper');
                const p = newPlayer(cfg, rng, c, needKeeper ? 'keeper' : rng.pick(classes), club.tier, Math.max(0, ...club.squad.map((q) => q.number)) + 1, [17, 19]);
                club.squad.push(p);
                summary.push(`Academy trialist ${p.name} (${cfg.classes[p.cls].short}) joins to fill the squad.`);
            }
        } else {
            for (const [cls, count] of Object.entries(cfg.career.squadMake) as Array<[ClassId, number]>) {
                while (club.squad.filter((p) => p.cls === cls).length < count) {
                    club.squad.push(newPlayer(cfg, rng, c, cls, club.tier, club.squad.length + 1, [17, 20]));
                }
            }
        }
        club.lineup = autoLineup(cfg, club);
    }

    c.season++;
    c.day = 1;
    for (const d of c.divisions) d.fixtures = roundRobin(d.clubs, rng, `s${c.season}-t${d.tier}`);
    c.market = buildMarket(cfg, rng, c);
    for (const s of summary) news(c, s, s.includes('Relegated') || s.includes('retired') ? 'bad' : 'good');
    news(c, `Season ${c.season} begins. A fresh crop of players is on the market.`, 'info');
    resetSeason(c, rng);
    saveRng(c, rng);
    return ceremony;
};

// ------------------------------------------------------------------ market

const buildMarket = (cfg: GameConfig, rng: Rng, c: Career): Player[] => {
    const tier = userClub(c).tier;
    const classes = Object.keys(cfg.career.squadMake) as ClassId[];
    const out: Player[] = [];
    for (let i = 0; i < cfg.career.market.size; i++) {
        // mostly around the user's tier, sometimes a tier above or below
        const t = Math.max(0, Math.min(cfg.career.divisions - 1, tier + rng.int(-1, 1)));
        const young = rng.chance(0.4);
        const p = newPlayer(cfg, rng, c, rng.pick(classes), t, 0, young ? [17, 21] : [21, 32]);
        out.push(p);
    }
    return out;
};

export const askingPrice = (cfg: GameConfig, p: Player) => Math.round((playerValue(cfg, p) * cfg.career.market.priceMarkup) / 1000) * 1000;
export const salePrice = (cfg: GameConfig, p: Player) => Math.round((playerValue(cfg, p) * cfg.career.market.saleCut) / 1000) * 1000;

export const buy = (cfg: GameConfig, c: Career, playerId: string): string | null => {
    const u = userClub(c);
    const p = c.market.find((q) => q.id === playerId);
    if (!p) return 'No longer available.';
    if (u.squad.length >= cfg.career.squadMax) return `Squad is full (${cfg.career.squadMax}).`;
    const price = askingPrice(cfg, p);
    if (u.budget < price) return 'Not enough money.';
    c.market = c.market.filter((q) => q.id !== p.id);
    p.number = Math.max(0, ...u.squad.map((q) => q.number)) + 1;
    u.squad.push(p);
    book(c, `Signed ${p.name}`, -price);
    news(c, `${p.name} signs for ${money(price)}.`, 'good');
    return null;
};

export const sell = (cfg: GameConfig, c: Career, playerId: string): string | null => {
    const u = userClub(c);
    const p = u.squad.find((q) => q.id === playerId);
    if (!p) return 'Not in your squad.';
    if (u.squad.length <= cfg.career.squadMin) return `Squad can't go below ${cfg.career.squadMin}.`;
    if (p.cls === 'keeper' && u.squad.filter((q) => q.cls === 'keeper').length <= 1) return 'You need at least one keeper.';
    const price = salePrice(cfg, p);
    u.squad = u.squad.filter((q) => q.id !== p.id);
    u.lineup = u.lineup.filter((id) => id !== p.id);
    delete c.plan[p.id];
    validLineup(cfg, u);
    book(c, `Sold ${p.name}`, price);
    news(c, `${p.name} sold for ${money(price)}.`, 'info');
    return null;
};

// ------------------------------------------------------------------ training plan

/** A starting plan: the XI train their primary class at light intensity, up to the slot count. */
export const defaultPlan = (cfg: GameConfig, club: CareerClub): Record<string, Session> => {
    const plan: Record<string, Session> = {};
    for (const id of club.lineup.slice(0, cfg.training.slots)) {
        const p = club.squad.find((q) => q.id === id);
        if (p && !p.injury) plan[p.id] = { cls: p.cls, intensity: 'light' };
    }
    return plan;
};

// ------------------------------------------------------------------ persistence

export const saveCareer = (c: Career) => writeSave(JSON.stringify(c));
export const loadCareer = (): Career | null => {
    try {
        const raw = readSave();
        if (!raw) return null;
        const c = JSON.parse(raw) as Career;
        return c.version === 1 ? c : null;
    } catch {
        return null;
    }
};
export const deleteCareer = () => deleteSave();

export const userSide = (c: Career, f: Fixture): TeamSide => (f.home === c.userClubId ? 0 : 1);

/** Answer the pending inbox letter with choice `idx`; returns the outcome line (also in the news). */
export const resolveLetter = (cfg: GameConfig, c: Career, idx: number): string => {
    const rng = careerRng(c);
    const out = answerLetter(cfg, c, rng, idx, (label, amount) => book(c, label, amount));
    if (out) news(c, out, 'info');
    validLineup(cfg, userClub(c));
    saveRng(c, rng);
    return out;
};

/** A club's home ground, created on first use (old saves just get one). Grounds lean on the division. */
export const stadiumOf = (c: Career, club: CareerClub): Stadium => {
    const cl = club as CareerClub & { stadium?: Stadium };
    if (!cl.stadium) cl.stadium = generateStadium(`${c.seed}-${club.id}`, club.name.split(' ')[0]!, club.tier);
    return cl.stadium;
};
