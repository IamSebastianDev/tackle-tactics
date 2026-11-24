/**
 * The training-ground tutorial: a handful of staged situations on a real match board. Each
 * lesson sets the pieces, hands one of your players the turn, and checks what happened. Nothing
 * here is special-cased in the engine; the controller just stages turns instead of running a match.
 */
import { MOVE_ABILITY_IDS, type Match } from '../engine/match';
import { hasAbility } from '../engine/abilities';
import type { Cell, MatchEvent, Piece } from '../types';

export type Cast = { me: Piece; mate: Piece; wing: Piece; def: Piece; fwd: Piece; gk: Piece; runner: Piece | null };

export type Lesson = {
    id: string;
    title: string;
    text: (k: Cast) => string;
    /** Set the board. Returns the piece that acts, null for a read-only lesson, undefined to skip. */
    stage: (m: Match, k: Cast) => Piece | null | undefined;
    /** true when the lesson is learned, otherwise what to try next. */
    done?: (ev: MatchEvent[], m: Match, k: Cast) => true | string;
    praise?: string;
};

const put = (m: Match, p: Piece, c: Cell) => {
    const o = m.pieceAt(c);
    if (o && o !== p) o.pos = { ...p.pos };
    p.pos = { ...c };
};
const give = (m: Match, p: Piece) => { m.state.ball = { kind: 'held', by: p.id }; };
const reset = (m: Match) => {
    m.kickoff(0);
    for (const p of m.state.pieces) { p.stamina = 100; p.cooldowns = {}; }
};

export const castFor = (m: Match): Cast => {
    const of = (team: 0 | 1, cls: string) => m.state.pieces.filter((p) => p.team === team && p.player.cls === cls);
    const me = of(0, 'midfielder')[0] ?? m.state.pieces.find((p) => p.team === 0 && p.player.cls !== 'keeper')!;
    const mate = of(0, 'striker')[0] ?? of(0, 'midfielder')[1]!;
    const wing = of(0, 'winger')[0] ?? of(0, 'midfielder')[2] ?? mate;
    const runner = m.state.pieces.find((p) => p.team === 0 && MOVE_ABILITY_IDS.some((a) => hasAbility(m.cfg, p.player, a))) ?? null;
    return { me, mate, wing, runner, def: of(1, 'defender')[0]!, fwd: of(1, 'striker')[0] ?? of(1, 'midfielder')[0]!, gk: of(1, 'keeper')[0]! };
};

const byMe = (ev: MatchEvent[], p: Piece, t: MatchEvent['t']) => ev.filter((e) => e.t === t && 'by' in e && e.by === p.id);

export const LESSONS: Lesson[] = [
    {
        id: 'move',
        title: 'Find space',
        text: (k) => `This is ${k.me.player.name}. Blue squares are everywhere they can run this turn — click one. Red hatching marks opponents' zones of control: an off-ball run stops the moment it steps into one.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.mate, { x: 24, y: 14 });
            give(m, k.mate);
            put(m, k.me, { x: 18, y: 9 });
            return k.me;
        },
        done: (ev, _m, k) => (ev.some((e) => e.t === 'move' && e.id === k.me.id) ? true : 'Click one of the blue squares to make a run.'),
        praise: 'Good. Every player moves once per round, then may act.',
    },
    {
        id: 'pass',
        title: 'Pass it on',
        text: (k) => `${k.me.player.name} has the ball. Each turn is two steps: Move, then Act. Press Space to stay put, then click ${k.mate.player.name} to pass. The orange ring shows where the ball may land — longer passes spread wider, and defenders next to the lane can cut it out.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 18, y: 14 });
            give(m, k.me);
            put(m, k.mate, { x: 25, y: 9 });
            return k.me;
        },
        done: (ev, m, k) => {
            if (!byMe(ev, k.me, 'kick').length) return 'Stay put with Space, then click a teammate to pass.';
            const r = ev.find((e) => e.t === 'receive');
            return r && r.t === 'receive' && m.piece(r.by).team === 0 ? true : 'Lost it! A shorter pass to a teammate with nobody beside them is safer. Again.';
        },
        praise: 'Completed. A short pass to someone in space almost always arrives.',
    },
    {
        id: 'dribble',
        title: 'Run with the ball',
        text: () => `Now carry it. Pink squares are next to a defender who still has a reaction ready: step on one and they get a free tackle. Dribble forward around the pink, then press Space to keep the ball.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 20, y: 14 });
            give(m, k.me);
            put(m, k.def, { x: 24, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) => {
            if (ev.some((e) => e.t === 'tackle' && e.success)) return 'Tackled! Steer around the pink squares this time.';
            return ev.some((e) => e.t === 'move' && e.id === k.me.id && e.dribble) ? true : 'Click a blue square to dribble forward.';
        },
        praise: 'Nicely done. A defender who has used their reaction is harmless until their own turn.',
    },
    {
        id: 'tackle',
        title: 'Win it back',
        text: (k) => `${k.fwd.player.name} has the ball right next to ${k.me.player.name}. Press Space to stay, then click the carrier (or press T) to tackle. The odds come from Tackling against Dribbling — it is a dice roll, so pick your moments.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.fwd, { x: 21, y: 14 });
            give(m, k.fwd);
            put(m, k.me, { x: 20, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) => (byMe(ev, k.me, 'tackle').length ? true : 'Stay put, then click the carrier or press T.'),
        praise: 'Win or lose, that is how you challenge. A miss leaves you off balance until your next turn.',
    },
    {
        id: 'shoot',
        title: 'Shoot',
        text: (k) => `${k.me.player.name} is in range. Stay put, then click a cell inside the goal mouth. The orange band shows where the shot may go: closer and better-skilled means tighter. The keeper gets a save roll.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 40, y: 13 });
            give(m, k.me);
            put(m, k.gk, { x: 49, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) => (byMe(ev, k.me, 'kick').some((e) => e.t === 'kick' && e.kind === 'shot') ? true : 'Click inside the goal mouth (between the posts) to shoot.'),
        praise: 'That is the whole loop: make space, move the ball, get a shot away.',
    },
    {
        id: 'ability',
        title: 'Abilities',
        text: (k) => `${k.runner?.player.name ?? 'This player'} has a movement ability in the dock at the bottom. Hover a card to preview it, click it (or press its number), then click a cell. Abilities recharge for a few rounds after use.`,
        stage: (m, k) => {
            if (!k.runner) return undefined;
            reset(m);
            put(m, k.runner, { x: 16, y: 20 });
            put(m, k.mate, { x: 24, y: 14 });
            give(m, k.runner.id === k.mate.id ? k.me : k.mate);
            return k.runner;
        },
        done: (ev, _m, k) => (ev.some((e) => (e.t === 'move' && e.id === k.runner?.id && !!e.ability) || (e.t === 'ability' && e.by === k.runner?.id))
            ? true : 'Pick the ability card in the dock first, then click a highlighted cell.'),
        praise: 'Each class unlocks more abilities as players level up in the career.',
    },
    {
        id: 'corner',
        title: 'Set pieces',
        text: () => 'Corner! First the setup: click one of your highlighted players, then a free cell — get runners away from their markers. Press Space when happy (the defence answers each move). Then whip it into the box: teammates within 2 of where it drops attack a header.',
        stage: (m) => {
            reset(m);
            m.awardCorner(0, 0);
            return m.carrier() ?? null;
        },
        done: (ev, m) => {
            const k = ev.find((e) => e.t === 'kick');
            return k && k.t === 'kick' && m.piece(k.by).team === 0 ? true : 'Aim the delivery at a cell inside the box.';
        },
        praise: 'Corners come from parries, blocks and clearances. Free kicks near the box work the same way.',
    },
    {
        id: 'flow',
        title: 'How a match flows',
        text: () => 'Each round every player acts once, fastest first — the queue on the right shows who is next. Defenders keep one reaction per round: a tackle or interception off your turn. Players tire as they run (the bar under a tired player); press B for the bench and up to 3 substitutions. F changes which of your players ask for orders, P pauses, H opens the playbook.',
        stage: (m) => { reset(m); return null; },
    },
];
