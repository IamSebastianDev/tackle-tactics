/** Settings modal: display (scale, font, motion), pacing, match defaults, the current career, data. */
import { combined, derived, grain, type WritableGrain } from '@grainular/grains';
import { fullscreen, isDesktop, setFullscreen } from './desktop';
import { $render, attr, html, on } from '@grainular/nord';
import type { Difficulty, TimeoutPolicy } from '../config';
import type { CareerSettings } from '../meta/career';
import { saveLocation } from '../meta/storage';
import { radio } from './radio';
import { audio } from './audio';
import { CONTROL_MODES, FONTS, prefs, setPref, UI_SCALES, type AiSpeed } from './prefs';

/** The match options shared by quick matches, new careers and a running career. */
export type MatchOpts = { timerSeconds: number; rounds: number; difficulty: Difficulty; timeoutPolicy: TimeoutPolicy };

export type SettingsProps = {
    onClose: () => void;
    /** Defaults for quick matches and new careers. */
    defaults: { get: () => MatchOpts; set: (o: MatchOpts) => void };
    /** The running career's match options, if one is loaded. */
    career?: { name: string; settings: CareerSettings; save: () => void };
    onDeleteCareer?: () => void;
};

const seg = <T extends string | number>(value: T, options: Array<[T, string]>, set: (v: T) => void) =>
    html`<div class="seg">${options.map(([v, label]) => html`<button class="${v === value ? 'on' : ''}" ${on('click', () => set(v))}>${label}</button>`)}</div>`;

const slider = (value: number, min: number, max: number, step: number, unit: string, set: (v: number) => void) => {
    const shown = grain(value);
    return html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(value)}"
        ${on('input', (e) => { const v = Number((e.target as HTMLInputElement).value); shown.set(v); set(v); })} /><output>${derived(shown, (v) => `${v}${unit}`)}</output></div>`;
};

/** One block of match options bound to a getter/setter. */
const matchOptions = (get: () => MatchOpts, set: (o: MatchOpts) => void, bump: WritableGrain<number>) => {
    const put = <K extends keyof MatchOpts>(k: K, v: MatchOpts[K]) => { set({ ...get(), [k]: v }); bump.update((n) => n + 1); };
    const o = get();
    return html`<div class="set-rows">
        <div class="set-row"><span>Action timer<small>Seconds per action before you lose it. Off = no clock at all.</small></span>${seg(o.timerSeconds, [[0, 'Off'], [8, '8s'], [10, '10s'], [15, '15s'], [20, '20s'], [30, '30s'], [45, '45s']] as Array<[number, string]>, (v) => put('timerSeconds', v))}</div>
        <label class="set-row"><span>Match length<small>Rounds per match (everyone acts once per round)</small></span>${slider(o.rounds, 6, 40, 2, '', (v) => put('rounds', v))}</label>
        <div class="set-row"><span>AI difficulty</span>${seg(o.difficulty, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => put('difficulty', v))}</div>
        <div class="set-row"><span>On timeout</span>${seg(o.timeoutPolicy, [['lose', 'Lose action'], ['auto', 'AI plays it']], (v) => put('timeoutPolicy', v))}</div>
    </div>`;
};

export const SettingsModal = (props: SettingsProps) => {
    const savePath = grain('…');
    void saveLocation().then((p) => savePath.set(p)).catch(() => savePath.set('Unknown'));
    const tab = grain<'display' | 'sound' | 'gameplay' | 'career'>('display');
    const bump = grain(0);
    const body = derived(combined([tab, prefs, bump]), ([t, p]) => {
        if (t === 'display') {
            return html`<div class="set-rows">
                <div class="set-row"><span>UI scale<small>Bigger UI shows less around it. Applies instantly.</small></span>
                    ${seg(p.uiScale, UI_SCALES.map((s) => [s, `${Math.round(s * 100)}%`] as [number, string]), (v) => setPref('uiScale', v))}</div>
                <div class="set-row"><span>Fullscreen<small>F11 or ${isDesktop && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+Enter toggles it anywhere.</small></span>
                    ${$render(derived(fullscreen, (f) => seg(f ? 'on' : 'off', [['off', 'Window'], ['on', 'Fullscreen']], (v) => void setFullscreen(v === 'on'))))}</div>
                <div class="set-row top"><span>Font<small>The players and the pitch stay pixel art in every style.</small></span>
                    <div class="font-list">${FONTS.map((f) => html`<button class="font-opt ${p.font === f.id ? 'on' : ''}" data-font="${f.id}" ${on('click', () => setPref('font', f.id))}>
                        <b>${f.label}</b><span class="sample">Division 5 of 5 · 128k g · Run in behind</span><small>${f.note}</small></button>`)}</div></div>
                <div class="set-row"><span>Camera<small>Classic 2D is the art's native top-down view. Tilted 3D leans the pitch back like a broadcast. From the next match.</small></span>
                    ${seg(p.camera, [['2d', 'Classic 2D'], ['3d', 'Tilted 3D']] as Array<['2d' | '3d', string]>, (v) => setPref('camera', v))}</div>
                <div class="set-row"><span>Auto zoom<small>The camera leans in when players crowd the ball. Wheel or +/− zoom by hand, 0 resets.</small></span>
                    ${seg(p.autoZoom ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (v) => setPref('autoZoom', v === 'on'))}</div>
                <div class="set-row"><span>Reduce motion<small>Stops blinking and pulsing UI elements.</small></span>
                    ${seg(p.reduceMotion ? 'on' : 'off', [['off', 'Off'], ['on', 'On']], (v) => setPref('reduceMotion', v === 'on'))}</div>
            </div>`;
        }
        if (t === 'sound') {
            const vol = (k: 'sfxVolume' | 'crowdVolume', label: string, note: string) => html`<label class="set-row"><span>${label}<small>${note}</small></span>
                ${slider(Math.round(p[k] * 100), 0, 100, 5, '%', (v) => { setPref(k, v / 100); if (k === 'sfxVolume') audio.play('kick'); })}</label>`;
            return html`<div class="set-rows">
                <div class="set-row"><span>Sound<small>M toggles it during a match.</small></span>${seg(p.muted ? 'off' : 'on', [['on', 'On'], ['off', 'Muted']], (v) => setPref('muted', v === 'off'))}</div>
                ${vol('sfxVolume', 'Effects', 'Kicks, tackles, whistles, UI.')}
                ${vol('crowdVolume', 'Crowd', 'The ambience that swells as the ball nears goal.')}
                <h4>Radio <small>songs from assets/music · N next song · R on/off</small></h4>
                <div class="set-row"><span>Radio</span>${seg(p.radioOn ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (v) => radio.setOn(v === 'on'))}</div>
                <label class="set-row"><span>Radio volume</span>${slider(Math.round(p.radioVolume * 100), 0, 100, 5, '%', (v) => setPref('radioVolume', v / 100))}</label>
                <div class="set-row"><span>During matches<small>Quieter keeps it under the crowd and the commentary.</small></span>${seg(p.radioInMatch, [['on', 'Full'], ['quiet', 'Quieter'], ['off', 'Off']] as Array<['on' | 'quiet' | 'off', string]>, (v) => setPref('radioInMatch', v))}</div>
            </div>`;
        }
        if (t === 'gameplay') {
            return html`<div>
                <div class="set-rows"><div class="set-row"><span>AI speed<small>How quickly AI players act and results resolve.</small></span>
                    ${seg(p.aiSpeed, [['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']] as Array<[AiSpeed, string]>, (v) => setPref('aiSpeed', v))}</div>
                <div class="set-row top"><span>Focus<small>Which of your players ask for orders. F cycles it in a match.</small></span>
                    <div class="font-list">${CONTROL_MODES.map((m) => html`<button class="font-opt ${p.controlMode === m.id ? 'on' : ''}" ${on('click', () => setPref('controlMode', m.id))}><b>${m.label}</b><small>${m.note}</small></button>`)}</div></div>
                <div class="set-row"><span>Coach tips<small>One-time hints the first time something happens.</small></span>
                    <div class="seg">${seg(p.tips ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (v) => setPref('tips', v === 'on'))}<button class="ghost" ${on('click', () => { setPref('tipsSeen', []); setPref('tips', true); })}>Replay all tips</button></div></div>
                </div>
                <h4>Match defaults <small>quick matches & new careers</small></h4>
                ${matchOptions(props.defaults.get, props.defaults.set, bump)}
            </div>`;
        }
        const c = props.career;
        if (!c) return html`<p class="muted">No career loaded.</p>`;
        return html`<div>
            <h4>${c.name} <small>applies from the next match</small></h4>
            ${matchOptions(() => c.settings, (o) => { Object.assign(c.settings, o); c.save(); }, bump)}
            <h4>Save file <small>saved automatically after every change</small></h4>
            <p class="save-path">${savePath}</p>
            ${props.onDeleteCareer ? html`<div class="danger-zone"><span>Delete this career save. This can't be undone.</span>
                <button class="warn" ${on('click', () => { if (confirm(`Delete the career "${c.name}"? This cannot be undone.`)) props.onDeleteCareer!(); })}>Delete career</button></div>` : html``}
        </div>`;
    });
    const tabs = derived(tab, (t) => html`<div class="seg tabs">
        ${(['display', 'sound', 'gameplay', ...(props.career ? ['career'] : [])] as Array<'display' | 'sound' | 'gameplay' | 'career'>).map((id) =>
            html`<button class="${t === id ? 'on' : ''}" ${on('click', () => tab.set(id))}>${id === 'career' ? 'Career' : id[0]!.toUpperCase() + id.slice(1)}</button>`)}
    </div>`);
    return html`<div class="modal settings-modal" ${on('click', (e) => { if (e.target === e.currentTarget) props.onClose(); })}>
        <div class="modal-body" ${attr({ role: 'dialog', 'aria-label': 'Settings' })}>
            <header><h2>Settings</h2><button class="ghost" ${on('click', props.onClose)}>Close <kbd>Esc</kbd></button></header>
            ${$render(tabs)}
            <div class="set-body">${$render(body)}</div>
        </div>
    </div>`;
};
