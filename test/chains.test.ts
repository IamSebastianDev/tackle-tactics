import { it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { simulate } from '../src/sim';
it.skipIf(!process.env.TT_CHAIN)(
    'tackle chains',
    () => {
        for (const [name, o] of Object.entries(JSON.parse(process.env.TT_CHAIN!)) as Array<[string, Parameters<typeof withOverrides>[0]]>) {
            const cfg = withOverrides(o, defaultConfig);
            const a = { chains: 0, longest: 0, wins: 0, shots: 0, goals: 0, n: 0 };
            for (let s = 1; s <= 10; s++) {
                const { st, m } = simulate(cfg, 300 + s);
                void m;
                a.shots += st.shots;
                a.goals += st.goals;
                a.wins += st.tacklesWon;
                a.n++;
                a.chains += (st as unknown as { chains: number }).chains ?? 0;
                a.longest = Math.max(a.longest, (st as unknown as { longestChain: number }).longestChain ?? 0);
            }
            console.log(
                name.padEnd(8),
                `wins=${(a.wins / a.n).toFixed(1)} chains(2+)=${(a.chains / a.n).toFixed(2)} longest=${a.longest} shots=${(a.shots / a.n).toFixed(1)} goals=${(a.goals / a.n).toFixed(1)}`,
            );
        }
    },
    600000,
);
