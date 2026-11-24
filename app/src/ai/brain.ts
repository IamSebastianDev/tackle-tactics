/**
 * Heuristic, per-turn AI on fully public state:
 *   enumerate legal actions (incl. abilities) → score → softmax-sample from the top band.
 * Off-ball scoring blends formation slot (ball-relative) with a role job, weighted per slot
 * (`roleWeight`): shape-enforcers stay home, freelancers break shape.
 */
import type { Difficulty, FormationSlot, GameConfig, TeamStyle } from '../config';
import { attackGoalX, cheb, dist, forward, fromKey, goalRows, inPitch, line } from '../engine/grid';
import type { KickAbility, Match, MoveAbility } from '../engine/match';
import { interceptChance, movePoints, saveChance, scatterRadius, tackleChance } from '../engine/rules';
import type { Rng } from '../rng';
import type { Cell, Club, MatchEvent, Piece, TeamSide } from '../types';

export type MoveDecision = { kind: 'move'; to: Cell; ability?: MoveAbility } | { kind: 'hold' } | { kind: 'trick' };
export type ActDecision =
    | { kind: 'kick'; target: Cell; ability?: KickAbility }
    | { kind: 'tackle' } | { kind: 'slide' } | { kind: 'foul' } | { kind: 'command' }
    | { kind: 'mark'; target: string } | { kind: 'tempo'; target: string }
    | { kind: 'end' };

export const applyMove = (m: Match, d: MoveDecision): MatchEvent[] =>
    d.kind === 'move' ? m.move(d.to, d.ability) : d.kind === 'trick' ? m.trick() : m.hold();

export const applyAct = (m: Match, d: ActDecision): MatchEvent[] => {
    switch (d.kind) {
        case 'kick': return m.kick(d.target, d.ability);
        case 'tackle': return m.tackle();
        case 'slide': return m.slide();
        case 'foul': return m.foul();
        case 'command': return m.command();
        case 'mark': return m.mark(d.target);
        case 'tempo': return m.tempo(d.target);
        default: return m.endTurn();
    }
};

type Scored<T> = { v: number; a: T };

const STYLES: TeamStyle[] = ['balanced', 'press', 'deep', 'direct', 'possession'];
const hashId = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
/** A club's identity: its chosen style, or a stable pick from its id (balanced twice as common). */
export const styleOf = (club: Club): TeamStyle => club.style ?? (['balanced', ...STYLES] as TeamStyle[])[hashId(club.id + club.name) % (STYLES.length + 1)]!;

type Knobs = GameConfig['ai'];
const addKnobs = (base: Knobs, d: Partial<Record<string, number>>): Knobs => {
    const out = { ...base } as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) if (typeof out[k] === 'number' && v !== undefined) out[k] = (out[k] as number) + v;
    return out as Knobs;
};

const softmaxPick = <T>(rng: Rng, options: Scored<T>[], temperature: number, band = 6): T | undefined => {
    if (!options.length) return undefined;
    const top = [...options].sort((a, b) => b.v - a.v).slice(0, band);
    const best = top[0]!.v;
    // The band narrows naturally when one option dominates: exp() of a big gap ~ 0.
    const w = top.map((o) => Math.exp((o.v - best) / Math.max(temperature, 1e-4)));
    const sum = w.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    for (let i = 0; i < top.length; i++) if ((r -= w[i]!) <= 0) return top[i]!.a;
    return top[0]!.a;
};

export class Brain {
    constructor(private m: Match, private rng: Rng, private difficulty: Difficulty) {
        this.k = m.cfg.ai;
    }

    private get cfg() { return this.m.cfg; }
    private get T() { return this.k.temperature[this.difficulty]; }
    /** Knobs for the team deciding right now: base → club style → game state. */
    private k!: Knobs;
    /** Overrides the club's style (the human's game plan for auto-players). */
    styleOverride: TeamStyle | null = null;

    /** The mood this team is in, for the HUD and commentary. */
    mood(team: TeamSide): 'protect' | 'chase' | null {
        const s = this.m.state;
        const f = s.round / this.cfg.match.rounds;
        const diff = s.score[team] - s.score[(1 - team) as TeamSide];
        if (diff > 0 && f >= this.cfg.ai.protectFrom) return 'protect';
        if (diff < 0 && f >= this.cfg.ai.chaseFrom) return 'chase';
        return null;
    }

    styleFor(team: TeamSide): TeamStyle {
        return this.styleOverride ?? styleOf(this.m.state.clubs[team]);
    }

    private refresh(team: TeamSide) {
        const ai = this.cfg.ai;
        let k = addKnobs(ai, ai.styles[this.styleFor(team)].d);
        const mood = this.mood(team);
        if (mood) k = addKnobs(k, ai[mood]);
        this.k = k;
    }

    private slot(p: Piece): FormationSlot {
        const club = this.m.state.clubs[p.team];
        const f = this.cfg.formations.find((x) => x.id === club.formationId) ?? this.cfg.formations[0]!;
        return f.slots[p.slot] ?? f.slots[0]!;
    }

    private toCell(team: TeamSide, nx: number, ny: number): Cell {
        const { cols, rows } = this.cfg.pitch;
        const x = Math.round(Math.max(0, Math.min(1, nx)) * (cols - 1));
        const y = Math.round(Math.max(0, Math.min(1, ny)) * (rows - 1));
        return team === 0 ? { x, y } : { x: cols - 1 - x, y: rows - 1 - y };
    }

    /** Formation slot translated with the ball (team-relative), stretched/compressed by phase. */
    slotTarget(p: Piece): Cell {
        const cfg = this.cfg;
        const s = this.slot(p);
        const ball = this.m.ballCell();
        const bf = forward(cfg, p.team, ball);
        const byRaw = ball.y / (cfg.pitch.rows - 1);
        const by = p.team === 0 ? byRaw : 1 - byRaw;
        const carrier = this.m.carrier();
        const inPossession = carrier?.team === p.team;
        let nx = s.x + (bf - 0.35) * s.ballShift;
        const ny = s.y + (by - 0.5) * s.ballShift * 0.55;
        if (inPossession) nx += this.k.stretch * s.roleWeight;
        else if (carrier) nx -= this.k.compress;
        if (p.player.cls === 'keeper') nx = Math.min(nx, 0.06);
        return this.toCell(p.team, nx, ny);
    }

    /** Opponents closest to the carrier press; returns the ordered list of pressers. */
    private pressers(team: TeamSide, carrier: Piece): Piece[] {
        const n = forward(this.cfg, carrier.team, carrier.pos) > this.k.doublePressFrom ? 2 : 1;
        return this.m.state.pieces
            .filter((q) => q.team === team && q.player.cls !== 'keeper')
            .sort((a, b) => dist(a.pos, carrier.pos) - dist(b.pos, carrier.pos))
            .slice(0, n);
    }

    private jobTarget(p: Piece, slotT: Cell): { cell: Cell; weight: number } {
        const m = this.m;
        const cfg = this.cfg;
        const carrier = m.carrier();
        const ball = m.ballCell();
        const rw = this.slot(p).roleWeight;
        if (p.player.cls === 'keeper') {
            const gx = m.ownGoalX(p.team);
            const lineX = gx < 0 ? 1 : cfg.pitch.cols - 2;
            const [top, bottom] = goalRows(cfg);
            const y = Math.max(top - 1, Math.min(bottom + 1, Math.round((ball.y + (cfg.pitch.rows - 1) / 2) / 2)));
            const out = dist(ball, { x: lineX, y }) < 14 ? 1 : 0;
            return { cell: { x: lineX + (gx < 0 ? out : -out), y }, weight: 2 };
        }
        // Loose ball: the two nearest of each team chase it.
        if (!carrier) {
            const mates = m.state.pieces.filter((q) => q.team === p.team && q.player.cls !== 'keeper')
                .sort((a, b) => dist(a.pos, ball) - dist(b.pos, ball));
            if (mates.indexOf(p) < 2) return { cell: ball, weight: 2.5 };
            return { cell: slotT, weight: rw };
        }
        if (carrier.team === p.team) {
            // Attack: freelancers push beyond their slot towards goal.
            const dir = p.team === 0 ? 1 : -1;
            const push = Math.round(rw * 4);
            return { cell: { x: slotT.x + dir * push, y: slotT.y }, weight: rw };
        }
        // Defence: pressers close the carrier down, others mark goal-side.
        if (this.pressers(p.team, carrier).includes(p)) return { cell: carrier.pos, weight: this.k.pressWeight };
        const goalSide = p.team === 0 ? -1 : 1;
        const threats = m.opponents(p.team).filter((o) => o.player.cls !== 'keeper' && o.id !== carrier.id)
            .sort((a, b) => dist(a.pos, slotT) - dist(b.pos, slotT));
        const mark = threats[0];
        if (mark && dist(mark.pos, slotT) < 9) return { cell: { x: mark.pos.x + goalSide, y: mark.pos.y }, weight: Math.max(rw, 0.8) };
        return { cell: slotT, weight: rw };
    }

    private oppWithin(team: TeamSide, c: Cell, r: number) {
        return this.m.opponents(team).filter((o) => cheb(o.pos, c) <= r).length;
    }

    /**
     * Positional value of having the ball on `c`, in the same units as a shot
     * (goalValue × expected-threat): low in midfield, rising steeply near the box.
     */
    value(team: TeamSide, c: Cell): number {
        const cfg = this.cfg;
        const f = forward(cfg, team, c);
        const oppD = Math.min(...this.m.opponents(team).map((o) => cheb(o.pos, c)));
        const central = 1 - Math.abs(c.y - (cfg.pitch.rows - 1) / 2) / (cfg.pitch.rows / 2);
        const x = Math.max(0, (f - 0.35) / 0.65);
        const xT = 0.012 + f * this.k.xtLinear + this.k.xtPeak * Math.pow(x, 2.2) * (0.45 + 0.55 * central);
        return this.k.goalValue * xT + this.k.openValue * Math.min(oppD, 3) / 3;
    }

    /**
     * Expected cost of holding the ball on `c` as `holder` until their next turn: every
     * opponent who acts before then and can reach `c` gets an active tackle.
     */
    private exposure(holder: Piece, c: Cell) {
        const m = this.m;
        const cfg = this.cfg;
        const order = m.state.order;
        const ti = m.state.turnIndex;
        const ri = order.indexOf(holder.id);
        const before = (o: Piece) => {
            const oi = order.indexOf(o.id);
            return ri > ti ? oi > ti && oi < ri : oi !== ri;
        };
        const threats: number[] = [];
        for (const o of m.opponents(holder.team)) {
            if (!before(o) || o.player.cls === 'keeper') continue;
            const gap = cheb(o.pos, c) - 1;
            const mp = movePoints(cfg, o, 1); // assume a press-like burst
            if (gap > mp) continue;
            const reachP = gap <= mp - 2 ? 1 : 0.6;
            threats.push(tackleChance(cfg, o, holder, true) * reachP * this.k.tackleIntent);
        }
        // only the closest couple actually press; the rest hold shape
        const keep = threats.sort((a, b) => b - a).slice(0, this.k.pressersAssumed).reduce((k, t) => k * (1 - t), 1);
        const pLoss = 1 - keep;
        return pLoss * (this.value(holder.team, c) + this.lossCost(holder.team, c));
    }

    private laneOpen(from: Cell, to: Cell, team: TeamSide) {
        const path = line(from, to).slice(1, -1);
        let blocked = 0;
        for (const o of this.m.opponents(team)) if (this.m.canReact(o) && path.some((c) => cheb(c, o.pos) <= 1)) blocked++;
        return blocked === 0 ? 1 : 1 / (1 + blocked * 1.5);
    }

    /** Losing the ball on `c` hands the opponent their threat from there. */
    private lossCost(team: TeamSide, c: Cell) {
        return this.k.lossBase + this.value((1 - team) as TeamSide, c);
    }

    // ------------------------------------------------------------ move phase

    decideMove(p: Piece): MoveDecision {
        this.refresh(p.team);
        const m = this.m;
        if (m.carrier()?.id === p.id) return this.decideCarrierMove(p);
        const cfg = this.cfg;
        const slotT = this.slotTarget(p);
        const job = this.jobTarget(p, slotT);
        const rw = this.slot(p).roleWeight;
        const carrier = m.carrier();
        const attacking = carrier?.team === p.team;
        const pressing = !!carrier && !attacking && this.pressers(p.team, carrier).includes(p);
        const options: Scored<MoveDecision>[] = [];
        const consider = (ability?: MoveAbility) => {
            for (const [k, r] of m.reachable(p, ability)) {
                const c = fromKey(k);
                let v = -this.k.wSlot * (1 - Math.min(rw, 1) * 0.6) * dist(c, slotT) - this.k.wJob * job.weight * dist(c, job.cell);
                if (attacking && carrier) {
                    const oppD = Math.min(...m.opponents(p.team).map((o) => cheb(o.pos, c)));
                    v += this.k.wOpen * Math.min(oppD, 4) + this.k.wLane * 2 * this.laneOpen(carrier.pos, c, p.team);
                    v += this.k.wForward * rw * forward(cfg, p.team, c) * 10;
                }
                if (pressing && carrier && cheb(c, carrier.pos) === 1) v += this.k.pressContactBonus;
                v -= r.cost * 0.02; // tiny economy: don't wander for nothing
                if (ability) v -= this.k.abilityCost;
                options.push({ v, a: r.path.length === 1 ? { kind: 'hold' } : { kind: 'move', to: c, ability } });
            }
        };
        consider();
        for (const a of ['run', 'press', 'rush', 'sprint'] as MoveAbility[]) if (m.abilityUsable(p, a)) consider(a);
        return softmaxPick(this.rng, options, this.T * 3) ?? { kind: 'hold' };
    }

    private loseRisk(p: Piece, path: Cell[]) {
        let keep = 1;
        const seen = new Set<string>();
        for (const c of path.slice(1))
            for (const o of this.m.opponents(p.team))
                if (!seen.has(o.id) && this.m.canReact(o) && cheb(o.pos, c) <= 1) {
                    seen.add(o.id);
                    keep *= 1 - tackleChance(this.cfg, o, p, false);
                }
        return 1 - keep;
    }

    private decideCarrierMove(p: Piece): MoveDecision {
        const m = this.m;
        // Burn adjacent defenders' reactions before doing anything else.
        if (m.abilityUsable(p, 'trick')) return { kind: 'trick' };
        const kickNow = this.bestKick(p);
        const holdV = kickNow ? kickNow.v : this.value(p.team, p.pos) - this.exposure(p, p.pos);
        const options: Scored<MoveDecision>[] = [{ v: holdV, a: { kind: 'hold' } }];
        const consider = (ability?: MoveAbility) => {
            for (const [k, r] of m.reachable(p, ability)) {
                if (r.path.length === 1) continue;
                const c = fromKey(k);
                const risk = this.loseRisk(p, r.path);
                // After dribbling we can still kick; approximate by the cell's value minus exposure.
                const v = (1 - risk) * (this.value(p.team, c) - this.exposure(p, c)) - risk * this.lossCost(p.team, c) - (ability ? this.k.abilityCost : 0);
                options.push({ v, a: { kind: 'move', to: c, ability } });
            }
        };
        consider();
        if (m.abilityUsable(p, 'sprint')) consider('sprint');
        return softmaxPick(this.rng, options, this.T) ?? { kind: 'hold' };
    }

    // ------------------------------------------------------------ act phase

    private shotOptions(p: Piece, ability?: KickAbility): Scored<{ target: Cell; ability?: KickAbility }>[] {
        const cfg = this.cfg;
        const m = this.m;
        const gx = attackGoalX(cfg, p.team);
        const [top, bottom] = goalRows(cfg);
        const keeper = m.keeperOf((1 - p.team) as TeamSide);
        const out: Scored<{ target: Cell; ability?: KickAbility }>[] = [];
        for (let y = top; y <= bottom; y++) {
            const target = { x: gx, y };
            const d = dist(p.pos, target);
            if (d > this.k.shootRange) continue;
            const r = scatterRadius(cfg, p, d, 'shot', m.kickMods(ability));
            // fraction of the disc whose y lands inside the posts (sampled)
            let on = 0;
            const N = 36;
            for (let i = 0; i < N; i++) {
                const ang = (i / N) * Math.PI * 2;
                for (const rr of [0.35, 0.7, 0.95]) {
                    const ly = Math.round(y + Math.sin(ang) * rr * r);
                    if (ly >= top && ly <= bottom) on++;
                }
            }
            const pOn = on / (N * 3);
            const lineCell = { x: gx < 0 ? 0 : cfg.pitch.cols - 1, y };
            const pSave = keeper ? saveChance(cfg, keeper, p, cheb(keeper.pos, lineCell), d, m.shotSaveMod(p, ability)) : 0;
            const pBlock = ability === 'chip' ? 0 : 1 - this.laneOpen(p.pos, lineCell, p.team);
            const pGoal = pOn * (1 - pSave) * (1 - pBlock * 0.35);
            out.push({ v: pGoal * this.k.goalValue - (1 - pGoal) * 0.15, a: { target, ability } });
        }
        return out;
    }

    private passSuccess(p: Piece, to: Cell, radiusAllowance: number, lofted: boolean) {
        const cfg = this.cfg;
        const d = dist(p.pos, to);
        const r = scatterRadius(cfg, p, d, 'pass');
        const pLand = Math.min(1, (radiusAllowance * radiusAllowance) / Math.max(r * r, 0.01));
        let keep = 1;
        const path = line(p.pos, to).slice(1);
        const n = cfg.ball.loftInterceptCells;
        const seen = new Set<string>();
        path.forEach((c, i) => {
            if (lofted && i >= n && i < path.length - n) return;
            for (const o of this.m.opponents(p.team))
                if (!seen.has(o.id) && this.m.canReact(o) && cheb(o.pos, c) <= 1) {
                    seen.add(o.id);
                    keep *= 1 - interceptChance(cfg, o, p, false, 'pass');
                }
        });
        return pLand * keep;
    }

    private passOptions(p: Piece): Scored<{ target: Cell; ability?: KickAbility }>[] {
        const cfg = this.cfg;
        const m = this.m;
        const out: Scored<{ target: Cell; ability?: KickAbility }>[] = [];
        for (const q of m.mates(p)) {
            const d = dist(p.pos, q.pos);
            if (d < 2) continue;
            let pOk = this.passSuccess(p, q.pos, 1.5, d > cfg.ball.loftThreshold);
            // contested reception: an opponent next to the receiver may win the drop
            if (this.oppWithin(p.team, q.pos, 1) > 0) pOk *= this.k.contestedReceive;
            const gain = Math.max(0, forward(cfg, p.team, q.pos) - forward(cfg, p.team, p.pos)) * cfg.pitch.cols;
            const v = pOk * (this.value(p.team, q.pos) - this.exposure(q, q.pos) + this.k.directBonus * gain / 10) - (1 - pOk) * this.lossCost(p.team, p.pos);
            out.push({ v, a: { target: q.pos } });
        }
        if (m.abilityUsable(p, 'through')) {
            const dir = p.team === 0 ? 1 : -1;
            const R = cfg.abilities.through.runRadius;
            for (const q of m.mates(p)) {
                if (forward(cfg, p.team, q.pos) < 0.4) continue;
                for (const ahead of [2, 3]) for (const dy of [-1, 0, 1]) {
                    const t = { x: q.pos.x + dir * ahead, y: q.pos.y + dy };
                    if (!inPitch(cfg, t) || m.pieceAt(t)) continue;
                    if (m.opponents(p.team).some((o) => dist(o.pos, t) < dist(q.pos, t))) continue;
                    const pOk = this.passSuccess(p, t, R * 0.8, dist(p.pos, t) > cfg.ball.loftThreshold);
                    const v = pOk * (this.value(p.team, t) - this.exposure(q, t) + 0.05) - (1 - pOk) * this.lossCost(p.team, p.pos);
                    out.push({ v, a: { target: t, ability: 'through' } });
                }
            }
        }
        if (m.abilityUsable(p, 'cross')) {
            const R = cfg.abilities.cross.headRadius;
            for (const q of m.mates(p)) {
                if (!m.inOwnBox((1 - p.team) as TeamSide, q.pos)) continue;
                const att = m.mates(p).filter((a) => cheb(a.pos, q.pos) <= R).length;
                const def = this.oppWithin(p.team, q.pos, R);
                const pWin = att / (att + def + 0.5);
                const v = pWin * this.k.crossValue - (1 - pWin) * 0.2;
                out.push({ v, a: { target: q.pos, ability: 'cross' } });
            }
        }
        return out;
    }

    private kickOptions(p: Piece) {
        const m = this.m;
        const all = [...this.shotOptions(p), ...this.passOptions(p)];
        for (const a of ['placed', 'power', 'chip'] as KickAbility[]) if (m.abilityUsable(p, a)) all.push(...this.shotOptions(p, a));
        return all;
    }

    bestKick(p: Piece) {
        return this.kickOptions(p).sort((a, b) => b.v - a.v)[0];
    }

    // ---------------------------------------------------------------- substitutions

    /** One change for `team` if someone's legs have gone: like for like, or tilted by the score. */
    decideSub(team: TeamSide): { off: string; on: string } | null {
        const m = this.m;
        const cfg = this.cfg;
        if (m.subsLeft(team) <= 0 || m.state.round / cfg.match.rounds < cfg.subs.aiFrom) return null;
        const bench = m.bench(team).filter((p) => p.cls !== 'keeper');
        if (!bench.length) return null;
        const tired = m.state.pieces
            .filter((q) => q.team === team && q.player.cls !== 'keeper' && q.stamina < cfg.subs.aiBelow && m.carrier()?.id !== q.id)
            .sort((a, b) => a.stamina - b.stamina)[0];
        if (!tired) return null;
        const mood = this.mood(team);
        const want: string[] = mood === 'chase' ? ['striker', 'winger', tired.player.cls] : mood === 'protect' ? ['defender', 'midfielder', tired.player.cls] : [tired.player.cls];
        const score = (p: (typeof bench)[number]) => (want.includes(p.cls) ? 10 - want.indexOf(p.cls) * 2 : 0) + p.level * 0.3;
        const on = [...bench].sort((a, b) => score(b) - score(a))[0]!;
        return m.subBlock(team, tired.id, on.id) ? null : { off: tired.id, on: on.id };
    }

    // ---------------------------------------------------------------- set pieces

    /** One setup placement for `team`, or null when happy with the shape. */
    decidePlacement(team: TeamSide): { id: string; to: Cell } | null {
        this.refresh(team);
        const m = this.m;
        const sp = m.state.setPiece;
        if (!sp || sp.stage !== 'setup' || sp.next !== team) return null;
        const cfg = this.cfg;
        const zone = m.placeZone(team).filter((c) => !m.pieceAt(c));
        if (!zone.length) return null;
        const gx = attackGoalX(cfg, sp.team);
        const gc: Cell = { x: gx < 0 ? 0 : cfg.pitch.cols - 1, y: (cfg.pitch.rows - 1) / 2 };
        const inZone = (c: Cell) => m.placeZone(team).some((z) => z.x === c.x && z.y === c.y);
        const movable = m.state.pieces.filter((q) => m.canPlacePiece(q));
        const noise = () => this.rng() * 0.08;
        if (team === sp.team) {
            // attack: get a runner free of its marker, in a dangerous pocket
            const defenders = m.opponents(team);
            const cellV = (c: Cell, self?: Piece) => {
                const tight = defenders.filter((o) => cheb(o.pos, c) <= 1).length;
                const crowd = m.state.pieces.filter((q) => q.team === team && q.id !== self?.id && cheb(q.pos, c) <= 1).length;
                const d = dist(c, gc);
                return -0.55 * tight - 0.15 * crowd - 0.05 * d - (d < 2 ? 1 : 0);
            };
            let best: { id: string; to: Cell; gain: number } | null = null;
            for (const q of movable) {
                const now = inZone(q.pos) ? cellV(q.pos, q) : -1.4;
                for (const c of zone) {
                    const gain = cellV(c, q) - now - dist(q.pos, c) * 0.004 + noise();
                    if (!best || gain > best.gain) best = { id: q.id, to: c, gain };
                }
            }
            return best && best.gain > 0.2 ? { id: best.id, to: best.to } : null;
        }
        // defence: pick up the most dangerous unmarked attacker, goal-side
        const attackers = m.opponents(team).filter((o) => o.id !== sp.taker && inZone(o.pos));
        const marked = (o: Piece) => m.state.pieces.some((q) => q.team === team && cheb(q.pos, o.pos) <= 1);
        const threat = attackers.filter((o) => !marked(o)).sort((a, b) => dist(a.pos, gc) - dist(b.pos, gc))[0];
        if (!threat) return null;
        // anyone who isn't the only man on some attacker is free to go
        const onlyMarker = (q: Piece) => attackers.some((o) => cheb(o.pos, q.pos) <= 1
            && !m.state.pieces.some((x) => x.team === team && x.id !== q.id && cheb(x.pos, o.pos) <= 1));
        const spare = movable.filter((q) => !onlyMarker(q)).sort((a, b) => dist(a.pos, threat.pos) - dist(b.pos, threat.pos))[0];
        if (!spare) return null;
        const to = zone.filter((c) => cheb(c, threat.pos) === 1).sort((a, b) => dist(a, gc) - dist(b, gc))[0];
        return to ? { id: spare.id, to } : null;
    }

    /** The taker: whip it to the freest runner, go short, or (free kick) have a go. */
    private setPieceAct(p: Piece): ActDecision {
        const m = this.m;
        const cfg = this.cfg;
        const sp = m.state.setPiece!;
        const gx = attackGoalX(cfg, p.team);
        const [top, bottom] = goalRows(cfg);
        const gc: Cell = { x: gx < 0 ? 0 : cfg.pitch.cols - 1, y: (cfg.pitch.rows - 1) / 2 };
        const opp = m.opponents(p.team);
        const options: Scored<ActDecision>[] = [];
        for (const q of m.mates(p)) {
            if (q.player.cls === 'keeper') continue;
            const tight = opp.filter((o) => cheb(o.pos, q.pos) <= 1).length;
            if (m.inOwnBox((1 - p.team) as TeamSide, q.pos)) {
                options.push({ v: 0.62 - 0.22 * tight - 0.018 * dist(q.pos, gc) + (q.player.stats.composure - 50) * 0.004, a: { kind: 'kick', target: q.pos } });
            } else if (dist(q.pos, p.pos) <= 6 && !tight) {
                options.push({ v: 0.22, a: { kind: 'kick', target: q.pos } }); // short
            }
        }
        if (sp.kind === 'freekick') {
            const d = dist(p.pos, gc);
            if (d <= cfg.ball.maxShotRange * 0.75) {
                const target = { x: gx, y: this.rng.chance(0.5) ? top : bottom };
                options.push({ v: 0.75 - d * 0.022 + (p.player.stats.shooting - 50) * 0.006, a: { kind: 'kick', target } });
            }
        }
        if (!options.length) return this.decideAct(p, true);
        return softmaxPick(this.rng, options, this.T * 0.6) ?? options[0]!.a;
    }

    decideAct(p: Piece, plain = false): ActDecision {
        this.refresh(p.team);
        const m = this.m;
        const cfg = this.cfg;
        const c = m.carrier();
        if (!plain && c?.id === p.id && m.state.setPiece?.stage === 'take' && m.state.setPiece.taker === p.id) return this.setPieceAct(p);
        if (c?.id === p.id) {
            const keepV = this.value(p.team, p.pos) - this.exposure(p, p.pos);
            const options: Scored<ActDecision>[] = [{ v: keepV, a: { kind: 'end' } }];
            for (const k of this.kickOptions(p)) options.push({ v: k.v, a: { kind: 'kick', target: k.a.target, ability: k.a.ability } });
            return softmaxPick(this.rng, options, this.T) ?? { kind: 'end' };
        }
        const options: Scored<ActDecision>[] = [{ v: 0, a: { kind: 'end' } }];
        if (c && c.team !== p.team) {
            const danger = forward(cfg, c.team, c.pos); // how close the carrier is to our goal (0..1)
            const urgency = danger > 0.7 ? 0.12 : 0;
            if (m.canTackle(p)) {
                const ch = tackleChance(cfg, p, c, true);
                options.push({ v: ch + urgency - this.k.tackleThreshold, a: { kind: 'tackle' } });
            }
            if (m.abilityUsable(p, 'slide')) {
                const ch = tackleChance(cfg, p, c, true, cfg.abilities.slide.bonus);
                options.push({ v: ch + urgency - this.k.tackleThreshold - 0.08, a: { kind: 'slide' } });
            }
            if (m.abilityUsable(p, 'foul') && !m.inOwnBox(p.team, c.pos)) {
                // a cynical foul is worth it to stop a dangerous carrier, less so on a booking
                const v = danger - 0.62 - (p.yellows > 0 ? 0.5 : 0);
                options.push({ v, a: { kind: 'foul' } });
            }
        }
        if (m.abilityUsable(p, 'command')) {
            const threatened = c && c.team !== p.team && forward(cfg, c.team, c.pos) > 0.55;
            const spent = m.mates(p).filter((q) => cheb(q.pos, p.pos) <= cfg.abilities.command.radius && !m.canReact(q)).length;
            options.push({ v: (threatened ? 0.25 : -0.1) + spent * 0.12, a: { kind: 'command' } });
        }
        if (m.abilityUsable(p, 'mark')) {
            const threats = m.markTargets(p)
                .map((o) => ({ o, v: forward(cfg, o.team, o.pos) }))
                .sort((a, b) => b.v - a.v);
            const t = threats[0];
            if (t && t.v > 0.55) options.push({ v: (t.v - 0.55) * 0.8, a: { kind: 'mark', target: t.o.id } });
        }
        if (m.abilityUsable(p, 'tempo')) {
            const targets = m.tempoTargets(p);
            // keep an attack flowing: let the carrier go next; when defending, send a presser
            const carrierMate = targets.find((q) => q.id === c?.id);
            if (carrierMate) options.push({ v: 0.35, a: { kind: 'tempo', target: carrierMate.id } });
            else if (c && c.team !== p.team) {
                const presser = targets.sort((a, b) => dist(a.pos, c.pos) - dist(b.pos, c.pos))[0];
                if (presser && dist(presser.pos, c.pos) < 6) options.push({ v: 0.2, a: { kind: 'tempo', target: presser.id } });
            }
        }
        return softmaxPick(this.rng, options, this.T * 0.5) ?? { kind: 'end' };
    }
}
