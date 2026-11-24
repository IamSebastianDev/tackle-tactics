/**
 * The pre-match intro: the commentary team, the ground, both line-ups and the story of the day.
 * Pure text built from the match setup; MatchView renders it as a short, skippable sequence.
 */
import type { GameConfig, TeamStyle } from '../config';
import type { Match } from '../engine/match';
import type { TeamSide } from '../types';
import { sizeLabel, type Conditions, type Stadium } from '../world/stadium';

export const COMMENTATORS = {
    lead: { name: 'Barnaby Quill', role: 'Commentary' },
    colour: { name: 'Ottilie Marsh', role: 'Co-commentator · former keeper, two caps, one famous broken finger' },
};

const pick = <T>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length]!;

export type IntroText = { welcome: string; colour: string; story: string[] };

/** The commentators' opening and the day's narrative (career lines come from the caller). */
export const introText = (
    cfg: GameConfig,
    m: Match,
    styles: [TeamStyle, TeamStyle],
    stadium: Stadium | undefined,
    conditions: Conditions | undefined,
    seed: number,
    careerStory: string[] = [],
): IntroText => {
    const [h, a] = m.state.clubs;
    const ground = stadium ? `${stadium.name}, ${sizeLabel(stadium.size).toLowerCase()}` : 'a neutral ground';
    const crowd = stadium ? `${Math.round(stadium.capacity * stadium.fill).toLocaleString('en')} in` : 'a few faithful in';
    const welcome = pick(
        [
            `Good afternoon from ${ground}, ${crowd}. ${h.name} against ${a.name}. I'm ${COMMENTATORS.lead.name}, and alongside me, ${COMMENTATORS.colour.name}.`,
            `Welcome to ${ground}. ${h.name} host ${a.name}, and ${crowd} to see it. ${COMMENTATORS.lead.name} here with ${COMMENTATORS.colour.name}.`,
            `${crowd} at ${ground} for ${h.name} and ${a.name}. ${COMMENTATORS.lead.name} with you, and ${COMMENTATORS.colour.name} beside me, gloves on as ever.`,
        ],
        seed,
    );
    const weather = conditions
        ? {
              clear: 'Lovely conditions. No excuses today.',
              rain: 'It is wet out there. Long passes will skid, keepers will hate it.',
              snow: 'Snow! The ball will do strange things. I have seen keepers cry.',
              fog: 'Fog rolling in. You will hear the shots before you see them.',
          }[conditions.weather]
        : '';
    const colour = `${weather} ${pick(
        [
            `Referee ${m.state.referee.name} today: ${cfg.referee.styles[m.state.referee.style].note.toLowerCase()}`,
            `${m.state.referee.name} has the whistle. ${cfg.referee.styles[m.state.referee.style].note}`,
        ],
        seed + 1,
    )}`.trim();
    const [sh, sa] = styles.map((s) => cfg.ai.styles[s].label.toLowerCase());
    const clash: Record<string, string> = {
        'high press:possession': 'The press against the patient passers. Somebody will crack.',
        'possession:high press': 'Patient passing against a high press. Composure is everything.',
        'low block:direct': 'A wall against the long ball. Expect plenty of headers.',
        'direct:low block': 'Long balls into a packed box. The big lads will earn their wages.',
    };
    const story = careerStory.length
        ? careerStory
        : [
              clash[`${sh}:${sa}`] ??
                  (sh === sa
                      ? `Both sides play it ${sh}. A mirror match: whoever blinks first loses.`
                      : `${h.name} play it ${sh}, ${a.name} ${sa}. Something has to give.`),
              conditions && conditions.time !== 'day'
                  ? conditions.time === 'night'
                      ? 'Under the floodlights tonight.'
                      : 'The light is fading already.'
                  : '',
              pick(
                  [
                      `${cfg.match.rounds} rounds. Every one counts.`,
                      'Space is the currency today. Spend it wisely.',
                      'Make space, deny space, beat the clock.',
                  ],
                  seed + 2,
              ),
          ].filter(Boolean);
    return { welcome, colour, story };
};

/** The danger man: the best finisher on the pitch for a side. */
export const dangerMan = (m: Match, team: TeamSide) =>
    m.state.pieces
        .filter((p) => p.team === team && p.player.cls !== 'keeper')
        .toSorted((x, y) => y.player.stats.shooting + y.player.level - (x.player.stats.shooting + x.player.level))[0];
