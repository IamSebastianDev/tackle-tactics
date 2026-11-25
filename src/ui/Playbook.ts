/** Reference of every class kit: abilities and passives by perk tier (pick one per tier). Used in-match and in the hub. */
import { html } from '@grainular/nord';
import type { ClassId, GameConfig } from '../config';
import { abilitiesOf, abilityDef, allAbilities, classLevel, passivesOf, type PassiveId } from '../engine/abilities';
import type { Player } from '../types';

const PHASE_LABEL = { pre: 'Before moving', move: 'Instead of a normal move', act: 'After moving' } as const;
const CLASS_BLURB: Record<ClassId, string> = {
    keeper: 'Last line. Saves shots as a reaction and organises the defence.',
    defender: 'Breaks up play: tackles from range, shadows runners, and fouls when it must.',
    midfielder: 'Controls tempo: presses, threads passes into space, decides who acts next.',
    winger: 'Speed and deception: bursts down the line, beats defenders, crosses.',
    striker: 'Finisher: runs in behind and chooses the right kind of shot.',
};

/** Optional `player` highlights what they own and how far they are from the next unlock. */
export const Playbook = (cfg: GameConfig, player?: Player) => {
    const classes = Object.keys(cfg.classes) as ClassId[];
    return html`<div class="playbook">
        ${classes.map((cls) => {
            const lvl = player ? classLevel(player, cls) : undefined;
            const owned = new Set<string>(player ? [...abilitiesOf(cfg, player), ...passivesOf(cfg, player)] : []);
            /** have it / reached the tier but picked the other option / not there yet */
            const state = (id: string, unlock: number) =>
                lvl === undefined ? '' : owned.has(id) ? 'have' : lvl >= unlock ? 'gone' : 'locked';
            const tierSize = (unlock: number) => (cfg.perkTiers[cls] ?? []).find((t) => t.level === unlock)?.options.length ?? 1;
            const abilities = allAbilities(cfg)
                .filter((id) => abilityDef(cfg, id).cls === cls)
                .sort((a, b) => abilityDef(cfg, a).unlock - abilityDef(cfg, b).unlock);
            const passives = (Object.keys(cfg.passives) as PassiveId[]).filter((id) => cfg.passives[id].cls === cls);
            const rows = [
                ...abilities.map((id) => ({
                    unlock: abilityDef(cfg, id).unlock,
                    row: () => {
                        const a = abilityDef(cfg, id);
                        return html`<li class="${state(id, a.unlock)} ${tierSize(a.unlock) > 1 ? 'pick' : ''}">
                        <span class="lv">${String(a.unlock)}</span><span class="ic">${a.icon}</span>
                        <div><b>${a.label}</b> <em>${PHASE_LABEL[a.phase]}${a.cooldown ? ` · ${a.cooldown} round cooldown` : ''}</em><p>${a.desc}</p><p class="how">${a.how}</p></div>
                    </li>`;
                    },
                })),
                ...passives.map((id) => ({
                    unlock: cfg.passives[id].unlock,
                    row: () => {
                        const d = cfg.passives[id];
                        return html`<li class="passive ${state(id, d.unlock)} ${tierSize(d.unlock) > 1 ? 'pick' : ''}">
                        <span class="lv">${String(d.unlock)}</span><span class="ic">◆</span>
                        <div><b>${d.label}</b> <em>Passive · ${'innate' in d && d.innate ? `every ${cfg.classes[cls].label.toLowerCase()}` : 'always on'}</em><p>${d.desc}</p></div>
                    </li>`;
                    },
                })),
            ].sort((a, b) => a.unlock - b.unlock);
            return html`<section class="pb-class ${lvl ? 'mine' : ''}">
                <h3>${cfg.classes[cls].label} <small>${cfg.classes[cls].short}${lvl ? ` · level ${lvl}` : ''}</small></h3>
                <p class="blurb">${CLASS_BLURB[cls]}</p>
                <ul>${rows.map((r) => r.row())}</ul>
            </section>`;
        })}
        <p class="pb-foot">Numbers on the left are the class levels with a choice: at each one the player picks one of the entries marked "or" and the other is gone for good. You choose the class every level-up goes into; multiclass players pick in each class they have levels in.</p>
    </div>`;
};
