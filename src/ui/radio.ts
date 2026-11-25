/**
 * The in-game radio: every song in assets/music (scanned at dev/build time by
 * scripts/music-plugin.ts) plays across every screen, like a sports game's soundtrack. The first
 * track opens the station; the rest shuffle and reshuffle. A "now playing" card announces each
 * song. Volume, on/off and how loud it plays during matches live in prefs.
 */
import { grain } from '@grainular/grains';
import playlist from 'virtual:playlist';
import { myTracks, songUrl } from './myMusic';
import { prefs, setPref } from './prefs';

/** A song: the station's (a URL in the build) or one of the player's own (`mine`: its file name). */
export type Track = { url: string; title: string; artist: string | null; mine?: string };
export const STATION = 'Tackle Tactics Radio';
/** Stable identity for a song, used for the per-song on/off setting. */
export const trackKey = (t: Track) => `${t.artist ?? STATION} - ${t.title}`;
const enabled = (t: Track) => !prefs().radioDisabled.includes(trackKey(t));
/** Every song: the station's in order, then the player's own (for the settings list). */
export const allTracks = (): Track[] => [...playlist, ...myTracks()];

export const nowPlaying = grain<Track | null>(null);
/** Shown for a few seconds when a song starts. */
export const announce = grain<Track | null>(null);
export const radioPlaying = grain(false);

class Radio {
    private el: HTMLAudioElement | null = null;
    private tracks: Track[] = [];
    private queue: Track[] = [];
    private history: Track[] = [];
    private started = false;
    private inMatch = false;
    private announceTimer = 0;

    private async load() {
        if (!this.tracks.length) this.tracks = allTracks();
    }

    /** The player's songs changed (added, removed, rescanned): the station follows. */
    refreshTracks() {
        if (!this.started) return;
        this.tracks = allTracks();
        const keys = new Set(this.tracks.map(trackKey));
        this.queue = this.queue.filter((t) => keys.has(trackKey(t)));
    }

    private refill() {
        const rest = this.tracks.slice(this.history.length ? 0 : 1).filter(enabled);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j]!, rest[i]!];
        }
        // the station opens with the first track; afterwards avoid repeating the song just played
        if (!this.history.length && this.tracks[0] && enabled(this.tracks[0])) rest.unshift(this.tracks[0]);
        const last = this.history.at(-1);
        if (last && rest[0] === last && rest.length > 1) rest.push(rest.shift()!);
        this.queue.push(...rest);
    }

    /** Effective volume: off, muted, or ducked during matches. */
    volume() {
        const p = prefs();
        if (!p.radioOn || p.muted) return 0;
        const duck = this.inMatch ? ({ on: 1, quiet: 0.45, off: 0 } as const)[p.radioInMatch] : 1;
        return Math.max(0, Math.min(1, p.radioVolume * duck));
    }

    applyVolume() {
        if (!this.el) return;
        const v = this.volume();
        this.el.volume = v;
        if (v === 0 && !this.el.paused) this.el.pause();
        else if (v > 0 && this.el.paused && this.started && radioPlaying()) void this.el.play().catch(() => undefined);
    }

    /** First user gesture: start the station (autoplay rules). */
    async start() {
        if (this.started) return;
        this.started = true;
        await this.load();
        if (!this.tracks.length) return;
        radioPlaying.set(true);
        this.next();
    }

    private play(t: Track) {
        if (!this.el) {
            this.el = new Audio();
            this.el.preload = 'auto';
            this.el.addEventListener('ended', () => this.next());
            this.el.addEventListener('error', () => {
                this.tracks = this.tracks.filter((x) => x !== nowPlaying());
                if (this.tracks.length) this.next();
            });
        }
        nowPlaying.set(t);
        const el = this.el;
        const start = (url: string) => {
            if (nowPlaying() !== t) return; // skipped while it loaded
            el.src = url;
            this.applyVolume();
            if (this.volume() > 0 && radioPlaying()) void el.play().catch(() => undefined);
        };
        if (t.mine)
            songUrl(t).then(start, () => {
                // gone from the folder, or unreadable: drop it and move on
                this.tracks = this.tracks.filter((x) => x !== t);
                if (nowPlaying() === t) this.next();
            });
        else start(t.url);
        announce.set(t);
        clearTimeout(this.announceTimer);
        this.announceTimer = window.setTimeout(() => announce.set(null), 5000);
    }

    next() {
        // skip anything switched off since it was queued; stop if nothing is left on
        this.queue = this.queue.filter(enabled);
        if (!this.queue.length) this.refill();
        const t = this.queue.shift();
        if (!t) {
            this.stop();
            return;
        }
        const cur = nowPlaying();
        if (cur) this.history.push(cur);
        this.play(t);
    }

    /** Play a specific song now (from the settings list). */
    playNow(t: Track) {
        if (!this.started) {
            this.started = true;
            void this.load();
        }
        radioPlaying.set(true);
        if (!prefs().radioOn) setPref('radioOn', true);
        const cur = nowPlaying();
        if (cur && cur !== t) this.history.push(cur);
        this.queue = this.queue.filter((q) => q !== t);
        this.play(t);
    }

    private stop() {
        this.el?.pause();
        nowPlaying.set(null);
        radioPlaying.set(false);
    }

    /** A song was switched off: if it's the one playing, move on. */
    checkCurrent() {
        const cur = nowPlaying();
        if (cur && !enabled(cur) && radioPlaying()) this.next();
    }

    prev() {
        // restart the song if we're into it; otherwise go back one
        if (this.el && this.el.currentTime > 4) {
            this.el.currentTime = 0;
            return;
        }
        let t = this.history.pop();
        while (t && !enabled(t)) t = this.history.pop();
        if (!t) {
            if (this.el) this.el.currentTime = 0;
            return;
        }
        const cur = nowPlaying();
        if (cur) this.queue.unshift(cur);
        this.play(t);
    }

    toggle() {
        if (!this.started) {
            void this.start();
            return;
        }
        const on = !radioPlaying();
        radioPlaying.set(on);
        if (!this.el) return;
        if (on && this.volume() > 0) void this.el.play().catch(() => undefined);
        else this.el.pause();
    }

    /** Radio on/off (the R key and the chip's mute). */
    setOn(on: boolean) {
        setPref('radioOn', on);
        if (on && !this.started) void this.start();
    }

    setMatch(inMatch: boolean) {
        this.inMatch = inMatch;
        this.applyVolume();
    }

    hasTracks = () => playlist.length > 0 || myTracks().length > 0;
}

export const radio = new Radio();
myTracks.subscribe(() => radio.refreshTracks());
prefs.subscribe(() => radio.applyVolume());
