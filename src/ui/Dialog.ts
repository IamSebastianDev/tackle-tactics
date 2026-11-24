import { html, mounted, on, type Fragment } from '@grainular/nord';

/** A modal whose DOM lifetime belongs to the surrounding Nørd region. */
export const Dialog = ({
    label,
    className = 'modal',
    dismiss,
    children,
}: {
    label: string;
    className?: string;
    dismiss?: () => void;
    children: Fragment;
}) => {
    const open = mounted<HTMLDialogElement>((dialog) => {
        const previous = document.activeElement;
        dialog.showModal();
        return () => {
            dialog.close();
            if (document.activeElement === document.body && previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    });
    return html`<dialog class="${className}" aria-label="${label}" ${open}
        ${on('cancel', (event) => {
            event.preventDefault();
            dismiss?.();
        })}
        ${on('click', (event) => {
            if (event.target === event.currentTarget) dismiss?.();
        })}
        ${on('keydown', (event) => event.stopPropagation())}>${children}</dialog>`;
};
