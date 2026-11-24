/**
 * Radio controls for the title screen, career header and match toolbar.
 */
import { combined, derived, type WritableGrain } from '@grainular/grains';
import { $render, attr, html, mounted, on } from '@grainular/nord';
import { prefs, setPref, type RadioPosition } from './prefs';
import { announce, nowPlaying, radio, radioPlaying, STATION } from './radio';
import { stageSize } from './stage';

const moveRadio = mounted<HTMLDivElement>((node) => {
    const stage = node.closest<HTMLElement>('#app')!;
    const margin = 8;
    let position = prefs().radioPosition;
    let drag: { id: number; x: number; y: number; right: number; bottom: number; moved: boolean } | null = null;

    const place = (requested: RadioPosition): RadioPosition => {
        const { w, h } = stageSize();
        const right = Math.max(margin, Math.min(requested.right, w - node.offsetWidth - margin));
        const bottom = Math.max(margin, Math.min(requested.bottom, h - node.offsetHeight - margin));
        node.style.right = `${right}px`;
        node.style.bottom = `${bottom}px`;
        return { right, bottom };
    };
    const fit = () => {
        if (position) place(position);
    };
    const start = (e: PointerEvent) => {
        if (drag || e.button !== 0 || !(e.target instanceof Element) || !e.target.closest('.radio-grip')) return;
        const rect = node.getBoundingClientRect();
        drag = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            right: rect.right - e.clientX,
            bottom: rect.bottom - e.clientY,
            moved: false,
        };
    };
    const move = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved) {
            // Preserve an ordinary click on the collapsed player.
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
            node.setPointerCapture(e.pointerId);
            node.classList.add('dragging');
            drag.moved = true;
        }
        const { w, h } = stageSize();
        const rect = stage.getBoundingClientRect();
        position = place({
            right: ((rect.right - e.clientX - drag.right) * w) / rect.width,
            bottom: ((rect.bottom - e.clientY - drag.bottom) * h) / rect.height,
        });
    };
    const finish = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        const { moved } = drag;
        drag = null;
        if (!moved) return;
        node.classList.remove('dragging');
        setPref('radioPosition', position);
    };

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    node.addEventListener('pointerdown', start, options);
    window.addEventListener('pointermove', move, options);
    window.addEventListener('pointerup', finish, options);
    window.addEventListener('pointercancel', finish, options);
    node.addEventListener(
        'lostpointercapture',
        (e) => {
            if (e.target === node) finish(e);
        },
        options,
    );
    const resize = new ResizeObserver(fit);
    resize.observe(node);
    const unsubscribe = stageSize.subscribe(fit);
    fit();
    return () => {
        listeners.abort();
        resize.disconnect();
        unsubscribe();
    };
});

const transport = (enabled: boolean, playing: boolean) => {
    const active = enabled && playing;
    const label = active ? 'Pause music' : 'Play music';
    const toggle = () => {
        if (!enabled) radio.setOn(true);
        if (enabled || !playing) radio.toggle();
    };
    return html`
        <button type="button" class="ghost rc-btn" aria-label="Previous song" title="Previous song" ${on('click', () => radio.prev())}>⏮</button>
        <button type="button" class="ghost rc-btn" aria-label="${label}" title="${label}" ${on('click', toggle)}>${active ? '❚❚' : '▶'}</button>
        <button type="button" class="ghost rc-btn" aria-label="Next song" title="Next song (N)" ${on('click', () => radio.next())}>⏭</button>`;
};

export const MatchRadioControls = () => {
    const controls = derived(combined([nowPlaying, radioPlaying, prefs]), ([track, playing, p]) => {
        const title = p.radioOn ? (track?.title ?? 'Music') : 'Radio off';
        return html`<div class="radio-controls match-radio" id="match-radio-controls" role="group" aria-label="Music playback">
            <span class="radio-track" title="${title}"><span aria-hidden="true">♫</span> ${title}</span>
            ${transport(p.radioOn, playing)}
        </div>`;
    });
    return html`${$render(controls)}`;
};

export const MatchRadioButton = (open: WritableGrain<boolean>) => {
    if (!radio.hasTracks()) return html``;
    return html`<button type="button" class="match-radio" title="Music" aria-label="Music" ${attr({
        'aria-expanded': derived(open, String),
        'aria-controls': derived(open, (visible) => (visible ? 'match-radio-controls' : undefined)),
    })} ${on('click', () => open.update((v) => !v))}>♫</button>`;
};

export const RadioPlayer = ({ floating = false } = {}) => {
    if (!radio.hasTracks()) return html``;
    const grip = floating ? 'radio-grip' : '';
    const content = derived(combined([nowPlaying, radioPlaying, announce, prefs]), ([t, playing, fresh, p]) => {
        const off = !p.radioOn;
        const title = off ? 'Radio off' : (t?.title ?? STATION);
        const artist = off ? 'R turns it back on' : t ? (t.artist ?? STATION) : 'Click anywhere to tune in';
        if (floating && p.radioCollapsed) {
            return html`<div class="radio-dock collapsed ${off ? 'off' : ''}">
                ${fresh && !off ? html`<div class="radio-toast"><small>Now playing</small><b>${fresh.title}</b><span>${fresh.artist ?? STATION}</span></div>` : html``}
                <button class="radio-fab radio-grip ${playing && !off ? 'live' : ''}" title="Radio: ${title} · click to open or drag to move" ${on('click', () => setPref('radioCollapsed', false))}>♫</button>
            </div>`;
        }
        const toggleLabel = off ? 'Turn radio on' : 'Turn radio off';
        return html`<div class="radio-dock ${off ? 'off' : ''} ${fresh ? 'fresh' : ''}" role="group" aria-label="Music playback">
            <i class="np-icon ${grip}" aria-hidden="true" ${attr({ title: floating ? 'Drag to move the radio' : undefined })}>♫</i>
            <div class="rc-text ${grip}"><small>${off ? 'Radio' : fresh ? 'Now playing' : 'Radio'}</small><b title="${title}">${title}</b><span title="${artist}">${artist}</span></div>
            ${transport(p.radioOn, playing)}
            <button type="button" class="ghost rc-btn radio-mute" aria-label="${toggleLabel}" title="${toggleLabel} (R)" ${on('click', () => radio.setOn(off))}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">
                    <path d="M1 6h4V5h2V3h2v12H7v-2H5v-1H1z" />
                    <path d="${off ? 'M11 6h2v2h2V6h2v2h-2v2h2v2h-2v-2h-2v2h-2v-2h2V8h-2z' : 'M11 6h2v2h1v2h-1v2h-2v-2h1V8h-1z M14 3h2v2h1v8h-1v2h-2v-2h1V5h-1z'}" />
                </svg>
            </button>
            ${floating ? html`<button type="button" class="ghost rc-btn" aria-label="Hide the player" title="Hide the player" ${on('click', () => setPref('radioCollapsed', true))}>⌄</button>` : html``}
        </div>`;
    });
    return floating ? html`<div class="radio-window" ${moveRadio}>${$render(content)}</div>` : html`${$render(content)}`;
};

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
