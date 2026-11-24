/**
 * Play-by-play: one short line per action, built straight from the engine's events (passes,
 * dribbles, tackles, shots, saves, fouls, cards, set pieces, subs). The live simulation shows these
 * alongside the commentators' lines. Quiet off-ball moves are skipped so the feed stays readable.
 */
import { dist } from '../engine/grid';
import type { Match } from '../engine/match';
import type { MatchEvent, TeamSide } from '../types';

/** `turnover` is any change of possession (tackle won, pass cut out or given away). */
export type PlayKind = 'pass' | 'carry' | 'duel' | 'turnover' | 'shot' | 'save' | 'goal' | 'foul' | 'card' | 'setpiece' | 'sub' | 'period';

/** What the highlights feed keeps: chances, set pieces, discipline and changes of possession. */
export const HIGHLIGHT_KINDS: ReadonlySet<PlayKind> = new Set([
    'turnover',
    'shot',
    'save',
    'goal',
    'foul',
    'card',
    'setpiece',
    'sub',
    'period',
]);
export type Play = { kind: PlayKind; text: string; team: TeamSide | null };

export const describePlays = (m: Match, events: MatchEvent[]): Play[] => {
    const out: Play[] = [];
    const who = (id: string) => m.piece(id);
    const name = (id: string) => who(id).player.name;
    const team = (id: string) => who(id).team;
    const short = (t: TeamSide) => m.state.clubs[t].short;
    const add = (kind: PlayKind, text: string, t: TeamSide | null) => out.push({ kind, text, team: t });

    for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        switch (e.t) {
            case 'move':
                // only the ball carrier's runs make the feed
                if (e.dribble && e.path.length > 1)
                    add(
                        'carry',
                        `${name(e.id)} carries it ${e.path.length - 1} yard${e.path.length > 2 ? 's' : ''}${e.ability === 'sprint' ? ' at full sprint' : ''}`,
                        team(e.id),
                    );
                break;
            case 'trick':
                add(
                    'duel',
                    e.success ? `${name(e.by)} skins ${name(e.on)} with a trick` : `${name(e.on)} reads ${name(e.by)}'s trick`,
                    team(e.success ? e.by : e.on),
                );
                break;
            case 'tackle':
                add(
                    e.success ? 'turnover' : 'duel',
                    e.success
                        ? `${name(e.by)} wins the ball off ${name(e.on)}${e.reaction ? '' : ' with a crunching tackle'}`
                        : `${name(e.on)} rides ${name(e.by)}'s tackle`,
                    team(e.success ? e.by : e.on),
                );
                break;
            case 'kick': {
                const d = Math.round(dist(e.from, e.target));
                if (e.kind === 'shot') {
                    add('shot', `${name(e.by)} shoots from ${d} yards`, team(e.by));
                    break;
                }
                // pass: say how it ended if the next events tell us
                const next = events.slice(i + 1);
                const caught = next.find((x) => x.t === 'intercept' && x.success);
                const recv = next.find((x) => x.t === 'receive' || x.t === 'header' || x.t === 'runOnto');
                const loose = next.find((x) => x.t === 'loose' || x.t === 'out');
                if (caught && caught.t === 'intercept')
                    add('turnover', `${name(e.by)}'s pass is cut out by ${name(caught.by)}`, team(caught.by));
                else if (recv && (recv.t === 'receive' || recv.t === 'header' || recv.t === 'runOnto')) {
                    const to = recv.by;
                    add(
                        team(to) === team(e.by) ? 'pass' : 'turnover',
                        team(to) === team(e.by)
                            ? `${name(e.by)} ${d > 14 ? 'lofts it' : 'passes'} to ${name(to)}${recv.t === 'header' ? ', who heads it on' : ''}`
                            : `${name(e.by)}'s pass goes straight to ${name(to)}`,
                        team(to),
                    );
                } else if (loose) add('pass', `${name(e.by)}'s ${d > 14 ? 'long ball' : 'pass'} runs loose`, team(e.by));
                break;
            }
            case 'intercept':
                if (e.success && e.block) add('save', `Blocked by ${name(e.by)}!`, team(e.by));
                break;
            case 'save':
                add('save', e.held ? `Saved and held by ${name(e.by)}` : `Saved! ${name(e.by)} parries it`, team(e.by));
                break;
            case 'wide':
                add('shot', 'Wide of the post', e.team);
                break;
            case 'goal': {
                const [a, b] = m.state.score;
                add('goal', `GOAL! ${name(e.scorer)} scores for ${short(e.team)} · ${a}–${b}`, e.team);
                break;
            }
            case 'foul':
                add(
                    'foul',
                    `Foul by ${name(e.by)} on ${name(e.on)}${e.penalty ? ': PENALTY' : e.advantage ? ', advantage played' : ''}`,
                    team(e.by),
                );
                break;
            case 'card':
                add('card', `${e.card === 'red' ? 'Red' : 'Yellow'} card for ${name(e.on)}`, team(e.on));
                break;
            case 'setpiece':
                add('setpiece', `${e.kind === 'corner' ? 'Corner' : 'Free kick'} to ${short(e.team)}, ${name(e.taker)} to take`, e.team);
                break;
            case 'sub':
                add('sub', `Substitution ${short(e.team)}: ${name(e.on)} on for ${name(e.off)}`, e.team);
                break;
            case 'pickup':
                add('carry', `${name(e.by)} picks up the loose ball`, team(e.by));
                break;
            case 'kickoff':
                add('period', `Kick-off: ${short(e.team)}`, e.team);
                break;
            case 'halftime':
                add('period', `Half time · ${m.state.score[0]}–${m.state.score[1]}`, null);
                break;
            case 'fulltime':
                add('period', `Full time · ${m.state.score[0]}–${m.state.score[1]}`, null);
                break;
            default:
                break;
        }
    }
    return out;
};
