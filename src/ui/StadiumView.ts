/**
 * Draws a Stadium around the pitch.
 *
 * Every piece of pack art is drawn at the players' pixel scale (S = renderPx / framePx), so a fan,
 * a flag and a footballer share one pixel grid. Upright things (stands, boards, pylons, flags) are
 * billboards that follow the camera tilt: in Classic 2D (tilt 0) they simply stand on the ground
 * exactly as the art pack composes them; in tilted 3D they lean back like the players do.
 *
 * Layout, outward from the pitch: corner flags → advertising boards on both touchlines → dugouts →
 * the main stand along the far touchline (tiers by ground size), end stands behind both goals,
 * floodlight pylons at the corners, and for the grandest grounds a TV gantry and a big scoreboard.
 */
import { createDirective, html } from '@grainular/nord';
import { createRng } from '../rng';
import { standTiers, type Conditions, type Stadium } from '../world/stadium';

export type Geo = { L: number; T: number; PW: number; PH: number; C: number; W: number; H: number; S: number; tilt: number };

const GRASS = { light: 'assets/tiles/grass_001.png', dark: 'assets/tiles/grass_006.png', plainLight: 'assets/tiles/grass_003.png' };

// ------------------------------------------------------------------ pitch surface

/** HTML string for the pitch layer: grass pattern + worn patches (one filtered wrapper). */
export const pitchSurface = (st: Stadium, g: Geo): string => {
    // whole-pixel edges plus 1px overlap: fractional bands leave hairline seams
    const tile = (x: number, y: number, w: number, h: number, dark: boolean) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(Math.ceil(x + w) + 1, Math.round(g.L + g.PW));
        const y1 = Math.min(Math.ceil(y + h) + 1, Math.round(g.T + g.PH));
        const img = dark
            ? `linear-gradient(#0000002a, #0000002a), url(${GRASS.dark})`
            : `linear-gradient(#ffffff0c, #ffffff0c), url(${GRASS.light})`;
        return `<div class="stripe" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;background-image:${img};background-size:auto, 48px 48px"></div>`;
    };
    let out = '';
    const n = st.bands;
    if (st.pattern === 'stripes') for (let i = 0; i < n; i++) out += tile(g.L + (i * g.PW) / n, g.T, g.PW / n, g.PH, i % 2 === 1);
    else if (st.pattern === 'hoops') {
        const k = Math.round(n * 0.6);
        for (let i = 0; i < k; i++) out += tile(g.L, g.T + (i * g.PH) / k, g.PW, g.PH / k, i % 2 === 1);
    } else if (st.pattern === 'checker') {
        const cols = n;
        const rows = Math.round((n * g.PH) / g.PW);
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
                out += tile(g.L + (c * g.PW) / cols, g.T + (r * g.PH) / rows, g.PW / cols, g.PH / rows, (r + c) % 2 === 1);
    } else
        out += `<div class="stripe" style="left:${g.L}px;top:${g.T}px;width:${g.PW}px;height:${g.PH}px;background-image:url(${GRASS.plainLight})"></div>`;
    if (st.wear > 0.15) {
        const patch = (cx: number, cy: number, w: number, h: number, tileNo: string, op: number) =>
            `<div class="wear" style="left:${cx - w / 2}px;top:${cy - h / 2}px;width:${w}px;height:${h}px;background-image:url(assets/tiles/grass_${tileNo}.png);opacity:${op.toFixed(2)}"></div>`;
        const mud = st.condition === 'muddy' ? '013' : '011';
        const op = Math.min(0.9, st.wear * (st.condition === 'muddy' ? 1.2 : 0.8));
        const midY = g.T + g.PH / 2;
        out += patch(g.L + g.C * 2, midY, g.C * 4, g.C * 7, mud, op);
        out += patch(g.L + g.PW - g.C * 2, midY, g.C * 4, g.C * 7, mud, op);
        out += patch(g.L + g.PW / 2, midY, g.C * 5, g.C * 4, '010', op * 0.7);
    }
    if (st.condition === 'frost') out += `<div class="frost" style="left:${g.L}px;top:${g.T}px;width:${g.PW}px;height:${g.PH}px"></div>`;
    return `<div class="surface">${out}</div>`;
};

// ------------------------------------------------------------------ building blocks

const f1 = (n: number) => n.toFixed(1);
const raw = (markup: string) =>
    createDirective((n) => {
        if (markup) n.innerHTML = markup;
    });

/** An upright billboard standing on ground point (x, y). */
const bb = (x: number, y: number, w: number, h: number, art: string, cls = '', inner = '') =>
    html`<div class="prop ${cls}" style="left:${f1(x)}px;top:${f1(y)}px;z-index:${Math.round(y)}"><div class="stand"><div class="prop-art" style="left:${f1(-w / 2)}px;top:${f1(-h)}px;width:${f1(w)}px;height:${f1(h)}px;${art}" ${raw(inner)}></div></div></div>`;

/** A flat patch lying on the ground (rectangle in world px). */
const flat = (x: number, y: number, w: number, h: number, cls: string, inner: string, style = '') =>
    html`<div class="ground-art ${cls}" style="left:${f1(x)}px;top:${f1(y)}px;width:${f1(w)}px;height:${f1(h)}px;${style}" ${raw(inner)}></div>`;

const strip = (src: string, frames: number, fw: number, fh: number, ms: number, repeat = false) =>
    `background-image:url(${src});background-size:${f1(frames * fw)}px ${f1(fh)}px;background-repeat:${repeat ? 'repeat-x' : 'no-repeat'};--strip:${f1(frames * fw)}px;animation:strip ${ms}ms steps(${frames}) infinite`;

/** One row of animated fans `w` px wide, with empty seats punched in to match the fill. */
const crowdRow = (st: Stadium, w: number, tile: number, fill: number, rnd: () => number, delay: number) => {
    const slots = Math.max(1, Math.floor(w / tile));
    const empties = new Set(Array.from({ length: Math.round((1 - fill) * slots) }, () => Math.floor(rnd() * slots)));
    const holes = [...empties]
        .map(
            (i) =>
                `<i style="left:${f1(i * tile)}px;width:${f1(tile)}px;background-image:url(assets/stadium/seats_empty_${st.fans}.png)"></i>`,
        )
        .join('');
    return `<div class="tier" style="height:${f1(tile)}px;${strip(`assets/stadium/fans_${st.fans}.png`, 24, tile, tile, 2400, true)};animation-delay:-${delay}ms">${holes}</div>`;
};

// ------------------------------------------------------------------ the ground

const SIZE_KIT = {
    village: { ends: 0, boardsBottom: false, lights: 0, dugouts: false, led: false, roof: false },
    town: { ends: 0, boardsBottom: true, lights: 2, dugouts: true, led: false, roof: false },
    city: { ends: 1, boardsBottom: true, lights: 4, dugouts: true, led: true, roof: false },
    grand: { ends: 2, boardsBottom: true, lights: 4, dugouts: true, led: true, roof: true },
} as const;

/** Stadium furniture: billboards (upright) and flat terraces, in world px. `kit` colours trim. */
export const stadiumProps = (st: Stadium, cond: Conditions, kit: string, g: Geo) => {
    const rng = createRng(st.name.length * 7919 + st.capacity);
    const S = g.S;
    const TILE = 128 * S; // one block of crowd (two rows of fans)
    const tiers = standTiers(st);
    const k = SIZE_KIT[st.size];
    const flatMode = g.tilt === 0;
    const lit = cond.time !== 'day' && k.lights > 0;
    const parts = [];
    const endDepth = flatMode ? k.ends * TILE : 0;
    const endGap = g.C * 3.4; // behind the goal frames
    const span = g.PW + 2 * (endGap + endDepth); // the main stand reaches round to the end stands

    // ---- main stand along the far touchline
    const baseY = g.T - g.C * 2.6;
    const band = 24;
    if (tiers > 0) {
        const rows = Array.from({ length: tiers }, (_, i) =>
            crowdRow(st, span, TILE, Math.max(0.2, st.fill - i * 0.12), rng, (i * 370) % 2400),
        )
            .toReversed()
            .join('');
        const roof = k.roof ? `<div class="roof" style="--kit:${kit}"></div>` : '';
        const h = tiers * TILE + band + (k.roof ? 20 : 0);
        parts.push(
            bb(
                g.L + g.PW / 2,
                baseY,
                span,
                h,
                `--kit:${kit}`,
                'stand-main',
                `<div class="stand-body">${roof}${rows}<div class="stand-base"><span>${st.name}</span></div></div>`,
            ),
        );
    } else {
        // village: a fenced grass bank with a thin line of locals
        const w = g.PW + g.C * 6;
        const row = crowdRow(st, w, TILE * 0.8, Math.min(0.5, st.fill * 0.55), rng, 0);
        parts.push(
            bb(
                g.L + g.PW / 2,
                baseY + g.C,
                w,
                TILE * 0.8 + 16,
                '',
                'stand-village',
                `<div class="stand-body village">${row}<div class="fence-row"></div></div>`,
            ),
        );
    }

    // ---- end stands behind both goals (flat terraces in Classic 2D)
    if (endDepth > 0) {
        const top = g.T - g.C * 1.2;
        const h = g.PH + g.C * 2.4;
        const rows = Math.floor(h / TILE);
        for (const side of ['left', 'right'] as const) {
            const x = side === 'left' ? g.L - endGap - endDepth : g.L + g.PW + endGap;
            const body = Array.from({ length: rows }, (_, i) =>
                crowdRow(st, endDepth, TILE, Math.max(0.25, st.fill - 0.05 * (i % 3)), rng, (i * 210) % 2400),
            ).join('');
            parts.push(
                flat(
                    x,
                    top + (h - rows * TILE) / 2,
                    endDepth,
                    rows * TILE,
                    `end-stand ${side}${k.roof ? ' roofed' : ''}`,
                    body,
                    `--kit:${kit}`,
                ),
            );
        }
    }

    // ---- advertising boards: far touchline (LED in the big grounds), near touchline from towns up
    const bw = 192 * S * 0.75;
    const bh = 48 * S * 0.75;
    const boards = (y: number, led: boolean, salt: number) => {
        const count = Math.floor((g.PW + g.C * 4) / (bw + 4));
        const x0 = g.L + (g.PW - count * (bw + 4)) / 2 + bw / 2;
        for (let i = 0; i < count; i++) {
            const art =
                led && i % 3 !== 1
                    ? `${strip(`assets/stadium/anim_led_board_${((i + salt) % 3) + 1}.png`, 48, bw, bh, 4800)};animation-delay:-${i * 300}ms`
                    : `background-image:url(assets/stadium/ad_board_${((i + salt) % 4) + 1}.png);background-size:${f1(bw)}px ${f1(bh)}px`;
            parts.push(bb(x0 + i * (bw + 4), y, bw, bh, art, 'adboard'));
        }
    };
    boards(g.T - g.C * 0.4, k.led, 0);
    if (k.boardsBottom && flatMode) boards(g.T + g.PH + g.C * 1.9, false, 2);

    // ---- dugouts on the far side, either side of halfway, in front of the boards
    if (k.dugouts) {
        const dw = 192 * S * 0.75;
        const dh = 112 * S * 0.75;
        parts.push(
            bb(
                g.L + g.PW / 2 - g.C * 7,
                g.T - g.C * 0.05,
                dw,
                dh,
                `background-image:url(assets/stadium/dugout_home.png);background-size:${f1(dw)}px ${f1(dh)}px`,
                'dugout',
            ),
        );
        parts.push(
            bb(
                g.L + g.PW / 2 + g.C * 7,
                g.T - g.C * 0.05,
                dw,
                dh,
                `background-image:url(assets/stadium/dugout_away.png);background-size:${f1(dw)}px ${f1(dh)}px`,
                'dugout',
            ),
        );
    }

    // ---- floodlight pylons
    const pw = 96 * S;
    const ph = 256 * S;
    const corners: Array<[number, number]> = [
        [g.L - g.C * 4.2, baseY - g.C * 0.4],
        [g.L + g.PW + g.C * 4.2, baseY - g.C * 0.4],
    ];
    if (k.lights === 4 && flatMode)
        corners.push([g.L - g.C * 4.2, g.T + g.PH + g.C * 3.4], [g.L + g.PW + g.C * 4.2, g.T + g.PH + g.C * 3.4]);
    if (k.lights > 0)
        for (const [x, y] of corners)
            parts.push(
                bb(
                    x,
                    y,
                    pw,
                    ph,
                    `background-image:url(assets/stadium/floodlight_${lit ? 'on' : 'off'}.png);background-size:${f1(pw)}px ${f1(ph)}px`,
                    lit ? 'flood lit' : 'flood',
                ),
            );

    // ---- the grand extras: TV gantry on halfway, big scoreboard over the right end
    if (st.size === 'grand') {
        if (flatMode)
            parts.push(
                bb(
                    g.L + g.PW / 2,
                    g.T + g.PH + g.C * 3.3,
                    64 * S,
                    80 * S,
                    `background-image:url(assets/stadium/tv_camera.png);background-size:${f1(64 * S)}px ${f1(80 * S)}px`,
                ),
            );
        parts.push(
            bb(
                g.L + g.PW + endGap + endDepth / 2,
                baseY - g.C * 0.6,
                192 * S,
                144 * S,
                `background-image:url(assets/stadium/scoreboard.png);background-size:${f1(192 * S)}px ${f1(144 * S)}px`,
                'scoreboard',
            ),
        );
    }

    // ---- corner flags
    const flag = `assets/stadium/anim_corner_flag_${st.flag}.png`;
    for (const [x, y] of [
        [g.L, g.T],
        [g.L + g.PW, g.T],
        [g.L, g.T + g.PH],
        [g.L + g.PW, g.T + g.PH],
    ] as Array<[number, number]>)
        parts.push(
            bb(x, y, 32 * S, 80 * S, `${strip(flag, 12, 32 * S, 80 * S, 1300)};animation-delay:-${Math.floor(rng() * 1300)}ms`, 'flag'),
        );

    return parts;
};

/** Screen-space light & weather over the pitch. */
export const atmosphere = (cond: Conditions) => html`<div class="atmo time-${cond.time} weather-${cond.weather}">
    ${cond.weather === 'rain' ? html`<div class="rain"></div><div class="rain far"></div>` : html``}
    ${cond.weather === 'snow' ? html`<div class="snow"></div><div class="snow far"></div>` : html``}
    ${cond.weather === 'fog' ? html`<div class="fog"></div>` : html``}
</div>`;
