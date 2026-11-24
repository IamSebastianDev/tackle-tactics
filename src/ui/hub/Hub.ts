/**
 * The manager hub: a sidebar of screens over one mutable `Career`. Every mutation calls
 * `changed()`, which bumps `version` (re-rendering the active screen) and autosaves.
 */
import { combined, derived, grain } from '@grainular/grains';
import { $if, $render, attr, html, on, type Fragment } from '@grainular/nord';
import type { ClassId, GameConfig, TeamStyle } from '../../config';
import { abilitiesOf, abilityDef, allAbilities, classLabel, classLevel, passivesOf } from '../../engine/abilities';
import {
    askingPrice,
    autoLineup,
    buy,
    divisionOf,
    stadiumOf,
    resolveLetter,
    roundsPerSeason,
    salePrice,
    saveCareer,
    seasonDays,
    sell,
    squadOvr,
    table,
    today,
    trainingDay,
    userClub,
    validLineup,
    wageBill,
    type Career,
    type CareerClub,
    type Intensity,
    type SeasonCeremony,
} from '../../meta/career';
import { avgRating, moraleLabel, rivalOf, seasonLine, story } from '../../meta/story';
import { COUNTERS, isDerby, opponentOf, planEdge, prepFor, TALKS, type TeamTalk } from '../../meta/prep';
import { styleOf } from '../../ai/brain';
import { audio } from '../audio';
import { conditionsLabel, sizeLabel } from '../../world/stadium';
import { fitFor, money, ovr, playerValue, potentialStars, wage, xpToNext } from '../../meta/player';
import type { Player } from '../../types';
import { kitColor } from '../MatchView';
import { Playbook } from '../Playbook';
import { recolorVersion } from '../recolor';
import { spriteStyle } from '../sprites';
import { prefs, setPref } from '../prefs';
import { RadioChip } from '../RadioUI';

type Tab = 'overview' | 'squad' | 'tactics' | 'training' | 'league' | 'market' | 'finances' | 'playbook';
const TABS: Array<[Tab, string, string]> = [
    ['overview', 'Overview', '◈'],
    ['squad', 'Squad', '☰'],
    ['tactics', 'Tactics', '▦'],
    ['training', 'Training', '⚒'],
    ['league', 'League', '♜'],
    ['market', 'Market', '⇄'],
    ['finances', 'Finances', '¤'],
    ['playbook', 'Playbook', '✦'],
];
const CLASSES: ClassId[] = ['keeper', 'defender', 'midfielder', 'winger', 'striker'];

export type HubActions = {
    /** Start the user's fixture today (play it in the match view). */
    playMatch: () => void;
    /** Resolve today's fixture instantly. */
    simMatch: () => void;
    endSeason: () => SeasonCeremony;
    exit: () => void;
    settings: () => void;
};

export const spriteFor = (club: CareerClub, p: Player) => (p.cls === 'keeper' ? club.keeperKit : `${club.kit}_player_${p.look ?? 1}`);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

const crest = (cl: CareerClub) => html`<span class="crest" style="--kit:${kitColor(cl.kit)}">${cl.short}</span>`;

export const Hub = (cfg: GameConfig, c: Career, actions: HubActions, notice: { title: string; lines: string[] } | null = null) => {
    const version = grain(0);
    const tab = grain<Tab>('overview');
    const selected = grain<{ id: string; from: 'squad' | 'market' } | null>(null);
    const modal = grain<{ title: string; lines: string[] } | null>(notice);
    const flash = grain<string | null>(null);
    const leagueTier = grain<number>(userClub(c).tier);
    const marketFilter = grain<ClassId | 'all'>('all');
    const slotPick = grain<number | null>(null);
    const letterOpen = grain(false);
    const ceremony = grain<SeasonCeremony | null>(null);

    // palette-swapped portraits arrive asynchronously; redraw once they do
    recolorVersion.subscribe(() => version.update((v) => v + 1));

    const changed = () => {
        saveCareer(c);
        version.update((v) => v + 1);
    };
    const toast = (msg: string | null) => {
        if (!msg) return;
        flash.set(msg);
        setTimeout(() => flash.set(null), 2600);
    };

    const u = () => userClub(c);
    const club = (id: string) => c.clubs[id]!;
    const portrait = (cl: CareerClub, p: Player, size = 40) =>
        html`<span class="portrait-s" style="width:${size}px;height:${size}px"><span class="sprite still" style="${portraitStyle(cl, p, size)}"></span></span>`;
    /** Crop the sprite to head & shoulders: draw it larger than the frame and shift it up-left. */
    const portraitStyle = (cl: CareerClub, p: Player, size: number) => {
        const big = Math.round(size * 1.9);
        const frames = cfg.animFrames.idle ?? 12;
        return `${spriteStyle(cfg, spriteFor(cl, p), 'idle', 'down', p)};width:${big}px;height:${big}px;background-size:${frames * big}px ${big}px;left:${Math.round((size - big) / 2)}px;top:${Math.round(-big * 0.14)}px`;
    };
    const stars = (p: Player) =>
        html`<span class="stars" title="Potential: growth per level-up">${'★'.repeat(potentialStars(cfg, p))}<i>${'★'.repeat(5 - potentialStars(cfg, p))}</i></span>`;

    // ------------------------------------------------------------ top bar
    const todayInfo = () => {
        if (story(c).inbox) return { label: 'A letter arrives', sub: 'Read it before moving on', kind: 'letter' as const };
        const t = today(cfg, c);
        if (t.kind === 'seasonEnd') return { label: 'End season', sub: 'Promotion, relegation and awards', kind: t.kind };
        if (t.kind === 'match') {
            const f = t.fixture;
            const opp = club(f.home === u().id ? f.away : f.home);
            return { label: `Matchday ${t.round + 1}`, sub: `${f.home === u().id ? 'vs' : 'at'} ${opp.name}`, kind: t.kind };
        }
        return {
            label: 'Training day',
            sub: `${Object.keys(c.plan).length ? Math.min(Object.keys(c.plan).length, cfg.training.slots) : 0}/${cfg.training.slots} sessions planned`,
            kind: t.kind,
        };
    };

    const continueDay = () => {
        if (story(c).inbox) {
            letterOpen.set(true);
            return;
        }
        const t = today(cfg, c);
        if (t.kind === 'match') {
            validLineup(cfg, u());
            preview.set(true);
            return;
        }
        if (t.kind === 'training') {
            const before = c.news.length;
            const sessions = Math.min(cfg.training.slots, u().squad.filter((p) => c.plan[p.id]).length);
            trainingDay(cfg, c);
            changed();
            const fresh = c.news.slice(0, Math.max(0, c.news.length - before));
            toast(
                `Training: ${sessions} session${sessions === 1 ? '' : 's'} done.${
                    fresh.length
                        ? ' ' +
                          fresh
                              .map((n) => n.text)
                              .slice(0, 3)
                              .join(' · ')
                        : ''
                }`,
            );
            return;
        }
        const result = actions.endSeason();
        changed();
        audio.play(result.champion || result.promoted ? 'goal' : 'whistleEnd');
        ceremony.set(result);
    };
    const preview = grain(false);

    /** The season as a strip of day tiles: matchdays (with your result), training days, today. */
    const calendar = () => {
        const k = cfg.career.daysPerMatchday;
        const div = divisionOf(c, u().id);
        return html`<div class="calendar">${Array.from({ length: seasonDays(cfg) }, (_, i) => {
            const d = i + 1;
            const isMatch = (d - 1) % k === 0;
            let res = '';
            let tip = `Day ${d}: training`;
            if (isMatch) {
                const round = (d - 1) / k;
                const f = div.fixtures.find((x) => x.round === round && (x.home === u().id || x.away === u().id));
                tip = `Day ${d}: matchday ${round + 1}`;
                if (f) {
                    const home = f.home === u().id;
                    tip += ` ${home ? 'vs' : 'at'} ${club(home ? f.away : f.home).name}`;
                    if (f.result) {
                        const [gf, ga] = home ? f.result : [f.result[1], f.result[0]];
                        res = gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
                        tip += ` (${gf}–${ga})`;
                    }
                }
            }
            const cls = `d ${isMatch ? 'm' : ''} ${d < c.day ? 'past' : ''} ${d === c.day ? 'now' : ''} ${res}`;
            return html`<div class="${cls}" data-tip="${tip}">${isMatch ? html`<img src="assets/props/ball_classic.png" alt="" />` : html`<i>⚒</i>`}<span>${String(d)}</span></div>`;
        })}</div>`;
    };

    const moraleMeter = () => {
        const m = story(c).morale;
        const pips = Math.round(m / 10);
        return html`<div class="money morale" data-tip="Team morale ${String(m)}/100. Wins, quests and good choices lift it; it sharpens reactions and kicks a little (±10%).">
            <span>Morale</span><b>${moraleLabel(m)}</b><i class="pips">${Array.from({ length: 10 }, (_, k) => html`<em class="${k < pips ? 'on' : ''} ${m < 40 ? 'low' : m >= 70 ? 'high' : ''}"></em>`)}</i></div>`;
    };

    const topbar = derived(version, () => {
        const t = todayInfo();
        const cl = u();
        return html`<header class="hub-top">
            <div class="when"><b>Season ${String(c.season)}</b><span>Day ${String(Math.min(c.day, seasonDays(cfg)))} / ${String(seasonDays(cfg))} · Division ${String(cl.tier + 1)}${(() => {
                const r = rivalOf(c);
                return r ? ` · Rival: ${r.name}` : '';
            })()}</span></div>
            ${calendar()}
            ${moraleMeter()}
            <div class="money"><span>Budget</span><b class="${cl.budget < 0 ? 'neg' : ''}">${money(cl.budget)}</b></div>
            <div class="money"><span>Wages / matchday</span><b>${money(wageBill(cfg, cl))}</b></div>
            <button class="primary go" ${on('click', continueDay)}><span><b>${t.label}</b><small>${t.sub}</small></span><i>→</i></button>
        </header>`;
    });

    // ------------------------------------------------------------ overview
    const nextUp = () => {
        const t = today(cfg, c);
        if (t.kind === 'match') {
            const f = t.fixture;
            const h = club(f.home);
            const a = club(f.away);
            return html`<div class="card next">
                <h3>Next up · Matchday ${String(t.round + 1)} of ${String(roundsPerSeason(cfg))}</h3>
                <div class="vs">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                <p class="muted">Team strength ${squadOvr(cfg, h).toFixed(0)} vs ${squadOvr(cfg, a).toFixed(0)}</p>
            </div>`;
        }
        if (t.kind === 'training') {
            const left = cfg.career.daysPerMatchday - ((c.day - 1) % cfg.career.daysPerMatchday);
            return html`<div class="card next"><h3>Training day</h3><p>Set up to ${String(cfg.training.slots)} sessions in <a ${on('click', () => tab.set('training'))}>Training</a>, then continue. Next match in ${String(left)} day${left > 1 ? 's' : ''}.</p></div>`;
        }
        return html`<div class="card next"><h3>Season over</h3><p>Continue to settle promotion, relegation and season bonuses.</p></div>`;
    };

    const miniTable = () => {
        const d = divisionOf(c, u().id);
        const rows = table(d);
        return html`<div class="card"><h3>Division ${String(d.tier + 1)}</h3>${leagueTable(rows, d.tier, true)}</div>`;
    };

    const alerts = () => {
        const cl = u();
        const injured = cl.squad.filter((p) => p.injury);
        const items: Fragment[] = [];
        if (injured.length)
            items.push(
                html`<li class="bad">${String(injured.length)} injured: ${injured.map((p) => `${p.name} (${p.injury}d)`).join(', ')}</li>`,
            );
        if (cl.budget < 0) items.push(html`<li class="bad">You're in debt. Sell a player or win some matches.</li>`);
        if (cl.squad.length < cfg.career.squadMin + 1)
            items.push(html`<li class="bad">Thin squad (${String(cl.squad.length)}). Check the market.</li>`);
        const planned = Object.keys(c.plan).filter((id) => cl.squad.some((p) => p.id === id)).length;
        if (planned < cfg.training.slots) items.push(html`<li>${String(cfg.training.slots - planned)} training slot(s) unused.</li>`);
        if (!items.length) items.push(html`<li class="good">All good. The squad is fit.</li>`);
        return html`<div class="card"><h3>Squad status</h3><ul class="alerts">${items}</ul></div>`;
    };

    const newsFeed = () =>
        html`<div class="card news fill"><h3>News</h3><ul class="scroll">${c.news.slice(0, 14).map((n) => html`<li class="${n.tone}"><b>S${String(n.season)} D${String(n.day)}</b> ${n.text}</li>`)}</ul></div>`;

    const questsCard = () => {
        const qs = story(c).quests;
        if (!qs.length) return html``;
        const fee = cfg.career.matchFee[u().tier]!;
        return html`<div class="card quests"><h3>Season quests <small>bonus money & morale</small></h3>
            <ul>${qs.map(
                (q) => html`<li class="${q.done ? 'done' : ''}">
                <div><b>${q.done ? '✓ ' : ''}${q.title}</b><span>${q.desc}</span></div>
                <div class="qprog"><span class="xpbar"><i style="width:${String((q.progress / q.target) * 100)}%"></i></span><small>${String(q.progress)}/${String(q.target)}</small></div>
                <em>${money(Math.round(fee * q.reward))}</em>
            </li>`,
            )}</ul></div>`;
    };

    const Overview = () => html`<div class="grid-2">
        <div class="col">${nextUp()}${questsCard()}${alerts()}${newsFeed()}</div>
        <div class="col">${miniTable()}${xiCard()}${historyCard()}</div>
    </div>`;

    const xiCard = () => {
        const cl = u();
        validLineup(cfg, cl);
        const players = cl.lineup.map((id) => cl.squad.find((p) => p.id === id)!).filter(Boolean);
        return html`<div class="card fill"><h3>Your XI <small>${cl.formationId} · strength ${squadOvr(cfg, cl).toFixed(0)}</small></h3>
            <ul class="xi scroll">${players.map((p) => html`<li ${on('click', () => selected.set({ id: p.id, from: 'squad' }))}>${portrait(cl, p, 26)}<span>${p.name}</span>${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}<em>${classLabel(cfg, p)} · ${String(ovr(cfg, p))}</em></li>`)}</ul></div>`;
    };

    const historyCard = () =>
        html`<div class="card"><h3>Club history</h3>${
            c.history.length
                ? html`<ul class="hist">${c.history.map((h) => html`<li>Season ${String(h.season)}: ${ordinal(h.position)} in division ${String(h.tier + 1)}</li>`)}
            ${story(c)
                .awards.slice(-4)
                .map((a) => html`<li class="award">★ S${String(a.season)} ${a.title}: ${a.who}</li>`)}</ul>`
                : html`<p class="muted">Your first season. Top ${String(cfg.career.promote)} go up, bottom ${String(cfg.career.relegate)} go down.</p>`
        }</div>`;

    // ------------------------------------------------------------ league
    const leagueTable = (rows: ReturnType<typeof table>, tier: number, compact = false) => html`<table class="tbl league">
        <thead><tr><th>#</th><th>Club</th><th>P</th>${compact ? html`` : html`<th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th>`}<th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const cl = club(r.club);
            const zone =
                tier > 0 && i < cfg.career.promote
                    ? 'up'
                    : tier < cfg.career.divisions - 1 && i >= rows.length - cfg.career.relegate
                      ? 'down'
                      : '';
            return html`<tr class="${zone} ${r.club === u().id ? 'me' : ''}">
                <td>${String(i + 1)}</td><td class="club">${crest(cl)}${cl.name}</td><td>${String(r.p)}</td>
                ${compact ? html`` : html`<td>${String(r.w)}</td><td>${String(r.d)}</td><td>${String(r.l)}</td><td>${String(r.gf)}</td><td>${String(r.ga)}</td>`}
                <td>${String(r.gf - r.ga)}</td><td><b>${String(r.pts)}</b></td></tr>`;
        })}</tbody></table>`;

    /** The division's top scorers this season (played, simulated and invented alike). */
    const goldenBoot = (d: (typeof c.divisions)[number]) => {
        const st = story(c).seasonStats;
        const rows = d.clubs
            .flatMap((id) => club(id).squad.map((p) => ({ p, cl: club(id), l: st[p.id] })))
            .filter((x) => x.l && x.l.goals > 0)
            .sort((a, b) => b.l!.goals - a.l!.goals || b.l!.assists - a.l!.assists)
            .slice(0, 8);
        return html`<div class="card fill boot"><h3>Golden Boot <small>top scorers</small></h3>${
            rows.length
                ? html`<ol class="scroll">${rows.map((x, i) => html`<li class="${x.cl.id === u().id ? 'me' : ''}"><span class="pos">${String(i + 1)}</span>${portrait(x.cl, x.p, 24)}<b>${x.p.name}</b>${crest(x.cl)}<em>${String(x.l!.goals)} G · ${String(x.l!.assists)} A</em></li>`)}</ol>`
                : html`<p class="muted">No goals yet this season.</p>`
        }</div>`;
    };

    const League = () => {
        const tier = leagueTier();
        const d = c.divisions[tier]!;
        const rounds = Array.from({ length: roundsPerSeason(cfg) }, (_, r) => d.fixtures.filter((f) => f.round === r));
        return html`<div class="stack">
            <div class="seg">${c.divisions.map((dv) => html`<button class="${dv.tier === tier ? 'on' : ''}" ${on('click', () => leagueTier.set(dv.tier))}>Division ${String(dv.tier + 1)}${dv.tier === u().tier ? ' ★' : ''}</button>`)}</div>
            <div class="grid-2 wide-left">
                <div class="col"><div class="card">${leagueTable(table(d), tier)}<p class="muted legend-line"><i class="up"></i>Promotion <i class="down"></i>Relegation</p></div>${goldenBoot(d)}</div>
                <div class="card fixtures fill"><h3>Fixtures</h3><div class="scroll">${rounds.map(
                    (fs, r) =>
                        html`<div class="round"><h4>Matchday ${String(r + 1)}</h4>${fs.map(
                            (f) => html`<div class="fx ${f.home === u().id || f.away === u().id ? 'me' : ''}">
                    <span>${club(f.home).name}</span><b>${f.result ? `${f.result[0]} – ${f.result[1]}` : 'v'}</b><span>${club(f.away).name}</span></div>`,
                        )}</div>`,
                )}</div></div>
            </div>
        </div>`;
    };

    // ------------------------------------------------------------ squad
    const classChips = (p: Player) =>
        html`<span class="classes">${(Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1]).map(([cl, l]) => html`<span class="cls cls-${cl}">${cfg.classes[cl].short} ${String(l)}</span>`)}</span>`;

    const playerRow = (
        cl: CareerClub,
        p: Player,
        extra: Fragment,
        from: 'squad' | 'market',
    ) => html`<tr class="${p.injury ? 'injured' : ''}" ${on('click', () => selected.set({ id: p.id, from }))}>
        <td>${portrait(cl, p, 32)}</td>
        <td class="name"><b>${p.name}</b>${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}</td>
        <td>${classChips(p)}</td>
        <td class="num">${String(p.age)}</td>
        <td class="num"><b>${String(ovr(cfg, p))}</b></td>
        <td>${stars(p)}</td>
        <td class="num">${String(abilitiesOf(cfg, p).length)}</td>
        ${extra}
    </tr>`;

    const seasonCell = (p: Player) => {
        const l = seasonLine(c, p.id);
        return l && l.apps ? `${l.goals}·${l.assists}·${avgRating(l).toFixed(1)}` : '—';
    };

    const Squad = () => {
        const cl = u();
        const inXI = new Set(cl.lineup);
        const rows = [...cl.squad].sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || ovr(cfg, b) - ovr(cfg, a));
        return html`<div class="card fill">
            <h3>Squad <small>${String(cl.squad.length)} players · ${String(cfg.career.squadMin)}–${String(cfg.career.squadMax)} allowed · click a player for details</small></h3>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>Name</th><th>Classes</th><th>Age</th><th>OVR</th><th>Potential</th><th>Abilities</th><th>XI</th><th title="Season goals / assists / average rating">G·A·Avg</th><th>Value</th><th>Wage</th></tr></thead>
            <tbody>${rows.map((p) => playerRow(cl, p, html`<td>${inXI.has(p.id) ? html`<span class="pill">XI</span>` : html``}</td><td class="num">${seasonCell(p)}</td><td class="num">${money(playerValue(cfg, p))}</td><td class="num">${money(wage(cfg, p))}</td>`, 'squad'))}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ player drawer
    const xpBar = (p: Player, cl: ClassId) => {
        const need = xpToNext(cfg, p, cl);
        const have = p.xp[cl] ?? 0;
        return html`<span class="xpbar" title="${String(Math.round(have))} / ${String(need)} XP"><i style="width:${Math.min(100, (have / need) * 100)}%"></i></span>`;
    };

    const drawer = derived(combined([selected, version]), ([sel]) => {
        if (!sel) return html``;
        const fromMarket = sel.from === 'market';
        const p = (fromMarket ? c.market : u().squad).find((q) => q.id === sel.id);
        if (!p) return html``;
        const cl = u();
        const owned = abilitiesOf(cfg, p);
        const classes = (Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1]);
        const nextUnlocks = allAbilities(cfg)
            .filter((id) => classes.some(([k]) => k === abilityDef(cfg, id).cls) && !owned.includes(id))
            .sort(
                (a, b) =>
                    abilityDef(cfg, a).unlock -
                    classLevel(p, abilityDef(cfg, a).cls) -
                    (abilityDef(cfg, b).unlock - classLevel(p, abilityDef(cfg, b).cls)),
            )
            .slice(0, 3);
        const stat = (k: keyof Player['stats'], label: string) =>
            html`<div class="stat"><span>${label}</span><i style="--v:${String(Math.min(100, p.stats[k]))}%"></i><b>${String(p.stats[k])}</b></div>`;
        const act = fromMarket
            ? html`<button class="primary" ${on('click', () => {
                  const err = buy(cfg, c, p.id);
                  toast(err ?? `Signed ${p.name}!`);
                  if (!err) selected.set(null);
                  changed();
              })}>Sign for ${money(askingPrice(cfg, p))}</button>`
            : html`<button class="warn" ${on('click', () => {
                  if (!confirm(`Sell ${p.name} for ${money(salePrice(cfg, p))}?`)) return;
                  const err = sell(cfg, c, p.id);
                  toast(err ?? `Sold ${p.name}.`);
                  if (!err) selected.set(null);
                  changed();
              })}>Sell for ${money(salePrice(cfg, p))}</button>`;
        return html`<div class="drawer-wrap" ${on('click', (e) => {
            if (e.target === e.currentTarget) selected.set(null);
        })}>
            <aside class="drawer" style="--kit:${kitColor(cl.kit)}">
                <header>${portrait(cl, p, 64)}<div><h2>${p.name}</h2><p>${classLabel(cfg, p)} · age ${String(p.age)} (peaks ~${String(p.peakAge)})</p></div><button class="ghost" ${on('click', () => selected.set(null))}>✕</button></header>
                <div class="kv">
                    <div><span>Overall</span><b>${String(ovr(cfg, p))}</b></div>
                    <div><span>Potential</span><b>${stars(p)}</b></div>
                    <div><span>Talent</span><b>${p.talent.toFixed(2)}</b></div>
                    <div><span>Value</span><b>${money(playerValue(cfg, p))}</b></div>
                    <div><span>Wage</span><b>${money(wage(cfg, p))}</b></div>
                    <div><span>Status</span><b>${p.injury ? `Injured ${p.injury}d` : 'Fit'}</b></div>
                    ${(() => {
                        const l = seasonLine(c, p.id);
                        return l && l.apps
                            ? html`<div class="wide"><span>This season</span><b>${String(l.apps)} apps · ${String(l.goals)} G · ${String(l.assists)} A · avg ${avgRating(l).toFixed(1)}${l.motm ? ` · ${l.motm}× MOTM` : ''}</b></div>`
                            : html``;
                    })()}
                </div>
                <h4>Class levels</h4>
                <div class="levels">${classes.map(([k, l]) => html`<div class="lvl"><span class="cls cls-${k}">${cfg.classes[k].label}</span><b>${String(l)}</b>${xpBar(p, k)}</div>`)}</div>
                <h4>Abilities</h4>
                <div class="ab-list">${
                    owned.length
                        ? owned.map((id) => {
                              const a = abilityDef(cfg, id);
                              return html`<div class="ab"><span class="ic">${a.icon}</span><div><b>${a.label}</b><p>${a.desc}</p></div></div>`;
                          })
                        : html`<p class="muted">None yet. Abilities unlock as class levels rise.</p>`
                }
                    ${passivesOf(cfg, p).map((id) => html`<div class="ab passive"><span class="ic">◆</span><div><b>${cfg.passives[id].label}</b><p>${cfg.passives[id].desc}</p></div></div>`)}</div>
                ${
                    nextUnlocks.length
                        ? html`<h4>Next unlocks</h4><div class="ab-list">${nextUnlocks.map((id) => {
                              const a = abilityDef(cfg, id);
                              return html`<div class="ab locked"><span class="ic">${a.icon}</span><div><b>${a.label} <em>at ${cfg.classes[a.cls].short} ${String(a.unlock)} (now ${String(classLevel(p, a.cls))})</em></b><p>${a.short}</p></div></div>`;
                          })}</div>`
                        : html``
                }
                <h4>Stats</h4>
                <div class="stats">${stat('speed', 'SPD')}${stat('pace', 'PAC')}${stat('passing', 'PAS')}${stat('shooting', 'SHO')}${stat('dribbling', 'DRI')}${stat('tackling', 'TAC')}${stat('reflexes', 'REF')}${stat('composure', 'COM')}</div>
                <footer>${act}</footer>
            </aside>
        </div>`;
    });

    // ------------------------------------------------------------ tactics
    const Tactics = () => {
        const cl = u();
        validLineup(cfg, cl);
        const formation = cfg.formations.find((f) => f.id === cl.formationId) ?? cfg.formations[0]!;
        const pick = slotPick();
        const byId = (id: string) => cl.squad.find((p) => p.id === id);
        const slotEls = formation.slots.map((s, i) => {
            const p = byId(cl.lineup[i] ?? '');
            const fitCls = p ? (classLevel(p, s.cls) > 0 ? 'fit' : 'misfit') : 'empty';
            return html`<button class="slot ${fitCls} ${pick === i ? 'on' : ''}" style="left:${String(s.x * 100 * 1.9 + 3)}%;top:${String(s.y * 84 + 8)}%" ${on('click', () => slotPick.set(pick === i ? null : i))}>
                ${p ? portrait(cl, p, 36) : html``}<b>${p ? p.name.split(' ')[0]! : '—'}</b><span>${cfg.classes[s.cls].short}${p ? ` · ${ovr(cfg, p, s.cls)}` : ''}</span></button>`;
        });
        const choose = (id: string) => {
            if (pick === null) return;
            const cur = cl.lineup.indexOf(id);
            if (cur >= 0) cl.lineup[cur] = cl.lineup[pick]!; // swap
            cl.lineup[pick] = id;
            slotPick.set(null);
            changed();
        };
        const candidates =
            pick === null
                ? []
                : [...cl.squad].sort((a, b) => fitFor(cfg, b, formation.slots[pick]!.cls) - fitFor(cfg, a, formation.slots[pick]!.cls));
        return html`<div class="grid-2 wide-left">
            <div class="card fill">
                <h3>Formation <small>click a position, then pick a player · players out of position play with that class's stats but none of its abilities</small></h3>
                <div class="seg">${cfg.formations.map(
                    (f) =>
                        html`<button class="${f.id === cl.formationId ? 'on' : ''}" ${on('click', () => {
                            cl.formationId = f.id;
                            cl.lineup = autoLineup(cfg, cl);
                            changed();
                        })}>${f.label}</button>`,
                )}
                    <button class="ghost" ${on('click', () => {
                        cl.lineup = autoLineup(cfg, cl);
                        changed();
                        toast('Best XI picked.');
                    })}>Auto-pick XI</button></div>
                <div class="board">${slotEls}<div class="half"></div><div class="box"></div></div>
            </div>
            <div class="card fill">
                ${
                    pick === null
                        ? html`<h3>Bench</h3><ul class="bench">${cl.squad.filter((p) => !cl.lineup.includes(p.id)).map((p) => html`<li>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}</li>`)}</ul>`
                        : html`<h3>Pick for ${cfg.classes[formation.slots[pick]!.cls].label}</h3><ul class="bench pickable">${candidates.map((p) => html`<li class="${p.injury ? 'injured' : ''}" ${on('click', () => choose(p.id))}>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}<span class="num">${String(ovr(cfg, p, formation.slots[pick]!.cls))}</span>${cl.lineup.includes(p.id) ? html`<span class="pill">XI</span>` : html``}</li>`)}</ul>`
                }
            </div>
        </div>`;
    };

    // ------------------------------------------------------------ training
    const Training = () => {
        const cl = u();
        const planned = cl.squad.filter((p) => c.plan[p.id]).length;
        const isTraining = today(cfg, c).kind === 'training';
        const setPlan = (p: Player, cls: ClassId | 'rest', intensity?: Intensity) => {
            if (cls === 'rest') delete c.plan[p.id];
            else {
                if (!c.plan[p.id] && planned >= cfg.training.slots) {
                    toast(`Only ${cfg.training.slots} sessions per day.`);
                    changed();
                    return;
                }
                c.plan[p.id] = { cls, intensity: intensity ?? c.plan[p.id]?.intensity ?? 'light' };
            }
            changed();
        };
        const rows = [...cl.squad].sort((a, b) => (c.plan[b.id] ? 1 : 0) - (c.plan[a.id] ? 1 : 0) || ovr(cfg, b) - ovr(cfg, a));
        return html`<div class="card fill">
            <h3>Training plan <small>${String(planned)}/${String(cfg.training.slots)} sessions · runs every training day${isTraining ? ' (today!)' : ''} · unassigned players rest</small></h3>
            <p class="muted">Each session gives XP in one class. Train a class a player doesn't have yet to start multiclassing. Full intensity is about twice the XP of light. Injured players heal fastest when resting; full training can make it worse.</p>
            <div class="scroll"><table class="tbl training"><thead><tr><th></th><th>Player</th><th>Classes</th><th>Session</th><th>Intensity</th><th>Progress in class</th><th>Next unlock</th></tr></thead>
            <tbody>${rows.map((p) => {
                const s = c.plan[p.id];
                const cls = s?.cls;
                const next = cls
                    ? allAbilities(cfg)
                          .filter((id) => abilityDef(cfg, id).cls === cls && abilityDef(cfg, id).unlock > classLevel(p, cls))
                          .sort((a, b) => abilityDef(cfg, a).unlock - abilityDef(cfg, b).unlock)[0]
                    : undefined;
                return html`<tr class="${s ? 'on' : ''} ${p.injury ? 'injured' : ''}">
                    <td>${portrait(cl, p, 28)}</td>
                    <td class="name"><b>${p.name}</b>${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}</td>
                    <td>${classChips(p)}</td>
                    <td><select ${on('change', (e) => setPlan(p, (e.target as HTMLSelectElement).value as ClassId | 'rest'))}>
                        <option value="rest" ${attr({ selected: !s })}>Rest</option>
                        ${CLASSES.map((k) => html`<option value="${k}" ${attr({ selected: cls === k })}>${cfg.classes[k].label}${classLevel(p, k) ? ` (${classLevel(p, k)})` : ' (new)'}</option>`)}
                    </select></td>
                    <td>${s ? html`<div class="seg small">${(['light', 'full'] as Intensity[]).map((i) => html`<button class="${s.intensity === i ? 'on' : ''}" ${on('click', () => setPlan(p, s.cls, i))}>${i}</button>`)}</div>` : html`<span class="muted">—</span>`}</td>
                    <td>${cls ? html`<span class="prog">${cfg.classes[cls].short} ${String(classLevel(p, cls))} ${xpBar(p, cls)} <small>+${String(cfg.training.xp[s!.intensity])}/day</small></span>` : html``}</td>
                    <td>${next ? html`<span class="muted">${abilityDef(cfg, next).icon} ${abilityDef(cfg, next).label} at ${String(abilityDef(cfg, next).unlock)}</span>` : html``}</td>
                </tr>`;
            })}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ market
    const Market = () => {
        const cl = u();
        const f = marketFilter();
        const list = c.market.filter((p) => f === 'all' || p.cls === f).sort((a, b) => ovr(cfg, b) - ovr(cfg, a));
        return html`<div class="card fill">
            <h3>Transfer market <small>${String(c.market.length)} players · refreshed each season · budget ${money(cl.budget)}</small></h3>
            <div class="seg">${(['all', ...CLASSES] as Array<ClassId | 'all'>).map((k) => html`<button class="${f === k ? 'on' : ''}" ${on('click', () => marketFilter.set(k))}>${k === 'all' ? 'All' : cfg.classes[k].label}</button>`)}</div>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>Name</th><th>Classes</th><th>Age</th><th>OVR</th><th>Potential</th><th>Abilities</th><th>Price</th><th>Wage</th></tr></thead>
            <tbody>${list.map((p) => playerRow(cl, p, html`<td class="num ${askingPrice(cfg, p) > cl.budget ? 'neg' : ''}">${money(askingPrice(cfg, p))}</td><td class="num">${money(wage(cfg, p))}</td>`, 'market'))}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ finances
    const Finances = () => {
        const cl = u();
        const fee = cfg.career.matchFee[cl.tier]!;
        return html`<div class="grid-2">
            <div class="col">
                <div class="card"><h3>Overview</h3><div class="kv">
                    <div><span>Budget</span><b class="${cl.budget < 0 ? 'neg' : ''}">${money(cl.budget)}</b></div>
                    <div><span>Wage bill / matchday</span><b>${money(wageBill(cfg, cl))}</b></div>
                    <div><span>Match fee</span><b>${money(fee)}</b></div>
                    <div><span>Win bonus</span><b>${money(Math.round(fee * cfg.career.winBonus))}</b></div>
                    <div><span>Squad value</span><b>${money(cl.squad.reduce((a, p) => a + playerValue(cfg, p), 0))}</b></div>
                </div></div>
                <div class="card"><h3>Season goals</h3><ul class="alerts">
                    <li>Win the division: ${money(fee * cfg.career.goalTitle)}</li>
                    <li>Top four: ${money(fee * cfg.career.goalTop4)}</li>
                    <li>Avoid relegation: ${money(fee * cfg.career.goalSurvive)}</li>
                </ul><p class="muted">Higher divisions pay far more per match, and so do their players.</p></div>
            </div>
            <div class="card fill"><h3>Ledger</h3><div class="scroll"><table class="tbl ledger"><tbody>${c.ledger.slice(0, 60).map((l) => html`<tr><td class="muted">S${String(l.season)} D${String(l.day)}</td><td>${l.label}</td><td class="num ${l.amount < 0 ? 'neg' : 'pos'}">${money(l.amount)}</td></tr>`)}</tbody></table></div></div>
        </div>`;
    };

    // ------------------------------------------------------------ match preview
    const previewModal = derived(combined([preview, version]), ([open]) => {
        if (!open) return html``;
        const t = today(cfg, c);
        if (t.kind !== 'match') return html``;
        const h = club(t.fixture.home);
        const a = club(t.fixture.away);
        validLineup(cfg, h);
        validLineup(cfg, a);
        const prep = prepFor(cfg, c, t.fixture);
        const opp = opponentOf(c, t.fixture);
        const oppStyle = styleOf(opp);
        const derby = isDerby(c, t.fixture);
        const div = c.divisions.find((d) => d.clubs.includes(opp.id))!;
        const pos = table(div).findIndex((r) => r.club === opp.id) + 1;
        const form = div.fixtures
            .filter((x) => x.result && (x.home === opp.id || x.away === opp.id))
            .slice(-5)
            .map((x) => {
                const [gh, ga] = x.result!;
                const [f, ag] = x.home === opp.id ? [gh, ga] : [ga, gh];
                return f > ag ? 'W' : f === ag ? 'D' : 'L';
            });
        const threats = opp.lineup
            .map((id) => opp.squad.find((p) => p.id === id)!)
            .filter(Boolean)
            .sort((x, y) => ovr(cfg, y) - ovr(cfg, x))
            .slice(0, 3);
        const st = stadiumOf(c, h);
        const ref = cfg.referee.styles[prep.referee.style];
        const setPlan = (s: TeamStyle) => {
            prep.plan = s;
            changed();
        };
        const setTalk = (k: TeamTalk) => {
            prep.talk = k;
            changed();
        };
        const edgeNote = (s: TeamStyle) => {
            const e = planEdge(s, oppStyle);
            return e > 0
                ? html`<em class="pos">counters ${cfg.ai.styles[oppStyle].label}</em>`
                : e < 0
                  ? html`<em class="neg">countered by ${cfg.ai.styles[oppStyle].label}</em>`
                  : html``;
        };
        const styles = Object.keys(cfg.ai.styles) as TeamStyle[];
        return html`<div class="modal" ${on('click', (e) => {
            if (e.target === e.currentTarget) preview.set(false);
        })}>
            <div class="modal-body preview prep">
                <header><h2>Match prep · Matchday ${String(t.round + 1)}${derby ? html` <span class="derby">Derby</span>` : html``}</h2><button class="ghost" ${on('click', () => preview.set(false))}>✕</button></header>
                <div class="vs big">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                <p class="venue">${st.name} · ${sizeLabel(st.size)} · ${conditionsLabel(prep.conditions)} · Referee ${prep.referee.name} (${ref.label})</p>
                <div class="grid-2">
                    <div class="card"><h4>Scouting: ${opp.short}</h4>
                        <div class="kv">
                            <div><span>Style</span><b>${cfg.ai.styles[oppStyle].label}</b></div>
                            <div><span>Formation</span><b>${opp.formationId}</b></div>
                            <div><span>League</span><b>${pos ? `${String(pos)}${['st', 'nd', 'rd'][pos - 1] ?? 'th'}` : '–'}</b></div>
                            <div><span>Form</span><b class="form">${form.length ? form.map((r) => html`<i class="r${r}">${r}</i>`) : '–'}</b></div>
                            <div><span>Strength</span><b>${squadOvr(cfg, opp).toFixed(0)} vs your ${squadOvr(cfg, u()).toFixed(0)}</b></div>
                        </div>
                        <p class="muted">${cfg.ai.styles[oppStyle].note}${derby ? ' This is the derby: the result swings morale twice as hard.' : ''}</p>
                        <h5>Watch out for</h5><ul class="xi">${threats.map((p) => html`<li>${portrait(opp, p, 24)}<span>${p.name}</span><em>${classLabel(cfg, p)} · ${String(seasonLine(c, p.id)?.goals ?? 0)} goals</em></li>`)}</ul>
                    </div>
                    <div class="card"><h4>Your game plan</h4>
                        <div class="plan-list">${styles.map((s) => html`<button class="plan ${prep.plan === s ? 'on' : ''}" ${on('click', () => setPlan(s))}><b>${cfg.ai.styles[s].label}</b>${edgeNote(s)}<span>${cfg.ai.styles[s].note}</span></button>`)}</div>
                        <p class="muted">Your auto-managed players follow the plan. Countering their style lifts the side on the day${COUNTERS[prep.plan] ? `; ${cfg.ai.styles[prep.plan].label} beats ${cfg.ai.styles[COUNTERS[prep.plan]!].label}` : ''}.</p>
                        <h4>Team talk <small>mood: ${moraleLabel(story(c).morale)}</small></h4>
                        <div class="plan-list talks">${(Object.keys(TALKS) as TeamTalk[]).map((k) => html`<button class="plan ${prep.talk === k ? 'on' : ''}" ${on('click', () => setTalk(k))}><b>${TALKS[k].label}</b><span>${TALKS[k].note}</span></button>`)}</div>
                    </div>
                </div>
                <footer>
                    <button class="ghost" ${on('click', () => {
                        preview.set(false);
                        tab.set('tactics');
                    })}>Change lineup</button>
                    <button ${on('click', () => {
                        preview.set(false);
                        actions.simMatch();
                    })}>Quick sim</button>
                    <button class="primary" ${on('click', () => {
                        preview.set(false);
                        actions.playMatch();
                    })}>Play match →</button>
                </footer>
            </div>
        </div>`;
    });

    // ------------------------------------------------------------ letters & ceremony
    const letterModal = derived(combined([letterOpen, version]), ([open]) => {
        const l = story(c).inbox;
        if (!open || !l) return html``;
        const answer = (i: number) => {
            const out = resolveLetter(cfg, c, i);
            letterOpen.set(false);
            changed();
            audio.play('coin');
            toast(out);
        };
        return html`<div class="modal letter-modal"><div class="letter">
            <div class="seal">✉</div>
            <small>From: ${l.from}</small>
            <h2>${l.title}</h2>
            <p>${l.body.replace(/\*/g, '')}</p>
            <div class="letter-choices">${l.choices.map((ch, i) => html`<button class="${i === 0 ? 'primary' : ''}" ${on('click', () => answer(i))}><b>${ch.label}</b><small>${ch.hint}</small></button>`)}</div>
        </div></div>`;
    });

    const ceremonyModal = derived(ceremony, (r) => {
        if (!r) return html``;
        const headline = r.champion ? 'Champions!' : r.promoted ? 'Promoted!' : r.relegated ? 'Relegated' : 'Season complete';
        const trophy = r.champion ? 'cup_gold' : r.promoted ? 'cup_silver' : r.relegated ? '' : 'medal_silver';
        const icon = { cup: '♛', medal: '◆', boot: '⚑', star: '★' } as const;
        return html`<div class="modal ceremony-modal"><div class="modal-body ceremony ${r.champion || r.promoted ? 'glory' : r.relegated ? 'gloom' : ''}">
            ${r.champion || r.promoted ? html`<div class="confetti">${Array.from({ length: 40 }, (_, i) => html`<i style="left:${String((i * 37) % 100)}%;animation-delay:${String((i % 10) * 120)}ms;--c:${['#f2bf2f', '#56b4e9', '#ffffff', '#cc79a7'][i % 4]!}"></i>`)}</div>` : html``}
            <small>Season ${String(r.season)} · Division ${String(r.tier + 1)}</small>
            <h2>${headline}</h2>
            ${trophy ? html`<img class="trophy" src="assets/props/${trophy}.png" alt="" />` : html``}
            <p class="placing">Finished ${ordinal(r.position)} of ${String(cfg.career.clubsPerDivision)}</p>
            <ul class="awards">${r.awards.map((a) => html`<li><span class="aw-ic">${icon[a.icon]}</span><div><b>${a.title}</b><span>${a.who}</span><small>${a.detail}</small></div></li>`)}</ul>
            <ul class="alerts">${r.lines.map((l) => html`<li>${l}</li>`)}</ul>
            <footer><button class="primary" ${on('click', () => ceremony.set(null))}>On to season ${String(r.season + 1)} →</button></footer>
        </div></div>`;
    });

    const noticeModal = derived(modal, (m) =>
        m
            ? html`<div class="modal"><div class="modal-body notice">
        <header><h2>${m.title}</h2></header><ul class="alerts">${m.lines.map((l) => html`<li>${l}</li>`)}</ul>
        <footer><button class="primary" ${on('click', () => modal.set(null))}>Continue</button></footer></div></div>`
            : html``,
    );

    // ------------------------------------------------------------ shell
    const screen = derived(combined([version, tab, leagueTier, marketFilter, slotPick]), ([, t]) => {
        switch (t) {
            case 'squad':
                return Squad();
            case 'tactics':
                return Tactics();
            case 'training':
                return Training();
            case 'league':
                return League();
            case 'market':
                return Market();
            case 'finances':
                return Finances();
            case 'playbook':
                return html`<div class="card fill"><div class="scroll">${Playbook(cfg)}</div></div>`;
            default:
                return Overview();
        }
    });

    const sidebar = derived(combined([tab, version]), ([t]) => {
        const cl = u();
        return html`<nav class="hub-side">
            <div class="club-id" style="--kit:${kitColor(cl.kit)}"><span class="crest big">${cl.short}</span><div><b>${cl.name}</b><small>Division ${String(cl.tier + 1)}</small></div></div>
            ${TABS.map(
                ([id, label, icon]) =>
                    html`<button class="${t === id ? 'on' : ''}" ${on('click', () => {
                        tab.set(id);
                        slotPick.set(null);
                    })}><span>${icon}</span>${label}</button>`,
            )}
            <div class="spacer"></div>
            ${$render(RadioChip('hub-radio'))}
            <button class="menu-extra" ${on('click', actions.settings)}><span>⚙</span>Settings</button>
            <button class="ghost" ${on('click', actions.exit)}>Save & exit</button>
        </nav>`;
    });

    // ------------------------------------------------------------ coach tips: each screen explained once
    const HUB_TIPS: Record<string, { title: string; text: string }> = {
        overview: {
            title: 'Welcome to the club',
            text: `This is your hub. A season is ${String(seasonDays(cfg))} days: a matchday, then training days, round and round. The gold button top-right moves the calendar on, or opens match prep on a matchday. Letters land in your inbox now and then; every choice has consequences. Finish in the top two to go up a division.`,
        },
        squad: {
            title: 'Your squad',
            text: 'Players have levels in one or more classes (GK, DF, MF, WG, ST). Class levels unlock abilities; stats grow with talent and age. Peak age differs per player, so a 25-year-old may still be rising or already fading. Better players are worth more and cost more in wages.',
        },
        tactics: {
            title: 'Pick your XI',
            text: 'Choose a formation, then click a slot to pick who plays there. Out of position a player is weaker: the number is their fit for that slot. Auto-pick fills every slot with the best fit. Good players left on the bench will come and ask why.',
        },
        training: {
            title: 'Training days',
            text: `Each training day you can run ${String(cfg.training.slots)} sessions. Pick a player and a class: the XP goes into that class, and training a new class makes a multi-class player. Full sessions give more XP; light ones are kinder to injured players. You can't train everyone, so choose.`,
        },
        league: {
            title: 'The league',
            text: 'Ten clubs, everyone plays everyone once: 3 points for a win, 1 for a draw. The top two go up, the bottom two go down. Your rival is named in the top bar, and derbies swing morale twice as hard.',
        },
        market: {
            title: 'Transfers',
            text: 'A fresh crop of players arrives every season. Buy young, train them up, and sell at a profit, or keep them. Mind the wages: the fee is paid once, wages every matchday.',
        },
        finances: {
            title: 'Money',
            text: 'Income comes from match fees, win bonuses, season goals (survival, top four, the title) and player sales. Wages go out every matchday. Run dry and the market closes to you.',
        },
        playbook: {
            title: 'The playbook',
            text: 'Every class and ability in one place. Abilities unlock at class levels; passives are always on.',
        },
        prep: {
            title: 'Match prep',
            text: 'Read the opponent first: their style, form and danger men. Pick a game plan; your auto-managed players follow it, and countering their style lifts your side on the day. Then a team talk, and play it on the board or quick-sim it.',
        },
    };
    const hubTip = derived(combined([tab, preview, prefs, version]), ([t, open, p]) => {
        const id = open ? 'prep' : t;
        const tip = HUB_TIPS[id];
        if (!p.tips || !tip || p.tipsSeen.includes(`hub-${id}`)) return html``;
        const done = (forever: boolean) => {
            setPref('tipsSeen', [...prefs().tipsSeen, `hub-${id}`]);
            if (forever) setPref('tips', false);
        };
        const size = 96;
        const frames = cfg.animFrames.shout ?? 12;
        return html`<div class="tip hub-tip ${open ? 'over-modal' : ''}">
            <div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:${String(size)}px;height:${String(size)}px;background-size:${String(frames * size)}px ${String(size)}px;--strip:${String(frames * size)}px"></div></div>
            <div class="tip-body"><small>Coach Marlow</small><h3>${tip.title}</h3><p>${tip.text}</p>
                <div class="tip-actions"><button class="ghost" ${on('click', () => done(true))}>No more tips</button><button class="primary" ${on('click', () => done(false))}>Got it</button></div></div>
        </div>`;
    });

    return html`<div class="hub">
        ${$render(sidebar)}
        <main class="hub-main">${$render(topbar)}<section class="hub-content">${$render(screen)}</section></main>
        ${$render(drawer)}${$render(previewModal)}${$render(noticeModal)}${$render(letterModal)}${$render(ceremonyModal)}${$render(hubTip)}
        ${$if(derived(flash, (f) => !!f)).$then(() => html`<div class="toast">${derived(flash, (f) => f ?? '')}</div>`)}
    </div>`;
};
