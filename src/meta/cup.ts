import type { Rng } from '../rng';
import type { TeamSide } from '../types';
import type { Fixture } from './career';

export const CUP_NAME = 'Pyramid Cup';

export type CupFixture = Fixture & { competition: 'cup'; penalties?: [number, number] };
export type CupRound = { day: number; label: string; fixtures: CupFixture[]; byes: string[] };
export type Cup = { rounds: CupRound[]; champion?: string };

export const isCupFixture = (f: Fixture): f is CupFixture => 'competition' in f && f.competition === 'cup';

export const fixtureForClub = <F extends Fixture>(fixtures: readonly F[], club: string) =>
    fixtures.find((f) => f.home === club || f.away === club);

const draw = (clubs: readonly string[], rng: Rng, season: number, round: number, byeCount = 0) => {
    const ids = [...clubs];
    for (let i = ids.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const byes = ids.splice(0, byeCount);
    const fixtures = Array.from({ length: ids.length / 2 }, (_, i): CupFixture => ({
        competition: 'cup',
        id: `s${season}-cup-r${round}-${i}`,
        round,
        home: ids[2 * i]!,
        away: ids[2 * i + 1]!,
    }));
    return { fixtures, byes };
};

const roundLabel = (size: number) => {
    if (size === 2) return 'Final';
    if (size === 4) return 'Semi-finals';
    if (size === 8) return 'Quarter-finals';
    return `Round of ${size}`;
};

export const createCup = (rng: Rng, season: number, clubs: string[], leagueRounds: number, daysPerRound: number): Cup => {
    const count = Math.ceil(Math.log2(clubs.length));
    const fullSize = 2 ** count;
    const byes = fullSize - clubs.length;
    const rounds = Array.from({ length: count }, (_, index): CupRound => ({
        day: (Math.ceil(((index + 1) * leagueRounds) / count) + index) * daysPerRound + 1,
        label: index === 0 && byes ? 'Opening round' : roundLabel(fullSize / 2 ** index),
        fixtures: [],
        byes: [],
    }));
    if (rounds[0]) Object.assign(rounds[0], draw(clubs, rng, season, 0, byes));
    return { rounds };
};

export const cupWinner = (f: CupFixture): string | undefined => {
    const result = f.penalties ?? f.result;
    if (!result || result[0] === result[1]) return;
    return result[0] > result[1] ? f.home : f.away;
};

/** Five penalties each, followed by sudden death. Goals stay separate from the match score. */
export const recordCupScore = (rng: Rng, f: CupFixture, score: [number, number]) => {
    f.result = score;
    if (score[0] !== score[1]) return;
    const kick = () => Number(rng.chance(0.75));
    const penalties: [number, number] = [0, 0];
    for (let i = 0; i < 5 || penalties[0] === penalties[1]; i++) {
        penalties[0] += kick();
        penalties[1] += kick();
    }
    f.penalties = penalties;
};

export const advanceCup = (cup: Cup, round: CupRound, rng: Rng, season: number) => {
    const winners = round.fixtures.map(cupWinner);
    if (!winners.every((id) => id !== undefined)) return;
    const qualifiers = [...round.byes, ...winners];
    const index = cup.rounds.indexOf(round) + 1;
    const next = cup.rounds[index];
    if (next) {
        Object.assign(next, draw(qualifiers, rng, season, index));
        return next;
    }
    cup.champion = qualifiers[0];
};

export const penaltyScore = (f: Fixture, side: TeamSide = 0) =>
    isCupFixture(f) && f.penalties ? `${f.penalties[side]}–${f.penalties[side === 0 ? 1 : 0]} on pens` : '';
