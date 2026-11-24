/** Player preferences (display, sound, pacing, guidance). Persisted per browser, applied live. */
import { grain } from '@grainular/grains';

export type FontPreset = 'broadcast' | 'arcade' | 'terminal' | 'clean';
export type AiSpeed = 'fast' | 'normal' | 'slow';
export type RadioPosition = { right: number; bottom: number };
/** Which of your players ask for orders: everyone, those near the ball, or only the key duels. */
export type ControlMode = 'all' | 'near' | 'key';
export type Prefs = {
    /** 1 = default; larger = bigger UI (smaller logical canvas). */
    uiScale: number;
    font: FontPreset;
    reduceMotion: boolean;
    aiSpeed: AiSpeed;
    controlMode: ControlMode;
    sfxVolume: number;
    crowdVolume: number;
    muted: boolean;
    tips: boolean;
    tipsSeen: string[];
    /** Camera leans in when players crowd the ball. */
    autoZoom: boolean;
    /** Draw zones of control during your turns. */
    showZoc: boolean;
    /** Show the pre-match intro (commentators, ground, line-ups, the story). */
    matchIntro: boolean;
    /** The in-game radio (src/ui/radio.ts). */
    radioOn: boolean;
    radioVolume: number;
    /** During matches: full volume, quieter under the crowd, or silent. */
    radioInMatch: 'on' | 'quiet' | 'off';
    /** Songs switched off in Settings (keyed "Artist - Title", so adding songs doesn't shift them). */
    radioDisabled: string[];
    /** The floating radio player is folded down to its ♫ button. */
    radioCollapsed: boolean;
    /** Radio offsets in logical stage pixels, or null for the default corner. */
    radioPosition: RadioPosition | null;
};

export const UI_SCALES = [0.85, 1, 1.15, 1.3, 1.5];
export const FONTS: Array<{ id: FontPreset; label: string; note: string }> = [
    { id: 'broadcast', label: 'Broadcast', note: 'Condensed sports headings, crisp body text (default)' },
    { id: 'arcade', label: 'Arcade', note: 'Pixel fonts everywhere, the retro look' },
    { id: 'terminal', label: 'Terminal', note: 'Retro monitor text' },
    { id: 'clean', label: 'Clean', note: 'Maximum readability' },
];
export const AI_SPEED: Record<AiSpeed, number> = { fast: 0.45, normal: 1, slow: 1.7 };
export const CONTROL_MODES: Array<{ id: ControlMode; label: string; note: string }> = [
    { id: 'all', label: 'Every player', note: 'You order all eleven, every round.' },
    {
        id: 'near',
        label: 'Near the ball',
        note: 'Players within 10 cells of the ball, and always your 3 closest, ask; the rest keep formation.',
    },
    { id: 'key', label: 'Key duels', note: 'The carrier, players within 5 cells of the ball, and always your 3 closest.' },
];
/** Distance (cells) from the ball inside which a player asks for orders, per mode. */
export const CONTROL_RADIUS: Record<ControlMode, number> = { all: 999, near: 10, key: 5 };
/** However far away the ball is, this many of your closest players still ask for orders. */
export const CONTROL_MIN_NEAREST = 3;

const KEY = 'tackle-tactics:prefs';
const DEFAULTS: Prefs = {
    uiScale: 1,
    font: 'broadcast',
    reduceMotion: false,
    aiSpeed: 'normal',
    controlMode: 'near',
    sfxVolume: 0.7,
    crowdVolume: 0.5,
    muted: false,
    tips: true,
    tipsSeen: [],
    autoZoom: true,
    showZoc: true,
    matchIntro: true,
    radioOn: true,
    radioVolume: 0.6,
    radioInMatch: 'quiet',
    radioDisabled: [],
    radioCollapsed: false,
    radioPosition: null,
};

const load = (): Prefs => {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
};

export const prefs = grain<Prefs>(load());
prefs.subscribe((p) => {
    try {
        localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
        /* ignore */
    }
});
export const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => prefs.update((p) => ({ ...p, [k]: v }));
