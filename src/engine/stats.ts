/**
 * Match statistics, derived purely from the engine's event stream: goals (with minute and assist),
 * shots, passing, duels, saves, possession, player ratings and Man of the Match.
 */
import type { MatchEvent, Piece, TeamSide } from '../types';
import type { Match } from './match';

export type PlayerLine = {
    goals: number; assists: number; shots: number; onTarget: number; passes: number; passesOk: number;
    tackles: number; tacklesWon: number; intercepts: number; saves: number; dribbles: number; fouls: number;
    yellows: number; red: boolean; conceded: number;
};
export type GoalNote = { team: TeamSide; scorer: string; assist?: string; minute: number; how: 'open' | 'header' | 'penalty' | 'through' };
export type TeamLine = { possession: number; shots: number; onTarget: number; passes: number; passesOk: number; tacklesWon: number; saves: number };

const blank = (): PlayerLine => ({
    goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, tacklesWon: 0, intercepts: 0, saves: 0,
    dribbles: 0, fouls: 0, yellows: 0, red: false, conceded: 0,
});

export class MatchStats {
    readonly players = new Map<string, PlayerLine>();
    readonly goals: GoalNote[] = [];
    private possessionTurns: [number, number] = [0, 0];
    /** Last completed pass between teammates (for assists); cleared when possession switches. */
    private lastPass: { from: string; to: string; how: GoalNote['how'] } | null = null;
    private lastTeam: TeamSide | null = null;

    constructor(private m: Match) {}

    line = (id: string) => {
        let l = this.players.get(id);
        if (!l) { l = blank(); this.players.set(id, l); }
        return l;
    };

    minute = () => {
        const s = this.m.state;
        const frac = (s.round - 1 + Math.max(0, s.turnIndex) / Math.max(1, s.order.length)) / this.m.cfg.match.rounds;
        return Math.min(90, Math.max(1, Math.floor(frac * 90) + 1));
    };

    /** Call once per turn, before it is played. */
    onTurn() {
        const c = this.m.carrier();
        if (c) this.possessionTurns[c.team]++;
        this.trackPossession();
    }

    private trackPossession() {
        const t = this.m.carrier()?.team ?? null;
        if (t !== null && t !== this.lastTeam) {
            if (this.lastTeam !== null) this.lastPass = null;
            this.lastTeam = t;
        }
    }

    observe(events: MatchEvent[]) {
        let kick: Extract<MatchEvent, { t: 'kick' }> | null = null;
        let through = false;
        let penalty = false;
        for (const e of events) {
            switch (e.t) {
                case 'ability':
                    if (e.ability === 'through') through = true;
                    break;
                case 'foul':
                    this.line(e.by).fouls++;
                    if (e.penalty) penalty = true;
                    break;
                case 'card':
                    if (e.card === 'yellow') this.line(e.on).yellows++;
                    else this.line(e.on).red = true;
                    break;
                case 'kick':
                    kick = e;
                    if (e.kind === 'shot') this.line(e.by).shots++;
                    else this.line(e.by).passes++;
                    break;
                case 'receive':
                case 'runOnto': {
                    if (!kick || kick.kind !== 'pass') break;
                    const from = this.m.piece(kick.by);
                    const to = this.m.piece(e.by);
                    if (from.team === to.team && e.t === 'receive') {
                        this.line(kick.by).passesOk++;
                        this.lastPass = { from: kick.by, to: e.by, how: through ? 'through' : 'open' };
                    }
                    break;
                }
                case 'header':
                    // the cross that found a head counts as a completed pass
                    if (kick && kick.kind === 'pass') {
                        this.line(kick.by).passesOk++;
                        this.lastPass = { from: kick.by, to: e.by, how: 'header' };
                    }
                    break;
                case 'intercept':
                    if (e.success) this.line(e.by).intercepts++;
                    break;
                case 'tackle':
                    this.line(e.by).tackles++;
                    if (e.success) this.line(e.by).tacklesWon++;
                    else if (e.reaction) this.line(e.on).dribbles++;
                    break;
                case 'save':
                    this.line(e.by).saves++;
                    if (kick && kick.kind === 'shot') this.line(kick.by).onTarget++;
                    break;
                case 'goal': {
                    const scorer = e.scorer;
                    this.line(scorer).goals++;
                    this.line(scorer).onTarget++;
                    const lp = this.lastPass;
                    const assist = !penalty && lp && lp.to === scorer ? lp.from : undefined;
                    if (assist) this.line(assist).assists++;
                    const how: GoalNote['how'] = penalty ? 'penalty' : lp && lp.to === scorer ? lp.how : 'open';
                    this.goals.push({ team: e.team, scorer, assist, minute: this.minute(), how });
                    // keeper & back line concede
                    for (const p of this.m.state.pieces) if (p.team !== e.team && (p.player.cls === 'keeper' || p.player.cls === 'defender')) this.line(p.id).conceded++;
                    this.lastPass = null;
                    break;
                }
            }
            if (e.t !== 'kick' && e.t !== 'receive' && e.t !== 'header' && e.t !== 'runOnto') this.trackPossession();
        }
        this.trackPossession();
    }

    team = (t: TeamSide): TeamLine => {
        const ids = this.m.everyone().filter((p) => p.team === t).map((p) => p.id);
        const sum = (k: keyof PlayerLine) => ids.reduce((a, id) => a + Number(this.players.get(id)?.[k] ?? 0), 0);
        const total = this.possessionTurns[0] + this.possessionTurns[1];
        return {
            possession: total ? Math.round((this.possessionTurns[t] / total) * 100) : 50,
            shots: sum('shots'), onTarget: sum('onTarget'), passes: sum('passes'), passesOk: sum('passesOk'), tacklesWon: sum('tacklesWon'), saves: sum('saves'),
        };
    };

    /** 3.0–10.0 match rating from the player's line and the result. */
    rating = (p: Piece) => {
        const l = this.players.get(p.id) ?? blank();
        const [a, b] = this.m.state.score;
        const mine = p.team === 0 ? a - b : b - a;
        let r = 6.0;
        r += l.goals * 1.1 + l.assists * 0.7 + l.onTarget * 0.15 + l.passesOk * 0.05 - (l.passes - l.passesOk) * 0.12;
        r += l.tacklesWon * 0.3 - (l.tackles - l.tacklesWon) * 0.08 + l.intercepts * 0.3 + l.saves * 0.45 + l.dribbles * 0.15;
        r -= l.fouls * 0.15 + l.yellows * 0.3 + (l.red ? 1.5 : 0);
        r -= l.conceded * (p.player.cls === 'keeper' ? 0.3 : 0.12);
        r += mine > 0 ? 0.3 : mine < 0 ? -0.2 : 0;
        return Math.round(Math.max(3, Math.min(10, r)) * 10) / 10;
    };

    motm = (): Piece | undefined => {
        const all = this.m.everyone();
        const [a, b] = this.m.state.score;
        const winner: TeamSide | null = a > b ? 0 : b > a ? 1 : null;
        return all.sort((x, y) => this.rating(y) + (y.team === winner ? 0.05 : 0) - (this.rating(x) + (x.team === winner ? 0.05 : 0)))[0];
    };
}
