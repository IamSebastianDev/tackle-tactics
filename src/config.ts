/**
 * All tunables live here. Nothing in the engine, AI or UI should hard-code a number
 * that a modder might want to change. `GameConfig` is plain data; `withOverrides`
 * deep-merges a partial config on top of the defaults.
 */

export type ClassId = 'keeper' | 'defender' | 'midfielder' | 'winger' | 'striker';
export type StatId = 'speed' | 'pace' | 'passing' | 'shooting' | 'dribbling' | 'tackling' | 'reflexes' | 'composure';
export type Stats = Record<StatId, number>;
export type TimeoutPolicy = 'lose' | 'auto';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type TeamStyle = 'balanced' | 'press' | 'deep' | 'direct' | 'possession';

export type ClassKit = {
    label: string;
    short: string;
    /** Base movement points before the pace modifier. */
    move: number;
    /** Stat weights used when generating a player of this class (0..1, relative emphasis). */
    statProfile: Stats;
};

export type FormationSlot = {
    cls: ClassId;
    /** Home position, normalised: x 0 = own goal line, 1 = opponent goal line; y 0..1 across the pitch. */
    x: number;
    y: number;
    /** How strongly the slot translates with the ball (0 = pinned, 1 = follows fully). */
    ballShift: number;
    /** Weight of the role job vs. the slot. High = freelancer, low = shape enforcer. */
    roleWeight: number;
};

export type Formation = { id: string; label: string; slots: FormationSlot[] };

export const defaultConfig = {
    match: {
        /** Seconds per action. A ceiling, not a metronome. */
        timerSeconds: 15,
        /** A round = every player acts once. The concept's "turn counter". */
        rounds: 30,
        timeoutPolicy: 'lose' as TimeoutPolicy,
        /** Delay before an AI-controlled player acts, so humans can follow. ms */
        aiThinkMs: 320,
        /** Winning the ball in a tackle earns an immediate extra turn (carry it out of the scrum). */
        tackleBonusTurn: true,
        /** What the extra turn allows: 'full', 'noShot' (move and pass, no shooting) or 'move' (a run only). */
        tackleBonusMode: 'noShot' as 'full' | 'noShot' | 'move',
        /** A deliberate tackle is a duel: if it fails, the carrier gets the extra turn to escape. */
        missedTackleBonus: true,
        /** Extra pause after an action resolves, so the animation reads. ms */
        resolvePauseMs: 260,
        goalPauseMs: 1900,
    },
    pitch: {
        cols: 50,
        rows: 30,
        /** Cells of run-off rendered around the pitch (cosmetic). */
        margin: 6,
        /** Goal mouth height in cells (centred on the halfway row). */
        goalWidth: 4,
        boxDepth: 8,
        boxWidth: 18,
        sixDepth: 3,
        sixWidth: 9,
        circleRadius: 4.5,
        penaltySpot: 6,
    },
    camera: {
        cellPx: 24,
        scale: 1.12,
    },
    sprites: {
        framePx: 64,
        renderPx: 52,
        /** Pixel row of the feet inside a frame, measured on the source art. */
        feetY: 60,
        msPerFrame: 110,
        /** Goal sprite scale relative to the goal mouth. */
        goalScaleX: 1,
        goalScaleY: 1,
    },
    movement: {
        /** Every `paceStep` points above/below 50 pace adds/removes a move point. */
        paceStep: 22,
        /** Dribbling costs extra move points per cell. */
        dribbleCostMult: 1.4,
        /** Entering an opponent's adjacent cell ends an off-ball run (marking). */
        zocStopsOffBall: true,
    },
    ball: {
        /** Scatter radius (cells) = base + distance * perCell, then divided by skill factor. */
        passScatterBase: 0.15,
        passScatterPerCell: 0.085,
        shotScatterBase: 0.5,
        shotScatterPerCell: 0.11,
        /** skill factor = 0.55 + skill/100 * skillScale */
        skillScale: 0.9,
        maxScatter: 6,
        /** Passes longer than this are lofted: only interceptable near origin and landing. */
        loftThreshold: 12,
        loftInterceptCells: 2,
        /** Players within this Chebyshev distance of the landing cell can control the ball. */
        controlRadius: 1,
        /** Max shot distance (cells) the UI lets you aim from. */
        maxShotRange: 26,
    },
    reactions: {
        /** chance = base + (defStat - atkStat)/100 * statWeight, clamped. RNG sits on a stat floor. */
        interceptBase: 0.42,
        interceptStatWeight: 0.5,
        /** Lofted ball near its landing is easier to read than a driven ball. */
        tackleBase: 0.34,
        tackleStatWeight: 0.6,
        blockShotBase: 0.22,
        saveBase: 0.66,
        saveStatWeight: 0.55,
        /** Each cell the keeper is away from the shot's line costs this much save chance. */
        saveDistancePenalty: 0.12,
        /** Each cell of shot distance under 10 makes it harder to save. */
        saveCloseRangePenalty: 0.03,
        /** Each cell of shot distance beyond 10 makes it easier to save (keeper sees it coming). */
        saveLongRangeBonus: 0.015,
        minChance: 0.05,
        maxChance: 0.92,
        /** Active tackle (your own action) is a little more reliable than a reaction. */
        activeTackleBonus: 0.04,
        /** Chance a save is held rather than parried loose. */
        catchChance: 0.45,
    },
    ai: {
        /** Softmax temperature by difficulty: wider band = weaker AI. */
        temperature: { easy: 0.55, normal: 0.22, hard: 0.08 } as Record<Difficulty, number>,
        /** Weights for the off-ball cell scorer. */
        wSlot: 1.0,
        wJob: 1.4,
        wOpen: 0.45,
        wLane: 0.8,
        /** Normalised x pushed forward when in possession / pulled back when not. */
        stretch: 0.2,
        compress: 0.08,
        shootRange: 21,
        tackleThreshold: 0.33,
        /** How much the AI fears a missed tackle (the carrier then escapes with an extra turn). */
        missRisk: 0.2,
        /** Second presser joins once the carrier is this far (normalised) into our half. */
        doublePressFrom: 0.45,
        /** Job weight for pressers (overrides roleWeight) and the bonus for ending in contact. */
        pressWeight: 1.6,
        pressContactBonus: 2.5,
        /** Off-ball attackers' pull towards goal. */
        wForward: 0.25,
        /** Small cost on using an ability so it is saved for moments that matter. */
        abilityCost: 0.12,
        /** How likely an opponent in range actually goes for the tackle (exposure model). */
        tackleIntent: 0.65,
        pressersAssumed: 1,
        /** Cost of losing the ball: base + the opponent's threat from that cell. */
        lossBase: 0.05,
        /** Expected-threat curve: peak xT just in front of goal; small bonus for space. */
        xtPeak: 0.26,
        xtLinear: 0.08,
        openValue: 0.05,
        /** Pass success multiplier when an opponent stands next to the receiver. */
        contestedReceive: 0.75,
        goalValue: 3.5,
        crossValue: 0.95,
        /** Bonus per 10 cells of forward progress on a pass (Direct teams love it). */
        directBonus: 0,
        /**
         * Team identities: additive tweaks to the knobs above. A club's style is fixed (see
         * `styleOf`); the human's auto-players follow the game plan chosen in match prep.
         */
        styles: {
            balanced: { label: 'Balanced', note: 'No extremes. Adapts to the game.', d: {} },
            press: {
                label: 'High press',
                note: 'Hunts the ball high up the pitch. Leaves space behind.',
                d: { doublePressFrom: -0.22, compress: -0.04, pressWeight: 0.5, stretch: 0.03, tackleThreshold: -0.05 },
            },
            deep: {
                label: 'Low block',
                note: 'Sits deep and compact, waits for the counter.',
                d: { compress: 0.09, doublePressFrom: 0.2, pressWeight: -0.4, stretch: -0.06, lossBase: 0.03 },
            },
            direct: { label: 'Direct', note: 'Long balls forward, early shots.', d: { directBonus: 0.14, shootRange: 2, wForward: 0.15 } },
            possession: {
                label: 'Possession',
                note: 'Patient passing. Hates giving the ball away.',
                d: { lossBase: 0.06, contestedReceive: -0.1, shootRange: -2, openValue: 0.04 },
            },
        } as Record<TeamStyle, { label: string; note: string; d: Partial<Record<string, number>> }>,
        /** Game state: protect a late lead, chase a late deficit (fractions of the match). */
        protectFrom: 0.7,
        chaseFrom: 0.55,
        protect: { compress: 0.07, stretch: -0.06, lossBase: 0.05, doublePressFrom: 0.15 } as Partial<Record<string, number>>,
        chase: { stretch: 0.07, goalValue: 0.6, shootRange: 3, pressWeight: 0.4, doublePressFrom: -0.18, wForward: 0.15 } as Partial<
            Record<string, number>
        >,
    },
    world: {
        /** Share of a club's generated players who come from another nation. */
        foreignShare: 0.2,
        squadSize: 11,
        /** Total level range per player; a share of players multiclass. */
        levelRange: [2, 12] as [number, number],
        multiclassChance: 0.3,
        /** Fraction of total levels that may go into the secondary class. */
        multiclassShare: [0.2, 0.5] as [number, number],
        /** Talent is a bell curve (mean, sd), multiplier on stats. */
        talentMean: 1,
        talentSd: 0.12,
        statFloor: 25,
        statCeil: 95,
    },
    classes: {
        keeper: {
            label: 'Keeper',
            short: 'GK',
            move: 3,
            statProfile: { speed: 0.3, pace: 0.3, passing: 0.5, shooting: 0.1, dribbling: 0.2, tackling: 0.3, reflexes: 1, composure: 0.7 },
        },
        defender: {
            label: 'Defender',
            short: 'DF',
            move: 5,
            statProfile: {
                speed: 0.45,
                pace: 0.5,
                passing: 0.5,
                shooting: 0.2,
                dribbling: 0.3,
                tackling: 1,
                reflexes: 0.7,
                composure: 0.6,
            },
        },
        midfielder: {
            label: 'Midfielder',
            short: 'MF',
            move: 6,
            statProfile: {
                speed: 0.6,
                pace: 0.6,
                passing: 1,
                shooting: 0.5,
                dribbling: 0.6,
                tackling: 0.55,
                reflexes: 0.75,
                composure: 0.8,
            },
        },
        winger: {
            label: 'Winger',
            short: 'WG',
            move: 7,
            statProfile: { speed: 1, pace: 1, passing: 0.65, shooting: 0.5, dribbling: 1, tackling: 0.25, reflexes: 0.5, composure: 0.5 },
        },
        striker: {
            label: 'Striker',
            short: 'ST',
            move: 6,
            statProfile: {
                speed: 0.75,
                pace: 0.75,
                passing: 0.5,
                shooting: 1,
                dribbling: 0.7,
                tackling: 0.2,
                reflexes: 0.6,
                composure: 0.8,
            },
        },
    } as Record<ClassId, ClassKit>,
    formations: [
        {
            id: '4-3-3',
            label: '4-3-3',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.2, y: 0.15, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'defender', x: 0.17, y: 0.38, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.17, y: 0.62, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.2, y: 0.85, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'midfielder', x: 0.33, y: 0.5, ballShift: 0.5, roleWeight: 0.4 },
                { cls: 'midfielder', x: 0.4, y: 0.3, ballShift: 0.6, roleWeight: 0.8 },
                { cls: 'midfielder', x: 0.4, y: 0.7, ballShift: 0.6, roleWeight: 0.8 },
                { cls: 'winger', x: 0.46, y: 0.1, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'winger', x: 0.46, y: 0.9, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'striker', x: 0.48, y: 0.5, ballShift: 0.7, roleWeight: 1.1 },
            ],
        },
        {
            id: '4-4-2',
            label: '4-4-2 (deep block)',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.17, y: 0.15, ballShift: 0.4, roleWeight: 0.45 },
                { cls: 'defender', x: 0.14, y: 0.38, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.14, y: 0.62, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.17, y: 0.85, ballShift: 0.4, roleWeight: 0.45 },
                { cls: 'winger', x: 0.32, y: 0.12, ballShift: 0.55, roleWeight: 0.8 },
                { cls: 'midfielder', x: 0.3, y: 0.38, ballShift: 0.5, roleWeight: 0.4 },
                { cls: 'midfielder', x: 0.3, y: 0.62, ballShift: 0.5, roleWeight: 0.4 },
                { cls: 'winger', x: 0.32, y: 0.88, ballShift: 0.55, roleWeight: 0.8 },
                { cls: 'striker', x: 0.47, y: 0.4, ballShift: 0.65, roleWeight: 1.0 },
                { cls: 'striker', x: 0.47, y: 0.6, ballShift: 0.65, roleWeight: 1.0 },
            ],
        },
        {
            id: '3-4-3',
            label: '3-4-3 (high line)',
            slots: [
                { cls: 'keeper', x: 0.05, y: 0.5, ballShift: 0.2, roleWeight: 0.2 },
                { cls: 'defender', x: 0.24, y: 0.25, ballShift: 0.5, roleWeight: 0.5 },
                { cls: 'defender', x: 0.22, y: 0.5, ballShift: 0.45, roleWeight: 0.35 },
                { cls: 'defender', x: 0.24, y: 0.75, ballShift: 0.5, roleWeight: 0.5 },
                { cls: 'winger', x: 0.38, y: 0.08, ballShift: 0.6, roleWeight: 0.9 },
                { cls: 'midfielder', x: 0.36, y: 0.38, ballShift: 0.55, roleWeight: 0.5 },
                { cls: 'midfielder', x: 0.36, y: 0.62, ballShift: 0.55, roleWeight: 0.5 },
                { cls: 'winger', x: 0.38, y: 0.92, ballShift: 0.6, roleWeight: 0.9 },
                { cls: 'striker', x: 0.47, y: 0.22, ballShift: 0.65, roleWeight: 1.0 },
                { cls: 'striker', x: 0.48, y: 0.5, ballShift: 0.7, roleWeight: 1.1 },
                { cls: 'striker', x: 0.47, y: 0.78, ballShift: 0.65, roleWeight: 1.0 },
            ],
        },
    ] as Formation[],
    /**
     * Active abilities. A class grants an ability once the player's level *in that class*
     * reaches `unlock` (multiclassing = level distribution). Phases:
     *   pre  — used in the move phase without ending it (e.g. Trick, then still move)
     *   move — replaces the normal move with a different movement rule
     *   act  — the action after moving
     * `cooldown` is in rounds. All numbers are tunables.
     */
    abilities: {
        // ---- Winger
        sprint: {
            cls: 'winger',
            unlock: 2,
            phase: 'move',
            cooldown: 3,
            label: 'Sprint',
            key: 'Q',
            icon: '»',
            short: '+3 move, straight line',
            how: 'Pick it, then click a cell on one of the 8 lines.',
            desc: 'Burst in a straight line: +3 move, eight directions only.',
            bonusMove: 3,
        },
        trick: {
            cls: 'winger',
            unlock: 4,
            phase: 'pre',
            cooldown: 2,
            label: 'Trick',
            key: 'W',
            icon: '↯',
            short: 'Steal adjacent defenders’ reactions',
            how: 'Instant. You still get to move afterwards.',
            desc: 'Feint: every adjacent opponent must beat your Dribbling or lose their reaction. You still move after.',
            base: 0.55,
            statWeight: 0.6,
        },
        cross: {
            cls: 'winger',
            unlock: 6,
            phase: 'act',
            cooldown: 0,
            label: 'Cross',
            key: 'E',
            icon: '⤴',
            short: 'Ball into the box for a header',
            how: "Pick it, then aim at a cell inside the opponent's box.",
            desc: 'Lofted ball into the box from a wide area. A teammate within 2 of the drop attacks it with a header on goal.',
            headRadius: 2,
            wideRows: 7,
            minForward: 0.66,
        },
        // ---- Striker
        run: {
            cls: 'striker',
            unlock: 2,
            phase: 'move',
            cooldown: 2,
            label: 'Run in behind',
            key: 'Q',
            icon: '⇢',
            short: '+1 move, ignores marking',
            how: 'Pick it, then click where to run. Only without the ball.',
            desc: 'Off-ball run: +1 move and ignores marking.',
            bonusMove: 1,
        },
        placed: {
            cls: 'striker',
            unlock: 3,
            phase: 'act',
            cooldown: 0,
            label: 'Placed shot',
            key: 'W',
            icon: '◎',
            short: 'Accurate shot, easier to save',
            how: 'Pick it, then aim at the goal mouth.',
            desc: 'Pick your spot: tighter zone, but easier for the keeper.',
            scatterMult: 0.65,
            saveMod: 0.12,
        },
        power: {
            cls: 'striker',
            unlock: 5,
            phase: 'act',
            cooldown: 1,
            label: 'Power shot',
            key: 'E',
            icon: '✸',
            short: 'Wild shot, hard to save',
            how: 'Pick it, then aim at the goal mouth.',
            desc: 'Leather it: wider zone, much harder to save.',
            scatterMult: 1.3,
            saveMod: -0.2,
        },
        chip: {
            cls: 'striker',
            unlock: 8,
            phase: 'act',
            cooldown: 2,
            label: 'Chip',
            key: 'R',
            icon: '⌒',
            short: 'Lob a keeper who is off his line',
            how: 'Pick it, then aim at the goal mouth. Only blockable at take-off.',
            desc: 'Lob the keeper. Can only be blocked at take-off; deadly if the keeper is off his line, hopeless if not.',
            scatterMult: 1.1,
            offLine: 2,
            saveModOff: -0.4,
            saveModOn: 0.2,
        },
        // ---- Midfielder
        press: {
            cls: 'midfielder',
            unlock: 2,
            phase: 'move',
            cooldown: 2,
            label: 'Press',
            key: 'Q',
            icon: '⊳',
            short: '+1 move; pressure the carrier',
            how: 'Pick it, then move next to the ball carrier.',
            desc: '+1 move, ignores marking. An opposing carrier you end next to is pressured: wider kicks, easier to tackle.',
            bonusMove: 1,
            pressureScatter: 1.45,
            pressureTackle: 0.08,
        },
        through: {
            cls: 'midfielder',
            unlock: 3,
            phase: 'act',
            cooldown: 2,
            label: 'Through ball',
            key: 'W',
            icon: '↠',
            short: 'Pass into space; a teammate runs on',
            how: 'Pick it, then aim at empty space ahead of a teammate.',
            desc: 'Weighted into space: the nearest teammate within 3 of the drop runs onto it.',
            runRadius: 3,
        },
        tempo: {
            cls: 'midfielder',
            unlock: 6,
            phase: 'act',
            cooldown: 4,
            label: 'Set tempo',
            key: 'E',
            icon: '⏩',
            short: 'A teammate acts next',
            how: 'Pick it, then click a highlighted teammate.',
            desc: 'Point at a teammate who has not acted this round: they act next.',
        },
        // ---- Defender
        slide: {
            cls: 'defender',
            unlock: 2,
            phase: 'act',
            cooldown: 2,
            label: 'Slide tackle',
            key: 'Q',
            icon: '⟿',
            short: 'Tackle from 2 cells away',
            how: 'Instant, when the carrier is within 2. Missing floors you.',
            desc: 'Tackle a carrier up to 2 cells away. Miss and you are on the floor: half movement next turn.',
            reach: 2,
            bonus: 0.04,
        },
        mark: {
            cls: 'defender',
            unlock: 4,
            phase: 'act',
            cooldown: 0,
            label: 'Man-mark',
            key: 'W',
            icon: '⌖',
            short: 'Shadow one opponent',
            how: 'Pick it, then click a highlighted opponent within 4.',
            desc: 'Shadow an opponent within 4. Your marking reaches 2 cells for them, and if they receive the ball you step in.',
            range: 4,
        },
        foul: {
            cls: 'defender',
            unlock: 6,
            phase: 'act',
            cooldown: 0,
            label: 'Tactical foul',
            key: 'E',
            icon: '!',
            short: 'Freeze the carrier; card risk',
            how: "Instant, next to the carrier. In your own box it's a penalty!",
            desc: 'Stop an adjacent carrier dead: they cannot move next turn. Card risk. In your own box it is a penalty.',
            yellowChance: 0.45,
        },
        // ---- Keeper
        command: {
            cls: 'keeper',
            unlock: 3,
            phase: 'act',
            cooldown: 3,
            label: 'Command',
            key: 'Q',
            icon: '⚑',
            short: 'Teammates nearby regain reactions',
            how: 'Instant. Affects teammates within 5 cells.',
            desc: 'Organise the line: teammates within 5 regain their reaction and react better until their next turn.',
            radius: 5,
            bonus: 0.1,
        },
        rush: {
            cls: 'keeper',
            unlock: 5,
            phase: 'move',
            cooldown: 3,
            label: 'Rush out',
            key: 'W',
            icon: '⇉',
            short: '+3 move, ignores marking, tackle+',
            how: 'Pick it, then click where to charge.',
            desc: 'Charge off the line: +3 move, ignores marking, and a stronger tackle this turn.',
            bonusMove: 3,
            tackleBonus: 0.12,
        },
    },
    /** Passive traits, unlocked by class level like abilities. Applied inside rules.ts. */
    passives: {
        distributor: { cls: 'keeper', unlock: 1, label: 'Distributor', desc: 'Keeper kicks scatter 35% less.', passScatter: 0.65 },
        shotStopper: { cls: 'keeper', unlock: 8, label: 'Shot-stopper', desc: '+10% save chance.', save: 0.1 },
        stopper: { cls: 'defender', unlock: 8, label: 'Stopper', desc: '+8% tackle chance.', tackle: 0.08 },
        vision: { cls: 'midfielder', unlock: 5, label: 'Vision', desc: 'Passes scatter 20% less.', passScatter: 0.8 },
        reader: { cls: 'midfielder', unlock: 9, label: 'Reader', desc: '+10% intercept chance.', intercept: 0.1 },
        elusive: { cls: 'winger', unlock: 8, label: 'Elusive', desc: 'Tackles against you are 10% less likely.', evade: 0.1 },
        aerial: { cls: 'striker', unlock: 6, label: 'Aerial threat', desc: 'Headers scatter 30% less.', headerScatter: 0.7 },
        clinical: { cls: 'striker', unlock: 10, label: 'Clinical', desc: 'Shots scatter 20% less.', shotScatter: 0.8 },
    },
    /** The manager layer. Tier 0 is the top division. */
    career: {
        divisions: 5,
        clubsPerDivision: 10,
        /** Squad composition per club (by primary class). */
        squadMake: { keeper: 2, defender: 5, midfielder: 4, winger: 2, striker: 3 } as Record<ClassId, number>,
        squadMin: 13,
        squadMax: 20,
        /** Days between matchdays (matchday, then training days). */
        daysPerMatchday: 3,
        /** Per tier (index 0 = top): total level range and talent shift for generated players. */
        tierLevels: [
            [9, 16],
            [7, 13],
            [5, 11],
            [3, 9],
            [2, 7],
        ] as Array<[number, number]>,
        tierTalent: [0.1, 0.05, 0, -0.04, -0.08],
        /** Chance a generated player is a rare high-growth gem (bigger in lower tiers' markets = discovery). */
        gemChance: 0.04,
        startingBudget: [2_400_000, 1_100_000, 500_000, 240_000, 120_000],
        /** Per-match flat fee and win bonus by tier. */
        matchFee: [260_000, 130_000, 64_000, 32_000, 17_000],
        winBonus: 0.6,
        drawBonus: 0.2,
        /** Cup winner prize as a multiple of the club's match fee. */
        cupWinnerBonus: 4,
        /** Season-goal lump sums as multiples of the tier's match fee. */
        goalTitle: 6,
        goalTop4: 2.5,
        goalSurvive: 1,
        promote: 2,
        relegate: 2,
        /** XP & levelling. XP needed for the next level in a class = base + perLevel × current level. */
        xpBase: 80,
        xpPerLevel: 35,
        matchXp: 30,
        /** Stat growth: each level-up hands out growth × (0.7..1.3) stat points, weighted by class profile. */
        growthRange: [1.5, 5] as [number, number],
        peakAgeRange: [24, 28] as [number, number],
        /** End-of-season stat delta by (age − peak age) band. */
        aging: [
            { upTo: -6, delta: 3 },
            { upTo: -2, delta: 1.5 },
            { upTo: 1, delta: 0 },
            { upTo: 3, delta: -1 },
            { upTo: 6, delta: -2.5 },
            { upTo: 99, delta: -4.5 },
        ],
        retireFrom: 34,
        retireChance: 0.45,
        /** Simulated (AI vs AI) results: goals ~ Poisson(base × (strength ratio)^exp × home). */
        sim: { baseGoals: 1.5, exponent: 3.2, home: 1.08 },
        /** Match prep: a plan that counters the opponent's style is worth this much morale on the day. */
        prep: {
            edge: 6,
            /** Derbies: everyone is a bit more up for it, and the result swings morale harder. */
            derbyLift: 4,
            derbySwing: 6,
            talk: { calm: 4, fire: 8, overheatAt: 80, overheatChance: 0.35, overheat: -5, demandUp: 6, demandDown: -5 },
            /** Quick sims: each point of edge nudges expected goals by this fraction. */
            simEdge: 0.012,
        },
        market: {
            size: 72,
            priceMarkup: 1.15,
            saleCut: 0.85,
            /** Share of the market scouted from abroad (players from every nation can be signed). */
            foreignShare: 0.55,
        },
        /** Player value: base × (ovr/50)^ovrExp × age & growth factors. Wages are value × wageRate per matchday. */
        value: { base: 60_000, ovrExp: 4.2, wageRate: 0.0075 },
    },
    training: {
        /** Base XP for every fit player, plus bonuses for the drill's attributes and role. */
        xp: { base: 10, attributes: 18, primary: 18, secondary: 9 },
        /** Injury days healed while sitting out a squad session. */
        heal: 2,
        /** Injury chance per heavy knock taken in a match, and length range (days). */
        knockInjuryChance: 0.07,
        injuryDays: [2, 9] as [number, number],
    },
    /** Player looks: how many skin tones exist (ui/recolor.ts) and how common each hair colour is. */
    looks: {
        skinTones: 9,
        /** black, dark brown, brown, auburn, ginger, blonde, platinum, grey, blue dye, violet dye */
        hairWeights: [16, 14, 14, 7, 5, 9, 4, 3, 1, 1],
    },
    /** Stamina: drained per cell run and per round; scaled so a full match drains the same at any length. */
    fatigue: {
        perCell: 0.32,
        perRound: 0.4,
        /** Extra drain for a burst (sprint / run / press / rush) and for a tackle or slide. */
        burst: 3,
        tackle: 1.5,
        /** Players past this age tire faster (per year). */
        ageFrom: 29,
        agePerYear: 0.04,
        /** Below `tired`: one move point fewer. Below `exhausted`: two, and reactions suffer. */
        tired: 50,
        exhausted: 25,
        exhaustedReaction: 0.08,
        /** Reference match length the drain rates are tuned for. */
        refRounds: 30,
    },
    subs: {
        max: 3,
        bench: 5,
        /** The AI starts making changes from this fraction of the match, for players below `aiBelow` stamina. */
        aiFrom: 0.5,
        aiBelow: 52,
    },
    /** Dead balls: corners and free kicks in the final third get a placement setup. */
    setPieces: {
        /** Placements each side may make during the setup (alternating, attackers first). */
        placements: 3,
        /** Attackers sent into the box by default. */
        runners: 4,
        /** A free kick at least this far forward (0..1 towards goal) becomes a set piece. */
        freeKickForward: 0.62,
        wallSize: 3,
        wallDistance: 3,
        /** Cells around the box where players may be placed. */
        zoneMargin: 2,
        /** Chance the ball goes out for a corner after a parry / a blocked shot / a headed clearance. */
        parryCorner: 0.55,
        blockCorner: 0.5,
        clearCorner: 0.35,
        /** A wide shot took a deflection on the way. */
        wideCorner: 0.5,
        /** A pass or cross out over the byline with a defender within 2 cells of where it went out. */
        bylineCorner: 0.7,
        /** Header duels: defenders goal-side get this head start (cells); composure counts a little. */
        defenderEdge: 0.25,
        composureWeight: 0.006,
    },
    /** Referees: how often missed or reckless challenges are fouls, how freely cards come out. */
    referee: {
        styles: {
            lenient: {
                label: 'Lenient',
                note: 'Lets it flow. Plays advantage, keeps the cards in the pocket.',
                foulOnMiss: 0.16,
                foulOnWin: 0.04,
                slideMult: 1.8,
                card: 0.2,
                red: 0.02,
                advantage: 0.85,
            },
            fair: {
                label: 'Fair',
                note: 'By the book, no more, no less.',
                foulOnMiss: 0.28,
                foulOnWin: 0.07,
                slideMult: 1.8,
                card: 0.35,
                red: 0.04,
                advantage: 0.6,
            },
            strict: {
                label: 'Card-happy',
                note: 'Whistles everything. Mind your tackles.',
                foulOnMiss: 0.38,
                foulOnWin: 0.1,
                slideMult: 1.6,
                card: 0.55,
                red: 0.08,
                advantage: 0.25,
            },
        } as Record<
            'lenient' | 'fair' | 'strict',
            {
                label: string;
                note: string;
                foulOnMiss: number;
                foulOnWin: number;
                slideMult: number;
                card: number;
                red: number;
                advantage: number;
            }
        >,
        /** Relative frequency of each style among the referee pool. */
        weights: { lenient: 1, fair: 2, strict: 1 },
        names: [
            'Aldous Penhallow',
            'Brigid Thorne',
            'Cedric Vane',
            'Dorcas Mallory',
            'Edwin Ashgrove',
            'Fenna Crook',
            'Godfrey Lusk',
            'Hester Wren',
            'Ivo Blackmere',
            'Jessamy Rook',
            'Kit Harrowgate',
            'Linnet Shaw',
            'Mortimer Quayle',
            'Nell Fairweather',
            'Osric Dunmore',
            'Prudence Hale',
        ],
    },
    /** Matchday weather nudges the ball: kicks scatter a little more in rain and snow. */
    weather: {
        scatterMult: { clear: 1, rain: 1.12, snow: 1.18, fog: 1.05 } as Record<string, number>,
    },
    cards: {
        /** Second yellow = red; a sent-off player leaves the pitch for the rest of the match. */
        yellowsForRed: 2,
        penaltyScatterMult: 0.55,
        penaltySaveMod: -0.25,
        freeKickScatterMult: 0.85,
    },
    /** Kit sprite folders (under public/assets/cast). `_1`/`_2` are two looks per kit. */
    kits: {
        outfield: ['blue', 'yellow', 'white', 'hoops', 'sky', 'stripes', 'orange', 'red'],
        keepers: ['keeper_pink', 'keeper_black', 'keeper_lime', 'keeper_orange'],
        /** Kits too alike to share a pitch (besides identical ones). */
        clashes: [
            ['blue', 'sky'],
            ['orange', 'red'],
            ['yellow', 'orange'],
        ] as Array<[string, string]>,
    },
    /** Frames per animation strip (measured from the art). */
    animFrames: {
        idle: 12,
        walk: 8,
        run: 8,
        dribble: 8,
        kick: 8,
        pass: 6,
        header: 8,
        trap: 6,
        slide_tackle: 10,
        fall: 8,
        get_up: 8,
        celebrate: 12,
        sad: 12,
        tired: 12,
        clap: 12,
        juggle: 12,
        shout: 12,
        frustrated: 12,
        gk_ready: 12,
        gk_hold: 12,
        gk_catch: 6,
        gk_punch: 6,
        gk_punt: 8,
        gk_throw: 8,
        gk_dive: 10,
    } as Record<string, number>,
};

export type GameConfig = typeof defaultConfig;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const withOverrides = (overrides: DeepPartial<GameConfig>, base: GameConfig = defaultConfig): GameConfig => {
    const merge = (a: unknown, b: unknown): unknown => {
        if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? a : b;
        const out: Record<string, unknown> = { ...a };
        for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
        return out;
    };
    return merge(base, overrides) as GameConfig;
};
