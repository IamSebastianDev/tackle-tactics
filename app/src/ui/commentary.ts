/**
 * The voice of the match. Barnaby Quill has called matches in every muddy guild-league ground
 * from Mirewick to Kingsreach, and he has opinions. Lines are picked at random from variants,
 * never repeating the same line twice in a row.
 */
import type { Match } from '../engine/match';
import type { MatchEvent, TeamSide } from '../types';

export type Line = { text: string; tone: 'big' | 'good' | 'bad' | 'info'; team: TeamSide | null; caption?: string };

const pick = (arr: string[], last: Set<string>) => {
    const fresh = arr.filter((s) => !last.has(s));
    const s = (fresh.length ? fresh : arr)[Math.floor(Math.random() * (fresh.length ? fresh.length : arr.length))]!;
    last.add(s);
    if (last.size > 40) last.delete(last.values().next().value!);
    return s;
};
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? k);

const L = {
    kickoff: [
        "And we're under way! {team} get us started.",
        '{team} tap it off. Ninety minutes of shoving pieces round a board begins now.',
        "The whistle goes, {team} kick off, and somewhere a tactician sharpens a pencil.",
    ],
    goal: [
        'GOAL! {p} finds the net and {team} are dancing!',
        "{p} SCORES! You won't see a more confident finish in this league all season.",
        "IT'S IN! {p} buries it — the away end has gone very, very quiet.",
        'GOAL for {team}! {p}, take a bow. Take two, actually.',
        "{p}! Oh, that's lovely. The keeper didn't even get a vote.",
    ],
    goalAssist: [
        'GOAL! {a} with the vision, {p} with the finish!',
        "{a} picks the lock, {p} walks through the door. GOAL!",
        'What a move! {a} to {p}, and {team} lead the dance!',
    ],
    goalHeader: [
        "HEADER! {p} rises like a griffin and nods it home!",
        "{p} attacks that cross like it owes them money! GOAL!",
    ],
    goalPen: [
        "{p} steps up... and sends the keeper to the wrong postcode. Penalty scored!",
        'Cool as frost from {p}. The penalty is dispatched.',
    ],
    save: [
        'What a save from {k}! Fingertips and fury.',
        "{k} says no! That's a stop worthy of a ballad.",
        "Denied! {k} reads {p}'s mind and gets there first.",
        "{k} — WHAT A STOP! The crowd can't believe it.",
    ],
    parry: [
        "{k} can only parry it! It's loose in the box!",
        'Palmed away by {k} — and the vultures are circling!',
    ],
    wide: [
        "{p} drags it wide. That one's in the next village.",
        "Off target from {p}. Somewhere a farmer is getting his ball back.",
        "{p} lets fly... and the corner flag ducks. Wide.",
        'Ambitious from {p}. Inaccurate, but ambitious.',
    ],
    block: [
        "Blocked! {o} throws everything in front of that.",
        '{o} with the body on the line. Brave as a paladin.',
    ],
    intercept: [
        "{o} reads it like a cheap paperback. Intercepted.",
        "Cut out by {o}! That lane was never open.",
        'Lovely anticipation from {o}. Possession changes hands.',
    ],
    steal: [
        "{o} picks {p}'s pocket! Clean as you like.",
        "{p} tried to dance through, {o} wasn't on the dance card. Ball won.",
        "Timing! {o} steps in and takes it off {p}'s toes.",
    ],
    tackle: [
        "Strong challenge from {o}, and it's won!",
        "{o} goes to ground and comes up with the ball. Textbook.",
    ],
    missedTackle: [
        "{o} lunges and grabs nothing but air.",
        "{o} commits... and {p} is gone! That one will sting.",
    ],
    dribble: [
        "{p} skips past {o}! Lovely feet.",
        "{p} leaves {o} on the floor wondering what happened.",
    ],
    trick: [
        "{p} with a dummy! {o} has bought it entirely.",
        "Oh, the shimmy from {p}! {o} is still looking the other way.",
    ],
    through: [
        "Threaded through by {p}! {r} is away!",
        "{p} spots the run, {r} gets on the end of it. Danger!",
    ],
    cross: ["{p} whips in the cross...", "In it comes from {p}!"],
    foul: ["Cynical from {o}. Stopped {p} like a portcullis.", "{o} pulls {p} back. The referee has seen it."],
    penalty: ['PENALTY! {o} brings {p} down in the box!', "Oh no, {o}... that's a spot kick."],
    tackleFoul: ["{o} goes through the back of {p}. {r} blows.", "Late from {o}! {r} has the whistle out.", "{o} gets plenty of {p} and none of the ball. Free kick."],
    advantage: ["{o} clips {p}, but {r} waves play on. Advantage!", "Foul by {o} — {r} lets it run. Lovely refereeing."],
    corner: ["Corner to {team}. Big bodies forward!", "{team} win a corner. This is where the set-piece coach earns their wage.", "Corner kick. Everyone into the box, elbows sharpened."],
    freekick: ["Free kick to {team} in a dangerous spot. The wall assembles.", "{team} have a free kick within range. Who's standing over it?"],
    sub: ["Change for {team}: {on} comes on for {off}.", "{off} makes way, {on} on. Fresh legs for {team}.", "{team} roll the dice — {on} replaces a weary {off}."],
    styleIntro: ["{team} line up as a {style} side. {note}", "Expect {team} to play it {style}: {note}"],
    chase: ["{team} are throwing bodies forward now. Needs must.", "Time's running out for {team} — everyone up!"],
    protect: ["{team} are shutting up shop. Ten behind the ball.", "{team} sit on their lead. Ugly, but it might work."],
    refIntro: ["Today's referee: {r}. {note}", "{r} has the whistle today. {note}"],
    yellow: ['{o} goes in the book.', 'Yellow card for {o}. Steady now.'],
    red: ["RED CARD! {o} is off — that's a long, lonely walk.", "Second yellow, and {o} is sent packing!"],
    command: ["{k} organises the defence. Voice like a war horn, that one.", '{k} is shouting. Loudly. It seems to be working.'],
    tempo: ["{p} snaps their fingers and the tempo lifts.", '{p} conducts. {r} goes next.'],
    timeout: ["{p} hesitates... and the moment's gone.", 'Indecision from {p}. The clock waits for no one.'],
    halftime: ["That's half time. {s}. Oranges and harsh words in the dressing rooms.", 'The whistle for the break: {s}.'],
    fulltime: ["It's all over! {s}.", 'Full time. {s}. The bards will sing of it, briefly.'],
};

export class Commentator {
    private recent = new Set<string>();
    constructor(private m: Match) {}

    private name = (id: string) => this.m.piece(id).player.name;
    private teamName = (t: TeamSide) => this.m.state.clubs[t].name;
    private line(key: keyof typeof L, v: Record<string, string>, tone: Line['tone'], team: TeamSide | null, caption?: string): Line {
        return { text: fill(pick(L[key], this.recent), v), tone, team, caption };
    }
    private scoreline = () => `${this.m.state.clubs[0].short} ${this.m.state.score[0]}–${this.m.state.score[1]} ${this.m.state.clubs[1].short}`;

    /** Lines for one batch of engine events (most batches say nothing: silence is pacing). */
    style(team: TeamSide, style: string, note: string): Line[] {
        return [this.line('styleIntro', { team: this.teamName(team), style: style.toLowerCase(), note }, 'info', team)];
    }

    mood(team: TeamSide, mood: 'chase' | 'protect'): Line[] {
        return [this.line(mood, { team: this.teamName(team) }, 'info', team)];
    }

    /** Pre-match: who's refereeing and what that means. */
    referee(note: string): Line[] {
        return [this.line('refIntro', { r: this.m.state.referee.name, note }, 'info', null)];
    }

    call(events: MatchEvent[], assist?: string): Line[] {
        const out: Line[] = [];
        let kicker: string | null = null;
        let throughBy: string | null = null;
        let lastShooter: string | null = null;
        for (const e of events) {
            switch (e.t) {
                case 'kickoff': out.push(this.line('kickoff', { team: this.teamName(e.team) }, 'info', e.team)); break;
                case 'sub': out.push(this.line('sub', { team: this.teamName(e.team), on: this.name(e.on), off: this.name(e.off) }, 'info', e.team)); break;
                case 'setpiece': out.push(this.line(e.kind, { team: this.teamName(e.team) }, 'info', e.team, e.kind === 'corner' ? 'CORNER' : 'FREE KICK')); break;
                case 'ability':
                    if (e.ability === 'through') throughBy = e.by;
                    if (e.ability === 'cross') out.push(this.line('cross', { p: this.name(e.by) }, 'info', this.m.piece(e.by).team));
                    if (e.ability === 'command') out.push(this.line('command', { k: this.name(e.by) }, 'info', this.m.piece(e.by).team));
                    if (e.ability === 'tempo' && e.target) out.push(this.line('tempo', { p: this.name(e.by), r: this.name(e.target) }, 'info', this.m.piece(e.by).team));
                    break;
                case 'kick':
                    kicker = e.by;
                    if (e.kind === 'shot') lastShooter = e.by;
                    break;
                case 'runOnto':
                    if (throughBy) out.push(this.line('through', { p: this.name(throughBy), r: this.name(e.by) }, 'good', this.m.piece(e.by).team));
                    break;
                case 'intercept':
                    if (e.success) {
                        const o = this.m.piece(e.by);
                        out.push(this.line(e.block ? 'block' : 'intercept', { o: o.player.name }, 'info', o.team));
                    }
                    break;
                case 'tackle': {
                    const o = this.m.piece(e.by);
                    const p = this.m.piece(e.on);
                    if (e.success) out.push(this.line(e.reaction ? 'steal' : 'tackle', { o: o.player.name, p: p.player.name }, 'info', o.team));
                    else if (e.reaction) out.push(this.line('dribble', { o: o.player.name, p: p.player.name }, 'good', p.team));
                    else out.push(this.line('missedTackle', { o: o.player.name, p: p.player.name }, 'info', p.team));
                    break;
                }
                case 'trick':
                    if (e.success) out.push(this.line('trick', { p: this.name(e.by), o: this.name(e.on) }, 'good', this.m.piece(e.by).team));
                    break;
                case 'save': {
                    const k = this.m.piece(e.by);
                    out.push(this.line(e.held ? 'save' : 'parry', { k: k.player.name, p: lastShooter ? this.name(lastShooter) : 'the shooter' }, 'big', k.team, e.held ? 'WHAT A SAVE' : 'PARRIED'));
                    break;
                }
                case 'wide':
                    if (lastShooter) out.push(this.line('wide', { p: this.name(lastShooter) }, 'info', e.team));
                    break;
                case 'foul': {
                    const v = { o: this.name(e.by), p: this.name(e.on), r: this.m.state.referee.name };
                    const k = e.penalty ? 'penalty' : e.advantage ? 'advantage' : e.tackle ? 'tackleFoul' : 'foul';
                    // a plain free kick (the set-piece ones announce themselves with their own event)
                    const fk = !e.penalty && !e.advantage && !events.some((x) => x.t === 'setpiece');
                    out.push(this.line(k, v, e.penalty ? 'big' : 'info', this.m.piece(e.on).team, e.penalty ? 'PENALTY' : fk ? 'FREE KICK' : undefined));
                    break;
                }
                case 'card':
                    out.push(this.line(e.card === 'red' ? 'red' : 'yellow', { o: this.name(e.on) }, e.card === 'red' ? 'big' : 'info', this.m.piece(e.on).team, e.card === 'red' ? 'SENT OFF' : undefined));
                    break;
                case 'header':
                    lastShooter = e.by;
                    break;
                case 'goal': {
                    const p = this.name(e.scorer);
                    const v = { p, team: this.teamName(e.team), a: assist ? this.name(assist) : '' };
                    const headed = events.some((x) => x.t === 'header');
                    const pen = events.some((x) => x.t === 'foul' && x.penalty);
                    const key = pen ? 'goalPen' : headed ? 'goalHeader' : assist ? 'goalAssist' : 'goal';
                    out.push(this.line(key, v, 'big', e.team, 'GOAL'));
                    break;
                }
                case 'timeout': out.push(this.line('timeout', { p: this.name(e.id) }, 'info', this.m.piece(e.id).team)); break;
                case 'halftime': out.push(this.line('halftime', { s: this.scoreline() }, 'big', null)); break;
                case 'fulltime': out.push(this.line('fulltime', { s: this.scoreline() }, 'big', null)); break;
            }
        }
        void kicker;
        return out;
    }
}
