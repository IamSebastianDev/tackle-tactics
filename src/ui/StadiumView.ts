import { html } from '@grainular/nord';
import { standTiers, type Conditions, type Stadium } from '../world/stadium';

type Geo = { L: number; T: number; PW: number; PH: number; C: number };

/** One continuous grass texture, with mowing bands and worn areas painted over it. */
export const pitchSurface = (st: Stadium, g: Geo): string => {
    const { L, T, PW, PH, C } = g;
    const bounds = `left:${L}px;top:${T}px;width:${PW}px;height:${PH}px`;
    const tile = (x: number, y: number, w: number, h: number, dark: boolean) => {
        // A one-pixel overlap avoids seams between fractional mowing bands.
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(Math.ceil(x + w) + 1, Math.round(L + PW));
        const y1 = Math.min(Math.ceil(y + h) + 1, Math.round(T + PH));
        return `<div class="stripe" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;background-color:${dark ? '#071b0e1a' : '#ddf4ba0a'}"></div>`;
    };
    let out = `<div class="stripe turf" style="${bounds};background-position:${-L}px ${-T}px"></div>`;
    const n = st.bands;
    if (st.pattern === 'stripes') for (let i = 0; i < n; i++) out += tile(L + (i * PW) / n, T, PW / n, PH, i % 2 === 1);
    else if (st.pattern === 'hoops') {
        const k = Math.round(n * 0.6);
        for (let i = 0; i < k; i++) out += tile(L, T + (i * PH) / k, PW, PH / k, i % 2 === 1);
    } else if (st.pattern === 'checker') {
        const rows = Math.round((n * PH) / PW);
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < n; c++) out += tile(L + (c * PW) / n, T + (r * PH) / rows, PW / n, PH / rows, (r + c) % 2 === 1);
    }
    if (st.wear > 0.15) {
        const muddy = st.condition === 'muddy';
        const color = muddy ? '#5a4025' : '#9b8a4c';
        const opacity = st.wear * (muddy ? 0.32 : 0.15);
        const patch = (cx: number, w: number, h: number, op: number) =>
            `<div class="wear" style="left:${cx - w / 2}px;top:${T + (PH - h) / 2}px;width:${w}px;height:${h}px;background-color:${color};opacity:${op.toFixed(2)}"></div>`;
        out += patch(L + C * 2, C * 4, C * 7, opacity);
        out += patch(L + PW - C * 2, C * 4, C * 7, opacity);
        out += patch(L + PW / 2, C * 5, C * 4, opacity * 0.7);
    }
    if (st.condition === 'frost') out += `<div class="frost" style="${bounds}"></div>`;
    return `<div class="surface">${out}</div>`;
};

/** A billboard standing at ground point (x, y), sorted with the players. */
const billboard = (x: number, y: number, w: number, h: number, style: string, cls = '') =>
    html`<div class="prop ${cls}" style="left:${x}px;top:${y}px;z-index:${Math.round(y)}"><div class="stand"><div class="prop-art" style="left:${-w / 2}px;top:${-h}px;width:${w}px;height:${h}px;${style}"></div></div></div>`;

/** From a fenced village ground to a covered stand with several tiers and floodlights. */
export const stadiumProps = (st: Stadium, cond: Conditions, kit: string, { L, T, PW, PH, C }: Geo) => {
    const center = L + PW / 2;
    const tierCount = standTiers(st);
    const fence = billboard(center, T - C * 2.7, PW + C * 3, 38, 'background:url(assets/fence.png) repeat-x 0 0 / 46px 38px');
    const boards = billboard(center, T - C * 1.2, PW, 15, 'background:url(assets/boards.png) repeat-x 0 0 / 176px 15px');
    const benches = [-1, 1].map((side) =>
        billboard(center + side * C * 5, T - C * 0.3, 58, 34, 'background:url(assets/bench.png) center / 100% no-repeat'),
    );
    const standWidth = PW * (0.58 + tierCount * 0.14);
    const seats = Array.from({ length: tierCount }, (_, row) =>
        billboard(
            center,
            T - C * 3.25 - row * 20,
            standWidth,
            22,
            `--kit:${kit};background-image:url(assets/seats_${st.fans}.png);opacity:${0.55 + st.fill * 0.45}`,
            'terrace',
        ),
    );
    const roof =
        tierCount === 3 ? [billboard(center, T - C * 3.25 - tierCount * 20, standWidth + 10, 18, `--kit:${kit}`, 'terrace-roof')] : [];
    const lights =
        tierCount > 0
            ? [L - C * 2.5, L + PW + C * 2.5].map((x) => billboard(x, T - C * 2.7, 36, 98, '', cond.time === 'day' ? 'flood' : 'flood lit'))
            : [];
    const flags = [L, L + PW].flatMap((x) =>
        [T, T + PH].map((y) =>
            billboard(
                x,
                y,
                32,
                38,
                `background-image:url(assets/flag_${st.flag}.png);background-size:192px 38px;--strip:192px;animation:strip 720ms steps(6) infinite`,
            ),
        ),
    );
    return [...seats, ...roof, fence, boards, ...lights, ...benches, ...flags];
};

/** Screen-space light & weather over the pitch. */
export const atmosphere = (cond: Conditions) => html`<div class="atmo time-${cond.time} weather-${cond.weather}">
    ${cond.weather === 'rain' ? html`<div class="rain"></div><div class="rain far"></div>` : html``}
    ${cond.weather === 'snow' ? html`<div class="snow"></div><div class="snow far"></div>` : html``}
    ${cond.weather === 'fog' ? html`<div class="fog"></div>` : html``}
</div>`;
