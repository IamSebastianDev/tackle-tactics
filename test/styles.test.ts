import { it } from 'vitest';
import { defaultConfig, type TeamStyle } from '../src/config';
import { simulate } from '../src/sim';
it.skipIf(!process.env.TT_STYLES)(
    'styles',
    () => {
        for (const st of ['balanced', 'press', 'deep', 'direct', 'possession'] as TeamStyle[]) {
            const a = { gf: 0, ga: 0, shots: 0, passes: 0, tackles: 0, n: 0 };
            for (let s = 1; s <= 12; s++) {
                const { st: r, stats } = simulate(defaultConfig, 500 + s, 'normal', ['4-3-3', '4-4-2'], [st, 'balanced']);
                a.gf += r.score[0];
                a.ga += r.score[1];
                a.n++;
                const lines = [...stats.players.entries()].filter(([id]) => id.startsWith('home'));
                a.shots += lines.reduce((n, [, l]) => n + l.shots, 0);
                a.passes += lines.reduce((n, [, l]) => n + l.passes, 0);
                a.tackles += lines.reduce((n, [, l]) => n + l.tackles, 0);
            }
            console.log(
                st.padEnd(11),
                Object.entries(a)
                    .filter(([k]) => k !== 'n')
                    .map(([k, v]) => `${k}=${(v / a.n).toFixed(1)}`)
                    .join(' '),
            );
        }
    },
    600000,
);
