/**
 * The manager hub: a sidebar of screens over one mutable `Career`. Every mutation calls
 * `changed()`, which publishes the new version of the model and autosaves.
 */
import { combined, derived, grain, type WritableGrain } from '@grainular/grains';
import { NATION_IDS, NATIONS, nationOf, type NationId } from '../../world/nations';
import { flag } from '../flag';
import type { Confirm } from '../confirm';
import { $each, $if, $render, $switch, attr, html, mounted, on, type Fragment } from '@grainular/nord';
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
    scheduledFixture,
    seasonDays,
    seasonSchedule,
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
    type Fixture,
    type SeasonCeremony,
} from '../../meta/career';
import { CUP_NAME, cupWinner, isCupFixture, penaltyScore } from '../../meta/cup';
import { avgRating, moraleLabel, rivalOf, seasonLine, story } from '../../meta/story';
import { COUNTERS, isDerby, opponentOf, planEdge, prepFor, TALKS, type TeamTalk } from '../../meta/prep';
import { styleOf } from '../../ai/brain';
import { audio } from '../audio';
import { conditionsLabel, sizeLabel } from '../../world/stadium';
import { fitFor, money, ovr, playerValue, potentialStars, wage, xpToNext } from '../../meta/player';
import { TRAINING_FOCUSES, TRAINING_FOCUS_IDS, trainingGain } from '../../meta/training';
import type { Player } from '../../types';
import { kitColor } from '../MatchView';
import { Playbook } from '../Playbook';
import { recolorVersion } from '../recolor';
import { spriteStyle } from '../sprites';
import { prefs, setPref } from '../prefs';
import { RadioPlayer } from '../RadioUI';
import { Dialog } from '../Dialog';

type Tab = 'overview' | 'season' | 'squad' | 'tactics' | 'training' | 'league' | 'cup' | 'market' | 'finances' | 'playbook';
const TABS: Array<[Tab, string, string]> = [
    ['overview', 'Overview', '◈'],
    ['season', 'Season Plan', '▤'],
    ['squad', 'Squad', '☰'],
    ['tactics', 'Tactics', '▦'],
    ['training', 'Training', '⚒'],
    ['league', 'League', '♜'],
    ['cup', 'Cup', '♛'],
    ['market', 'Market', '⇄'],
    ['finances', 'Finances', '¤'],
    ['playbook', 'Playbook', '✦'],
];
const CLASSES: ClassId[] = ['keeper', 'defender', 'midfielder', 'winger', 'striker'];

export type HubNotice = { title: string; lines: string[] };

const PLAYER_DEVELOPMENT: HubNotice = {
    title: 'Player development',
    lines: [
        'Overall (OVR) measures current ability. It combines class levels with the stats that matter most to each class. Reflexes count more for a keeper, while shooting counts more for a striker. Class levels also unlock abilities.',
        'Potential stars show growth per level-up. Higher potential usually means more stat points, and the class that levels up influences which stats improve.',
        'Age affects stats at the end of each season. Players tend to improve before their personal peak age, hold steady around it, and decline after it. Veterans can still improve through level-ups during the season.',
        'Transfer value factors in current OVR, potential, and age relative to peak. A young prospect can cost more than a veteran with the same OVR. Higher value generally means higher wages.',
    ],
};

export type HubActions = {
    confirm: Confirm;
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

export const Hub = (cfg: GameConfig, c: Career, actions: HubActions, modal: WritableGrain<HubNotice | null>) => {
    const version = grain(0);
    const tab = grain<Tab>('overview');
    const selected = grain<{ id: string; from: 'squad' | 'market' } | null>(null);
    const flash = grain<string | null>(null);
    const leagueTier = grain<number>(userClub(c).tier);
    const planDay = grain<number | null>(null);
    const marketFilter = grain<ClassId | 'all'>('all');
    const marketNation = grain<NationId | 'all'>('all');
    const slotPick = grain<number | null>(null);
    const letterOpen = grain(false);
    const ceremony = grain<SeasonCeremony | null>(null);

    const read = <T>(value: () => T) => derived(version, value);
    const modelRegion = (view: () => Fragment) => $render(read(view));
    let toastTimer: ReturnType<typeof setTimeout>;
    const clearToast = mounted(() => () => clearTimeout(toastTimer));

    const changed = () => {
        saveCareer(c);
        version.update((v) => v + 1);
    };
    const toast = (msg: string | null) => {
        if (!msg) return;
        flash.set(msg);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => flash.set(null), 2600);
    };

    const u = () => userClub(c);
    const club = (id: string) => c.clubs[id]!;
    const clubResult = (f: Fixture) => {
        if (!f.result) return null;
        const isHome = f.home === c.userClubId;
        const [gf, ga] = isHome ? f.result : [f.result[1], f.result[0]];
        const winner = isCupFixture(f) ? cupWinner(f) : undefined;
        const outcome = winner ? (winner === c.userClubId ? 'win' : 'loss') : gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
        return { gf, ga, outcome, pens: penaltyScore(f, isHome ? 0 : 1) };
    };
    const portrait = (cl: CareerClub, p: Player, size = 40) => {
        const style = derived(recolorVersion, () => portraitStyle(cl, p, size));
        return html`<span class="portrait-s" style="width:${size}px;height:${size}px"><span class="sprite still" ${attr({ style })}></span></span>`;
    };
    /** Crop the sprite to head & shoulders: draw it larger than the frame and shift it up-left. */
    const portraitStyle = (cl: CareerClub, p: Player, size: number) => {
        const big = Math.round(size * 1.9);
        const frames = cfg.animFrames.idle ?? 12;
        return `${spriteStyle(cfg, spriteFor(cl, p), 'idle', 'down', p)};width:${big}px;height:${big}px;background-size:${frames * big}px ${big}px;left:${Math.round((size - big) / 2)}px;top:${Math.round(-big * 0.14)}px`;
    };
    const stars = (p: Player) => {
        const rating = potentialStars(cfg, p);
        const label = `Potential ${rating} out of 5 · growth per level-up`;
        return html`<span class="stars" role="img" aria-label="${label}" title="${label}">${'★'.repeat(rating)}<i>${'★'.repeat(5 - rating)}</i></span>`;
    };

    // ------------------------------------------------------------ top bar
    const todayInfo = () => {
        if (story(c).inbox) return { label: 'A letter arrives', sub: 'Read it before moving on', kind: 'letter' as const };
        const t = today(cfg, c);
        if (t.kind === 'seasonEnd') return { label: 'End season', sub: 'Promotion, relegation and awards', kind: t.kind };
        if (t.kind === 'match') {
            const f = t.fixture;
            const opp = club(f.home === u().id ? f.away : f.home);
            const label = t.cup ? `Cup · ${t.cup.label}` : `Matchday ${t.round + 1}`;
            return { label, sub: `${f.home === u().id ? 'vs' : 'at'} ${opp.name}`, kind: t.kind };
        }
        return {
            label: t.cup ? 'Cup day · Training' : 'Training day',
            sub: TRAINING_FOCUSES[c.trainingFocus].label,
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
            const report = trainingDay(cfg, c);
            if (!report) return;
            changed();
            toast([report.summary, ...report.updates.slice(0, 3)].join(' '));
            return;
        }
        const result = actions.endSeason();
        changed();
        audio.play(result.champion || result.promoted ? 'goal' : 'whistleEnd');
        ceremony.set(result);
    };
    const preview = grain(false);

    const todayAction = read(todayInfo);
    const topbar = html`<header class="hub-top">
        <div class="when"><b>Season ${read(() => String(c.season))}</b><span>${read(() => {
            const days = seasonDays(cfg, c);
            return c.day > days ? 'Season review' : `Day ${c.day} of ${days}`;
        })}</span></div>
        ${RadioPlayer()}
        <button class="primary go" ${on('click', continueDay)}><span><b>${derived(todayAction, (t) => t.label)}</b><small>${derived(todayAction, (t) => t.sub)}</small></span><i>→</i></button>
    </header>`;

    // ------------------------------------------------------------ overview
    const nextUp = () => {
        const t = today(cfg, c);
        if (t.kind === 'match') {
            const f = t.fixture;
            const h = club(f.home);
            const a = club(f.away);
            const label = t.cup ? `${CUP_NAME} · ${t.cup.label}` : `Matchday ${t.round + 1} of ${roundsPerSeason(c)}`;
            return html`<div class="card next">
                <h3>Next up · ${label}</h3>
                <div class="vs">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                <p class="muted">Team strength ${squadOvr(cfg, h).toFixed(0)} vs ${squadOvr(cfg, a).toFixed(0)}</p>
            </div>`;
        }
        if (t.kind === 'training') {
            const next = seasonSchedule(cfg, c).find((date) => date.day > c.day && scheduledFixture(c, date));
            const note = t.cup ? `${CUP_NAME} ${t.cup.label.toLowerCase()} today. Your squad trains.` : '';
            return html`<div class="card next"><h3>Training day · ${TRAINING_FOCUSES[c.trainingFocus].label}</h3>
                ${note ? html`<p>${note}</p>` : html``}
                <p>${next ? `Next match on Day ${next.day}.` : 'Season review follows the last training day.'}</p>
                <button class="ghost" ${on('click', () => tab.set('training'))}>View training</button>
            </div>`;
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
        if (!items.length) items.push(html`<li class="good">All good. The squad is fit.</li>`);
        const morale = story(c).morale;
        return html`<div class="card"><h3>Squad status <small title="Team morale ${String(morale)}/100">${moraleLabel(morale)} morale</small></h3><ul class="alerts">${items}</ul></div>`;
    };

    const NewsFeed = () => html`<div class="card news fill"><h3>News</h3><ul class="scroll">
        ${$each(read(() => c.news.slice(0, 14))).$as((n) => html`<li class="${n.tone}"><b>S${String(n.season)} D${String(n.day)}</b> ${n.text}</li>`)}
    </ul></div>`;

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
        <div class="col">${modelRegion(nextUp)}${modelRegion(questsCard)}${modelRegion(alerts)}${NewsFeed()}</div>
        <div class="col">${modelRegion(miniTable)}${modelRegion(xiCard)}${modelRegion(historyCard)}</div>
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

    // ------------------------------------------------------------ season plan
    const calendar = read(() => {
        const lastDay = seasonDays(cfg, c) + 1;
        const rival = rivalOf(c);
        const inbox = story(c).inbox;
        const dates = new Map(seasonSchedule(cfg, c).map((date) => [date.day, date]));
        const news = c.news.filter((item) => item.season === c.season);
        const days = Array.from({ length: lastDay }, (_, i) => {
            const day = i + 1;
            const date = dates.get(day);
            const fixture = date && scheduledFixture(c, date);
            const home = fixture?.home === c.userClubId;
            const opponent = fixture ? club(home ? fixture.away : fixture.home) : null;
            const result = fixture && clubResult(fixture);
            const cup = date?.cup;
            const kind = cup ? 'cup' : fixture ? 'match' : day === lastDay ? 'review' : 'training';
            return {
                day,
                kind,
                trains: kind === 'training' || (!!cup?.fixtures.length && !fixture),
                title: cup
                    ? `Cup · ${cup.label}`
                    : fixture
                      ? `Matchday ${fixture.round + 1}`
                      : kind === 'review'
                        ? 'Season review'
                        : 'Training',
                match: opponent ? `${home ? 'vs' : 'at'} ${opponent.name}` : '',
                cupNote:
                    cup && !fixture
                        ? !cup.fixtures.length
                            ? 'Draw pending'
                            : cup.byes.includes(u().id)
                              ? 'Bye · squad training'
                              : 'Squad training'
                        : '',
                derby: !!opponent && opponent.id === rival?.id,
                score: result ? `${result.gf}–${result.ga} ${result.outcome}${result.pens ? ` (${result.pens})` : ''}` : '',
                tone: result?.outcome === 'win' ? 'pos' : result?.outcome === 'loss' ? 'neg' : '',
                letter: day === (inbox?.trainingDay ?? c.day) ? inbox : null,
                news: news.filter((item) => item.day === day),
            };
        });
        return { days, rival, season: c.season, today: c.day };
    });
    const SeasonPlan = () => {
        const selectedDay = derived(combined([planDay, calendar]), ([day, cal]) => Math.min(day ?? cal.today, cal.days.length));
        const pageSize = 30;
        const page = derived(selectedDay, (day) => Math.floor((day - 1) / pageSize));
        const visibleDays = derived(combined([page, calendar]), ([index, cal]) =>
            cal.days.slice(index * pageSize, (index + 1) * pageSize).map((day) => day.day),
        );
        const pages = derived(calendar, (cal) => Array.from({ length: Math.ceil(cal.days.length / pageSize) }, (_, i) => i));
        const details = derived(combined([selectedDay, calendar]), ([day, cal]) => {
            const item = cal.days[day - 1]!;
            const { title, match, score, tone, letter } = item;
            return html`<section class="season-day-details" aria-live="polite">
                <h4>Day ${String(day)} · ${title}${item.derby ? ' · Derby' : ''}</h4>
                ${match ? html`<p>${match}${score ? html` <strong class="${tone}">${score}</strong>` : html``}</p>` : html``}
                ${item.cupNote ? html`<p>${item.cupNote}</p>` : html``}
                ${item.kind === 'cup' ? html`<p><button class="ghost" ${on('click', () => tab.set('cup'))}>View cup</button></p>` : html``}
                ${item.kind === 'review' ? html`<p>Promotion, relegation and awards</p>` : html``}
                ${item.trains && day === cal.today ? html`<p>Squad focus · ${TRAINING_FOCUSES[c.trainingFocus].label}</p>` : html``}
                ${item.trains && day < cal.today && !item.news.length ? html`<p class="muted">Training completed</p>` : html``}
                ${letter ? html`<p><button class="ghost" ${on('click', () => letterOpen.set(true))}>Read letter</button> ${letter.title} · ${letter.from}</p>` : html``}
                ${item.news.length ? html`<ul class="alerts">${item.news.map((event) => html`<li class="${event.tone}">${event.text}</li>`)}</ul>` : html``}
            </section>`;
        });
        return html`<div class="card fill season-calendar">
            <h3>Season ${derived(calendar, (info) => String(info.season))} calendar <small ${attr({ hidden: derived(calendar, (info) => !info.rival) })}>${derived(calendar, (info) => (info.rival ? `Rival · ${info.rival.name}` : ''))}</small></h3>
            <div class="seg" role="group" aria-label="Calendar dates">
                ${$each(pages)
                    .$withKey((index) => index)
                    .$as((index) => {
                        const active = derived(page, (i) => i === index);
                        const first = index * pageSize + 1;
                        const last = derived(calendar, (cal) => Math.min(first + pageSize - 1, cal.days.length));
                        return html`<button ${attr({ class: derived(active, (value) => (value ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                        ${on('click', () => planDay.set(c.day >= first && c.day <= last() ? null : first))}>Days ${String(first)}–${derived(last, String)}</button>`;
                    })}
                <button ${on('click', () => planDay.set(null))}>Today</button>
            </div>
            <div class="calendar-layout">
                <div class="scroll"><div class="season-calendar-grid" aria-label="Season days">
                    ${$each(visibleDays)
                        .$withKey((day) => day)
                        .$as((day) => {
                            const entry = derived(calendar, (info) => info.days[day - 1]!);
                            const current = derived(calendar, (info) => day === info.today);
                            const content = derived(
                                entry,
                                ({ title, match, cupNote, score, tone, derby, letter, news }) => html`
                            <b>${title}${derby ? ' · Derby' : ''}</b>
                            ${match || cupNote ? html`<span class="season-opponent">${match || cupNote}</span>` : html``}
                            ${score ? html`<strong class="${tone}">${score}</strong>` : html``}
                            ${letter ? html`<small class="season-event">✉ ${letter.title}</small>` : html``}
                            ${news.length ? html`<small class="season-event">${news.length === 1 ? news[0]!.text : `${news.length} club updates`}</small>` : html``}
                        `,
                            );
                            return html`<button type="button" ${attr({
                                class: derived(calendar, (info) => `season-day ${day < info.today ? 'past' : ''}`),
                                'data-kind': derived(entry, (item) => item?.kind),
                                'aria-pressed': derived(selectedDay, (date) => String(date === day)),
                                'aria-current': derived(current, (isToday) => (isToday ? 'date' : undefined)),
                            })} ${on('click', () => planDay.set(day))}>
                            <span class="season-day-heading">Day ${String(day)}${$if(current).$then(() => html`<small>Today</small>`)}</span>
                            ${$render(content)}
                        </button>`;
                        })}
                </div></div>
                <div class="scroll">${$render(details)}</div>
            </div>
        </div>`;
    };

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
        const entries = derived(combined([leagueTier, version]), ([tier]) => {
            const d = c.divisions[tier]!;
            const rounds = Array.from({ length: roundsPerSeason(c) }, (_, r) => d.fixtures.filter((f) => f.round === r));
            return html`            <div class="grid-2 wide-left">
                <div class="col"><div class="card">${leagueTable(table(d), tier)}<p class="muted legend-line"><i class="up"></i>Promotion <i class="down"></i>Relegation</p></div>${goldenBoot(d)}</div>
                <div class="card fixtures fill"><h3>Fixtures</h3><div class="scroll">${rounds.map(
                    (fs, r) =>
                        html`<div class="round"><h4>Matchday ${String(r + 1)}</h4>${fs.map(
                            (f) => html`<div class="fx ${f.home === u().id || f.away === u().id ? 'me' : ''}">
                    <span>${club(f.home).name}</span><b>${f.result ? `${f.result[0]} – ${f.result[1]}` : 'v'}</b><span>${club(f.away).name}</span></div>`,
                        )}</div>`,
                )}</div></div>
            </div>`;
        });
        return html`<div class="stack">
            <div class="seg">${c.divisions.map((division) => {
                const active = derived(leagueTier, (tier) => tier === division.tier);
                return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => leagueTier.set(division.tier))}>Division ${String(division.tier + 1)}${read(() => (division.tier === u().tier ? ' ★' : ''))}</button>`;
            })}</div>
            ${$render(entries)}
        </div>`;
    };

    const Cup = () => {
        const selectedRound = grain<number | null>(null);
        const info = read(() => c.cup);
        const rounds = derived(info, (cup) => cup?.rounds ?? []);
        const activeRound = derived(combined([selectedRound, rounds]), ([picked, dates]) => {
            const scheduled = dates.findIndex((date) => date.day >= c.day);
            return picked ?? (scheduled < 0 ? dates.length - 1 : scheduled);
        });
        const roundView = derived(combined([activeRound, rounds]), ([index, dates]) => {
            const round = dates[index];
            if (!round) return html`<p class="muted">The cup begins next season.</p>`;
            return html`<h4>${round.label} · Day ${String(round.day)}</h4>
                ${
                    round.fixtures.length
                        ? html`<table class="tbl cup-fixtures">
                    <thead><tr><th>Home</th><th>Result</th><th>Away</th></tr></thead>
                    <tbody>${round.fixtures.map((fixture) => {
                        const home = club(fixture.home);
                        const away = club(fixture.away);
                        const winner = cupWinner(fixture);
                        return html`<tr class="${home.id === c.userClubId || away.id === c.userClubId ? 'me' : ''}">
                            <td class="${winner === home.id ? 'cup-winner' : ''}">${crest(home)} ${home.name} <small>Div ${String(home.tier + 1)}</small></td>
                            <td>${fixture.result ? `${fixture.result[0]}–${fixture.result[1]}` : 'vs'} <small>${penaltyScore(fixture)}</small></td>
                            <td class="${winner === away.id ? 'cup-winner' : ''}">${crest(away)} ${away.name} <small>Div ${String(away.tier + 1)}</small></td>
                        </tr>`;
                    })}</tbody>
                </table>`
                        : html`<p class="muted">The draw follows the previous round.</p>`
                }
                ${round.byes.length ? html`<h4>Byes to the next round</h4><p>${round.byes.map((id) => club(id).name).join(' · ')}</p>` : html``}`;
        });
        return html`<div class="card fill">
            <h3>${CUP_NAME} <small>${derived(info, (cup) => (cup?.champion ? `${club(cup.champion).name} won the cup` : 'Single-match knockout · all five divisions'))}</small></h3>
            <div class="seg" role="group" aria-label="Cup rounds">
                ${$each(derived(rounds, (dates) => dates.map((_, i) => i)))
                    .$withKey((index) => index)
                    .$as((index) => {
                        const active = derived(activeRound, (value) => value === index);
                        return html`<button ${attr({ class: derived(active, (value) => (value ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                        ${on('click', () => selectedRound.set(index))}>${derived(rounds, (dates) => dates[index]?.label ?? '')}</button>`;
                    })}
            </div>
            <div class="scroll">${$render(roundView)}</div>
        </div>`;
    };

    // ------------------------------------------------------------ squad
    const classChips = (p: Player) =>
        html`<span class="classes">${(Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1]).map(([cl, l]) => html`<span class="cls cls-${cl}">${cfg.classes[cl].short} ${String(l)}</span>`)}</span>`;

    const playerRow = (p: Player, extra: Fragment, from: 'squad' | 'market') => {
        const injury = read(() => p.injury);
        const injuryLabel = derived(injury, (days) => (days ? `✚ ${days}d` : ''));
        return html`<tr ${attr({ class: derived(injury, (days) => (days ? 'injured' : '')) })} ${on('click', () => selected.set({ id: p.id, from }))}>
            <td>${portrait(u(), p, 32)}</td>
            <td class="name">${flag(p.nation)}<b>${p.name}</b>${$if(derived(injury, Boolean)).$then(() => html`<em class="inj">${injuryLabel}</em>`)}</td>
            <td>${modelRegion(() => classChips(p))}</td>
            <td class="num">${read(() => String(p.age))}</td>
            <td class="num"><b>${read(() => String(ovr(cfg, p)))}</b></td>
            <td>${modelRegion(() => stars(p))}</td>
            <td class="num">${read(() => String(abilitiesOf(cfg, p).length))}</td>
            ${extra}
        </tr>`;
    };

    const seasonCell = (p: Player) => {
        const l = seasonLine(c, p.id);
        return l && l.apps ? `${l.goals}·${l.assists}·${avgRating(l).toFixed(1)}` : '—';
    };

    const Squad = () => {
        const rows = read(() =>
            [...u().squad].sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || ovr(cfg, b) - ovr(cfg, a)),
        );
        return html`<div class="card fill">
            <header class="squad-heading">
                <h3>Squad <small>${read(() => String(u().squad.length))} players · ${String(cfg.career.squadMin)}–${String(cfg.career.squadMax)} allowed · click a player for details</small></h3>
                <button type="button" class="ghost" ${on('click', () => modal.set(PLAYER_DEVELOPMENT))}>Player development</button>
            </header>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>Name</th><th>Classes</th><th>Age</th><th>OVR</th><th>Potential</th><th>Abilities</th><th>XI</th><th title="Season goals / assists / average rating">G·A·Avg</th><th>Value</th><th>Wage</th></tr></thead>
            <tbody>${$each(rows)
                .$withKey((p) => p.id)
                .$as((p) =>
                    playerRow(
                        p,
                        html`
                <td>${$if(read(() => u().lineup.includes(p.id))).$then(() => html`<span class="pill">XI</span>`)}</td>
                <td class="num">${read(() => seasonCell(p))}</td><td class="num">${read(() => money(playerValue(cfg, p)))}</td><td class="num">${read(() => money(wage(cfg, p)))}</td>`,
                        'squad',
                    ),
                )}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ player drawer
    const xpBar = (p: Player, cl: ClassId) => {
        const need = xpToNext(cfg, p, cl);
        const have = p.xp[cl] ?? 0;
        return html`<span class="xpbar" title="${String(Math.round(have))} / ${String(need)} XP"><i style="width:${Math.min(100, (have / need) * 100)}%"></i></span>`;
    };

    const drawer = derived(selected, (sel) => {
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
        const feedback = grain('');
        const act = fromMarket
            ? html`<button class="primary" ${on('click', () => {
                  const err = buy(cfg, c, p.id);
                  if (err) {
                      feedback.set(err);
                      return;
                  }
                  selected.set(null);
                  toast(`Signed ${p.name}!`);
                  changed();
              })}>Sign for ${money(askingPrice(cfg, p))}</button>`
            : html`<button class="warn" ${on('click', async () => {
                  if (
                      !(await actions.confirm({
                          title: `Sell ${p.name}?`,
                          body: `They leave for ${money(salePrice(cfg, p))}.`,
                          action: 'Sell player',
                      }))
                  )
                      return;
                  const err = sell(cfg, c, p.id);
                  if (err) {
                      feedback.set(err);
                      return;
                  }
                  selected.set(null);
                  toast(`Sold ${p.name}.`);
                  changed();
              })}>Sell for ${money(salePrice(cfg, p))}</button>`;
        return Dialog({
            label: p.name,
            className: 'drawer-wrap',
            dismiss: () => selected.set(null),
            children: html`<aside class="drawer" style="--kit:${kitColor(cl.kit)}">
                <header>${portrait(cl, p, 64)}<div><h2>${p.name}</h2><p>${flag(p.nation)} ${nationOf(p.nation).adjective} · ${classLabel(cfg, p)} · age ${String(p.age)} (peaks ~${String(p.peakAge)})</p></div><button class="ghost" ${on('click', () => selected.set(null))}>✕</button></header>
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
                <p class="neg" role="status" ${attr({ hidden: derived(feedback, (message) => !message) })}>${feedback}</p>
                <footer>${act}</footer>
            </aside>`,
        });
    });

    // ------------------------------------------------------------ tactics
    const Tactics = () => {
        const lineup = read(() => {
            const cl = u();
            validLineup(cfg, cl);
            const formation = cfg.formations.find((f) => f.id === cl.formationId) ?? cfg.formations[0]!;
            const slots = formation.slots.map((slot, i) => ({ slot, player: cl.squad.find((p) => p.id === cl.lineup[i]) }));
            return { formation, slots };
        });
        const slotEls = $each(derived(lineup, (team) => team.slots.map((_, i) => i)))
            .$withKey((i) => i)
            .$as((i) => {
                const entry = derived(lineup, (team) => team.slots[i]!);
                const fitClass = derived(entry, ({ player, slot }) =>
                    player ? (classLevel(player, slot.cls) > 0 ? 'fit' : 'misfit') : 'empty',
                );
                const cls = derived(combined([fitClass, slotPick]), ([fit, pick]) => `slot ${fit} ${pick === i ? 'on' : ''}`);
                const style = derived(entry, ({ slot }) => `left:${slot.x * 100 * 1.9 + 3}%;top:${slot.y * 84 + 8}%`);
                const slotPlayer = derived(entry, ({ player }) => player);
                return html`<button ${attr({ class: cls, style, 'aria-pressed': derived(slotPick, (pick) => String(pick === i)) })} ${on('click', () => slotPick.update((pick) => (pick === i ? null : i)))}>
                ${$render(derived(slotPlayer, (p) => (p ? portrait(u(), p, 36) : html``)))}
                <b>${derived(slotPlayer, (p) => p?.name.split(' ')[0] ?? '—')}</b><span>${derived(entry, ({ player, slot }) => `${cfg.classes[slot.cls].short}${player ? ` · ${ovr(cfg, player, slot.cls)}` : ''}`)}</span>
            </button>`;
            });
        const choose = (id: string) => {
            const pick = slotPick();
            if (pick === null) return;
            const cl = u();
            const current = cl.lineup.indexOf(id);
            if (current >= 0) cl.lineup[current] = cl.lineup[pick]!;
            cl.lineup[pick] = id;
            slotPick.set(null);
            changed();
        };
        const bench = derived(combined([slotPick, lineup]), ([pick, team]) => {
            const cl = u();
            const slot = pick === null ? undefined : team.slots[pick]?.slot;
            if (!slot)
                return html`<h3>Bench</h3><ul class="bench">${cl.squad.filter((p) => !cl.lineup.includes(p.id)).map((p) => html`<li>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}</li>`)}</ul>`;
            const candidates = [...cl.squad].sort((a, b) => fitFor(cfg, b, slot.cls) - fitFor(cfg, a, slot.cls));
            return html`<h3>Pick for ${cfg.classes[slot.cls].label}</h3><ul class="bench pickable">${candidates.map((p) => html`<li class="${p.injury ? 'injured' : ''}" ${on('click', () => choose(p.id))}>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}<span class="num">${String(ovr(cfg, p, slot.cls))}</span>${cl.lineup.includes(p.id) ? html`<span class="pill">XI</span>` : html``}</li>`)}</ul>`;
        });
        return html`<div class="grid-2 wide-left">
            <div class="card fill">
                <h3>Formation <small>click a position, then pick a player · players out of position play with that class's stats but none of its abilities</small></h3>
                <div class="seg">${cfg.formations.map((f) => {
                    const active = derived(lineup, (team) => team.formation.id === f.id);
                    return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on(
                        'click',
                        () => {
                            const cl = u();
                            cl.formationId = f.id;
                            cl.lineup = autoLineup(cfg, cl);
                            changed();
                        },
                    )}>${f.label}</button>`;
                })}
                    <button class="ghost" ${on('click', () => {
                        const cl = u();
                        cl.lineup = autoLineup(cfg, cl);
                        changed();
                        toast('Best XI picked.');
                    })}>Auto-pick XI</button></div>
                <p class="formation-note">${derived(lineup, (team) => team.formation.note)}</p>
                <div class="board">${slotEls}<div class="half"></div><div class="box"></div></div>
            </div>
            <div class="card fill">${$render(bench)}</div>
        </div>`;
    };

    // ------------------------------------------------------------ training
    const Training = () => {
        const focus = read(() => c.trainingFocus);
        const rows = read(() => [...u().squad].sort((a, b) => ovr(cfg, b) - ovr(cfg, a)));
        const abilities = allAbilities(cfg)
            .map((id) => abilityDef(cfg, id))
            .sort((a, b) => a.unlock - b.unlock);
        const focusButtons = TRAINING_FOCUS_IDS.map((id) => {
            const active = derived(focus, (value) => value === id);
            const drill = TRAINING_FOCUSES[id];
            return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                ${on('click', () => {
                    if (c.trainingFocus === id) return;
                    c.trainingFocus = id;
                    changed();
                })}>
                <b>${drill.label}</b><small>${cfg.classes[drill.cls].label}</small>
            </button>`;
        });
        const row = (p: Player) => {
            const gain = read(() => trainingGain(cfg, p, c.trainingFocus));
            const injury = read(() => (p.injury ? `✚ ${p.injury}d` : ''));
            const progress = derived(gain, (result) => {
                if (!result) return html``;
                const level = classLevel(p, result.cls);
                return html`<span class="prog">${cfg.classes[result.cls].short} ${level ? String(level) : '(new)'} ${xpBar(p, result.cls)}</span>`;
            });
            const nextUnlock = derived(gain, (result) => {
                if (!result) return '';
                const level = classLevel(p, result.cls);
                const next = abilities.find((ability) => ability.cls === result.cls && ability.unlock > level);
                return next ? `${next.icon} ${next.label} at ${next.unlock}` : '';
            });
            return html`<tr ${attr({ class: read(() => (p.injury ? 'injured' : '')) })}>
                <td>${portrait(u(), p, 28)}</td>
                <td class="name">${flag(p.nation)}<b>${p.name}</b>${$if(derived(injury, Boolean)).$then(() => html`<em class="inj">${injury}</em>`)}</td>
                <td>${modelRegion(() => classChips(p))}</td>
                <td>${modelRegion(() => stars(p))}</td>
                <td><span ${attr({ class: derived(gain, (result) => (result ? 'training-xp' : 'muted')) })}>${derived(gain, (result) =>
                    result ? `+${result.amount} ${cfg.classes[result.cls].short} XP` : 'Recovering',
                )}</span></td>
                <td>${$render(progress)}</td>
                <td><span class="muted">${nextUnlock}</span></td>
            </tr>`;
        };

        return html`<div class="card fill">
            <h3>Squad training <small>One focus per training day</small></h3>
            <div class="training-focus" role="group" aria-label="Training focus">${focusButtons}</div>
            <p class="muted training-note">XP depends on class, ${derived(focus, (id) => TRAINING_FOCUSES[id].stats.join(' and '))}. Injured players recover.</p>
            <div class="scroll"><table class="tbl training"><thead><tr><th></th><th>Player</th><th>Classes</th><th>Potential</th><th>Session XP</th><th>Class progress</th><th>Next unlock</th></tr></thead>
            <tbody>${$each(rows)
                .$withKey((p) => p.id)
                .$as(row)}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ market
    const Market = () => {
        const list = derived(combined([marketFilter, marketNation, version]), ([filter, from]) =>
            c.market
                .filter((p) => (filter === 'all' || p.cls === filter) && (from === 'all' || nationOf(p.nation).id === from))
                .sort((a, b) => ovr(cfg, b) - ovr(cfg, a)),
        );
        const nationButton = (k: NationId | 'all') => {
            const active = derived(marketNation, (cur) => cur === k);
            return html`<button title="${k === 'all' ? 'Every country' : NATIONS[k].name}" ${attr({ class: derived(active, (isOn) => `nation-filter${isOn ? ' on' : ''}`), 'aria-pressed': derived(active, String) })} ${on('click', () => marketNation.set(k))}>${k === 'all' ? 'All' : flag(k)}</button>`;
        };
        return html`<div class="card fill">
            <h3>Transfer market <small>${read(() => String(c.market.length))} players · refreshed each season · budget ${read(() => money(u().budget))}</small></h3>
            <div class="seg">${(['all', ...CLASSES] as const).map((k) => {
                const active = derived(marketFilter, (filter) => filter === k);
                return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => marketFilter.set(k))}>${k === 'all' ? 'All' : cfg.classes[k].label}</button>`;
            })}</div>
            <div class="seg nation-seg">${(['all', ...NATION_IDS] as const).map(nationButton)}</div>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>Name</th><th>Classes</th><th>Age</th><th>OVR</th><th>Potential</th><th>Abilities</th><th>Price</th><th>Wage</th></tr></thead>
            <tbody>${$each(list)
                .$withKey((p) => p.id)
                .$as((p) =>
                    playerRow(
                        p,
                        html`<td ${attr({ class: read(() => (askingPrice(cfg, p) > u().budget ? 'num neg' : 'num')) })}>${read(() => money(askingPrice(cfg, p)))}</td><td class="num">${read(() => money(wage(cfg, p)))}</td>`,
                        'market',
                    ),
                )}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ finances
    const Finances = () => html`<div class="grid-2">
        <div class="col">${modelRegion(() => {
            const cl = u();
            const fee = cfg.career.matchFee[cl.tier]!;
            return html`
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
            `;
        })}</div>
        <div class="card fill"><h3>Ledger</h3><div class="scroll"><table class="tbl ledger"><tbody>${$each(read(() => c.ledger.slice(0, 60))).$as((l) => html`<tr><td class="muted">S${String(l.season)} D${String(l.day)}</td><td>${l.label}</td><td class="num ${l.amount < 0 ? 'neg' : 'pos'}">${money(l.amount)}</td></tr>`)}</tbody></table></div></div>
    </div>`;

    // ------------------------------------------------------------ match preview
    // ------------------------------------------------------------ coach tips: each screen explained once
    const HUB_TIPS: Record<string, { title: string; text: string | string[] }> = {
        overview: {
            title: 'Welcome to the club',
            text: 'The gold button advances the calendar or opens match prep. Check Season Plan for league fixtures, cup dates and training sessions. Letters arrive between matches. Finish in the top two to go up a division.',
        },
        squad: {
            title: 'Your squad',
            text: PLAYER_DEVELOPMENT.lines,
        },
        tactics: {
            title: 'Pick your XI',
            text: 'Choose a formation, then click a slot to pick who plays there. Out of position a player is weaker: the number is their fit for that slot. Auto-pick fills every slot with the best fit. Good players left on the bench will come and ask why.',
        },
        training: {
            title: 'Training days',
            text: 'Pick one focus for the squad. Players gain more XP when the drill fits their class and attributes. Outfield players can develop a new class through training. Goalkeepers and outfield players do lighter drills in their own class when the focus is for the other group. Injured players recover automatically.',
        },
        league: {
            title: 'The league',
            text: 'Ten clubs, everyone plays everyone once: 3 points for a win, 1 for a draw. The top two go up, the bottom two go down. Derbies are marked in the season calendar and swing morale twice as hard.',
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
    const coachTip = (id: Tab | 'prep', p: ReturnType<typeof prefs>) => {
        const tip = HUB_TIPS[id];
        if (!p.tips || !tip || p.tipsSeen.includes(`hub-${id}`)) return html``;
        const done = (forever: boolean) => {
            setPref('tipsSeen', [...prefs().tipsSeen, `hub-${id}`]);
            if (forever) setPref('tips', false);
        };
        const size = 96;
        const frames = cfg.animFrames.shout ?? 12;
        return html`<div class="tip ${id === 'prep' ? 'prep-tip' : 'hub-tip'}">
            <div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:${String(size)}px;height:${String(size)}px;background-size:${String(frames * size)}px ${String(size)}px;--strip:${String(frames * size)}px"></div></div>
            <div class="tip-body"><small>Coach Marlow</small><h3>${tip.title}</h3>
                ${(typeof tip.text === 'string' ? [tip.text] : tip.text).map((paragraph) => html`<p>${paragraph}</p>`)}
                <div class="tip-actions"><button class="ghost" ${on('click', () => done(true))}>No more tips</button><button class="primary" ${on('click', () => done(false))}>Got it</button></div></div>
        </div>`;
    };
    const hubTip = derived(combined([tab, prefs]), ([id, p]) => coachTip(id, p));
    const prepTip = derived(prefs, (p) => coachTip('prep', p));

    const PreviewDialog = () => {
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
        const selectedPlan = read(() => prep.plan);
        const selectedTalk = read(() => prep.talk);
        const counter = derived(selectedPlan, (plan) =>
            COUNTERS[plan] ? `; ${cfg.ai.styles[plan].label} beats ${cfg.ai.styles[COUNTERS[plan]!].label}` : '',
        );
        return Dialog({
            label: 'Match prep',
            dismiss: () => preview.set(false),
            children: html`<div class="modal-body preview prep">
                <header><h2>Match prep · ${t.cup ? `${CUP_NAME} · ${t.cup.label}` : `Matchday ${t.round + 1}`}${derby ? html` <span class="derby">Derby</span>` : html``}</h2><button class="ghost" ${on('click', () => preview.set(false))}>✕</button></header>
                <div class="modal-scroll">
                    ${$render(prepTip)}
                    <div class="vs big">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                    <p class="venue">${st.name} · ${sizeLabel(st.size)} · ${conditionsLabel(prep.conditions)} · Referee ${prep.referee.name} (${ref.label})${t.cup ? ' · Draws go to penalties' : ''}</p>
                    <div class="grid-2">
                        <div class="card"><h4>Scouting: ${opp.short}</h4>
                            <div class="kv">
                                <div><span>Style</span><b>${cfg.ai.styles[oppStyle].label}</b></div>
                                <div><span>Formation</span><b>${opp.formationId}</b></div>
                                <div><span>Division ${String(opp.tier + 1)}</span><b>${pos ? ordinal(pos) : '–'}</b></div>
                                <div><span>Form</span><b class="form">${form.length ? form.map((r) => html`<i class="r${r}">${r}</i>`) : '–'}</b></div>
                                <div><span>Strength</span><b>${squadOvr(cfg, opp).toFixed(0)} vs your ${squadOvr(cfg, u()).toFixed(0)}</b></div>
                            </div>
                            <p class="muted">${cfg.ai.styles[oppStyle].note}${derby ? ' This is the derby: the result swings morale twice as hard.' : ''}</p>
                            <h5>Watch out for</h5><ul class="xi">${threats.map((p) => html`<li>${portrait(opp, p, 24)}<span>${p.name}</span><em>${classLabel(cfg, p)} · ${String(seasonLine(c, p.id)?.goals ?? 0)} goals</em></li>`)}</ul>
                        </div>
                        <div class="card"><h4>Your game plan</h4>
                            <div class="plan-list">${styles.map((s) => html`<button ${attr({ class: derived(selectedPlan, (plan) => `plan ${plan === s ? 'on' : ''}`) })} ${on('click', () => setPlan(s))}><b>${cfg.ai.styles[s].label}</b>${edgeNote(s)}<span>${cfg.ai.styles[s].note}</span></button>`)}</div>
                            <p class="muted">Your auto-managed players follow the plan. Countering their style lifts the side on the day${counter}.</p>
                            <h4>Team talk <small>mood: ${moraleLabel(story(c).morale)}</small></h4>
                            <div class="plan-list talks">${(Object.keys(TALKS) as TeamTalk[]).map((k) => html`<button ${attr({ class: derived(selectedTalk, (talk) => `plan ${talk === k ? 'on' : ''}`) })} ${on('click', () => setTalk(k))}><b>${TALKS[k].label}</b><span>${TALKS[k].note}</span></button>`)}</div>
                        </div>
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
                        changed();
                    })}>Quick sim</button>
                    <button class="primary" ${on('click', () => {
                        preview.set(false);
                        actions.playMatch();
                    })}>Play match →</button>
                </footer>
            </div>`,
        });
    };

    // ------------------------------------------------------------ letters & ceremony
    const LetterDialog = () => {
        const l = story(c).inbox;
        if (!l) return html``;
        const answer = (i: number) => {
            const out = resolveLetter(cfg, c, i);
            letterOpen.set(false);
            changed();
            audio.play('coin');
            toast(out);
        };
        return Dialog({
            label: l.title,
            className: 'modal letter-modal',
            children: html`<div class="letter">
            <div class="seal">✉</div>
            <small>From: ${l.from}</small>
            <h2>${l.title}</h2>
            <p>${l.body.replace(/\*/g, '')}</p>
            <div class="letter-choices">${l.choices.map((ch, i) => html`<button class="${i === 0 ? 'primary' : ''}" ${on('click', () => answer(i))}><b>${ch.label}</b><small>${ch.hint}</small></button>`)}</div>
        </div>`,
        });
    };

    const CeremonyDialog = () => {
        const r = ceremony()!;
        const headline = r.champion ? 'Champions!' : r.promoted ? 'Promoted!' : r.relegated ? 'Relegated' : 'Season complete';
        const trophy = r.champion ? 'cup_gold' : r.promoted ? 'cup_silver' : r.relegated ? '' : 'medal_silver';
        const icon = { cup: '♛', medal: '◆', boot: '⚑', star: '★' } as const;
        return Dialog({
            label: headline,
            className: 'modal ceremony-modal',
            children: html`<div class="modal-body ceremony ${r.champion || r.promoted ? 'glory' : r.relegated ? 'gloom' : ''}">
            ${r.champion || r.promoted ? html`<div class="confetti">${Array.from({ length: 40 }, (_, i) => html`<i style="left:${String((i * 37) % 100)}%;animation-delay:${String((i % 10) * 120)}ms;--c:${['#f2bf2f', '#56b4e9', '#ffffff', '#cc79a7'][i % 4]!}"></i>`)}</div>` : html``}
            <div class="modal-scroll">
                <small>Season ${String(r.season)} · Division ${String(r.tier + 1)}</small>
                <h2>${headline}</h2>
                ${trophy ? html`<img class="trophy" src="assets/props/${trophy}.png" alt="" />` : html``}
                <p class="placing">Finished ${ordinal(r.position)} of ${String(cfg.career.clubsPerDivision)}</p>
                <ul class="awards">${r.awards.map((a) => html`<li><span class="aw-ic">${icon[a.icon]}</span><div><b>${a.title}</b><span>${a.who}</span><small>${a.detail}</small></div></li>`)}</ul>
                <ul class="alerts">${r.lines.map((l) => html`<li>${l}</li>`)}</ul>
            </div>
            <footer><button class="primary" ${on('click', () => ceremony.set(null))}>On to season ${String(r.season + 1)} →</button></footer>
        </div>`,
        });
    };

    const NoticeDialog = () => {
        const m = modal()!;
        return Dialog({
            label: m.title,
            dismiss: () => modal.set(null),
            children: html`<div class="modal-body notice">
            <header><h2>${m.title}</h2></header><div class="modal-scroll"><ul class="alerts">${m.lines.map((l) => html`<li>${l}</li>`)}</ul></div>
            <footer><button class="primary" ${on('click', () => modal.set(null))}>Continue</button></footer></div>`,
        });
    };

    // ------------------------------------------------------------ shell
    const screen = $switch(tab)
        .$case('season', SeasonPlan)
        .$case('squad', Squad)
        .$case('tactics', Tactics)
        .$case('training', Training)
        .$case('league', League)
        .$case('cup', Cup)
        .$case('market', Market)
        .$case('finances', Finances)
        .$case('playbook', () => html`<div class="card fill"><div class="scroll">${Playbook(cfg)}</div></div>`)
        .$default(Overview);

    const sidebar = html`<nav class="hub-side">
        <div class="club-id" ${attr({ style: read(() => `--kit:${kitColor(u().kit)}`) })}><span class="crest big">${read(() => u().short)}</span><div><b>${read(() => u().name)}</b><small>Division ${read(() => String(u().tier + 1))}</small></div></div>
        ${TABS.map(([id, label, icon]) => {
            const active = derived(tab, (current) => current === id);
            return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-current': derived(active, (isActive) => (isActive ? 'page' : undefined)) })} ${on(
                'click',
                () => {
                    planDay.set(null);
                    slotPick.set(null);
                    tab.set(id);
                },
            )}><span>${icon}</span>${label}</button>`;
        })}
        <div class="spacer"></div>
        <button class="menu-extra" ${on('click', actions.settings)}><span>⚙</span>Settings</button>
        <button class="ghost" ${on('click', actions.exit)}>Save & exit</button>
    </nav>`;

    return html`<div class="hub" ${clearToast}>
        ${sidebar}
        <main class="hub-main">${topbar}<section class="hub-content">${screen}</section></main>
        ${$render(drawer)}
        ${$if(preview).$then(PreviewDialog)}${$if(derived(modal, Boolean)).$then(NoticeDialog)}
        ${$if(letterOpen).$then(LetterDialog)}${$if(derived(ceremony, Boolean)).$then(CeremonyDialog)}
        <div class="hub-overlays">${$render(hubTip)}</div>
        ${$if(derived(flash, (f) => !!f)).$then(() => html`<div class="toast">${derived(flash, (f) => f ?? '')}</div>`)}
    </div>`;
};
