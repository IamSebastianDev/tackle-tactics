/**
 * The radio's one widget: a player floating in the lower-right corner of every screen. It collapses
 * to a small ♫ button (remembered in prefs); while collapsed, a "now playing" label slides out next to
 * the button when a song starts. Also the global radio keys (N next song, R radio on/off).
 */
import { combined, derived } from '@grainular/grains';
import { html, on } from '@grainular/nord';
import { prefs, setPref } from './prefs';
import { announce, nowPlaying, radio, radioPlaying, STATION } from './radio';

export const RadioDock = () =>
    derived(combined([nowPlaying, radioPlaying, announce, prefs]), ([t, playing, fresh, p]) => {
        if (!radio.hasTracks()) return html``;
        const off = !p.radioOn;
        const title = off ? 'Radio off' : (t?.title ?? STATION);
        const artist = off ? 'R turns it back on' : t ? (t.artist ?? STATION) : 'Click anywhere to tune in';
        if (p.radioCollapsed) {
            return html`<div class="radio-dock collapsed ${off ? 'off' : ''}">
                ${fresh && !off ? html`<div class="radio-toast"><small>Now playing</small><b>${fresh.title}</b><span>${fresh.artist ?? STATION}</span></div>` : html``}
                <button class="radio-fab ${playing && !off ? 'live' : ''}" title="Radio: ${title} · click to open" ${on('click', () => setPref('radioCollapsed', false))}>♫</button>
            </div>`;
        }
        return html`<div class="radio-dock ${off ? 'off' : ''} ${fresh ? 'fresh' : ''}" title="Radio · N next song · R radio on/off">
            <i class="np-icon">♫</i>
            <div class="rc-text"><small>${off ? 'Radio' : fresh ? 'Now playing' : 'Radio'}</small><b>${title}</b><span>${artist}</span></div>
            <button class="ghost rc-btn" title="Previous" ${on('click', () => radio.prev())}>⏮</button>
            <button class="ghost rc-btn" title="${playing ? 'Pause' : 'Play'}" ${on('click', () => radio.toggle())}>${playing && !off ? '❚❚' : '▶'}</button>
            <button class="ghost rc-btn" title="Next song (N)" ${on('click', () => radio.next())}>⏭</button>
            <button class="ghost rc-btn" title="${off ? 'Radio on (R)' : 'Radio off (R)'}" ${on('click', () => radio.setOn(off))}>${off ? '🔈' : '🔇'}</button>
            <button class="ghost rc-btn" title="Hide the player" ${on('click', () => setPref('radioCollapsed', true))}>⌄</button>
        </div>`;
    });

/** N: next song, R: radio on/off — anywhere, except while typing. */
export const installRadioKeys = () => {
    window.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'n' || e.key === 'N') radio.next();
        else if (e.key === 'r' || e.key === 'R') radio.setOn(!prefs().radioOn);
        else return;
        e.preventDefault();
    });
};
