/** Headless AI-vs-AI match runner, used by tests and for tuning. */
import { applyAct, applyMove, Brain } from './ai/brain';
import type { Difficulty, GameConfig, TeamStyle } from './config';
import { Match } from './engine/match';
import { MatchStats } from './engine/stats';
import { createRng } from './rng';
import { generateClub } from './world/generate';

export type SimStats = {
    score: [number, number]; actions: number; passes: number; completed: number; shots: number; goals: number;
    tackles: number; tacklesWon: number; intercepts: number; turnovers: number; abilities: Record<string, number>;
    cards: number; reds: number; subs: number; fouls: number; corners: number; freeKicks: number; avgSpell: number; ownHalfTurnovers: number;
};

export const simulate = (cfg: GameConfig, seed: number, difficulty: Difficulty = 'normal', formations: [string, string] = ['4-3-3', '4-4-2'], styles?: [TeamStyle, TeamStyle]) => {
    const rng = createRng(seed);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', formations[0], names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', formations[1], names);
    if (styles) { a.style = styles[0]; b.style = styles[1]; }
    const m = new Match(cfg, [a, b], seed);
    const brains = [new Brain(m, createRng(seed + 1), difficulty), new Brain(m, createRng(seed + 2), difficulty)];
    const st: SimStats = {
        score: [0, 0], actions: 0, passes: 0, completed: 0, shots: 0, goals: 0, tackles: 0, tacklesWon: 0, intercepts: 0,
        turnovers: 0, abilities: {}, cards: 0, reds: 0, subs: 0, fouls: 0, corners: 0, freeKicks: 0, avgSpell: 0, ownHalfTurnovers: 0,
    };
    const stats = new MatchStats(m);
    let owner = m.carrier()?.team;
    let spellStart = 0;
    const spells: number[] = [];
    const track = () => {
        const now = m.carrier()?.team;
        if (now !== undefined && now !== owner) {
            if (owner !== undefined) {
                st.turnovers++;
                spells.push(st.actions - spellStart);
                const c = m.carrier()!;
                // turnover in the losing side's own half
                const half = (cfg.pitch.cols - 1) / 2;
                if ((owner === 0 && c.pos.x < half) || (owner === 1 && c.pos.x > half)) st.ownHalfTurnovers++;
            }
            owner = now;
            spellStart = st.actions;
        }
    };
    while (!m.state.over && st.actions < 6000) {
        const p = m.active();
        const brain = brains[p.team]!;
        stats.onTurn();
        const events = [];
        for (let guard = 0; guard < 3 && m.state.phase === 'move'; guard++) {
            const mv = brain.decideMove(p);
            const ev = applyMove(m, mv);
            if (mv.kind === 'move' && ev.length === 0) throw new Error(`illegal AI move ${JSON.stringify(mv)}`);
            events.push(...ev);
            if (mv.kind !== 'trick') break;
        }
        if (m.state.phase === 'move') m.hold();
        if (m.state.phase === 'act' && m.state.pieces.includes(p)) events.push(...applyAct(m, brain.decideAct(p)));
        stats.observe(events);
        for (const e of events) {
            if (e.t === 'kick') {
                if (e.kind === 'pass') st.passes++;
                else st.shots++;
            }
            if (e.t === 'receive') {
                const r = m.piece(e.by);
                const k = events.find((x) => x.t === 'kick');
                if (k && k.t === 'kick' && m.piece(k.by).team === r.team) st.completed++;
            }
            if (e.t === 'tackle') { st.tackles++; if (e.success) st.tacklesWon++; }
            if (e.t === 'intercept' && e.success) st.intercepts++;
            if (e.t === 'ability') st.abilities[e.ability] = (st.abilities[e.ability] ?? 0) + 1;
            if (e.t === 'move' && e.ability) st.abilities[e.ability] = (st.abilities[e.ability] ?? 0) + 1;
            if (e.t === 'foul') st.fouls++;
            if (e.t === 'setpiece') { if (e.kind === 'corner') st.corners++; else st.freeKicks++; }
            if (e.t === 'card') { st.cards++; if (e.card === 'red') st.reds++; }
            if (e.t === 'goal') { st.goals++; m.restartAfterGoal(e.team); }
        }
        track();
        for (let guard = 0; guard < 12 && m.state.setPiece?.stage === 'setup'; guard++) {
            const t = m.state.setPiece.next;
            const d = brains[t]!.decidePlacement(t);
            if (d) m.place(d.id, d.to);
            else m.passPlacement(t);
        }
        m.state.phase = 'done';
        const round = m.state.round;
        m.nextTurn();
        if (m.state.round !== round) for (const t of [0, 1] as const) {
            const d = brains[t]!.decideSub(t);
            if (d) { const ev = m.substitute(t, d.off, d.on); stats.observe(ev); st.subs += ev.length; }
        }
        st.actions++;
        track();
    }
    st.score = [...m.state.score] as [number, number];
    st.avgSpell = spells.length ? +(spells.reduce((x, y) => x + y, 0) / spells.length).toFixed(1) : st.actions;
    return { m, st, stats };
};
