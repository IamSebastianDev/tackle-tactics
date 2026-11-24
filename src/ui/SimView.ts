/**
 * Live simulation: the match is played for real on the engine (AI on both sides), without the
 * pitch. The play-by-play and the commentators' lines arrive in real time, with the score, the
 * clock and live stats. Fast doubles the pace; Skip plays the rest at once.
 */
import { derived, grain } from '@grainular/grains';
import { $each, $if, attr, html, mounted, on } from '@grainular/nord';
import type { MatchController, SimLine } from './controller';
import { isLightKit, kitColor } from './kits';
import type { TeamSide } from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a batch of lines stays before the next turn (ms at normal speed). */
const pause = (lines: SimLine[]) => {
    if (lines.some((l) => l.kind === 'goal')) return 1800;
    if (lines.some((l) => l.kind === 'card' || l.kind === 'period')) return 1100;
    if (lines.some((l) => l.kind === 'shot' || l.kind === 'save' || l.kind === 'foul' || l.kind === 'setpiece')) return 750;
    return 280 + lines.filter((l) => l.voice).length * 260;
};

export const SimView = (ctl: MatchController, opts: { title: string; doneLabel: string; onDone: () => void }) => {
    const m = ctl.match;
    const clubs = m.state.clubs;
    type Entry = SimLine & { id: number };
    const feed = grain<Entry[]>([]);
    const fast = grain(false);
    const finished = grain(m.state.over);
    let nextId = 0;
    /** Flags the buttons and unmount flip while the loop runs. */
    const run = { skipping: false, stopped: false };

    const push = (lines: SimLine[]) => {
        if (!lines.length) return;
        // newest first; keep the feed to a readable length
        feed.update((f) => [...lines.map((l) => ({ ...l, id: ++nextId })).toReversed(), ...f].slice(0, 160));
    };

    const loop = async () => {
        let quiet = 0;
        while (!m.state.over && !run.stopped) {
            if (run.skipping) {
                const rest: SimLine[] = [];
                while (!m.state.over) rest.push(...ctl.simTurn());
                // the last stretch of the feed, so the ending still reads
                push(rest.slice(-60));
                break;
            }
            const lines = ctl.simTurn();
            if (lines.length) {
                push(lines);
                await sleep(pause(lines) / (fast() ? 3 : 1));
            } else if (++quiet % 6 === 0) await sleep(16);
        }
        if (!run.stopped) finished.set(true);
    };
    const start = mounted<HTMLDivElement>(() => {
        void loop();
        return () => {
            run.stopped = true;
        };
    });

    const score = (t: TeamSide) => derived(ctl.tick, () => String(m.state.score[t]));
    const clock = derived(ctl.tick, () => (m.state.over ? 'Full time' : `${ctl.stats.minute()}'`));
    const progress = derived(ctl.tick, () => {
        const s = m.state;
        const done = s.over ? 1 : (s.round - 1 + s.turnIndex / Math.max(1, s.order.length)) / ctl.cfg.match.rounds;
        return `width:${(Math.min(1, done) * 100).toFixed(1)}%`;
    });
    const name = (id: string) => m.piece(id).player.name;
    const goals = derived(ctl.tick, () => ctl.stats.goals.map((g, i) => ({ ...g, i })));
    const bar = (label: string, get: (t: TeamSide) => number, fmt = (v: number) => String(v)) => {
        const v = derived(ctl.tick, () => [get(0), get(1)] as const);
        return html`<div class="rbar"><b>${derived(v, ([x]) => fmt(x))}</b><div class="rbar-track"><i class="l" ${attr({ style: derived(v, ([x, y]) => `width:${(x / Math.max(1, x + y)) * 100}%;--kit:${kitColor(clubs[0].kit)}`) })}></i><i class="r" ${attr({ style: derived(v, ([x, y]) => `width:${(y / Math.max(1, x + y)) * 100}%;--kit:${kitColor(clubs[1].kit)}`) })}></i></div><b>${derived(v, ([, y]) => fmt(y))}</b><span>${label}</span></div>`;
    };
    const team = (t: TeamSide) => ctl.stats.team(t);
    const cards = derived(ctl.tick, () =>
        m
            .everyone()
            .map((p) => ({ p, l: ctl.stats.players.get(p.id) }))
            .filter((x) => x.l && (x.l.yellows || x.l.red))
            .map((x) => ({ id: x.p.id, red: !!x.l!.red, name: x.p.player.name, team: x.p.team })),
    );

    return html`<main class="setup sim-screen" aria-label="${opts.title}" ${start}>
        <div class="sim-inner">
            <header class="sim-head">
                <span class="sim-kicker">${opts.title}</span>
                <div class="report-head">
                    <div class="rteam ${isLightKit(clubs[0].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[0].kit)}">${clubs[0].name}</div>
                    <div class="rscore">${score(0)}<span>–</span>${score(1)}</div>
                    <div class="rteam ${isLightKit(clubs[1].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[1].kit)}">${clubs[1].name}</div>
                </div>
                <div class="sim-clock"><b>${clock}</b><span class="sim-progress"><i ${attr({ style: progress })}></i></span></div>
            </header>
            <div class="sim-grid">
                <section class="opts sim-feed-wrap">
                    <ul class="sim-feed scroll">${$each(feed)
                        .$withKey((l) => l.id)
                        .$as(
                            (l) =>
                                html`<li class="sl ${l.kind} ${l.voice ? 'voice' : ''} ${l.team === null ? '' : `t${l.team}`}" style="${l.team === null ? '' : `--kit:${kitColor(clubs[l.team].kit)}`}"><b class="min">${String(l.minute)}'</b><span>${l.text}</span></li>`,
                        )}</ul>
                </section>
                <aside class="opts sim-side">
                    <h4>Goals</h4>
                    <ul class="sim-goals">${$each(goals)
                        .$withKey((g) => String(g.i))
                        .$as(
                            (g) =>
                                html`<li class="t${String(g.team)}"><b>${String(g.minute)}'</b> ${name(g.scorer)}${g.assist ? html`<em> · ${name(g.assist)}</em>` : html``}</li>`,
                        )}</ul>
                    <h4>Cards</h4>
                    <ul class="sim-goals">${$each(cards)
                        .$withKey((x) => x.id)
                        .$as(
                            (x) => html`<li class="t${String(x.team)}"><i class="cardchip ${x.red ? 'red' : 'yellow'}"></i> ${x.name}</li>`,
                        )}</ul>
                    <h4>Stats</h4>
                    <div class="rbars">
                        ${bar(
                            'Possession',
                            (t) => team(t).possession,
                            (v) => `${v}%`,
                        )}
                        ${bar('Shots', (t) => team(t).shots)}
                        ${bar('On target', (t) => team(t).onTarget)}
                        ${bar('Passes completed', (t) => team(t).passesOk)}
                        ${bar('Tackles won', (t) => team(t).tacklesWon)}
                    </div>
                </aside>
            </div>
            <footer class="sim-foot">
                <div class="seg">
                    <button ${attr({ class: derived(fast, (f) => (f ? '' : 'on')) })} ${on('click', () => fast.set(false))}>Normal</button>
                    <button ${attr({ class: derived(fast, (f) => (f ? 'on' : '')) })} ${on('click', () => fast.set(true))}>Fast</button>
                </div>
                ${$if(finished)
                    .$then(() => html`<button class="primary" autofocus ${on('click', opts.onDone)}>${opts.doneLabel} →</button>`)
                    .$else(() => html`<button class="ghost" ${on('click', () => (run.skipping = true))}>Skip to full time</button>`)}
            </footer>
        </div>
    </main>`;
};
