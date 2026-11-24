/** Kit colours for UI chrome (crests, plates, confetti). */
const KIT_COLORS: Record<string, string> = {
    blue: '#2f5fd0', yellow: '#f2c230', white: '#e8e8e8', hoops: '#2e9b5a', sky: '#6cc4f0',
    stripes: '#222', orange: '#f07a28', red: '#c8323a',
};
export const kitColor = (kit: string) => KIT_COLORS[kit] ?? '#888';
/** Kits pale enough that text on them must be dark. */
export const isLightKit = (kit: string) => ['white', 'yellow', 'sky'].includes(kit);
