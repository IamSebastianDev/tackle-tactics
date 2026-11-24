/**
 * Coach Marlow's one-time tips: contextual onboarding that appears the first time a situation
 * comes up, pauses the clock while it's on screen, and never nags twice.
 */
export type TipCtx = {
    phase: 'move' | 'act' | 'done';
    isCarrier: boolean;
    canTackle: boolean;
    hasUsableAbility: boolean;
    humanTurns: number;
    reactionHitUs: boolean;
    name: string;
};
export type Tip = { id: string; title: string; text: string; when: (c: TipCtx) => boolean };

export const TIPS: Tip[] = [
    {
        id: 'welcome', title: 'Every player, one move',
        text: "Right, listen up. Each round every player moves once, fastest first, the two sides taking turns. You're directing {name}. The blue squares are where they can reach — click one, or press Space to stay put. Get them into space; that's the whole game.",
        when: (c) => c.phase === 'move' && !c.isCarrier,
    },
    {
        id: 'carrier', title: 'Ball at your feet',
        text: "Now we're talking. Pink squares sit next to a defender with a reaction ready — dribble through one and they get a tackle roll. Fancy a pass instead? Press Space to stay where you are and you'll get to kick.",
        when: (c) => c.phase === 'move' && c.isCarrier,
    },
    {
        id: 'kick', title: 'Aim, then pray',
        text: "Point anywhere. The orange zone is where the ball might land — the further you kick, the wilder it gets. Long balls go up in the air and can only be cut out at the start and the end. Aim at the goal mouth to shoot.",
        when: (c) => c.phase === 'act' && c.isCarrier,
    },
    {
        id: 'abilities', title: 'Tricks of the trade',
        text: "See that card in the dock? That's an ability. Hover it and the pitch shows what it'll do; click to use. Every class has its own kit, and they unlock as players level up in training.",
        when: (c) => c.hasUsableAbility,
    },
    {
        id: 'defend', title: 'Win it back',
        text: "You're next to their carrier. Press T (or click them) to tackle. Win it and the ball's ours. Miss and you're off balance until your next turn — so pick your moment.",
        when: (c) => c.phase === 'act' && c.canTackle,
    },
    {
        id: 'reaction', title: 'That was a reaction',
        text: "Every player gets one reaction per round: a tackle or an interception when the ball comes near them. Players whose reaction is spent show a dim ring — attack them, they can't stop you.",
        when: (c) => c.reactionHitUs,
    },
    {
        id: 'focus', title: 'You can\'t be everywhere',
        text: "Notice some of your players moving on their own? That's Focus: players far from the ball keep their shape without bothering you. Press F to switch between every player, near the ball, or key duels only.",
        when: (c) => c.humanTurns >= 9,
    },
];

export const fillTip = (t: Tip, c: TipCtx) => t.text.replace('{name}', c.name);
