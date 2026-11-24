import type { Grain } from '@grainular/grains';
import { mounted } from '@grainular/nord';

/** Grains 2.4 forwards every derived emission, including an unchanged projection. */
export const distinct = <T>(source: Grain<T>): Grain<T> =>
    Object.assign(() => source(), {
        subscribe: (listener: (value: T) => void) => {
            let previous = source();
            return source.subscribe((value) => {
                if (Object.is(previous, value)) return;
                previous = value;
                listener(value);
            });
        },
    });

/** Keep the live value in sync even after the browser marks a control as edited. */
export const controlValue = (value: Grain<string | number>) =>
    mounted<HTMLInputElement | HTMLSelectElement>((control) => {
        const update = (next: string | number) => {
            if (control.value !== String(next)) control.value = String(next);
        };
        update(value());
        return value.subscribe(update);
    });
