// Formation balance: TT_FORMATIONS=<seeds per pairing> npx vitest run test/formations.test.ts --silent=false
// Every formation meets every other from both ends with the same seeds; prints points per game,
// goals for/against and the head-to-head matrix (points per game for the row formation).
import { it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { simulate } from '../src/sim';

const n = Number(process.env.TT_FORMATIONS ?? 0);
const overrides = process.env.TT_FORMATION_CFG ? JSON.parse(process.env.TT_FORMATION_CFG) : {};

it.skipIf(!n)(
    'formation balance',
    () => {
        const cfg = withOverrides(overrides, defaultConfig);
        // TT_SLOTS='{"4-3-1-2":[...slots]}' swaps a formation's slots for a tuning variant
        const slots: Record<string, unknown> = process.env.TT_SLOTS ? JSON.parse(process.env.TT_SLOTS) : {};
        cfg.formations = cfg.formations.map((f) => (slots[f.id] ? { ...f, slots: slots[f.id] as typeof f.slots } : f));
        // TT_FOCUS=<id> only plays the pairings involving that formation
        const focus = process.env.TT_FOCUS;
        const ids = (process.env.TT_ONLY?.split(',') ?? cfg.formations.map((f) => f.id)).filter(Boolean);
        const row = Object.fromEntries(ids.map((id) => [id, { p: 0, gf: 0, ga: 0, shots: 0, g: 0 }]));
        const h2h: Record<string, Record<string, { p: number; g: number }>> = {};
        const add = (a: string, b: string, ga: number, gb: number, shots: number) => {
            const pts = ga > gb ? 3 : ga === gb ? 1 : 0;
            Object.assign(row[a]!, {
                p: row[a]!.p + pts,
                gf: row[a]!.gf + ga,
                ga: row[a]!.ga + gb,
                shots: row[a]!.shots + shots,
                g: row[a]!.g + 1,
            });
            h2h[a] ??= {};
            h2h[a][b] ??= { p: 0, g: 0 };
            h2h[a][b].p += pts;
            h2h[a][b].g++;
        };
        for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++)
                for (let s = 1; s <= (focus && ids[i] !== focus && ids[j] !== focus ? 0 : n); s++)
                    for (const [h, a] of [
                        [ids[i]!, ids[j]!],
                        [ids[j]!, ids[i]!],
                    ] as const) {
                        const { st, stats } = simulate(cfg, 9000 + s * 31 + i * 7 + j, 'normal', [h, a], ['balanced', 'balanced']);
                        const shots = (side: string) =>
                            [...stats.players.entries()].filter(([id]) => id.startsWith(side)).reduce((x, [, l]) => x + l.shots, 0);
                        add(h, a, st.score[0], st.score[1], shots('home'));
                        add(a, h, st.score[1], st.score[0], shots('away'));
                    }
        console.log('formation     ppg   gf    ga    shots');
        for (const id of ids) {
            const r = row[id]!;
            if (!r.g) continue;
            console.log(
                id.padEnd(12),
                (r.p / r.g).toFixed(2),
                (r.gf / r.g).toFixed(2).padStart(5),
                (r.ga / r.g).toFixed(2).padStart(5),
                (r.shots / r.g).toFixed(1).padStart(6),
            );
        }
        console.log(`\nhead-to-head (ppg for the row)\n${''.padEnd(10)}${ids.map((x) => x.padStart(9)).join('')}`);
        for (const a of ids)
            console.log(a.padEnd(10) + ids.map((b) => (a === b ? '—' : (h2h[a]![b]!.p / h2h[a]![b]!.g).toFixed(2)).padStart(9)).join(''));
    },
    3_600_000,
);
