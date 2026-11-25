/** Settings modal: display (scale, font, motion), pacing, match defaults, the current career, data. */
import { combined, derived, grain, type Grain } from '@grainular/grains';
import { COIN } from '../meta/player';
import type { Confirm } from './confirm';
import { fullscreen, isDesktop, setFullscreen } from './desktop';
import { $switch, attr, html, on } from '@grainular/nord';
import { controlValue, distinct } from './value';
import { Dialog } from './Dialog';
import type { Difficulty, TimeoutPolicy } from '../config';
import type { CareerSettings } from '../meta/career';
import { saveLocation } from '../meta/storage';
import { allTracks, nowPlaying, radio, STATION, trackKey } from './radio';
import { audio } from './audio';
import { CONTROL_MODES, FONTS, prefs, setPref, UI_SCALES, type AiSpeed } from './prefs';

/** The match options shared by quick matches, new careers and a running career. */
export type MatchOpts = { timerSeconds: number; rounds: number; difficulty: Difficulty; timeoutPolicy: TimeoutPolicy };

export type SettingsProps = {
    onClose: () => void;
    confirm: Confirm;
    /** Defaults for quick matches and new careers. */
    defaults: { get: () => MatchOpts; set: (o: MatchOpts) => void };
    /** The running career's match options, if one is loaded. */
    career?: { name: string; settings: CareerSettings; save: () => void };
    onDeleteCareer?: () => void;
};

const seg = <T extends string | number>(value: Grain<T>, options: Array<[T, string]>, set: (v: T) => void) =>
    html`<div class="seg">${options.map(([v, label]) => {
        const active = derived(value, (current) => current === v);
        return html`<button ${attr({ class: derived(active, (selected) => (selected ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => set(v))}>${label}</button>`;
    })}</div>`;

const slider = (value: Grain<number>, min: number, max: number, step: number, unit: string, set: (v: number) => void) =>
    html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(value())}" ${controlValue(value)}
        ${on('input', (e) => set(Number((e.currentTarget as HTMLInputElement).value)))} /><output>${derived(value, (v) => `${v}${unit}`)}</output></div>`;

/** One block of match options bound to a getter/setter. */
const matchOptions = (get: () => MatchOpts, set: (o: MatchOpts) => void) => {
    const options = grain(get());
    const put = <K extends keyof MatchOpts>(k: K, v: MatchOpts[K]) => {
        const next = { ...get(), [k]: v };
        set(next);
        options.set(next);
    };
    return html`<div class="set-rows">
        <div class="set-row"><span>Action timer<small>Seconds per action before you lose it. Off = no clock at all.</small></span>${seg(
            derived(options, (o) => o.timerSeconds),
            [
                [0, 'Off'],
                [8, '8s'],
                [10, '10s'],
                [15, '15s'],
                [20, '20s'],
                [30, '30s'],
                [45, '45s'],
            ] as Array<[number, string]>,
            (v) => put('timerSeconds', v),
        )}</div>
        <label class="set-row"><span>Match length<small>Rounds per match (everyone acts once per round)</small></span>${slider(
            derived(options, (o) => o.rounds),
            6,
            40,
            2,
            '',
            (v) => put('rounds', v),
        )}</label>
        <div class="set-row"><span>AI difficulty</span>${seg(
            derived(options, (o) => o.difficulty),
            [
                ['easy', 'Easy'],
                ['normal', 'Normal'],
                ['hard', 'Hard'],
            ],
            (v) => put('difficulty', v),
        )}</div>
        <div class="set-row"><span>On timeout</span>${seg(
            derived(options, (o) => o.timeoutPolicy),
            [
                ['lose', 'Lose action'],
                ['auto', 'AI plays it'],
            ],
            (v) => put('timeoutPolicy', v),
        )}</div>
    </div>`;
};

/** Every song on the station with an on/off switch; clicking a title plays it now. */
const SongList = () => {
    const tracks = allTracks();
    if (!tracks.length) return html`<p class="muted">No songs yet: drop audio files into assets/music (named "Artist - Title").</p>`;
    const disabled = derived(prefs, (p) => p.radioDisabled);
    const onCount = derived(disabled, (off) => String(tracks.filter((t) => !off.includes(trackKey(t))).length));
    return html`<div class="songs">
        <div class="songs-head"><span>Songs <small>${onCount} of ${String(tracks.length)} on · click a title to play it</small></span>
            <button class="ghost" ${on('click', () => setPref('radioDisabled', []))}>All on</button></div>
        <ul>${tracks.map((t) => {
            const k = trackKey(t);
            const enabled = derived(disabled, (off) => !off.includes(k));
            const now = derived(nowPlaying, (playing) => playing?.url === t.url);
            const cls = derived(combined([enabled, now]), ([isEnabled, playing]) => `${isEnabled ? '' : 'off'} ${playing ? 'now' : ''}`);
            const toggle = (value: 'on' | 'off') => {
                if ((value === 'on') === enabled()) return;
                const off = disabled();
                setPref('radioDisabled', value === 'on' ? off.filter((key) => key !== k) : [...off, k]);
                radio.checkCurrent();
            };
            return html`<li ${attr({ class: cls })}>
                <button class="song-play" title="Play now" ${on('click', () => radio.playNow(t))}><i>${derived(now, (playing) => (playing ? '♫' : '▶'))}</i><b>${t.title}</b><span>${t.artist ?? STATION}</span></button>
                ${seg(
                    derived(enabled, (value) => (value ? 'on' : 'off')),
                    [
                        ['on', 'On'],
                        ['off', 'Off'],
                    ],
                    toggle,
                )}
            </li>`;
        })}</ul>
    </div>`;
};

export const SettingsModal = (props: SettingsProps) => {
    const savePath = grain('…');
    void saveLocation()
        .then((p) => savePath.set(p))
        .catch(() => savePath.set('Unknown'));
    type Tab = 'display' | 'sound' | 'gameplay' | 'career' | 'about';
    const tab = grain<Tab>('display');
    const pref = <K extends keyof ReturnType<typeof prefs>>(key: K) => distinct(derived(prefs, (p) => p[key]));
    /** How many coach tips have been seen (match and hub), and the confirmation after a reset. */
    const seenTips = derived(pref('tipsSeen'), (seen) => seen.length);
    const tipsReset = grain('');
    const toggle = (key: 'autoZoom' | 'reduceMotion' | 'muted' | 'radioOn' | 'matchIntro' | 'tips') =>
        derived(pref(key), (value) => (value ? 'on' : 'off'));
    const Display = () => {
        return html`<div class="set-rows">
                <div class="set-row"><span>UI scale<small>Bigger UI shows less around it. Applies instantly.</small></span>
                    ${seg(
                        pref('uiScale'),
                        UI_SCALES.map((s) => [s, `${Math.round(s * 100)}%`] as [number, string]),
                        (v) => setPref('uiScale', v),
                    )}</div>
                <div class="set-row"><span>Fullscreen<small>F11 or ${isDesktop && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+Enter toggles it anywhere.</small></span>
                    ${seg(
                        derived(fullscreen, (f) => (f ? 'on' : 'off')),
                        [
                            ['off', 'Window'],
                            ['on', 'Fullscreen'],
                        ],
                        (v) => void setFullscreen(v === 'on'),
                    )}</div>
                <div class="set-row top"><span>Font<small>The players and the pitch stay pixel art in every style.</small></span>
                    <div class="font-list">${FONTS.map(
                        (
                            f,
                        ) => html`<button ${attr({ class: derived(pref('font'), (font) => `font-opt ${font === f.id ? 'on' : ''}`) })} data-font="${f.id}" ${on('click', () => setPref('font', f.id))}>
                        <b>${f.label}</b><span class="sample">National League · 128k${COIN} · Run in behind</span><small>${f.note}</small></button>`,
                    )}</div></div>
                <div class="set-row"><span>Auto zoom<small>The camera leans in when players crowd the ball. Wheel or +/− zoom by hand, 0 resets.</small></span>
                    ${seg(
                        toggle('autoZoom'),
                        [
                            ['on', 'On'],
                            ['off', 'Off'],
                        ],
                        (v) => setPref('autoZoom', v === 'on'),
                    )}</div>
                <div class="set-row"><span>Reduce motion<small>Stops blinking and pulsing UI elements.</small></span>
                    ${seg(
                        toggle('reduceMotion'),
                        [
                            ['off', 'Off'],
                            ['on', 'On'],
                        ],
                        (v) => setPref('reduceMotion', v === 'on'),
                    )}</div>
            </div>`;
    };
    const Sound = () => {
        const vol = (
            k: 'sfxVolume' | 'crowdVolume',
            label: string,
            note: string,
        ) => html`<label class="set-row"><span>${label}<small>${note}</small></span>
                ${slider(
                    derived(pref(k), (value) => Math.round(value * 100)),
                    0,
                    100,
                    5,
                    '%',
                    (v) => {
                        setPref(k, v / 100);
                        if (k === 'sfxVolume') audio.play('kick');
                    },
                )}</label>`;
        return html`<div class="set-rows">
                <div class="set-row"><span>Sound<small>M toggles it during a match.</small></span>${seg(
                    derived(pref('muted'), (muted) => (muted ? 'off' : 'on')),
                    [
                        ['on', 'On'],
                        ['off', 'Muted'],
                    ],
                    (v) => setPref('muted', v === 'off'),
                )}</div>
                ${vol('sfxVolume', 'Effects', 'Kicks, tackles, whistles, UI.')}
                ${vol('crowdVolume', 'Crowd', 'The ambience that swells as the ball nears goal.')}
                <h4>Radio <small>songs from assets/music · N next song · R on/off</small></h4>
                <div class="set-row"><span>Radio</span>${seg(
                    toggle('radioOn'),
                    [
                        ['on', 'On'],
                        ['off', 'Off'],
                    ],
                    (v) => radio.setOn(v === 'on'),
                )}</div>
                <label class="set-row"><span>Radio volume</span>${slider(
                    derived(pref('radioVolume'), (value) => Math.round(value * 100)),
                    0,
                    100,
                    5,
                    '%',
                    (v) => setPref('radioVolume', v / 100),
                )}</label>
                <div class="set-row"><span>During matches<small>Quieter keeps it under the crowd and the commentary.</small></span>${seg(
                    pref('radioInMatch'),
                    [
                        ['on', 'Full'],
                        ['quiet', 'Quieter'],
                        ['off', 'Off'],
                    ] as Array<['on' | 'quiet' | 'off', string]>,
                    (v) => setPref('radioInMatch', v),
                )}</div>
                ${SongList()}
            </div>`;
    };
    const Gameplay = () => {
        return html`<div>
                <div class="set-rows"><div class="set-row"><span>Match intro<small>Both squads on the pitch, the commentators and the ground before kick-off. Enter or Esc kicks off.</small></span>
                    ${seg(
                        toggle('matchIntro'),
                        [
                            ['on', 'Show'],
                            ['off', 'Skip'],
                        ],
                        (v) => setPref('matchIntro', v === 'on'),
                    )}</div>
                <div class="set-row"><span>AI speed<small>How quickly AI players act and results resolve.</small></span>
                    ${seg(
                        pref('aiSpeed'),
                        [
                            ['fast', 'Fast'],
                            ['normal', 'Normal'],
                            ['slow', 'Slow'],
                        ] as Array<[AiSpeed, string]>,
                        (v) => setPref('aiSpeed', v),
                    )}</div>
                <div class="set-row top"><span>Focus<small>Which of your players ask for orders. F cycles it in a match.</small></span>
                    <div class="font-list">${CONTROL_MODES.map((m) => html`<button ${attr({ class: derived(pref('controlMode'), (mode) => `font-opt ${mode === m.id ? 'on' : ''}`) })} ${on('click', () => setPref('controlMode', m.id))}><b>${m.label}</b><small>${m.note}</small></button>`)}</div></div>
                <div class="set-row"><span>Coach tips<small>One-time hints the first time something happens.</small></span>
                    <div class="seg">${seg(
                        toggle('tips'),
                        [
                            ['on', 'On'],
                            ['off', 'Off'],
                        ],
                        (v) => setPref('tips', v === 'on'),
                    )}</div></div>
                <div class="set-row"><span>Tutorial messages<small>Show every coach tip again, in matches and in the career hub.</small></span>
                    <div class="set-reset">
                        <button class="ghost" ${attr({ disabled: derived(seenTips, (n) => n === 0) })} ${on('click', () => {
                            const n = seenTips();
                            setPref('tipsSeen', []);
                            setPref('tips', true);
                            tipsReset.set(`${n} tip${n === 1 ? '' : 's'} will show again.`);
                        })}>Reset tutorial messages</button>
                        <small role="status">${derived(combined([seenTips, tipsReset]), ([n, done]) => done || (n ? `${n} seen so far` : 'None seen yet'))}</small>
                    </div></div>
                </div>
                <h4>Match defaults <small>quick matches & new careers</small></h4>
                ${matchOptions(props.defaults.get, props.defaults.set)}
            </div>`;
    };
    const Career = () => {
        const c = props.career;
        if (!c) return html`<p class="muted">No career loaded.</p>`;
        return html`<div>
            <h4>${c.name} <small>applies from the next match</small></h4>
            ${matchOptions(
                () => c.settings,
                (o) => {
                    Object.assign(c.settings, o);
                    c.save();
                },
            )}
            <h4>Save file <small>saved automatically after every change</small></h4>
            <p class="save-path">${savePath}</p>
            ${
                props.onDeleteCareer
                    ? html`<div class="danger-zone"><span>Delete this career save. This can't be undone.</span>
                <button class="warn" ${on('click', async () => {
                    if (
                        await props.confirm({
                            title: 'Delete this career?',
                            body: `“${c.name}” will be removed from the active save slot.`,
                            action: 'Delete career',
                        })
                    )
                        props.onDeleteCareer!();
                })}>Delete career</button></div>`
                    : html``
            }
        </div>`;
    };
    const About = () => html`<div class="about">
        <h4>A vibe-coded game</h4>
        <p>Tackle Tactics is a hobby project, built by directing AI coding assistants (mostly Claude) rather than writing every
        line by hand. The design, the decisions and the playtesting are human; much of the code is not. Expect rough edges,
        odd balance and the occasional bug, and please report what you find.</p>
        <h4>Credits</h4>
        <dl class="credits-list">
            <dt>Design & direction</dt><dd>Sebastian Heinz</dd>
            <dt>Code</dt><dd>Written with AI coding assistants (Claude Code)</dd>
            <dt>Players, pitch & stadium art</dt><dd><i>Soccer Match – Top Down Football Tileset & Players</i> by bubbabba (bubbabba.itch.io)</dd>
            <dt>Additional art</dt><dd><i>Goals in Pixels</i></dd>
            <dt>Radio</dt><dd>Each song is credited to its artist in the player</dd>
            <dt>Fonts</dt><dd>Barlow Condensed, Inter, Silkscreen, Pixelify Sans, VT323 (SIL Open Font License, via Fontsource)</dd>
            <dt>Built with</dt><dd>Nørd & Grains, TypeScript, Vite, Tauri</dd>
        </dl>
        <p class="muted">Clubs, players, nations and leagues are invented. Any resemblance to real ones is a nod, not a claim.</p>
    </div>`;
    const tabs: Tab[] = ['display', 'sound', 'gameplay'];
    if (props.career) tabs.push('career');
    tabs.push('about');
    return Dialog({
        label: 'Settings',
        className: 'modal settings-modal',
        dismiss: props.onClose,
        children: html`<div class="modal-body">
            <header><h2>Settings</h2><button class="ghost" ${on('click', props.onClose)}>Close <kbd>Esc</kbd></button></header>
            <div class="seg tabs">${tabs.map((id) => {
                const active = derived(tab, (current) => current === id);
                return html`<button ${attr({ class: derived(active, (selected) => (selected ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => tab.set(id))}>${id[0]!.toUpperCase() + id.slice(1)}</button>`;
            })}</div>
            <div class="modal-scroll set-body">${$switch(tab).$case('display', Display).$case('sound', Sound).$case('gameplay', Gameplay).$case('about', About).$default(Career)}</div>
            <p class="set-version" title="Include this when you report a bug">Tackle Tactics v${__APP_VERSION__}${__APP_COMMIT__ ? html` <span>· build ${__APP_COMMIT__}</span>` : html``}</p>
        </div>`,
    });
};
