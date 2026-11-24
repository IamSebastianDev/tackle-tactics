import { combined, derived, grain } from '@grainular/grains';
import { $if, $render, attr, html, mounted, on } from '@grainular/nord';
import { defaultConfig, withOverrides, type Difficulty, type GameConfig, type TeamStyle, type TimeoutPolicy } from '../config';
import { createRng } from '../rng';
import type { Club } from '../types';
import { generateClub } from '../world/generate';
import { abilitiesOf, classLabel } from '../engine/abilities';
import {
    careerRng, deleteCareer, stadiumOf, endSeason, fixtureClubs, loadCareer, newCareer, playMatchday, saveCareer, simulateScore, today, userClub, userSide,
    type Career,
} from '../meta/career';
import { Hub } from './hub/Hub';
import { styleOf } from '../ai/brain';
import { recolorVersion } from './recolor';
import { generateStadium, rollConditions, type Conditions, type PitchCondition, type StadiumSize, type TimeOfDay, type Weather } from '../world/stadium';
import { SettingsModal } from './Settings';
import { LESSONS } from './tutorial';
import { NowPlayingCard, RadioChip } from './RadioUI';
import { radio } from './radio';
import { applyTalk, matchEdge, prepFor } from '../meta/prep';
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
        mode: 'ai', difficulty: 'normal', timerSeconds: defaultConfig.match.timerSeconds, rounds: defaultConfig.match.rounds,
        timeoutPolicy: defaultConfig.match.timeoutPolicy, homeFormation: '4-3-3', awayFormation: '4-4-2',
        homeKit: 'blue', awayKit: 'yellow', ground: 'random', pitch: 'random', time: 'random', weather: 'random', seed: Math.floor(Math.random() * 1e9),
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...fallback, ...JSON.parse(raw), seed: fallback.seed } : fallback;
    } catch {
        return fallback;
    }
};
const saveSettings = (s: Settings) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
};

const buildClubs = (cfg: GameConfig, s: Settings): [Club, Club] => {
    const rng = createRng(s.seed);
    const names = new Set<string>();
    const kAway = s.awayKit === s.homeKit ? cfg.kits.outfield.find((k) => k !== s.homeKit)! : s.awayKit;
    return [
        generateClub(cfg, rng, 'home', s.homeKit, cfg.kits.keepers[0]!, s.homeFormation, names),
        generateClub(cfg, rng, 'away', kAway, cfg.kits.keepers[1]!, s.awayFormation, names),
    ];
};

/** Weather makes the ball a little less predictable (config.weather); the camera preset comes from Settings. */
const weatherCfg = (base: GameConfig, cond: Conditions) => {
    const k = base.weather.scatterMult[cond.weather] ?? 1;
    const cam = base.camera.modes[prefs().camera] ?? base.camera.modes['2d'];
    return withOverrides({
        ball: { passScatterPerCell: base.ball.passScatterPerCell * k, shotScatterPerCell: base.ball.shotScatterPerCell * k },
        camera: { tiltDeg: cam.tiltDeg, scale: cam.scale },
        sprites: { goalScaleX: cam.goalScaleX, goalScaleY: cam.goalScaleY },
    }, base);
};

/** Match pacing follows the AI-speed preference. */
const pacing = () => {
    const f = AI_SPEED[prefs().aiSpeed];
    return { aiThinkMs: Math.round(defaultConfig.match.aiThinkMs * f), resolvePauseMs: Math.round(defaultConfig.match.resolvePauseMs * f) };
};

export const App = () => {
    const settings = grain<Settings>(loadSettings());
    const showHowto = grain(false);
    const screen = grain<'title' | 'setup' | 'newCareer' | 'hub' | 'match'>('title');
    let ctl: MatchController | null = null;
    let career: Career | null = loadCareer();
    let hubNotice: { title: string; lines: string[] } | null = null;
    let matchExit: () => void = () => {};
    let matchIsCareer = false;

    const configFor = (s: Settings) => withOverrides({ match: { timerSeconds: s.timerSeconds, rounds: s.rounds, timeoutPolicy: s.timeoutPolicy, ...pacing() } });

    const start = () => {
        const s = settings();
        saveSettings(s);
        const clubs = buildClubs(configFor(s), s);
        const pick = <T extends string>(v: 'random' | T) => (v === 'random' ? undefined : v);
        const stadium = generateStadium(`quick-${s.seed}-${Math.random()}`, clubs[0].name.split(' ')[0]!, undefined, { size: pick(s.ground), condition: pick(s.pitch) });
        const conditions = rollConditions(createRng(Math.floor(Math.random() * 1e9)), stadium, { time: pick(s.time), weather: pick(s.weather) });
        const cfg = weatherCfg(configFor(s), conditions);
        const controllers: [Controller, Controller] =
            s.mode === 'ai' ? ['human', 'ai'] : s.mode === 'hotseat' ? ['human', 'human'] : ['ai', 'ai'];
        ctl = new MatchController(cfg, clubs, { controllers, difficulty: s.difficulty, seed: s.seed, stadium, conditions });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = exit;
        matchIsCareer = false;
        screen.set('match');
    };
    const startTutorial = () => {
        const s: Settings = { ...settings(), mode: 'ai', seed: 4242, homeFormation: '4-3-3', awayFormation: '4-4-2', homeKit: 'blue', awayKit: 'yellow' };
        const base = withOverrides({ match: { timerSeconds: 0, rounds: 30, ...pacing() } });
        const clubs = buildClubs(base, s);
        const stadium = generateStadium('tutorial-ground', 'Training', undefined, { size: 'village', condition: 'lush' });
        const conditions: Conditions = { time: 'day', weather: 'clear' };
        ctl = new MatchController(weatherCfg(base, conditions), clubs, { controllers: ['human', 'ai'], difficulty: 'normal', seed: 4242, stadium, conditions, tutorial: LESSONS });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = () => { ctl?.stop(); ctl = null; screen.set('title'); };
        matchIsCareer = false;
        screen.set('match');
    };
    const exit = () => {
        ctl?.stop();
        ctl = null;
        settings.update((s) => ({ ...s, seed: Math.floor(Math.random() * 1e9) }));
        screen.set('setup');
    };

    // ------------------------------------------------------------ career flow
    const careerCfg = (c: Career) => withOverrides({ match: { timerSeconds: c.settings.timerSeconds, rounds: c.settings.rounds, timeoutPolicy: c.settings.timeoutPolicy, ...pacing() } });

    const reportNotice = (c: Career, title: string, newsBefore: number) => {
        const fresh = c.news.slice(0, Math.max(0, c.news.length - newsBefore)).map((n) => n.text);
        hubNotice = { title, lines: fresh.length ? fresh.slice(0, 8) : ['Matchday complete.'] };
    };

    const playCareerMatch = () => {
        const c = career!;
        const cfg = careerCfg(c);
        const t = today(cfg, c);
        if (t.kind !== 'match') return;
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
        ctl = new MatchController(weatherCfg(cfg, conditions), clubs, { controllers, difficulty: c.settings.difficulty, seed: Math.floor(Math.random() * 1e9), stadium, conditions, referee: prep.referee, plans });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl;
        matchIsCareer = true;
        matchExit = () => {
            const m = ctl!.match;
            let score = [...m.state.score] as [number, number];
            if (!m.state.over) {
                // leaving early: the rest of the match is simulated from the current score
                const rng = careerRng(c);
                const rest = simulateScore(cfg, rng, c, t.fixture, Math.max(0, 1 - (m.state.round - 1) / cfg.match.rounds));
                c.rngState = rng.state();
                score = [score[0] + rest[0], score[1] + rest[1]];
            }
            const played = m.everyone().filter((p) => p.team === side).map((p) => p.id);
            const stats = ctl!.stats;
            ctl!.stop();
            ctl = null;
            const before = c.news.length;
            // real lines only if the match was finished on the board
            const lines = m.state.over
                ? Object.fromEntries(m.everyone().map((p) => {
                    const l = stats.players.get(p.id);
                    return [p.id, { goals: l?.goals ?? 0, assists: l?.assists ?? 0, rating: stats.rating(p) }];
                }))
                : undefined;
            playMatchday(cfg, c, { score, knocks: m.state.knocks, played, lines });
            saveCareer(c);
            const [h, a] = [c.clubs[t.fixture.home]!, c.clubs[t.fixture.away]!];
            reportNotice(c, `${h.short} ${score[0]} – ${score[1]} ${a.short}${m.state.over ? '' : ' (rest simulated)'}`, before);
            screen.set('hub');
        };
        screen.set('match');
    };

    const simCareerMatch = () => {
        const c = career!;
        const cfg = careerCfg(c);
        const t = today(cfg, c);
        if (t.kind !== 'match') return;
        const rng = careerRng(c);
        const prep = prepFor(cfg, c, t.fixture);
        const talk = applyTalk(cfg, c, t.fixture, prep, rng);
        if (talk) c.news.unshift({ season: c.season, day: c.day, text: talk, tone: 'info' });
        const score = simulateScore(cfg, rng, c, t.fixture, 1, matchEdge(cfg, c, t.fixture, prep));
        c.rngState = rng.state();
        const before = c.news.length;
        playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
        saveCareer(c);
        const [h, a] = [c.clubs[t.fixture.home]!, c.clubs[t.fixture.away]!];
        reportNotice(c, `${h.short} ${score[0]} – ${score[1]} ${a.short}`, before);
        screen.set('title');
        screen.set('hub');
    };

    const hubActions = {
        playMatch: playCareerMatch,
        simMatch: simCareerMatch,
        endSeason: () => endSeason(careerCfg(career!), career!),
        exit: () => { if (career) saveCareer(career); screen.set('title'); },
        settings: () => showSettings.set(true),
    };

    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => settings.update((s) => ({ ...s, [k]: v }));

    const select = <K extends keyof Settings>(k: K, opts: Array<[string, string]>, cast: (v: string) => Settings[K]) =>
        html`<select ${on('change', (e) => set(k, cast((e.target as HTMLSelectElement).value)))}>
            ${opts.map(([v, label]) => html`<option value="${v}" ${attr({ selected: settings()[k] === cast(v) })}>${label}</option>`)}
        </select>`;

    const range = (k: 'timerSeconds' | 'rounds', min: number, max: number, step: number, unit: string) => {
        const label = derived(settings, (s) => (k === 'timerSeconds' && s[k] <= 0 ? 'Off' : `${s[k]}${unit}`));
        return html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(settings()[k])}"
            ${on('input', (e) => set(k, Number((e.target as HTMLInputElement).value)))} /><output>${label}</output></div>`;
    };

    const squadPreview = derived(combined([settings, recolorVersion]), ([s]) => {
        const cfg = configFor(s);
        const clubs = buildClubs(cfg, s);
        return html`<div class="squads">${clubs.map((c, t) => html`<div class="squad" style="--kit:${kitColor(c.kit)}">
            <h3><span class="kit"></span>${c.name} <small>${c.formationId} · ${defaultConfig.ai.styles[styleOf(c)].label} · ${t === 0 ? (s.mode === 'watch' ? 'AI' : 'You') : s.mode === 'hotseat' ? 'Player 2' : 'AI'}</small></h3>
            <ul>${c.squad.map((p) => html`<li>
                <div class="sprite still" style="${spriteStyle(cfg, p.sprite, 'idle', 'down', p)}"></div>
                <span class="num">${String(p.number)}</span>
                <span class="nm">${p.name}</span>
                <span class="cl" title="${abilitiesOf(cfg, p).map((id) => cfg.abilities[id].label).join(', ') || 'No abilities yet'}">${classLabel(cfg, p)}</span>
                <span class="sp" title="Speed (turn order)">⚡${String(p.stats.speed)}</span>
            </li>`)}</ul>
        </div>`)}</div>`;
    });

    const formations = defaultConfig.formations.map((f) => [f.id, f.label] as [string, string]);
    const kits = defaultConfig.kits.outfield.map((k) => [k, k[0]!.toUpperCase() + k.slice(1)] as [string, string]);

    const Setup = () => html`<div class="setup">
        <div class="setup-inner">
            <h1>Tackle <span>Tactics</span></h1>
            <p class="tag">A turn-based positioning game in a football kit. Make space, deny space, beat the clock.</p>
            <div class="setup-grid">
                <section class="opts">
                    <label>Mode ${select('mode', [['ai', 'You vs AI'], ['hotseat', 'Hotseat (2 players)'], ['watch', 'Watch AI vs AI']], (v) => v as Mode)}</label>
                    <label>AI difficulty ${select('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => v as Difficulty)}</label>
                    <label>Action timer ${range('timerSeconds', 0, 45, 1, 's')}</label>
                    <label>Match length (rounds) ${range('rounds', 6, 40, 2, '')}</label>
                    <label>On timeout ${select('timeoutPolicy', [['lose', 'Lose the action'], ['auto', 'AI plays it for you']], (v) => v as TimeoutPolicy)}</label>
                    <div class="pair"><label>Home formation ${select('homeFormation', formations, (v) => v)}</label>
                    <label>Away formation ${select('awayFormation', formations, (v) => v)}</label></div>
                    <div class="pair"><label>Home kit ${select('homeKit', kits, (v) => v)}</label>
                    <label>Away kit ${select('awayKit', kits, (v) => v)}</label></div>
                    <div class="pair"><label>Ground ${select('ground', [['random', 'Random'], ['village', 'Village'], ['town', 'Town'], ['city', 'City'], ['grand', 'Grand']], (v) => v as Settings['ground'])}</label>
                    <label>Pitch ${select('pitch', [['random', 'Random'], ['lush', 'Lush'], ['dry', 'Dry'], ['muddy', 'Muddy'], ['frost', 'Frosty']], (v) => v as Settings['pitch'])}</label></div>
                    <div class="pair"><label>Kick-off ${select('time', [['random', 'Random'], ['day', 'Afternoon'], ['dusk', 'Dusk'], ['night', 'Night']], (v) => v as Settings['time'])}</label>
                    <label>Weather ${select('weather', [['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain'], ['snow', 'Snow'], ['fog', 'Fog']], (v) => v as Settings['weather'])}</label></div>
                    <div class="buttons">
                        <button class="ghost" ${on('click', () => screen.set('title'))}>Back</button>
                        <button class="ghost" ${on('click', () => showHowto.set(true))}>How to play</button>
                        <button class="ghost" ${on('click', () => set('seed', Math.floor(Math.random() * 1e9)))}>New squads</button>
                        <button class="primary" ${on('click', start)}>Kick off</button>
                    </div>
                </section>
                ${$render(squadPreview)}
            </div>
            ${$if(showHowto).$then(() => html`<div class="modal" ${on('click', (e) => { if (e.target === e.currentTarget) showHowto.set(false); })}>
                <div class="modal-body howto-modal"><header><h2>How to play</h2><button class="ghost" ${on('click', () => showHowto.set(false))}>Close</button></header>            
                <ul>
                    <li>All 22 players act one at a time, fastest first, teams alternating. A <b>round</b> is everyone acting once.</li>
                    <li>Each action has a timer. Act early to pass the baton; hesitate and you lose the action.</li>
                    <li><b>Move</b> (blue). Off-ball runs stop when they enter an opponent's adjacent cell — that's marking.</li>
                    <li>With the ball you may dribble, then <b>pass or shoot</b>: aim anywhere — the orange zone is where the ball may land. Longer = bigger gamble. Aim at the goal mouth to shoot.</li>
                    <li><b>Reactions</b>: every player has one per round. Dribble past someone or play the ball near them and they get a tackle/intercept roll. Pink cells show live reaction zones; dimmed rings are spent.</li>
                    <li>Passes longer than ${String(defaultConfig.ball.loftThreshold)} cells are lofted: only contestable near take-off and landing.</li>
                    <li><b>Abilities</b> come from class levels (hover a player's class for their kit). Wingers sprint, trick and cross; strikers run in behind and pick their shot; midfielders press, thread through balls and set the tempo; defenders slide, man-mark and foul; keepers command and rush out. Multiclass players get both kits. Most have a cooldown in rounds.</li>
                    <li>Keys: <kbd>Space</kbd> hold / end, <kbd>1</kbd>–<kbd>9</kbd> abilities, <kbd>T</kbd> tackle, <kbd>Esc</kbd> cancel, <kbd>A</kbd> let the AI play this action.</li>
                </ul>
            </div></div>`)}
            <p class="credits">Art by bubbabba · Goals in Pixels</p>
        </div>
    </div>`;

    // ------------------------------------------------------------ title & new career
    const titleScene = () => {
        const figs: Array<[string, string, number, string]> = [
            ['blue_player_1', 'celebrate_down', 22, 'down'], ['yellow_player_2', 'idle_left', 70, 'left'],
            ['blue_player_2', 'juggle_right', 8, 'right'], ['keeper_pink', 'gk_ready_down', 84, 'down'],
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

    const Title = () => html`<div class="setup title-screen">${titleScene()}<div class="setup-inner">
        <h1>Tackle <span>Tactics</span></h1>
        <p class="tag">A turn-based positioning game in a football kit. Make space, deny space, beat the clock.</p>
        ${$render(RadioChip('title-radio'))}
        <div class="title-cards">
            ${career ? html`<button class="tcard primary-card" ${on('click', () => screen.set('hub'))}>
                <b>Continue career</b><span>${userClub(career).name} · Season ${String(career.season)} · Division ${String(userClub(career).tier + 1)}</span></button>` : html``}
            <button class="tcard" ${on('click', startTutorial)}><b>Tutorial</b><span>Eight short lessons on the training ground. Start here.</span></button>
            <button class="tcard" ${on('click', () => screen.set('newCareer'))}><b>New career</b><span>Take a club from the bottom division to the top. Train, trade, promote.</span></button>
            <button class="tcard" ${on('click', () => showSettings.set(true))}><b>Settings</b><span>UI scale, font, pacing and match defaults.</span></button>
            <button class="tcard" ${on('click', () => screen.set('setup'))}><b>Quick match</b><span>One-off match: vs AI, hotseat or watch.</span></button>
        </div>
        <p class="credits">Art by bubbabba · Goals in Pixels</p>
    </div></div>`;

    const NewCareer = () => {
        const name = grain('');
        const kit = grain('blue');
        const s = settings();
        const create = () => {
            if (career && !confirm('Start a new career? Your current save will be replaced.')) return;
            deleteCareer();
            career = newCareer(defaultConfig, Math.floor(Math.random() * 1e9), {
                timerSeconds: settings().timerSeconds, rounds: settings().rounds, difficulty: settings().difficulty, timeoutPolicy: settings().timeoutPolicy,
            }, { name: name().trim() || undefined, kit: kit() });
            saveCareer(career);
            hubNotice = { title: `Welcome to ${userClub(career).name}`, lines: [
                'You start in division 5 of 5. The top 2 clubs are promoted each season.',
                'Every 3 days there is a matchday; the days between are for training.',
                'Use Training to level up class skills (and unlock abilities), Tactics to set your XI, Market to buy and sell.',
                'Press the yellow button at the top right to move the calendar on.',
            ] };
            screen.set('hub');
        };
        return html`<div class="setup"><div class="setup-inner narrow">
            <h1>New <span>career</span></h1>
            <section class="opts">
                <label>Club name <input type="text" placeholder="Leave empty for a random club" ${on('input', (e) => name.set((e.target as HTMLInputElement).value))} /></label>
                <label>Kit <select ${on('change', (e) => kit.set((e.target as HTMLSelectElement).value))}>${kits.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
                <label>Action timer ${range('timerSeconds', 0, 45, 1, 's')}</label>
                <label>Match length (rounds) ${range('rounds', 6, 40, 2, '')}</label>
                <label>AI difficulty ${select('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => v as Difficulty)}</label>
                <label>On timeout ${select('timeoutPolicy', [['lose', 'Lose the action'], ['auto', 'AI plays it for you']], (v) => v as TimeoutPolicy)}</label>
                <p class="muted">Match settings apply to every match you play in this career. Default ${String(s.rounds)} rounds; 12–16 is a brisk match.</p>
                <div class="buttons"><button class="ghost" ${on('click', () => screen.set('title'))}>Back</button><button class="primary" ${on('click', create)}>Start career</button></div>
            </section>
        </div></div>`;
    };

    const view = derived(screen, (s) => {
        if (s === 'match' && ctl) return MatchView(ctl, () => matchExit(), () => showSettings.set(true), career && ctl.isHuman(0) !== ctl.isHuman(1) && matchIsCareer ? 'Back to the club' : 'Back to menu');
        if (s === 'hub' && career) {
            if (import.meta.env.DEV) (window as unknown as { __career: Career }).__career = career; // debugging hook
            const n = hubNotice;
            hubNotice = null;
            return Hub(careerCfg(career), career, hubActions, n);
        }
        if (s === 'newCareer') return NewCareer();
        if (s === 'setup') return Setup();
        return Title();
    });
    // ------------------------------------------------------------ settings (one modal over any screen)
    const showSettings = grain(false);
    const settingsModal = derived(showSettings, (open) => (open ? SettingsModal({
        onClose: () => showSettings.set(false),
        defaults: {
            get: () => { const x = settings(); return { timerSeconds: x.timerSeconds, rounds: x.rounds, difficulty: x.difficulty, timeoutPolicy: x.timeoutPolicy }; },
            set: (o) => { settings.update((x) => ({ ...x, ...o })); saveSettings(settings()); },
        },
        career: career ? { name: userClub(career).name, settings: career.settings, save: () => saveCareer(career!) } : undefined,
        onDeleteCareer: career ? () => { deleteCareer(); career = null; showSettings.set(false); screen.set('newCareer'); screen.set('title'); } : undefined,
    }) : html``));
    const keys = mounted<HTMLDivElement>(() => {
        const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && showSettings()) { e.stopImmediatePropagation(); showSettings.set(false); } };
        // audio needs a user gesture; every button gets a tactile click
        const down = () => audio.unlock();
        window.addEventListener('keydown', down, { once: true });
        const click = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('button')) audio.play('click'); };
        window.addEventListener('keydown', k, true);
        window.addEventListener('pointerdown', down);
        window.addEventListener('click', click);
        return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('pointerdown', down); window.removeEventListener('click', click); };
    });
    screen.subscribe((s) => radio.setMatch(s === 'match'));
    return html`<div class="app-root" ${keys}>${$render(view)}${$render(settingsModal)}${$render(NowPlayingCard())}</div>`;
};
