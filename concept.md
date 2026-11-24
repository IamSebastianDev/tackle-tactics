# Concept

A turn-based positioning tactical game wearing a soccer skin. At its core it is a board game about creating and denying space on a grid: 22 players, one contested ball, and the whole game living in off-ball movement. Soccer is a deliberately chosen theme rather than arbitrary paint — the sport's own vocabulary (passing lanes, marking, getting open, the through ball, shielding) is the natural language of off-ball positioning, so player intuition about soccer maps directly onto correct intuition about the mechanics. Theme and mechanics reinforce each other: the sport teaches the systems for free, and the systems make the theme play out authentically.

Reference lineage is the tactics game — Advance Wars, Into the Breach, Final Fantasy Tactics — not the soccer simulation (FIFA, eFootball) or the management sim (Football Manager). The design space is genuinely uncontested because existing soccer games approach from either real-time physical fidelity or full match abstraction; neither treats 22-player positioning as a discrete tactical puzzle solved by hand.

## Design Pillars

- **Positioning is the game.** One player has the ball (or nobody does); the other 21 solve spatial problems — shielding as defenders, opening receiving lanes as attackers. The on-ball player is nearly the simplest piece on the board.
- **Movement abilities carry differentiation.** Class identity comes primarily from movement kits, not on-ball actions. How far, in what pattern, with what reactive capability a player can move is what makes a winger feel different from a defender.
- **Pressure through a soft time ceiling.** Each action is gated by a configurable timer (default ~10s). It is a ceiling, not a metronome — act and pass the baton immediately when done; the clock only bites on hesitation. Miss the window, lose the action.
- **Visible but uncertain outcomes.** The player sees legal movement range and shot/pass target zones, but never precisely where a struck ball lands. Uncertainty itself is the mechanic.
- **Config-first, moddable.** No magic numbers anywhere. Timer, match length, divisions, squad sizes, formations — all data, all overridable.

## Match Structure

### The turn loop

Players act one at a time in sequence. The active player is clearly indicated; the camera focuses on them. The controlling player has up to the timer duration to decide and act, then the baton passes to the next player. Acting early ends the window early and immediately advances.

Turn order is determined by the **Speed stat**, sorted descending, with teams alternating within that order. Speed as initiative means faster squads shape the board before slower ones can respond — a genuine tempo advantage, amplified under the timer, and a real team-composition decision before kickoff. Equal-speed ties break on a secondary stat or slight randomness.

When possession changes mid-sequence (tackle, interception, pass), the new carrier does **not** get a bonus turn; play continues in the existing sequence. This prevents cascading chaos and creates tension — winning the ball doesn't immediately let you capitalize.

### Match length

Framed in **plays**, not minutes. A play is roughly 3 turns (position, read, execute — about the time for a player to traverse meaningful distance). Target is ~5–7 plays per half. Both timer duration and total match length are user-configurable; a strong opinionated default ships (~10s timer, ~30 turns), with sliders available but not demanded. Two halves preserved for feel and a halftime beat; the structure is cosmetic mechanically.

A visible turn counter gives the player the clock's pressure ("turn 34 of 40, down by one").

Match intensity is deliberately high and filters _for_ the tactics-curious audience rather than the realism-seeking soccer fan. Configurability dissolves the audience tension — crank it to 8s/40 turns for a vice, or 45s/20 turns for a relaxed positioning game.

## The Pitch

- Real pitch dimensions (105×68m) are impractical; the game grid is roughly **50×30 cells**, one cell ≈ a couple of meters. Tight enough to render and read, spacious enough for penalty-area shape, midfield buildup, and crossing angles.
- **Orientation:** left-to-right (goals on the left and right), matching every football mental model.
- **Camera:** a real CSS perspective camera (not orthographic). Locked constants: `perspective: 700px`, `perspective-origin: 50% 35%`, `rotateX(35deg)`, `scale(1.18)`. Slight tilt so the far side recedes convincingly but stays readable.
- **Rendering architecture:** the pitch is a cosmetic background; a flat transparent grid overlay sits on top and is the source of truth for positions. Sprites live on the grid layer. The camera transforms all layers together. UI overlays (movement range, target zones) draw on the flat grid, not the perspective pitch.

## Visual Language

All game-state information is expressed as **colored region overlays on the grid** — one consistent visual grammar, learned once, read everywhere. Color is the only thing distinguishing meaning:

- **Movement range** — one color; where the active player can legally move (certain).
- **Shot/pass target scatter** — same overlay treatment, different hue; the area the ball might end up (uncertain). A soft overlay, a bounded _area_ rather than a crosshair, so the mental model is "lobbing it roughly there," not "hitting that point."
- A third color reserved for danger/interception or active-player indication.

The scatter zone is a **hard zone around the cursor**, scaling in size with distance and the acting player's relevant skill. A short pass or close shot has a tight zone (reliable); a long ball or distant shot has a large zone (a gamble). This makes skill legible spatially and without numbers — you _see_ a low-percentage shot because the zone sprawls past the posts. No percentages shown (they'd turn the shot into a math problem and undercut the visceral uncertainty); a pure visual indicator only. Good off-ball movement literally improves passes by shrinking the effective target zone, interlocking the positioning and targeting systems.

Palette must survive colorblindness checks (red/green is the obvious trap on a green pitch); reserve the small intentional palette now.

## Classes & Progression

### Base classes

Keeper, Defender, Midfielder, Winger, Striker. Classes are **action sets, not movement restrictions** — the keeper is a normal piece who simply has different tools (Save, Punch, Distribute, Command) available. Illustrative action directions:

- **Keeper** — Save reaction, Punch clear, Distribute (long pass), Command (buff adjacent defenders)
- **Defender** — Tackle, Block run, Header duel, Foul (deliberate, card risk)
- **Midfielder** — Through ball, Press, Intercept, Set tempo
- **Winger** — Dribble, Cross, Sprint, Trick (burns a defender's reaction without committing to a direction)
- **Striker** — Shoot variants (power/placed/chip), Movement run, Header finish

Possible additional classes to consider: Sweeper, Targetman, Libero — real archetypes that could be distinct classes.

### Level-based abilities (DnD model)

Players gain new/upgraded actions as class level rises. Power is a function of level and specialization: a level-20 pure Striker has deeper, stronger finisher actions than a 10/10 Midfielder-Striker, who instead has breadth. Higher-level actions can be **passive traits** (e.g. reduced shot-scatter variance) rather than new buttons — adding build identity through the active/passive distinction.

Multiclassing is handled entirely through level distribution — no separate dual-class rules. Total level is the power floor; distribution is the action set. The tradeoff (a 10/10 never reaches the level-16 passive) is self-evident and needs no special balancing.

### Stats, talent & growth

Two independent levers on top of the level baseline:

- **Base stats** — the level-1 floor, varies per player.
- **Stat points per level** — growth rate, varies per player.

**Talent** is a bell-curved multiplier producing four quadrants: high base/low growth (gifted but plateaus), low base/high growth (late bloomer), high/high (generational, rare, expensive), low/low (cheap depth). Talent gives the transfer market trajectory, not just current output, and is a visible rating. Truly elite talent is rare enough that finding one in a lower division feels like a discovery.

Movement range, hit/success chances, and reaction outcomes all derive from stats. Injuries reduce stats temporarily.

## Reactions

Borrowed from the DnD reaction concept. A player with a reaction available can act _outside their own turn_ when a trigger occurs nearby, closing the hole where the ball could otherwise walk past a defender untouched. This makes every square genuinely contested.

- **Trigger windows are narrow and spatial** (this specific square, this moment), so ball movement stays possible and danger is legible before you commit:
    - Ball passes into/through an adjacent square → **Intercept**
    - Ball-carrier moves into/through a defender's adjacent square → **Tackle / Steal**
    - Shot taken → Goalkeeper **Save**
    - Player runs into a defender's zone → **Block run / Mark**
- **One reaction per turn cycle**, refreshed at the start of the player's next turn (DnD-style). A defender who has spent their reaction is visibly vulnerable and exploitable.
- **Outcomes are stat + RNG** — high Reflexes widens the save/intercept window, high Tackle improves steals and lowers injury risk, high Composure reduces fatigue/pressure penalties, low Agility means a successful reaction still leaves you out of position.
- RNG sits on a stat floor, so upsets are possible but unlikely — a low-level defender _can_ dispossess a star, just rarely.
- **Failed reactions matter** — a missed tackle costs position and the recovery turn, making the attempt itself a real risk/reward decision.

## Sprites & Animation

- **32×32 conceptual scale, drawn as 64px sprites**, cute pixel art, slight elevation angle that reads as a character silhouette.
- **Layered compositing:** body (male/female base = the kit layer), skin tone, head shape, hairstyle. ~2 bodies, 6–8 skin tones, 8–10 heads, 12–15 hairstyles ≈ 30–35 sprites covering enormous variety. Kit color is a runtime palette/hue swap per team — no extra sprites per club.
- **Animation on twos:** ~6 key poses held across ~12 frames for that limited-animation TV feel; variable hold times (e.g. a single contact frame on ones) for punch. Full set per body ≈ 35–40 frames (idle, walk with/without ball, run, kick/shoot, tackle, react/celebrate, injured).

### Working sprite sheet (measured)

Current asset (`character1-Sheet.png`, commercial rights held): **1536×2496px, 12 columns × ~39 rows.**

- **Column pitch: 128px** (sprite content ~15px wide, centered in each cell, center ≈ x64).
- **Row pitch: 64px** (content occupies the middle band, feet at ≈ y47 within the cell).
- Real per-row frame counts are single-step: idle ≈ 5, walk ≈ 6, run ≈ 12, etc.

Token rendering: a 128×64 viewport with `overflow:hidden` shows one frame; the token is counter-rotated `rotateX(-35deg)` with `transform-origin: 50% 100%` to stand upright against the tilted pitch, anchored so feet land on the grid point; a soft ground-shadow ellipse sells the grounding.

## Meta Game

### Season loop

- **87-day season:** a league or cup matchday followed by two training days. There are 18 league matchdays, six Pyramid Cup dates and five Champions Cup dates. Clubs not playing on a cup date train.
- Choose one training focus per day for the whole squad. Fit players earn XP; players suited to the drill (class and its attributes) earn more. XP belongs to no class.
- **Level-ups are explicit.** When a player has enough XP, the manager chooses which class the level goes into: one they have, or a new outfield class (keepers stay keepers). AI clubs level in their main class.
- **Perk choices.** At certain class levels (2, 5, 8) the player picks one of two perks, an active ability or a passive, and the other is gone for good, so players of the same class differ. AI and generated players pick at random. See `config.perkTiers`.
- **Injured players** sit out training and recover automatically.
- The market is refreshed at season start and topped up through the season, with players from every nation; released players wait there as free agents.
- **AI transfers:** on training days AI clubs (any nation) sign the market player who most improves their weakest XI slot, if they can afford him, releasing a surplus player when the squad is full. AI clubs earn a yearly income by division (capped).
- **Offers for your players:** now and then a club at your level or above, anywhere, that can pay and would start him, bids for one of your best players (a premium on his value). It arrives as a letter: sell (he joins them, the fee is yours) or keep him.

### Aging

Applied as a single end-of-season stat delta:

- 18–21: strong positive
- 22–25: small positive
- 26: neutral (peak window)
- 27–29: small negative
- 30–32: meaningful negative (outpaces average training gains)
- 33+: steep decline

**Peak age varies per player** (roughly 24–28), so two same-age players aren't interchangeable — adds transfer-market ambiguity (is this 25-year-old ascending or already declining?).

### League & competition

- **5 divisions × 10 clubs** (all defaults, all config-driven). Player starts in the bottom division.
- Double round robin: everyone plays everyone home and away (18 matches). Simple points — 3 win / 1 draw / 0 loss.
- **Pyramid Cup:** a single-match knockout spanning all 50 clubs. The opening draw gives 14 clubs a bye. Subsequent rounds are drawn as teams advance. Ties go directly to simulated penalties, and the final follows the last league matchday.
- **The world:** every one of the 16 nations plays its own full 5×10 pyramid alongside the manager's (800 clubs), simulated each matchday with promotion and relegation.
- **Champions Cup:** the top two of every nation's top flight (32 clubs, from last season's tables; by squad strength in season one) in a single-match knockout through the season, with a large winners' bonus.
- **Top 2 promote, bottom 2 relegate.** Promotion is the goal; consolidation seasons are valid strategy.
- Division tier is the master difficulty constraint — it scales AI squad level, talent frequency, budgets, wages, transfer fees, and match income. The opponent roster quality _is_ the difficulty curve; no explicit tuning needed.
- All-fantasy clubs and players — no licensing constraints, freeing the RPG-flavored presentation (clubs feel more like adventuring parties than football clubs).

### Economy

Money is a hard requirement (the transfer market depends on it, especially given aging). Income sources:

- **Match income** — flat fee per game, win bonus. Keeps cash flowing.
- **Season goals** — top-4, avoid relegation, win the division. Lump sums; creates mid-table stakes.
- **Player sales** — the core loop: buy a cheap young prospect, invest training, sell at profit, reinvest. Dual purpose for every training decision — develop for the squad _or_ as a sellable asset. Selling a developed player hurts tactically, which is the intended tension.

**Wages** are the ongoing constraint, scaling with level and available stat points (so a generational talent at level 10 can out-cost a low-talent level-15 player). Transfer fee is one-time; wages are the sustained pressure. Quality-now versus financial-sustainability is the central management tension. Player value is formula-driven from level, class distribution, age-relative-to-peak, stat spread, and remaining development seasons.

Full money loop: win → earn → buy/develop → sell surplus → reinvest → promote → higher-division income.

## AI

### Match AI (human-facing opponent)

Pure per-turn heuristic scoring on fully public game state:

1. Receive game state (everything public — no hidden-info modeling).
2. Enumerate the active player's legal actions.
3. Score each against weighted positional criteria.
4. Select from the top options via weighted/softmax sampling (not strict best-move), with the random band _narrowing_ when one option dominates — so the AI doesn't fluff obvious situations but stays varied in ambiguous ones.

The scoring function is the entire project; the pipeline around it is trivial. Because the game is about positioning for _future_ moments, the scorer values **positions against role-based ideals**, not immediate outcomes.

### Formation-driven positioning model

Every player's target square each turn is computed from three nested influences:

1. **Formation slot (lowest weight)** — your nominal home zone in the team shape; the fallback when nothing else pulls you.
2. **Ball relation (higher weight)** — the whole formation translates as a unit toward the ball (compresses defensively, stretches offensively). Your slot is a ball-relative coordinate, not a fixed one. This unit-shift is what separates "11 players on marks" from "a team moving together" — and is the part most worth tuning by watching AI-vs-AI matches.
3. **Role job (highest weight)** — your primary directive, able to _override_ the slot (a defender stepping out to intercept, a striker dropping deep).

Crucially, **role weight is itself role-dependent**: a disciplined holding midfielder or last-line center-back uses its supremacy to _enforce_ shape (weighting formation/hold higher, resisting the ball pull); a pressing forward or attacking winger uses its supremacy to _break_ shape (weighting ball-relation and freelancing higher). Same mechanism, opposite expression.

Formations are **data, not code** (fitting the config-first architecture) — a set of slots, each with a home zone, role job, and ball-shift behavior. This doubles as a **player-facing tactical layer**: choosing a formation (high line vs deep block, narrow vs wide) changes how your own team auto-positions when you're not micromanaging.

Open implementation question: weighted-sum blend (smoother, can produce mushy compromise squares) vs priority cascade (sharper, can look twitchy). Leaning weighted-sum with role-tuned weights, but worth prototyping both on the real board since it reads differently in motion than on paper. The key tuning knob throughout is the balance between holding shape and responding to the immediate situation — too much discipline ignores obvious interceptions, too little dissolves the shape.

Difficulty falls out of the same system: weaker AI = wider random band, worse weights, occasional semi-random movement; stronger AI = tighter band, better weights, possibly shallow lookahead. One system, degraded or sharpened, rather than multiple AIs.

### Simulated matches (AI vs AI)

AI-only league and cup matches resolve instantly through a lightweight model based on squad quality. The full turn engine runs for matches the manager chooses to play.

## Technical Stack

- **Browser game**, pure DOM/CSS — no Canvas or WebGL needed. It's a board state that updates, not a self-playing animation; chess-like, notation/log-driven rather than animation-heavy.
- **TypeScript**, non-negotiable — the game is essentially a typed database (Player, Squad, League, Match, Season) with a turn engine on top.
- **Nørd** for the reactive UI layer (`@grainular/nord`); the match view is a reactive grid component driven by match state.
- **CSS grid** pitch, CSS `transform`/`transition` for the camera, positioned DOM tokens, CSS-class-triggered sprite-sequence animations.
- **LocalStorage** (or IndexedDB if a season's data grows large) for persistence.
- Two state modes: **match state** (fast, transactional, rollback-friendly) and **meta state** (persistent, season-long).
- Complexity lives in the data model and turn engine, not rendering — the correct ratio.

## Build Sequencing

1. **Procedural world backend first** — generate players, clubs, leagues. Everything else is presentation on top. Fully config-driven so counts, ranges, and distributions are trivially customizable/moddable.
2. **Data model** — Player, Squad, League, Match, Season as typed entities; the spine both the match engine and meta layer hang off.
3. **Match engine** — the turn loop, movement, targeting, reactions. Buildable and fun as a standalone hotseat tactical game with no meta layer.
4. **AI** — start by hand-authoring one role's positional ideal on the real board, expand to other roles, then add the formation/team-intention layer. Heuristics are where the time goes, not the pipeline.
5. **Meta layer** — season loop, transfers, economy, aging — only if the core earns it.

**Scope discipline:** the honest risk is the long content/systems tail of a full management loop, which historically stalls projects at the content phase. Ship the match game first (two squads, no meta) to validate that the positioning-under-pressure loop is as fun to play as it is to design — the one thing unknowable until hands are on it. Build the manager layer only if the core proves out. The board-game framing gives permission to build the small complete thing first, and keeps the work in the systems/architecture zone rather than the content-grind zone.

## Naming

**Tackle Tactics.** Evokes the tactics-game family (Advance Wars, FF Tactics), signaling turn-based strategic depth up front, with the soccer skin as the twist on a known genre. Clear genre positioning and strong discoverability.
