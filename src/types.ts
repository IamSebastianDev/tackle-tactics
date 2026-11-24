import type { ClassId, Stats, TeamStyle } from './config';

export type Cell = { x: number; y: number };
export type Facing = 'left' | 'right' | 'up' | 'down';
export type TeamSide = 0 | 1;

export type Player = {
    id: string;
    name: string;
    /** Primary class (the one with the most levels). */
    cls: ClassId;
    /** Total level = sum of class levels. */
    level: number;
    /** Multiclassing is just level distribution. */
    levels: Partial<Record<ClassId, number>>;
    age: number;
    /** Bell-curved multiplier; visible rating in the meta layer. */
    talent: number;
    stats: Stats;
    /** Sprite folder, e.g. "blue_player_1" or "keeper_pink". Derived from club kit + `look`. */
    sprite: string;
    /** Which of the two sprite variants per kit this player uses (hairstyle/build). */
    look: 1 | 2;
    /** Palette indices (ui/recolor.ts); absent on older saves → derived from the id. */
    skin?: number;
    hair?: number;
    number: number;
    /** Stat points gained per level-up (the growth lever; talent is the base lever). */
    growth: number;
    peakAge: number;
    /** XP banked towards the next level, per class. */
    xp: Partial<Record<ClassId, number>>;
    /** Days until fit; absent when fit. */
    injury?: number;
};

export type Club = {
    id: string;
    /** Division tier the club plays in (0 = top). Absent for one-off friendlies. */
    tier?: number;
    /** Team morale 10..100 (60 = settled): nudges reactions and kick accuracy. */
    morale?: number;
    name: string;
    short: string;
    kit: string;
    keeperKit: string;
    /** Second strip, worn when the home kit would clash with the home side's (career clubs). */
    awayKit?: string;
    formationId: string;
    /** Substitutes available for this match (engine clubs only). */
    bench?: Player[];
    /** Playing style; absent → derived from the id (see ai/brain `styleOf`). */
    style?: TeamStyle;
    squad: Player[];
};

/** Per-match mutable piece on the board. */
export type Piece = {
    id: string;
    player: Player;
    team: TeamSide;
    slot: number;
    pos: Cell;
    facing: Facing;
    reactionReady: boolean;
    /** True after a failed reaction: off balance until their next turn (cosmetic + no reaction). */
    staggered: boolean;
    /** Ability id → round from which it is usable again. */
    cooldowns: Record<string, number>;
    status: PieceStatus;
    yellows: number;
    /** 100 = fresh. Running drains it; tired players move less and react worse. */
    stamina: number;
    /** Copied from the club at kickoff. */
    morale?: number;
};

export type PieceStatus = {
    /** Set by Press: wider kicks, easier to tackle. Cleared when this piece's turn ends. */
    pressured?: boolean;
    /** Fouled: cannot move on their next turn; their kick is a free kick. Cleared at turn end. */
    fouled?: boolean;
    /** Missed a slide: half movement next turn. Cleared at turn end. */
    grounded?: boolean;
    /** Becomes `grounded` at the start of this piece's next turn. */
    groundedNext?: boolean;
    /** Man-marking target id. Cleared at the start of this piece's next turn. */
    markOn?: string;
    /** Keeper's Command buff. Cleared at the start of this piece's next turn. */
    commanded?: boolean;
    /** Rush out is active (tackle bonus this turn). */
    rushing?: boolean;
    /** Trick already used this turn. */
    tricked?: boolean;
};

export type BallState = { kind: 'held'; by: string } | { kind: 'loose'; at: Cell; restrictedTo: TeamSide | null };

export type Phase = 'move' | 'act' | 'done';

export type RefStyle = 'lenient' | 'fair' | 'strict';
/** The match official. Style is fixed per name, so a referee's reputation follows them around. */
export type Referee = { name: string; style: RefStyle };

export type SetPieceKind = 'corner' | 'freekick';
/**
 * A dead-ball situation. `setup`: both sides take turns placing players (attackers first);
 * `take`: the taker gets an extra turn straight away and may only kick.
 */
export type SetPiece = {
    kind: SetPieceKind;
    team: TeamSide;
    taker: string;
    spot: Cell;
    stage: 'setup' | 'take';
    /** Whose placement is next during setup. */
    next: TeamSide;
    /** Placements left per side. */
    left: [number, number];
    /** The taker's turn has started. */
    armed?: boolean;
};

export type MatchEvent =
    | { t: 'move'; id: string; path: Cell[]; dribble: boolean; ability?: string }
    | { t: 'ability'; by: string; ability: string; target?: string; at?: Cell }
    | { t: 'trick'; by: string; on: string; success: boolean }
    | { t: 'pressure'; by: string; on: string }
    | { t: 'foul'; by: string; on: string; penalty: boolean; advantage?: boolean; tackle?: boolean }
    | {
          t: 'setpiece';
          kind: SetPieceKind;
          team: TeamSide;
          taker: string;
          at: Cell;
          /** Where everyone stood before the set-piece shape was arranged (for the presenter). */
          from: Record<string, Cell>;
      }
    | { t: 'place'; id: string; from: Cell; to: Cell }
    | { t: 'sub'; team: TeamSide; off: string; on: string }
    | { t: 'bonus'; id: string; reason: 'won' | 'beat' }
    | { t: 'card'; on: string; card: 'yellow' | 'red' }
    | { t: 'header'; by: string; at: Cell }
    | { t: 'runOnto'; by: string; path: Cell[] }
    | { t: 'tackle'; by: string; on: string; success: boolean; reaction: boolean; at: Cell }
    | { t: 'kick'; by: string; kind: 'pass' | 'shot'; from: Cell; target: Cell; landing: Cell; radius: number }
    | { t: 'intercept'; by: string; at: Cell; success: boolean; block: boolean }
    | { t: 'receive'; by: string; at: Cell }
    | { t: 'loose'; at: Cell }
    | { t: 'save'; by: string; held: boolean; at: Cell }
    | { t: 'saveFail'; by: string }
    | { t: 'goal'; team: TeamSide; scorer: string }
    | { t: 'wide'; team: TeamSide }
    | { t: 'out'; at: Cell; to: TeamSide }
    | { t: 'pickup'; by: string; at: Cell }
    | { t: 'timeout'; id: string }
    | { t: 'kickoff'; team: TeamSide }
    | { t: 'halftime' }
    | { t: 'fulltime' };

export type LogEntry = { round: number; text: string; team: TeamSide | null };

export type MatchState = {
    clubs: [Club, Club];
    pieces: Piece[];
    ball: BallState;
    score: [number, number];
    round: number;
    /** Turn order for the current round (piece ids). */
    order: string[];
    turnIndex: number;
    phase: Phase;
    log: LogEntry[];
    over: boolean;
    halftimeDone: boolean;
    seed: number;
    /** Players removed by a red card. */
    sentOff: Piece[];
    /** Heavy knocks taken per player (won tackles against them, fouls): feeds injuries in the career. */
    knocks: Record<string, number>;
    referee: Referee;
    setPiece: SetPiece | null;
    /** Substitutions made per side, and the players taken off. */
    subs: [number, number];
    subbedOff: Piece[];
    /** A tackle winner owed an immediate extra turn (taken before the order moves on). */
    bonusNext?: string;
    /** Why the extra turn is owed: the ball was won, or a deliberate tackle was beaten. */
    bonusReason?: 'won' | 'beat';
    /** The extra turn running right now; `active()` returns this piece while it is set. */
    bonusTurn?: string;
};
