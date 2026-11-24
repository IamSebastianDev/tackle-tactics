/**
 * A pixel-styled dropdown in place of the web view's native <select>.
 *
 * The option list is a popover, so it renders in the top layer: never clipped by a scrolling panel,
 * always above dialogs, and it closes on Esc or a click elsewhere for free. The game stage is a
 * scaled box (stage.ts), so the list is placed from the button's on-screen rectangle and scaled by
 * the same factor. Keyboard: ↓/↑ open and move, Enter/Space pick, Esc/Tab close.
 */
import { combined, derived, grain, type Grain } from '@grainular/grains';
import { attr, html, mounted, on } from '@grainular/nord';

/** Anything readable and subscribable: a grain or a derived grain. */
type Readable<T> = (() => T) & { subscribe: (fn: (v: T) => void) => () => void };

export const Dropdown = <T extends string>(value: Readable<T>, options: ReadonlyArray<readonly [T, string]>, onChange: (v: T) => void) => {
    let button: HTMLButtonElement | null = null;
    let list: HTMLDivElement | null = null;
    const open = grain(false);
    /** The highlighted option while the list is open (keyboard or hover). */
    const cursor = grain(-1);
    let wasOpen = false;
    const selectedIndex = () =>
        Math.max(
            0,
            options.findIndex(([v]) => v === value()),
        );
    const label = derived(value, (v) => options.find(([o]) => o === v)?.[1] ?? options[0]?.[1] ?? '');
    const both = combined([value as Grain<T>, cursor]);

    const place = () => {
        if (!button || !list) return;
        const r = button.getBoundingClientRect();
        // the stage's scale: on-screen width over layout width
        const s = r.width / (button.offsetWidth || r.width);
        list.style.minWidth = `${button.offsetWidth}px`;
        list.style.transform = `scale(${s})`;
        const h = list.offsetHeight * s;
        const below = window.innerHeight - r.bottom;
        const up = below < h + 6 && r.top > below;
        list.style.left = `${Math.round(r.left)}px`;
        list.style.top = `${Math.round(up ? r.top - h - 2 : r.bottom + 2)}px`;
        list.classList.toggle('up', up);
    };
    const reveal = (i: number) => list?.children[i]?.scrollIntoView({ block: 'nearest' });
    const show = () => {
        if (!list || open()) return;
        cursor.set(selectedIndex());
        list.showPopover();
        place();
        reveal(cursor());
    };
    const hide = () => {
        if (list && open()) list.hidePopover();
    };
    const choose = (i: number) => {
        const o = options[i];
        hide();
        button?.focus();
        if (o && o[0] !== value()) onChange(o[0]);
    };
    const move = (by: number) => {
        const i = Math.max(0, Math.min(options.length - 1, cursor() + by));
        cursor.set(i);
        reveal(i);
    };

    const buttonRef = mounted<HTMLButtonElement>((el) => {
        button = el;
        return () => {
            button = null;
        };
    });
    const listRef = mounted<HTMLDivElement>((el) => {
        list = el;
        const onToggle = (e: Event) => open.set((e as ToggleEvent).newState === 'open');
        // the list is pinned to where the button was: any scroll or resize closes it
        const onMove = (e: Event) => {
            if (open() && !(e.target instanceof Node && el.contains(e.target))) hide();
        };
        el.addEventListener('toggle', onToggle);
        window.addEventListener('scroll', onMove, true);
        window.addEventListener('resize', onMove);
        return () => {
            el.removeEventListener('toggle', onToggle);
            window.removeEventListener('scroll', onMove, true);
            window.removeEventListener('resize', onMove);
            if (el.matches(':popover-open')) el.hidePopover();
        };
    });

    const keys = (e: KeyboardEvent) => {
        const isOpen = open();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (isOpen) move(e.key === 'ArrowDown' ? 1 : -1);
            else show();
        } else if (e.key === 'Enter' || e.key === ' ') {
            if (isOpen) choose(cursor());
            else show();
        } else if (e.key === 'Escape' && isOpen) hide();
        else if (e.key === 'Tab' && isOpen) {
            hide();
            return;
        } else if (e.key === 'Home' && isOpen) {
            cursor.set(0);
            reveal(0);
        } else if (e.key === 'End' && isOpen) {
            cursor.set(options.length - 1);
            reveal(options.length - 1);
        } else return;
        // handled here: keep the screen's own shortcuts (menus, match keys) out of it
        e.preventDefault();
        e.stopPropagation();
    };

    return html`<span class="dd">
        <button type="button" ${buttonRef} ${attr({ class: derived(open, (o) => `dd-button${o ? ' open' : ''}`), 'aria-expanded': derived(open, String) })}
            ${on('pointerdown', () => (wasOpen = open()))}
            ${on('click', () => {
                if (wasOpen) wasOpen = false;
                else show();
            })}
            ${on('keydown', keys)}><span class="dd-label">${label}</span><i class="dd-caret" aria-hidden="true"></i></button>
        <div class="dd-list" popover="auto" ${listRef}>${options.map(
            ([v, text], i) =>
                html`<div ${attr({
                    class: derived(both, ([cur, hi]) => `dd-option${cur === v ? ' on' : ''}${hi === i ? ' hi' : ''}`),
                })} ${on('pointerenter', () => cursor.set(i))} ${on('click', () => choose(i))}>${text}</div>`,
        )}</div>
    </span>`;
};
