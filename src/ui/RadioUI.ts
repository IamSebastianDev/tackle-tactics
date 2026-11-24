/** Radio widgets: the now-playing card, the player chip, and the global radio keys (N, R). */
import { combined, derived } from '@grainular/grains';
import { html, on } from '@grainular/nord';
import { prefs } from './prefs';
import { announce, nowPlaying, radio, radioPlaying, STATION } from './radio';

/** Slides in for a few seconds whenever a new song starts. */
export const NowPlayingCard = () => derived(announce, (t) => (t ? html`<div class="now-playing">
    <i class="np-icon">♫</i><div><small>Now playing</small><b>${t.title}</b><span>${t.artist ?? STATION}</span></div>
</div>` : html``));

/** Compact player: song, previous / play-pause / next, radio on-off. */
export const RadioChip = (extra = '') => derived(combined([nowPlaying, radioPlaying, prefs]), ([t, playing, p]) => {
    if (!radio.hasTracks()) return html``;
    const off = !p.radioOn;
    return html`<div class="radio-chip ${extra} ${off ? 'off' : ''}" title="Radio · N next song · R radio on/off">
        <i class="np-icon">♫</i>
        <div class="rc-text"><b>${off ? 'Radio off' : t?.title ?? STATION}</b><span>${off ? 'R turns it back on' : t ? t.artist ?? STATION : 'Click anywhere to tune in'}</span></div>
        <button class="ghost rc-btn" title="Previous" ${on('click', () => radio.prev())}>⏮</button>
        <button class="ghost rc-btn" title="${playing ? 'Pause' : 'Play'}" ${on('click', () => radio.toggle())}>${playing && !off ? '❚❚' : '▶'}</button>
        <button class="ghost rc-btn" title="Next song (N)" ${on('click', () => radio.next())}>⏭</button>
        <button class="ghost rc-btn" title="${off ? 'Radio on (R)' : 'Radio off (R)'}" ${on('click', () => radio.setOn(off))}>${off ? '🔈' : '🔇'}</button>
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
