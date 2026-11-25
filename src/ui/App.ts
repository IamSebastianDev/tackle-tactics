import { combined, derived, grain } from '@grainular/grains';
import { GroundEditor } from './GroundEditor';
import { money } from '../meta/player';
import { SimView } from './SimView';
import { Dropdown } from './Dropdown';
import { DEFAULT_NATION, NATION_IDS, NATIONS, type NationId } from '../world/nations';
import { flag } from './flag';
import { createConfirmation } from './confirm';
import { controlValue, distinct } from './value';
import { Dialog } from './Dialog';
import { isDesktop, quitApp } from './desktop';
import { $each, $if, $render, $switch, attr, html, mounted, on } from '@grainular/nord';
import { defaultConfig, withOverrides, type Difficulty, type GameConfig, type TeamStyle, type TimeoutPolicy } from '../config';
import { createRng } from '../rng';
import type { Club } from '../types';
import { generateClub } from '../world/generate';
import { abilitiesOf, classLabel } from '../engine/abilities';
import {
    deleteCareer,
    stadiumOf,
    endSeason,
    fixtureClubs,
    loadCareer,
    newCareer,
    playMatchday,
    seasonDays,
    saveCareer,
    simulatedWinChance,
    today,
    userClub,
    userSide,
    type Career,
    awayKitFor,
    kitsClash,
    type Fixture,
    groundAllowed,
    startingGroundSize,
} from '../meta/career';
import { CUP_NAME, penaltyScore } from '../meta/cup';
import { Hub, type HubNotice } from './hub/Hub';
import { styleOf } from '../ai/brain';
import { recolorVersion } from './recolor';
import {
    generateStadium,
    rollConditions,
    type Conditions,
    type PitchCondition,
    type StadiumSize,
    type TimeOfDay,
    type Weather,
    defaultGroundLook,
    sizeLabel,
    type GroundLook,
} from '../world/stadium';
import { SettingsModal } from './Settings';
import { LESSONS } from './tutorial';
import { RadioPlayer } from './RadioUI';
import { radio } from './radio';
import { applyTalk, matchEdge, prepFor, storyLines } from '../meta/prep';
import { audio } from './audio';
import { AI_SPEED, prefs } from './prefs';
import { MatchController, type Controller } from './controller';
import { kitColor, MatchView } from './MatchView';
import { spriteStyle } from './sprites';

type Mode = 'ai' | 'hotseat' | 'watch';
type Settings = {
    mode: Mode;
    difficulty: Difficulty;
    timerSeconds: number;
    rounds: number;
    timeoutPolicy: TimeoutPolicy;
    homeFormation: string;
    awayFormation: string;
    homeKit: string;
    awayKit: string;
    ground: 'random' | StadiumSize;
    pitch: 'random' | PitchCondition;
    time: 'random' | TimeOfDay;
    weather: 'random' | Weather;
    seed: number;
};

const STORAGE_KEY = 'tackle-tactics:settings';
const loadSettings = (): Settings => {
    const fallback: Settings = {
        mode: 'ai',
        difficulty: 'normal',
        timerSeconds: defaultConfig.match.timerSeconds,
        rounds: defaultConfig.match.rounds,
        timeoutPolicy: defaultConfig.match.timeoutPolicy,
        homeFormation: '4-3-3',
        awayFormation: '4-4-2',
        homeKit: 'blue',
        awayKit: 'yellow',
        ground: 'random',
        pitch: 'random',
        time: 'random',
        weather: 'random',
        seed: Math.floor(Math.random() * 1e9),
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...fallback, ...JSON.parse(raw), seed: fallback.seed } : fallback;
    } catch {
        return fallback;
    }
};
const saveSettings = (s: Settings) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        /* private mode etc. */
    }
};

const buildClubs = (cfg: GameConfig, s: Settings): [Club, Club] => {
    const rng = createRng(s.seed);
    const names = new Set<string>();
    const kAway = kitsClash(cfg, s.awayKit, s.homeKit) ? awayKitFor(cfg, s.awayKit, 0, s.homeKit) : s.awayKit;
    return [
        generateClub(cfg, rng, 'home', s.homeKit, cfg.kits.keepers[0]!, s.homeFormation, names, rng.pick([...NATION_IDS])),
        generateClub(cfg, rng, 'away', kAway, cfg.kits.keepers[1]!, s.awayFormation, names, rng.pick([...NATION_IDS])),
    ];
};

/** Weather makes the ball a little less predictable (config.weather). */
const weatherCfg = (base: GameConfig, cond: Conditions) => {
    const k = base.weather.scatterMult[cond.weather] ?? 1;
    return withOverrides(
        {
            ball: { passScatterPerCell: base.ball.passScatterPerCell * k, shotScatterPerCell: base.ball.shotScatterPerCell * k },
        },
        base,
    );
};

/** Match pacing follows the AI-speed preference. */
const pacing = () => {
    const f = AI_SPEED[prefs().aiSpeed];
    return { aiThinkMs: Math.round(defaultConfig.match.aiThinkMs * f), resolvePauseMs: Math.round(defaultConfig.match.resolvePauseMs * f) };
};

export const App = () => {
    const confirmation = createConfirmation();
    const settings = grain<Settings>(loadSettings());
    const showHowto = grain(false);
    const screen = grain<'title' | 'setup' | 'newCareer' | 'hub' | 'match' | 'sim'>('title');
    /** The live simulation screen's content (quick sim, or finishing a match early). */
    let simView: (() => ReturnType<typeof SimView>) | null = null;
    let ctl: MatchController | null = null;
    const career = grain<Career | null>(loadCareer());
    const hubNotice = grain<HubNotice | null>(null);
    let matchExit: () => void = () => {};
    let finishOdds: (() => number) | undefined;

    const configFor = (s: Settings) =>
        withOverrides({ match: { timerSeconds: s.timerSeconds, rounds: s.rounds, timeoutPolicy: s.timeoutPolicy, ...pacing() } });

    const start = () => {
        const s = settings();
        saveSettings(s);
        const clubs = buildClubs(configFor(s), s);
        const pick = <T extends string>(v: 'random' | T) => (v === 'random' ? undefined : v);
        const stadium = generateStadium(`quick-${s.seed}-${Math.random()}`, clubs[0].name.split(' ')[0]!, undefined, {
            size: pick(s.ground),
            condition: pick(s.pitch),
        });
        const conditions = rollConditions(createRng(Math.floor(Math.random() * 1e9)), stadium, {
            time: pick(s.time),
            weather: pick(s.weather),
        });
        const cfg = weatherCfg(configFor(s), conditions);
        const controllers: [Controller, Controller] =
            s.mode === 'ai' ? ['human', 'ai'] : s.mode === 'hotseat' ? ['human', 'human'] : ['ai', 'ai'];
        ctl = new MatchController(cfg, clubs, { controllers, difficulty: s.difficulty, seed: s.seed, stadium, conditions });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = exit;
        finishOdds = undefined;
        screen.set('match');
    };
    const startTutorial = () => {
        const s: Settings = {
            ...settings(),
            mode: 'ai',
            seed: 4242,
            homeFormation: '4-3-3',
            awayFormation: '4-4-2',
            homeKit: 'blue',
            awayKit: 'yellow',
        };
        const base = withOverrides({ match: { timerSeconds: 0, rounds: 30, ...pacing() } });
        const clubs = buildClubs(base, s);
        const stadium = generateStadium('tutorial-ground', 'Training', undefined, { size: 'village', condition: 'lush' });
        const conditions: Conditions = { time: 'day', weather: 'clear' };
        ctl = new MatchController(weatherCfg(base, conditions), clubs, {
            controllers: ['human', 'ai'],
            difficulty: 'normal',
            seed: 4242,
            stadium,
            conditions,
            tutorial: LESSONS,
        });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = () => {
            ctl?.stop();
            ctl = null;
            screen.set('title');
        };
        finishOdds = undefined;
        screen.set('match');
    };
    const exit = () => {
        ctl?.stop();
        ctl = null;
        settings.update((s) => ({ ...s, seed: Math.floor(Math.random() * 1e9) }));
        screen.set('setup');
    };

    // ------------------------------------------------------------ career flow
    const careerCfg = (c: Career) =>
        withOverrides({
            match: {
                timerSeconds: c.settings.timerSeconds,
                rounds: c.settings.rounds,
                timeoutPolicy: c.settings.timeoutPolicy,
                ...pacing(),
            },
        });

    const reportNotice = (c: Career, title: string, newsBefore: number) => {
        const fresh = c.news.slice(0, Math.max(0, c.news.length - newsBefore)).map((n) => n.text);
        hubNotice.set({ title, lines: fresh.length ? fresh.slice(0, 8) : ['Matchday complete.'] });
    };

    const resultTitle = (c: Career, f: Fixture) => {
        const [home, away] = f.result!;
        const penalties = penaltyScore(f);
        return `${c.clubs[f.home]!.short} ${home} – ${away} ${c.clubs[f.away]!.short}${penalties ? ` (${penalties})` : ''}`;
    };

    /** Today's career fixture, set up for the engine: prep, talk, conditions, the controller. */
    const buildCareerMatch = () => {
        const c = career()!;
        const cfg = careerCfg(c);
        const t = today(cfg, c);
        if (t.kind !== 'match') return null;
        const side = userSide(c, t.fixture);
        const controllers: [Controller, Controller] = side === 0 ? ['human', 'ai'] : ['ai', 'human'];
        const stadium = stadiumOf(c, c.clubs[t.fixture.home]!);
        // match prep: the talk lands now, the plan steers your auto-players, a counter-plan lifts the side
        const prep = prepFor(cfg, c, t.fixture);
        const talk = applyTalk(cfg, c, t.fixture, prep, Math.random);
        if (talk) c.news.unshift({ season: c.season, day: c.day, text: talk, tone: 'info' });
        const conditions = prep.conditions;
        const clubs = fixtureClubs(cfg, c, t.fixture);
        clubs[side].morale = Math.max(10, Math.min(100, (clubs[side].morale ?? 60) + matchEdge(cfg, c, t.fixture, prep)));
        const plans: [TeamStyle | null, TeamStyle | null] = side === 0 ? [prep.plan, null] : [null, prep.plan];
        const match = new MatchController(weatherCfg(cfg, conditions), clubs, {
            controllers,
            difficulty: c.settings.difficulty,
            seed: Math.floor(Math.random() * 1e9),
            stadium,
            conditions,
            referee: prep.referee,
            plans,
            story: storyLines(cfg, c, t.fixture, prep),
        });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = match;
        /** The match is over (played, simulated, or both): record it and go back to the club. */
        const finish = (note = '') => {
            const m = match.match;
            const played = m
                .everyone()
                .filter((p) => p.team === side)
                .map((p) => p.id);
            const stats = match.stats;
            match.stop();
            ctl = null;
            const before = c.news.length;
            const lines = Object.fromEntries(
                m.everyone().map((p) => {
                    const l = stats.players.get(p.id);
                    return [p.id, { goals: l?.goals ?? 0, assists: l?.assists ?? 0, rating: stats.rating(p) }];
                }),
            );
            playMatchday(cfg, c, { score: [...m.state.score] as [number, number], knocks: m.state.knocks, played, lines });
            saveCareer(c);
            reportNotice(c, `${resultTitle(c, t.fixture)}${note}`, before);
            simView = null;
            screen.set('hub');
        };
        return { c, cfg, t, match, finish };
    };

    /** Play the rest of a match live, without the pitch (the match itself keeps going on the engine). */
    const showSim = (match: MatchController, title: string, onDone: () => void) => {
        simView = () => SimView(match, { title, doneLabel: 'Back to the club', onDone });
        screen.set('sim');
    };

    const playCareerMatch = () => {
        const built = buildCareerMatch();
        if (!built) return;
        const { c, cfg, t, match, finish } = built;
        ctl = match;
        const remainingFraction = () => Math.max(0, 1 - (match.match.state.round - 1) / cfg.match.rounds);
        finishOdds = () => simulatedWinChance(cfg, c, t.fixture, match.match.state.score, remainingFraction());
        matchExit = () => {
            if (match.match.state.over) return finish();
            // leaving early: the rest is simulated for real, and you can watch it play out
            match.stop();
            showSim(match, 'The rest of the match, simulated', () => finish(' (rest simulated)'));
        };
        screen.set('match');
    };

    const simCareerMatch = () => {
        const built = buildCareerMatch();
        if (!built) return;
        showSim(built.match, 'Simulated match', () => built.finish(' (simulated)'));
    };

    const hubActions = {
        confirm: confirmation.confirm,
        playMatch: playCareerMatch,
        simMatch: simCareerMatch,
        endSeason: () => {
            const c = career()!;
            return endSeason(careerCfg(c), c);
        },
        exit: () => {
            const c = career();
            if (c) saveCareer(c);
            screen.set('title');
        },
        settings: () => showSettings.set(true),
    };

    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => settings.update((s) => ({ ...s, [k]: v }));

    const setting = <K extends keyof Settings>(key: K) => distinct(derived(settings, (s) => s[key]));
    const select = <K extends keyof Settings>(k: K, opts: Array<[string, string]>, cast: (v: string) => Settings[K]) => {
        const value = derived(setting(k), (current) => opts.find(([v]) => current === cast(v))?.[0] ?? opts[0]![0]);
        return Dropdown(value, opts, (v) => set(k, cast(v)));
    };

    const range = (k: 'timerSeconds' | 'rounds', min: number, max: number, step: number, unit: string) => {
        const value = setting(k);
        const label = derived(value, (n) => (k === 'timerSeconds' && n <= 0 ? 'Off' : `${n}${unit}`));
        return html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(value())}" ${controlValue(value)}
            ${on('input', (e) => set(k, Number((e.currentTarget as HTMLInputElement).value)))} /><output>${label}</output></div>`;
    };

    const setupSquads = derived(
        combined([setting('seed'), setting('homeFormation'), setting('awayFormation'), setting('homeKit'), setting('awayKit')]),
        () => buildClubs(defaultConfig, settings()),
    );

    const formations = defaultConfig.formations.map((f) => [f.id, f.label] as [string, string]);
    const kits = defaultConfig.kits.outfield.map((k) => [k, k[0]!.toUpperCase() + k.slice(1)] as [string, string]);

    const SetupSquad = (side: 'Home' | 'Away') => {
        const home = side === 'Home';
        const club = derived(setupSquads, (clubs) => clubs[home ? 0 : 1]);
        const controller = derived(setting('mode'), (mode) => {
            if (mode === 'watch') return 'AI';
            if (mode === 'hotseat') return home ? 'Player 1' : 'Player 2';
            return home ? 'You' : 'AI';
        });
        const roster = $each(derived(club, (c) => c.squad)).$as((p) => {
            const abilities = abilitiesOf(defaultConfig, p)
                .map((id) => defaultConfig.abilities[id].label)
                .join(', ');
            const style = derived(recolorVersion, () => spriteStyle(defaultConfig, p.sprite, 'idle', 'down', p));
            return html`<li>
                <div class="sprite still" ${attr({ style })}></div>
                <span class="num">${String(p.number)}</span><span class="nm" title="${p.name}">${p.name}</span>
                <span class="cl" title="${abilities || 'No abilities yet'}">${classLabel(defaultConfig, p)}</span>
                <span class="sp" title="Speed (turn order)">${String(p.stats.speed)}</span>
            </li>`;
        });
        return html`<section class="opts squad" aria-label="${side} squad">
            <header class="setup-club" ${attr({ style: derived(club, (c) => `--kit:${kitColor(c.kit)}`) })}>
                <div><small>${side} · ${controller}</small><h2>${derived(club, (c) => c.name)}</h2></div>
                <span>${derived(club, (c) => defaultConfig.ai.styles[styleOf(c)].label)}</span>
            </header>
            <div class="pair setup-team-options">
                <label>Formation ${select(home ? 'homeFormation' : 'awayFormation', formations, (v) => v)}</label>
                <label>Kit ${select(home ? 'homeKit' : 'awayKit', kits, (v) => v)}</label>
            </div>
            <div class="setup-lineup">
                <div class="setup-roster-head" aria-hidden="true"><span>Player</span><span>Class</span><span>Speed</span></div>
                <ul class="setup-roster" aria-label="${side} lineup">${roster}</ul>
            </div>
        </section>`;
    };

    const Setup = () => html`<main class="setup quick-match" aria-label="Quick match">
        <div class="quick-match-inner">
            <header class="quick-match-header">
                <button class="ghost" ${on('click', () => screen.set('title'))}>← Back</button>
                <h1>Quick match</h1>
                <button class="ghost" ${on('click', () => showHowto.set(true))}>How to play</button>
            </header>
            <div class="setup-grid">
                <section class="opts setup-rules" aria-label="Match settings">
                    <h2>Match settings</h2>
                    <div class="setup-options">
                        <div class="pair"><label>Mode ${select(
                            'mode',
                            [
                                ['ai', 'You vs AI'],
                                ['hotseat', 'Hotseat (2 players)'],
                                ['watch', 'Watch AI vs AI'],
                            ],
                            (v) => v as Mode,
                        )}</label>
                        <label>AI difficulty ${select(
                            'difficulty',
                            [
                                ['easy', 'Easy'],
                                ['normal', 'Normal'],
                                ['hard', 'Hard'],
                            ],
                            (v) => v as Difficulty,
                        )}</label></div>
                        <label>Action timer ${range('timerSeconds', 0, 45, 1, 's')}</label>
                        <label>Match length (rounds) ${range('rounds', 6, 40, 2, '')}</label>
                        <label>On timeout ${select(
                            'timeoutPolicy',
                            [
                                ['lose', 'Lose the action'],
                                ['auto', 'AI plays it for you'],
                            ],
                            (v) => v as TimeoutPolicy,
                        )}</label>
                        <h3>Match conditions</h3>
                        <div class="pair"><label>Ground ${select(
                            'ground',
                            [
                                ['random', 'Random'],
                                ['village', 'Village'],
                                ['town', 'Town'],
                                ['city', 'City'],
                                ['grand', 'Grand'],
                            ],
                            (v) => v as Settings['ground'],
                        )}</label>
                        <label>Pitch ${select(
                            'pitch',
                            [
                                ['random', 'Random'],
                                ['lush', 'Lush'],
                                ['dry', 'Dry'],
                                ['muddy', 'Muddy'],
                                ['frost', 'Frosty'],
                            ],
                            (v) => v as Settings['pitch'],
                        )}</label></div>
                        <div class="pair"><label>Kick-off ${select(
                            'time',
                            [
                                ['random', 'Random'],
                                ['day', 'Afternoon'],
                                ['dusk', 'Dusk'],
                                ['night', 'Night'],
                            ],
                            (v) => v as Settings['time'],
                        )}</label>
                        <label>Weather ${select(
                            'weather',
                            [
                                ['random', 'Random'],
                                ['clear', 'Clear'],
                                ['rain', 'Rain'],
                                ['snow', 'Snow'],
                                ['fog', 'Fog'],
                            ],
                            (v) => v as Settings['weather'],
                        )}</label></div>
                    </div>
                </section>
                ${SetupSquad('Home')}
                ${SetupSquad('Away')}
            </div>
            <footer class="quick-match-actions">
                <button class="ghost" ${on('click', () => set('seed', Math.floor(Math.random() * 1e9)))}>New squads</button>
                <button class="primary" ${on('click', start)}>Kick off →</button>
            </footer>
        </div>
        ${$if(showHowto).$then(() =>
            Dialog({
                label: 'How to play',
                dismiss: () => showHowto.set(false),
                children: html`<div class="modal-body howto-modal"><header><h2>How to play</h2><button class="ghost" ${on('click', () => showHowto.set(false))}>Close</button></header>
                <div class="modal-scroll"><ul>
                    <li>All 22 players act one at a time, fastest first, teams alternating. A <b>round</b> is everyone acting once.</li>
                    <li>Each action has a timer. Act early to pass the baton; hesitate and you lose the action.</li>
                    <li><b>Move</b> (blue). Off-ball runs stop when they enter an opponent's adjacent cell — that's marking.</li>
                    <li>With the ball you may dribble, then <b>pass or shoot</b>: aim anywhere — the orange zone is where the ball may land. Longer = bigger gamble. Aim at the goal mouth to shoot.</li>
                    <li><b>Reactions</b>: every player has one per round. Dribble past someone or play the ball near them and they get a tackle/intercept roll. Pink cells show live reaction zones; dimmed rings are spent.</li>
                    <li>Passes longer than ${String(defaultConfig.ball.loftThreshold)} cells are lofted: only contestable near take-off and landing.</li>
                    <li><b>Abilities</b> come from class levels (hover a player's class for their kit). Wingers sprint, trick and cross; strikers run in behind and pick their shot; midfielders press, thread through balls and set the tempo; defenders slide, man-mark and foul; keepers command and rush out. Multiclass players get both kits. Most have a cooldown in rounds.</li>
                    <li>Keys: <kbd>Space</kbd> hold / end, <kbd>1</kbd>–<kbd>9</kbd> abilities, <kbd>T</kbd> tackle, <kbd>Esc</kbd> cancel, <kbd>A</kbd> let the AI play this action.</li>
                </ul></div>
            </div>`,
            }),
        )}
    </main>`;

    // ------------------------------------------------------------ title & new career
    const titleScene = () => {
        const figs: Array<[string, string, number, string]> = [
            ['blue_player_1', 'celebrate_down', 22, 'down'],
            ['yellow_player_2', 'idle_left', 70, 'left'],
            ['blue_player_2', 'juggle_right', 8, 'right'],
            ['keeper_pink', 'gk_ready_down', 84, 'down'],
        ];
        return html`<div class="title-scene">
            <div class="sky"></div><div class="stand-band"></div>
            ${[8, 30, 70, 92].map((x) => html`<div class="lights" style="left:${String(x)}%"></div>`)}
            <div class="turf"></div>
            ${figs.map(([kit, anim, x]) => {
                const [name, dir] = [anim.slice(0, anim.lastIndexOf('_')), anim.slice(anim.lastIndexOf('_') + 1)];
                const frames = defaultConfig.animFrames[name] ?? 8;
                return html`<div class="fig" style="left:${String(x)}%"><div class="sprite" style="background-image:url(assets/cast/${kit}/${name}_${dir}.png);background-size:${String(frames * 160)}px 160px;--strip:${String(frames * 160)}px;animation-duration:${String(frames * 120)}ms;animation-timing-function:steps(${String(frames)})"></div></div>`;
            })}
            <div class="vignette"></div>
        </div>`;
    };

    /** Title menu: one list, a ▶ on the focused item, its description underneath. Arrows + Enter work too. */
    const Title = (c: Career | null) => {
        type Item = { id: string; label: string; desc: string; go: () => void; cls?: string };
        const items: Item[] = [
            ...(c
                ? [
                      {
                          id: 'continue',
                          label: 'Continue career',
                          desc: `${userClub(c).name} · Season ${String(c.season)} · Division ${String(userClub(c).tier + 1)}`,
                          go: () => screen.set('hub'),
                          cls: 'primary',
                      },
                  ]
                : []),
            { id: 'tutorial', label: 'Tutorial', desc: 'Eight short lessons on the training ground. Start here.', go: startTutorial },
            {
                id: 'career',
                label: 'New career',
                desc: 'Take a club from the bottom division to the top. Train, trade, promote.',
                go: () => screen.set('newCareer'),
            },
            {
                id: 'quick',
                label: 'Quick match',
                desc: 'A one-off match: against the AI, hotseat, or watch the AI play.',
                go: () => screen.set('setup'),
            },
            {
                id: 'settings',
                label: 'Settings',
                desc: 'UI scale, font, sound, pacing and match defaults.',
                go: () => showSettings.set(true),
            },
            ...(isDesktop
                ? [
                      {
                          id: 'exit',
                          label: 'Exit',
                          desc: 'Close the game. Your career is saved automatically.',
                          go: () => void quitApp(),
                          cls: 'exit',
                      },
                  ]
                : []),
        ];
        const focus = grain(0);
        const keys = mounted<HTMLDivElement>(() => {
            const onKey = (e: KeyboardEvent) => {
                if (showSettings() || showHowto()) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    focus.update((f) => (f + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
                    audio.play('click');
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    items[focus()]?.go();
                }
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        });
        const menu = items.map((it, i) => {
            const cls = derived(focus, (f) => `title-item ${it.cls ?? ''} ${i === f ? 'on' : ''}`);
            return html`<button ${attr({ class: cls })} ${on('mouseenter', () => focus.set(i))} ${on('focus', () => focus.set(i))} ${on('click', it.go)}>${it.label}</button>`;
        });
        const desc = derived(focus, (f) => items[f]?.desc ?? '');
        return html`<div class="setup title-screen" ${keys}>${titleScene()}<div class="setup-inner">
            <h1>Tackle <span>Tactics</span></h1>
            <nav class="title-menu">${menu}</nav>
            <p class="title-desc">${desc}</p>
            <p class="credits">Art by bubbabba · Goals in Pixels</p>
        </div></div>`;
    };

    const NewCareer = () => {
        const name = grain('');
        const nation = grain<NationId>(DEFAULT_NATION);
        const cc = defaultConfig.career;
        /** Starting division (0 = top flight); the ground can be as big as that division allows. */
        const startTier = grain(cc.divisions - 1);
        const groundLook = grain<GroundLook>({ ...defaultGroundLook(''), name: '' });
        const groundSize = grain<StadiumSize>(startingGroundSize(defaultConfig, cc.divisions - 1));
        const pickTier = (t: number) => {
            startTier.set(t);
            // the ground defaults to the biggest the division allows (pick a smaller one on the next step)
            groundSize.set(startingGroundSize(defaultConfig, t));
        };
        const divisionPicker = html`<div class="seg nc-divisions">${Array.from({ length: cc.divisions }, (_, t) => {
            const active = derived(startTier, (cur) => cur === t);
            return html`<button type="button" ${attr({ class: derived(active, (x) => (x ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => pickTier(t))}>Div ${String(t + 1)}</button>`;
        })}</div>
        <p class="muted nc-division-note">${derived(startTier, (t) => {
            const where =
                t === cc.divisions - 1
                    ? 'The bottom of the pyramid: the long climb.'
                    : t === 0
                      ? 'The top flight: stay up and chase the Champions Cup.'
                      : 'Mid-pyramid: promotion is the goal.';
            return `${where} Budget ${money(cc.startingBudget[t]!)}, squad of Division ${t + 1} quality, grounds up to ${sizeLabel(startingGroundSize(defaultConfig, t)).toLowerCase()}.`;
        })}</p>`;
        const groundEditor = GroundEditor(defaultConfig, groundLook, groundSize, {
            allowed: (sz) => groundAllowed(defaultConfig, sz, startTier()),
            lockedNote: (sz) => `Division ${String(cc.ground[sz].minTier + 1)}+`,
            watch: startTier,
        });
        const kit = grain('blue');
        const keeperKit = grain(defaultConfig.kits.keepers[0]!);
        const awayKit = grain('white');
        // the away strip may never clash with the home one: move it along when the home kit changes
        const chooseHomeKit = (k: string) => {
            kit.set(k);
            if (kitsClash(defaultConfig, awayKit(), k)) awayKit.set(awayKitFor(defaultConfig, k));
        };
        /** The short name follows the club name until you type your own. */
        const short = grain('');
        const shortEdited = grain(false);
        const autoShort = (n: string) =>
            n
                .replace(/[^A-Za-z]/g, '')
                .slice(0, 3)
                .toUpperCase();
        const shownShort = derived(combined([name, short, shortEdited]), ([n, sh, edited]) => (edited ? sh : autoShort(n)) || 'YOU');
        const kitName = (k: string) => {
            const n = k.replace('keeper_', '');
            return n[0]!.toUpperCase() + n.slice(1);
        };
        // built once each: only the selected / clashing state and the preview kits update (no sprite rebuilds)
        const swatch = (k: string, which: 'home' | 'away' | 'keeper') => {
            const target = which === 'home' ? kit : which === 'away' ? awayKit : keeperKit;
            const clash = derived(kit, (home) => which === 'away' && kitsClash(defaultConfig, k, home));
            const cls = derived(combined([target, clash]), ([cur, c]) => `kit-swatch ${cur === k ? 'on' : ''} ${c ? 'clash' : ''}`);
            const title = derived(clash, (c) => (c ? `${kitName(k)}: clashes with the home kit` : kitName(k)));
            const art = spriteStyle(defaultConfig, which === 'keeper' ? k : `${k}_player_1`, 'idle', 'down');
            return html`<button ${attr({ class: cls, disabled: clash, title })} ${on('click', () => (which === 'home' ? chooseHomeKit(k) : target.set(k)))}>
                <span class="portrait kit-portrait"><span class="sprite still" style="${art}"></span></span>
                <small>${kitName(k)}</small>
            </button>`;
        };
        const model = (source: typeof kit, sprite: (k: string) => string, anim = 'idle') =>
            html`<span class="kit-model"><span class="sprite" ${attr({ style: derived(source, (k) => spriteStyle(defaultConfig, sprite(k), anim, 'down')) })}></span></span>`;
        const preview = html`<div class="kit-preview">
            <div class="kit-crest" ${attr({ style: derived(kit, (k) => `--kit:${kitColor(k)}`) })}><span>${shownShort}</span></div>
            <b>${derived(name, (n) => n.trim() || 'Your club')}</b>
            <div class="kit-pitch">
                ${model(kit, (k) => `${k}_player_1`)}${model(kit, (k) => `${k}_player_2`)}${model(keeperKit, (k) => k, 'gk_ready')}
                <span class="kit-away-label">Away</span>
                ${model(awayKit, (k) => `${k}_player_1`)}${model(awayKit, (k) => `${k}_player_2`)}
            </div>
        </div>`;
        /** A few example clubs and players, with distinct towns and surnames (fixed per country). */
        const sample = (id: NationId) => {
            const n = NATIONS[id];
            const rng = createRng(NATION_IDS.indexOf(id) * 7919 + 101);
            const towns = n.places(rng).filter((p, i, all) => all.findIndex((q) => q.slice(-3) === p.slice(-3)) === i);
            const clubs = towns.slice(0, 3).map((p) => n.clubName(rng, p));
            const players: string[] = [];
            while (players.length < 3) {
                const candidate = n.playerName(rng);
                if (!players.some((q) => q.split(' ').at(-1) === candidate.split(' ').at(-1))) players.push(candidate);
            }
            return { clubs, players };
        };
        const samples = Object.fromEntries(NATION_IDS.map((id) => [id, sample(id)])) as Record<NationId, ReturnType<typeof sample>>;
        const countryPicker = html`<div class="nation-pick" role="radiogroup" aria-label="Country">${NATION_IDS.map(
            (id) =>
                html`<button type="button" role="radio" ${attr({
                    class: derived(nation, (cur) => `nation-flag${cur === id ? ' on' : ''}`),
                    'aria-checked': derived(nation, (cur) => String(cur === id)),
                })} title="${NATIONS[id].name}" aria-label="${NATIONS[id].name}" ${on('click', () => nation.set(id))}>${flag(id, 'flag big')}</button>`,
        )}</div>
        <p class="nation-name">${derived(nation, (id) => NATIONS[id].name)}</p>
        <dl class="nation-sample">
            <dt>Clubs</dt><dd>${derived(nation, (id) => samples[id].clubs.join(' · '))}</dd>
            <dt>Players</dt><dd>${derived(nation, (id) => samples[id].players.join(' · '))}</dd>
        </dl>
        <p class="muted">Your club plays in its 5-tier pyramid, in the division you choose. Most players at its clubs are local; the transfer market scouts every country.</p>`;
        const s = settings();
        const startError = grain('');
        const create = async () => {
            const existing = career();
            if (
                existing &&
                !(await confirmation.confirm({
                    title: 'Start a new career?',
                    body: `Your current career with ${userClub(existing).name} will be replaced.`,
                    action: 'Start new career',
                }))
            )
                return;
            const next = newCareer(
                defaultConfig,
                Math.floor(Math.random() * 1e9),
                {
                    timerSeconds: settings().timerSeconds,
                    rounds: settings().rounds,
                    difficulty: settings().difficulty,
                    timeoutPolicy: settings().timeoutPolicy,
                },
                {
                    name: name().trim() || undefined,
                    short: shortEdited() ? short() : undefined,
                    kit: kit(),
                    awayKit: awayKit(),
                    keeperKit: keeperKit(),
                    nation: nation(),
                    tier: startTier(),
                    ground: { look: groundLook(), size: groundSize() },
                },
            );
            if (!saveCareer(next)) {
                startError.set('Could not save the new career.');
                return;
            }
            career.set(next);
            hubNotice.set({
                title: `Welcome to ${userClub(next).name}`,
                lines: [
                    `You start in division ${userClub(next).tier + 1} of 5 of the ${NATIONS[next.nation].adjective} pyramid. The top 2 clubs are promoted each season.`,
                    `The ${seasonDays(defaultConfig, next)}-day season includes home and away league fixtures and the all-division ${CUP_NAME}.`,
                    'Choose a squad focus in Training to develop class skills. Set your XI in Tactics and buy or sell players in the Market.',
                    'Press the yellow button at the top right to move the calendar on.',
                ],
            });
            screen.set('hub');
        };
        // two steps, both built once and toggled, so the kit sprites never rebuild
        const step = grain<1 | 2>(1);
        const shownOn = (n: 1 | 2) => attr({ hidden: derived(step, (cur) => cur !== n) });
        const stepChip = (n: 1 | 2, label: string) =>
            html`<li><button type="button" ${attr({ class: derived(step, (cur) => (cur === n ? 'on' : '')), 'aria-current': derived(step, (cur) => (cur === n ? 'step' : 'false')) })} ${on('click', () => step.set(n))}><b>${String(n)}</b>${label}</button></li>`;
        return html`<div class="setup"><div class="setup-inner new-career">
            <header class="nc-head">
                <h1>New <span>career</span></h1>
                <ol class="nc-steps">${stepChip(1, 'Country')}${stepChip(2, 'Your club')}</ol>
            </header>
            <div class="nc-step nc-country" ${shownOn(1)}>
                <section class="opts">
                    <h4>Country</h4>
                    ${countryPicker}
                </section>
                <section class="opts">
                    <h4>Starting division</h4>
                    ${divisionPicker}
                    <h4>Match settings</h4>
                    <label>Action timer ${range('timerSeconds', 0, 45, 1, 's')}</label>
                    <label>Match length (rounds) ${range('rounds', 6, 40, 2, '')}</label>
                    <label>AI difficulty ${select(
                        'difficulty',
                        [
                            ['easy', 'Easy'],
                            ['normal', 'Normal'],
                            ['hard', 'Hard'],
                        ],
                        (v) => v as Difficulty,
                    )}</label>
                    <label>On timeout ${select(
                        'timeoutPolicy',
                        [
                            ['lose', 'Lose the action'],
                            ['auto', 'AI plays it for you'],
                        ],
                        (v) => v as TimeoutPolicy,
                    )}</label>
                    <p class="muted">Match settings apply to every match you play in this career. Default ${String(s.rounds)} rounds; 12–16 is a brisk match.</p>
                </section>
            </div>
            <div class="nc-step nc-club" ${shownOn(2)}>
                <section class="opts">
                    <h4>Your club</h4>
                    <div class="nc-names">
                        <label>Club name <input type="text" maxlength="28" placeholder="Leave empty for a random club" ${on('input', (e) => name.set((e.target as HTMLInputElement).value))} /></label>
                        <label>Short <input type="text" class="short-input" maxlength="3" ${attr({ value: shownShort })} ${on(
                            'input',
                            (e) => {
                                shortEdited.set(true);
                                short.set((e.target as HTMLInputElement).value.toUpperCase());
                            },
                        )} /></label>
                    </div>
                    ${preview}
                    <h4>Your ground</h4>
                    ${groundEditor}
                </section>
                <section class="opts">
                    <h4>Home kit</h4>
                    <div class="kit-grid">${kits.map(([k]) => swatch(k, 'home'))}</div>
                    <h4>Away kit <small>worn when the home kit clashes with the hosts'</small></h4>
                    <div class="kit-grid">${kits.map(([k]) => swatch(k, 'away'))}</div>
                    <h4>Goalkeeper</h4>
                    <div class="kit-grid">${defaultConfig.kits.keepers.map((k) => swatch(k, 'keeper'))}</div>
                </section>
            </div>
            <footer class="nc-actions">
                <button class="ghost" ${on('click', () => (step() === 1 ? screen.set('title') : step.set(1)))}>${derived(step, (cur) => (cur === 1 ? 'Back' : '← Country'))}</button>
                <p class="neg" role="status" ${attr({ hidden: derived(startError, (message) => !message) })}>${startError}</p>
                <button class="primary" ${on('click', () => (step() === 1 ? step.set(2) : void create()))}>${derived(step, (cur) => (cur === 1 ? 'Next: your club →' : 'Start career'))}</button>
            </footer>
        </div></div>`;
    };

    const view = $switch(screen)
        .$case('sim', () => (simView ? simView() : html``))
        .$case('match', () => {
            if (!ctl) return html``;
            const c = career();
            const day = finishOdds && c ? today(careerCfg(c), c) : null;
            return MatchView(ctl, {
                onExit: matchExit,
                onSettings: () => showSettings.set(true),
                finishOdds,
                knockout: day?.kind === 'match' && !!day.cup,
            });
        })
        .$case('hub', () => {
            const c = career();
            if (!c) return html``;
            if (import.meta.env.DEV) (window as unknown as { __career: Career }).__career = c;
            return Hub(careerCfg(c), c, hubActions, hubNotice);
        })
        .$case('newCareer', NewCareer)
        .$case('setup', Setup)
        .$default(() => html`${$render(derived(career, Title))}${RadioPlayer({ floating: true })}`);
    // ------------------------------------------------------------ settings (one modal over any screen)
    const showSettings = grain(false);
    const settingsModal = $if(showSettings).$then(() => {
        const c = career();
        return SettingsModal({
            confirm: confirmation.confirm,
            onClose: () => showSettings.set(false),
            defaults: {
                get: () => {
                    const x = settings();
                    return {
                        timerSeconds: x.timerSeconds,
                        rounds: x.rounds,
                        difficulty: x.difficulty,
                        timeoutPolicy: x.timeoutPolicy,
                    };
                },
                set: (o) => {
                    settings.update((x) => ({ ...x, ...o }));
                    saveSettings(settings());
                },
            },
            career: c ? { name: userClub(c).name, settings: c.settings, save: () => saveCareer(c) } : undefined,
            onDeleteCareer: c
                ? () => {
                      deleteCareer();
                      showSettings.set(false);
                      screen.set('title');
                      career.set(null);
                  }
                : undefined,
        });
    });
    const keys = mounted<HTMLDivElement>(() => {
        // audio needs a user gesture; every button gets a tactile click
        const down = () => audio.unlock();
        window.addEventListener('keydown', down, { once: true });
        const click = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('button')) audio.play('click');
        };
        window.addEventListener('pointerdown', down);
        window.addEventListener('click', click);
        const unwatchScreen = screen.subscribe((s) => radio.setMatch(s === 'match'));
        return () => {
            unwatchScreen();
            window.removeEventListener('keydown', down);
            window.removeEventListener('pointerdown', down);
            window.removeEventListener('click', click);
        };
    });
    return html`<div class="app-root" ${keys}>${view}${settingsModal}${confirmation.dialog}</div>`;
};
