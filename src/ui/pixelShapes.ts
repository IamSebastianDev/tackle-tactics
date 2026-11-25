/**
 * Markers drawn in the sprites' own pixel language: SVG paths made of whole "art pixels" (the
 * players are 32-pixel art drawn at 52 CSS px, so one art pixel is 52/32 px), rendered with crisp
 * edges. Smooth vector rings and triangles next to pixel-art players read as cheap, especially on
 * big screens.
 */

/** One art pixel in CSS px (renderPx 52 / 32 art pixels per frame). */
export const ART_PX = 52 / 32;

/** Pixels inside an ellipse centred in a w×h grid (pixel centres tested). */
const inEllipse = (x: number, y: number, w: number, h: number, a: number, b: number) => {
    const dx = (x + 0.5 - w / 2) / a;
    const dy = (y + 0.5 - h / 2) / b;
    return dx * dx + dy * dy <= 1;
};

/** A path of 1×1 squares, merged into horizontal runs. */
const runs = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    let d = '';
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w;) {
            if (!on(x, y)) {
                x++;
                continue;
            }
            let n = 0;
            while (x + n < w && on(x + n, y)) n++;
            d += `M${x} ${y}h${n}v1h-${n}z`;
            x += n;
        }
    return d;
};

/** A ring between two ellipses (outer radii, inner radii) in a w×h grid. */
const ring = (w: number, h: number, outer: [number, number], inner: [number, number]) =>
    runs(w, h, (x, y) => inEllipse(x, y, w, h, ...outer) && !inEllipse(x, y, w, h, ...inner));

// the ground marker: shadow, the team / ball ring, the turn ring, and a dark outline around it all
const GW = 26;
const GH = 10;
const SHADOW = runs(GW, GH, (x, y) => inEllipse(x, y, GW, GH, 8.6, 3.1));
const INNER = ring(GW, GH, [9.6, 3.6], [8.1, 2.7]);
const OUTER = ring(GW, GH, [11.1, 4.6], [9.6, 3.6]);
const INK = ring(GW, GH, [12.6, 5.3], [11.1, 4.6]);

/** The marker under a player's feet. CSS colours its parts by state (team, ball, turn). */
export const groundSvg = `<svg class="ground" viewBox="0 0 ${GW} ${GH}" width="${GW * ART_PX}" height="${GH * ART_PX}" shape-rendering="crispEdges" aria-hidden="true"><path class="g-shadow" d="${SHADOW}"/><path class="g-ink" d="${INK}"/><path class="g-outer" d="${OUTER}"/><path class="g-inner" d="${INNER}"/></svg>`;

// the turn arrow: dark outline, gold fill, a highlight pixel row
const ARROW = ['KKKKKKKKKKK', 'KHHHHHHHHHK', '.KGGGGGGGK.', '..KGGGGGK..', '...KGGGK...', '....KGK....', '.....K.....'];
const AW = ARROW[0]!.length;
const AH = ARROW.length;
const cells = (ch: string) => runs(AW, AH, (x, y) => ARROW[y]![x] === ch);

/** The pixel arrow above the head of the player whose turn it is. */
export const turnArrowSvg = `<svg viewBox="0 0 ${AW} ${AH}" width="${AW * ART_PX}" height="${AH * ART_PX}" shape-rendering="crispEdges" aria-hidden="true"><path class="a-ink" d="${cells('K')}"/><path class="a-fill" d="${cells('G')}"/><path class="a-hi" d="${cells('H')}"/></svg>`;
