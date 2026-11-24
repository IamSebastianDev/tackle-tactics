/**
 * Match prep: before a career fixture you read the opponent, pick a game plan and give a team
 * talk. The plan drives your auto-managed players and can out-think the opponent's style
 * (a morale edge for the match); the talk moves the squad's mood. Derbies against the club's
 * rival raise the stakes both ways.
 */
import type { GameConfig, TeamStyle } from '../config';
import { styleOf } from '../ai/brain';
import { pickReferee } from '../engine/match';
import { createRng } from '../rng';
import type { Referee } from '../types';
import { rollConditions, type Conditions } from '../world/stadium';
import { stadiumOf, table, type Career, type Fixture } from './career';
import { CUP_NAME, isCupFixture } from './cup';
import { moraleLabel, rivalOf, shiftMorale, story } from './story';

export type TeamTalk = 'calm' | 'fire' | 'demand';
export type Prep = { fixtureId: string; plan: TeamStyle; talk: TeamTalk; referee: Referee; conditions: Conditions; applied?: boolean };

/** Rock-paper-scissors between styles; Balanced neither counters nor is countered. */
export const COUNTERS: Record<TeamStyle, TeamStyle | null> = {
    press: 'possession',
    possession: 'deep',
    deep: 'direct',
    direct: 'press',
    balanced: null,
};
export const planEdge = (mine: TeamStyle, theirs: TeamStyle) => (COUNTERS[mine] === theirs ? 1 : COUNTERS[theirs] === mine ? -1 : 0);

export const TALKS: Record<TeamTalk, { label: string; note: string }> = {
    calm: { label: 'Keep it calm', note: 'Settles the mood towards steady. Never backfires.' },
    fire: { label: 'Fire them up', note: 'Big lift — but an already buzzing squad can boil over.' },
    demand: { label: 'Demand more', note: 'Works on a confident squad, stings a fragile one.' },
};

const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

export { rivalOf };
export const isDerby = (c: Career, f: Fixture) => {
    const r = rivalOf(c);
    return !!r && (f.home === r.id || f.away === r.id) && (f.home === c.userClubId || f.away === c.userClubId);
};

/** The opponent in a fixture involving the user. */
export const opponentOf = (c: Career, f: Fixture) => c.clubs[f.home === c.userClubId ? f.away : f.home]!;

/** Prep for this fixture (created on first look, then stable until kick-off). */
export const prepFor = (cfg: GameConfig, c: Career, f: Fixture): Prep => {
    const holder = c as Career & { prep?: Prep };
    if (holder.prep?.fixtureId !== f.id) {
        const seed = hash(`${c.seed}-${f.id}`);
        const home = c.clubs[f.home]!;
        holder.prep = {
            fixtureId: f.id,
            plan: holder.prep?.plan ?? c.clubs[c.userClubId]!.style ?? 'balanced',
            talk: 'calm',
            referee: pickReferee(cfg, seed),
            conditions: rollConditions(createRng(seed), stadiumOf(c, home)),
        };
    }
    return holder.prep!;
};

/** Morale edge for the match itself (added to the club's morale on the board). */
export const matchEdge = (cfg: GameConfig, c: Career, f: Fixture, p: Prep) =>
    planEdge(p.plan, styleOf(opponentOf(c, f))) * cfg.career.prep.edge + (isDerby(c, f) ? cfg.career.prep.derbyLift : 0);

/** Apply the team talk once, at kick-off. Returns the news line. */
export const applyTalk = (cfg: GameConfig, c: Career, f: Fixture, p: Prep, rng: () => number): string => {
    if (p.applied) return '';
    p.applied = true;
    const t = cfg.career.prep.talk;
    const m = story(c).morale;
    const derby = isDerby(c, f) ? ' before the derby' : '';
    switch (p.talk) {
        case 'calm': {
            const d = Math.sign(60 - m) * Math.min(Math.abs(60 - m), t.calm);
            shiftMorale(c, d);
            return `A calm word${derby}. The squad settles.`;
        }
        case 'fire':
            if (m >= t.overheatAt && rng() < t.overheatChance) {
                shiftMorale(c, t.overheat);
                return `You fired them up${derby}, but they were already boiling. Heads are a little scrambled.`;
            }
            shiftMorale(c, t.fire);
            return `A thunderous team talk${derby}. They can't wait to get out there.`;
        case 'demand':
            if (m >= 55) {
                shiftMorale(c, t.demandUp);
                return `You demanded more${derby}, and the squad rose to it.`;
            }
            shiftMorale(c, t.demandDown);
            return `You demanded more${derby}. A fragile squad took it badly.`;
    }
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** The story of a career fixture, for the pre-match intro: derby, table, form, mood, the plan. */
export const storyLines = (cfg: GameConfig, c: Career, f: Fixture, p: Prep): string[] => {
    const u = c.clubs[c.userClubId]!;
    const opp = opponentOf(c, f);
    const div = c.divisions.find((d) => d.clubs.includes(u.id));
    const lines: string[] = [];
    if (isDerby(c, f)) lines.push(`It's the derby. ${opp.name} — the town has talked about nothing else all week.`);
    if (isCupFixture(f)) {
        const round = c.cup?.rounds[f.round];
        lines.push(
            `${CUP_NAME}${round ? ` · ${round.label}` : ''}. ${opp.name} play in Division ${opp.tier + 1}. A draw goes to penalties.`,
        );
    } else if (div) {
        const rows = table(div);
        const pos = (id: string) => rows.findIndex((r) => r.club === id) + 1;
        const played = rows.find((r) => r.club === u.id)?.p ?? 0;
        if (played > 0)
            lines.push(
                `${u.name} sit ${ordinal(pos(u.id))}, ${opp.name} ${ordinal(pos(opp.id))}. ${pos(u.id) <= 2 ? 'Promotion places — hold on to them.' : pos(u.id) >= rows.length - 1 ? 'The drop zone. Points are everything.' : 'Every point counts from here.'}`,
            );
        else lines.push(`The first match of the season. Everyone starts on zero.`);
        const form = (id: string) =>
            div.fixtures
                .filter((x) => x.result && (x.home === id || x.away === id))
                .slice(-5)
                .map((x) => {
                    const [gh, ga] = x.result!;
                    const [mine, theirs] = x.home === id ? [gh, ga] : [ga, gh];
                    return mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
                })
                .join('');
        if (form(u.id) || form(opp.id)) lines.push(`Form: ${u.short} ${form(u.id) || '—'} · ${opp.short} ${form(opp.id) || '—'}.`);
    }
    lines.push(`The squad is ${moraleLabel(story(c).morale).toLowerCase()}.`);
    const theirs = styleOf(opp);
    const edge = planEdge(p.plan, theirs);
    lines.push(
        `The plan: ${cfg.ai.styles[p.plan].label.toLowerCase()} against their ${cfg.ai.styles[theirs].label.toLowerCase()}${edge > 0 ? ' — it should hurt them.' : edge < 0 ? ' — a risky choice.' : '.'}`,
    );
    return lines;
};
