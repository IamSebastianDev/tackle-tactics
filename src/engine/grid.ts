import type { GameConfig } from '../config';
import type { Cell, Facing, TeamSide } from '../types';

export const key = (c: Cell) => `${c.x},${c.y}`;
export const fromKey = (k: string): Cell => {
    const [x, y] = k.split(',').map(Number);
    return { x: x!, y: y! };
};
export const eq = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
export const cheb = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const dist = (a: Cell, b: Cell) => Math.hypot(a.x - b.x, a.y - b.y);

export const inPitch = (cfg: GameConfig, c: Cell) => c.x >= 0 && c.y >= 0 && c.x < cfg.pitch.cols && c.y < cfg.pitch.rows;

export const clampToPitch = (cfg: GameConfig, c: Cell): Cell => ({
    x: Math.max(0, Math.min(cfg.pitch.cols - 1, c.x)),
    y: Math.max(0, Math.min(cfg.pitch.rows - 1, c.y)),
});

export const goalRows = (cfg: GameConfig): [number, number] => {
    const top = Math.floor((cfg.pitch.rows - cfg.pitch.goalWidth) / 2);
    return [top, top + cfg.pitch.goalWidth - 1];
};

/** The column a team shoots at: team 0 attacks right (x = cols), team 1 attacks left (x = -1). */
export const attackGoalX = (cfg: GameConfig, team: TeamSide) => (team === 0 ? cfg.pitch.cols : -1);
export const ownGoalX = (cfg: GameConfig, team: TeamSide) => (team === 0 ? -1 : cfg.pitch.cols);

export const isGoalCell = (cfg: GameConfig, c: Cell, goalX?: number) => {
    const [top, bottom] = goalRows(cfg);
    const xOk = goalX === undefined ? c.x === -1 || c.x === cfg.pitch.cols : c.x === goalX;
    return xOk && c.y >= top && c.y <= bottom;
};

export const goalCenter = (cfg: GameConfig, goalX: number): Cell => ({ x: goalX, y: (cfg.pitch.rows - 1) / 2 });

/** Normalised "forwardness" of a cell for a team: 0 at own goal line, 1 at the opponent's. */
export const forward = (cfg: GameConfig, team: TeamSide, c: Cell) => {
    const t = c.x / (cfg.pitch.cols - 1);
    return team === 0 ? t : 1 - t;
};

/** Bresenham line, inclusive of both ends. */
export const line = (a: Cell, b: Cell): Cell[] => {
    const out: Cell[] = [];
    let x0 = a.x;
    let y0 = a.y;
    const dx = Math.abs(b.x - x0);
    const dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1;
    const sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        out.push({ x: x0, y: y0 });
        if (x0 === b.x && y0 === b.y) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
};

/** All cells whose centre lies within `r` of `c` (including goal cells beyond the line if asked). */
export const disc = (c: Cell, r: number): Cell[] => {
    const out: Cell[] = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.25) out.push({ x: c.x + dx, y: c.y + dy });
    return out;
};

export const neighbours8 = (c: Cell): Cell[] => {
    const out: Cell[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push({ x: c.x + dx, y: c.y + dy });
    return out;
};

export const facingFor = (from: Cell, to: Cell, fallback: Facing): Facing => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return fallback;
    if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
};
