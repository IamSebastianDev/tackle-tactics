// Tuning harness: TT_VARIANTS='{"name":{...config overrides}}' npx vitest run test/tune.test.ts --silent=false
import { it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config';
import { simulate } from '../src/sim';

const variants: Record<string, Parameters<typeof withOverrides>[0]> = JSON.parse(process.env.TT_VARIANTS ?? '{"base":{}}');
it.skipIf(!process.env.TT_VARIANTS)('tune', () => {
    for (const [name, o] of Object.entries(variants)) {
        const cfg = withOverrides(o, defaultConfig);
        const agg: Record<string, number> = {};
        const seeds = [21, 22, 23, 24, 25, 26, 27, 28];
        for (const s of seeds) {
            const { st } = simulate(cfg, s);
            for (const k of [
                'passes',
                'completed',
                'shots',
                'goals',
                'tackles',
                'tacklesWon',
                'intercepts',
                'turnovers',
                'avgSpell',
                'cards',
            ])
                agg[k] = (agg[k] ?? 0) + (st as unknown as Record<string, number>)[k]! / seeds.length;
        }
        console.log(
            name.padEnd(10),
            Object.entries(agg)
                .map(([k, v]) => `${k}=${v.toFixed(1)}`)
                .join(' '),
        );
    }
});
