import { html } from '@grainular/nord';
import { nationOf } from '../world/nations';

/** A small pixel flag for a nationality (hover shows the country). */
export const flag = (nation: string | undefined, className = 'flag') => {
    const n = nationOf(nation);
    return html`<i class="${className}" style="background:${n.flag}" title="${n.name}" aria-label="${n.name}"></i>`;
};
