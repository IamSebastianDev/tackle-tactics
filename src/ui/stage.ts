/**
 * The game renders onto a stage designed around 1600×900. The stage is scaled so that design
 * size fits the window, then stretched in the spare dimension so it fills the window edge to
 * edge (no letterbox). UI scale shrinks the logical canvas, which makes everything bigger.
 */
import { grain } from '@grainular/grains';
import { prefs } from './prefs';

export const BASE = { w: 1600, h: 900 } as const;
/** Smallest logical canvas the layouts are designed to survive. */
const MIN = { w: 1180, h: 680 };

/** Current logical stage size in CSS px (before the scale transform). */
export const stageSize = grain<{ w: number; h: number }>({ w: BASE.w, h: BASE.h });

export const fitStage = (stage: HTMLElement) => {
    const apply = () => {
        const W = window.innerWidth;
        const H = window.innerHeight;
        let s = Math.min(W / BASE.w, H / BASE.h) * prefs().uiScale;
        // never let the logical canvas get smaller than the layouts can take
        s = Math.min(s, W / MIN.w, H / MIN.h);
        const w = Math.round(W / s);
        const h = Math.round(H / s);
        stage.style.width = `${w}px`;
        stage.style.height = `${h}px`;
        stage.style.transform = `scale(${s})`;
        stage.style.setProperty('--stage-scale', String(s));
        stage.style.setProperty('--stage-width', `${w}px`);
        stage.style.setProperty('--stage-height', `${h}px`);
        const p = prefs();
        stage.dataset.font = p.font;
        stage.classList.toggle('reduce-motion', p.reduceMotion);
        const cur = stageSize();
        if (cur.w !== w || cur.h !== h) stageSize.set({ w, h });
    };
    apply();
    window.addEventListener('resize', apply);
    const unsub = prefs.subscribe(apply);
    return () => {
        window.removeEventListener('resize', apply);
        unsub();
    };
};
