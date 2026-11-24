import { combined, derived, grain } from '@grainular/grains';
import { $each, $if, $render, attr, createDirective, html, mounted, on } from '@grainular/nord';
import { isLightKit, kitColor } from './kits';
import { Playbook } from './Playbook';
import { atmosphere, pitchSurface, stadiumProps } from './StadiumView';
import { generateStadium } from '../world/stadium';
import { MatchReport } from './Report';
import { audio } from './audio';
import { CONTROL_MODES, prefs, setPref } from './prefs';
import { stageSize } from './stage';
import {
    abilitiesOf,
    abilityDef,
    allAbilities,
    classLabel,
    classLevel,
    cooldownLeft,
    passivesOf,
    type AbilityId,
} from '../engine/abilities';
import { attackGoalX, cheb, dist, disc, fromKey, goalRows, inPitch, isGoalCell, key } from '../engine/grid';
import type { KickAbility, MoveAbility } from '../engine/match';
import { movePoints } from '../engine/rules';
import type { Cell, Piece, TeamSide } from '../types';
import { KICK_MODES, MOVE_MODES, TARGET_MODES, type MatchController } from './controller';
import { prewarmPlayer, resolveAnim, spriteStyle } from './sprites';
import { recolorVersion } from './recolor';

type OverlayKind = 'move' | 'path' | 'danger' | 'scatter' | 'target' | 'active' | 'tackle' | 'pick' | 'run' | 'zone';
type Overlay = { k: string; x: number; y: number; kind: OverlayKind };

export { isLightKit, kitColor };

const statBar = (label: string, v: number) =>
    html`<div class="stat"><span>${label}</span><i style="--v:${v}%"></i><b>${String(v)}</b></div>`;

export const MatchView = (ctl: MatchController, onExit: () => void, onSettings?: () => void, continueLabel?: string) => {
    const m = ctl.match;
    const cfg = ctl.cfg;
    const { cols, rows, margin } = cfg.pitch;
    const C = cfg.camera.cellPx;
    const W = (cols + margin * 2) * C;
    const H = (rows + margin * 2) * C;
    const px = (x: number) => (x + margin) * C; // cell → world px (top-left)
    const cx = (x: number) => px(x) + C / 2;
    const [gTop, gBottom] = goalRows(cfg);

    const viewport = stageSize;
    const stadium = ctl.opts.stadium ?? generateStadium(`quick-${ctl.opts.seed}`, m.state.clubs[0].name.split(' ')[0]!);
    const conditions = ctl.opts.conditions ?? { time: 'day' as const, weather: 'clear' as const };
    const showPlaybook = grain(false);
    const showBench = grain(false);
    const benchPick = grain<{ off: string | null; on: string | null; msg: string | null }>({ off: null, on: null, msg: null });

    // ------------------------------------------------------------ cached reach per tick
    let reachCache: { tick: number; id: string; ability?: string; map: ReturnType<typeof m.reachable> } | null = null;
    const reachFor = (p: Piece, ability?: MoveAbility) => {
        const t = ctl.tick();
        if (!reachCache || reachCache.tick !== t || reachCache.id !== p.id || reachCache.ability !== ability)
            reachCache = { tick: t, id: p.id, ability, map: m.reachable(p, ability) };
        return reachCache.map;
    };
    const shownMode = () => ctl.mode() ?? ctl.preview();
    const moveMode = (): MoveAbility | undefined => {
        const md = shownMode();
        return md && MOVE_MODES.includes(md) ? (md as MoveAbility) : undefined;
    };
    const kickMode = (): KickAbility | undefined => {
        const md = shownMode();
        return md && KICK_MODES.includes(md) ? (md as KickAbility) : undefined;
    };

    // ------------------------------------------------------------ overlays
    const overlays = derived(
        combined([ctl.tick, ctl.hover, ctl.flightZone, ctl.awaitingHuman, ctl.mode, ctl.preview, ctl.setupSel]),
        ([, hover, flight, awaiting, selected, preview]) => {
            const mode = selected ?? preview;
            const out = new Map<string, Overlay>();
            const put = (c: Cell, kind: OverlayKind) => out.set(`${c.x},${c.y}`, { k: `${kind}:${c.x},${c.y}`, x: c.x, y: c.y, kind });
            const showable = (c: Cell) => inPitch(cfg, c) || isGoalCell(cfg, c);
            if (m.state.over) return [];
            const sp = m.state.setPiece;
            if (sp?.stage === 'setup') {
                // placing: the legal zone, who can move, where the picked player would go
                if (awaiting && ctl.isHuman(sp.next)) {
                    for (const c of m.placeZone(sp.next)) if (!m.pieceAt(c)) put(c, 'move');
                    for (const q of m.state.pieces) if (m.canPlacePiece(q)) put(q.pos, 'pick');
                    const sel = ctl.setupSel();
                    if (sel) put(m.piece(sel).pos, 'active');
                    if (sel && hover && m.canPlace(sel, hover)) put(hover, 'target');
                }
                return [...out.values()];
            }
            const p = m.active();
            const carrier = m.carrier();
            const isCarrier = carrier?.id === p.id;

            if (awaiting && m.state.phase === 'move') {
                const ability = moveMode();
                const reach = reachFor(p, ability);
                const danger = isCarrier ? m.dangerCells(p.team) : new Set<string>();
                for (const k of reach.keys()) put(fromKey(k), danger.has(k) ? 'danger' : 'move');
                if (hover) {
                    const r = reach.get(key(hover));
                    if (r) for (const c of r.path.slice(1)) put(c, danger.has(key(c)) ? 'danger' : 'path');
                }
            }
            if (awaiting && m.state.phase === 'act') {
                if (isCarrier) {
                    const ability = kickMode();
                    const taking = sp?.stage === 'take' && sp.taker === p.id;
                    if (taking && hover && !ability && m.kickKind(p, hover) === 'pass' && m.inOwnBox((1 - p.team) as TeamSide, hover)) {
                        for (const c of disc(hover, cfg.abilities.cross.headRadius)) if (inPitch(cfg, c)) put(c, 'run');
                    }
                    if (ability === 'cross' || (taking && !ability)) {
                        // the box is the cross's target zone
                        for (let y = 0; y < rows; y++)
                            for (let x = 0; x < cols; x++) if (m.inOwnBox((1 - p.team) as TeamSide, { x, y })) put({ x, y }, 'zone');
                    }
                    const aim =
                        hover ??
                        (ability && ['placed', 'power', 'chip'].includes(ability)
                            ? { x: p.team === 0 ? cols : -1, y: Math.floor((rows - 1) / 2) }
                            : null);
                    if (aim && hover === null && ability) {
                        const r = m.kickRadius(p, aim, ability);
                        for (const c of disc(aim, r)) if (showable(c)) put(c, 'scatter');
                    }
                    if (hover && m.kickKind(p, hover, ability)) {
                        const r = m.kickRadius(p, hover, ability);
                        for (const c of disc(hover, r)) if (showable(c)) put(c, 'scatter');
                        if (ability === 'through')
                            for (const c of disc(hover, cfg.abilities.through.runRadius))
                                if (inPitch(cfg, c) && !out.has(key(c))) put(c, 'run');
                        if (ability === 'cross')
                            for (const c of disc(hover, cfg.abilities.cross.headRadius))
                                if (inPitch(cfg, c) && out.get(key(c))?.kind !== 'scatter') put(c, 'run');
                        put(hover, 'target');
                    }
                }
                if (mode === 'mark') for (const o of m.markTargets(p)) put(o.pos, 'pick');
                if (mode === 'tempo') for (const q of m.tempoTargets(p)) put(q.pos, 'pick');
                if (carrier && carrier.team !== p.team && (m.canTackle(p) || m.abilityUsable(p, 'slide'))) put(carrier.pos, 'tackle');
            }
            if (flight) {
                for (const c of disc(flight.target, flight.radius)) if (showable(c)) put(c, 'scatter');
            }
            if (!ctl.moveMs.has(p.id)) put(p.pos, 'active'); // don't run ahead of the walking sprite
            return [...out.values()];
        },
    );

    /**
     * Zones of control, from the active player's point of view: opponents' adjacent cells stop
     * off-ball runs (and threaten a tackle/intercept if their reaction is ready); your own team's
     * cover shows where *their* runs will stop.
     */
    const zoc = derived(combined([ctl.tick, ctl.awaitingHuman, prefs]), ([, awaiting, pr]) => {
        if (!pr.showZoc || !awaiting || m.state.over)
            return [] as Array<{ k: string; x: number; y: number; kind: 'opp' | 'spent' | 'own' }>;
        const me = m.active();
        const out = new Map<string, { k: string; x: number; y: number; kind: 'opp' | 'spent' | 'own' }>();
        const rank = { own: 0, spent: 1, opp: 2 } as const;
        const put = (x: number, y: number, kind: 'opp' | 'spent' | 'own') => {
            if (!inPitch(cfg, { x, y })) return;
            const k = `${x},${y}`;
            const cur = out.get(k);
            if (!cur || rank[kind] > rank[cur.kind]) out.set(k, { k: `${kind}:${k}`, x, y, kind });
        };
        for (const q of m.state.pieces) {
            const theirs = q.team !== me.team;
            const r = theirs && q.status.markOn === me.id ? 2 : 1;
            const kind = theirs ? (m.canReact(q) ? 'opp' : 'spent') : 'own';
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx || dy) put(q.pos.x + dx, q.pos.y + dy, kind);
        }
        return [...out.values()];
    });

    // danger outline when targeting: which opponents can still react
    const reactors = derived(ctl.tick, () => {
        if (m.state.over) return [] as Piece[];
        const p = m.active();
        return m.opponents(p.team).filter((o) => m.canReact(o));
    });

    // ------------------------------------------------------------ camera
    const zoomBias = grain(1);
    /** How much the camera leans in: crowded balls get a closer look (Settings → auto zoom). */
    const autoZoom = (): { zoom: number; focus: Cell | null } => {
        if (!prefs().autoZoom || m.state.over) return { zoom: 1, focus: null };
        const b = m.ballCell();
        const crowd = m.state.pieces.filter((q) => cheb(q.pos, b) <= 3).length;
        const a = m.active();
        if (crowd < 4 || cheb(a.pos, b) > 8) return { zoom: 1, focus: null };
        return { zoom: 1 + 0.13 * Math.min(crowd - 3, 4), focus: { x: (a.pos.x + b.x) / 2, y: (a.pos.y + b.y) / 2 } };
    };
    const camera = derived(combined([ctl.tick, viewport, zoomBias, prefs]), ([, vp, bias]) => {
        const p = m.state.over ? undefined : m.active();
        const az = autoZoom();
        // during a kick the camera rides with the ball, on the ball's own timing and easing
        const riding = ctl.followBall && !prefs().reduceMotion;
        const sp = m.state.setPiece;
        // set pieces: frame the ball and the box together
        const spFocus = sp
            ? {
                  x: (sp.spot.x + (attackGoalX(cfg, sp.team) < 0 ? cfg.pitch.boxDepth / 2 : cols - 1 - cfg.pitch.boxDepth / 2)) / 2,
                  y: (sp.spot.y + (rows - 1) / 2) / 2,
              }
            : null;
        const f = riding ? (ctl.ballAt ?? m.ballCell()) : (spFocus ?? az.focus ?? p?.pos);
        const ride = riding
            ? `transition:transform ${Math.max(ctl.ballMs, 260)}ms cubic-bezier(.3,.6,.4,1), transform-origin ${Math.max(ctl.ballMs, 260)}ms cubic-bezier(.3,.6,.4,1)`
            : '';
        const fx = f ? (f.x + margin) * C + C / 2 : W / 2;
        const fy = f ? (f.y + margin) * C + C / 2 : H / 2;
        const k = cfg.camera;
        return [
            `transform-origin:${fx}px ${fy}px`,
            `transform:translate3d(${vp.w / 2 - fx}px, ${vp.h * (k.tiltDeg ? 0.52 : 0.5) - fy}px, 0) rotateX(${k.tiltDeg}deg) scale(${k.scale * az.zoom * bias})`,
            `--tilt:${k.tiltDeg}deg`,
            `width:${W}px`,
            `height:${H}px`,
            ride,
        ]
            .filter(Boolean)
            .join(';');
    });
    // flat 2D needs no perspective (it would only nudge the raised layers out of register)
    const viewportStyle = cfg.camera.tiltDeg
        ? `perspective:${cfg.camera.perspectivePx}px;perspective-origin:${cfg.camera.originX} ${cfg.camera.originY}`
        : '';

    // ------------------------------------------------------------ static pitch
    /**
     * Goals as upright sprites, billboarded like the players (same art pack). The art's posts span
     * ~193px from the far post (y≈35) to the near post (y≈228); it is scaled so that span matches
     * the goal mouth as the tilted camera sees it, and anchored on the near post.
     */
    const goalSprite = (side: 'left' | 'right') => {
        const mouth = cfg.pitch.goalWidth * C * Math.cos((cfg.camera.tiltDeg * Math.PI) / 180);
        const base = mouth / 193;
        // wider than tall: more visible net, no tall-cage look
        const sx = base * cfg.sprites.goalScaleX;
        const sy = base * cfg.sprites.goalScaleY;
        const postX = side === 'left' ? 95 : 33;
        const anchorX = side === 'left' ? px(0) : px(0) + cols * C;
        // The sprite's base sits on the ground (nothing below the grass), on a point chosen so the
        // middle of the posts lines up with the middle of the mouth as the tilted camera sees it.
        const cosT = Math.cos((cfg.camera.tiltDeg * Math.PI) / 180);
        const midY = (35 + 228) / 2;
        const anchorY = px(gTop) + (cfg.pitch.goalWidth * C) / 2 + ((256 - midY) * sy) / cosT;
        const w = 128 * sx;
        const h = 256 * sy;
        const box = `left:${-postX * sx}px;top:${-h}px;width:${w}px;height:${h}px`;
        const art = derived(ctl.net, (n) =>
            n === side
                ? `${box};background-image:url(assets/fx/goal_${side}_net_billow.png);background-size:${24 * w}px ${h}px;--strip:${24 * w}px;animation:strip 1.2s steps(24) 1 forwards`
                : `${box};background-image:url(assets/props/goal_${side}.png);background-size:${w}px ${h}px;animation:none`,
        );
        return html`<div class="goal-sprite" style="left:${String(anchorX)}px;top:${String(anchorY)}px;z-index:${String(Math.round(anchorY))}"><div class="stand"><div class="goal-art" ${attr({ style: art })}></div></div></div>`;
    };

    const pitchSvg = () => {
        const L = px(0);
        const T = px(0);
        const PW = cols * C;
        const PH = rows * C;
        const midY = T + PH / 2;
        const box = (left: boolean, depth: number, width: number) => {
            const h = width * C;
            const x = left ? L : L + PW - depth * C;
            return `<rect x="${x}" y="${midY - h / 2}" width="${depth * C}" height="${h}" />`;
        };
        const spot = (x: number) => `<circle cx="${x}" cy="${midY}" r="2.5" class="fill" />`;
        const arc = (left: boolean) => {
            const sx = left ? L + cfg.pitch.penaltySpot * C : L + PW - cfg.pitch.penaltySpot * C;
            const edge = left ? L + cfg.pitch.boxDepth * C : L + PW - cfg.pitch.boxDepth * C;
            const r = cfg.pitch.circleRadius * C;
            const dy = Math.sqrt(Math.max(0, r * r - (edge - sx) ** 2));
            return `<path d="M ${edge} ${midY - dy} A ${r} ${r} 0 0 ${left ? 1 : 0} ${edge} ${midY + dy}" />`;
        };
        const stripes = pitchSurface(stadium, { L, T, PW, PH, C, W, H, S: 1, tilt: 0 });
        return `${stripes}
        <svg class="lines" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <rect x="${L}" y="${T}" width="${PW}" height="${PH}" />
          <line x1="${L + PW / 2}" y1="${T}" x2="${L + PW / 2}" y2="${T + PH}" />
          <circle cx="${L + PW / 2}" cy="${midY}" r="${cfg.pitch.circleRadius * C}" />
          ${spot(L + PW / 2)}
          ${box(true, cfg.pitch.boxDepth, cfg.pitch.boxWidth)}${box(false, cfg.pitch.boxDepth, cfg.pitch.boxWidth)}
          ${box(true, cfg.pitch.sixDepth, cfg.pitch.sixWidth)}${box(false, cfg.pitch.sixDepth, cfg.pitch.sixWidth)}
          ${spot(L + cfg.pitch.penaltySpot * C)}${spot(L + PW - cfg.pitch.penaltySpot * C)}
          ${arc(true)}${arc(false)}
        </svg>`;
    };

    const pitchLayer = createDirective<HTMLDivElement>((node) => {
        node.innerHTML = pitchSvg();
    });

    // Grid: the source of truth for positions & clicks. Built once, imperatively (1.5k cells).
    const gridLayer = createDirective<HTMLDivElement>((node) => {
        const frag = document.createDocumentFragment();
        for (let y = 0; y < rows; y++)
            for (let x = -1; x <= cols; x++) {
                if ((x === -1 || x === cols) && (y < gTop || y > gBottom)) continue;
                const d = document.createElement('div');
                d.className = x === -1 || x === cols ? 'cell goalcell' : 'cell';
                d.dataset.x = String(x);
                d.dataset.y = String(y);
                d.style.left = `${px(x)}px`;
                d.style.top = `${px(y)}px`;
                frag.appendChild(d);
            }
        node.appendChild(frag);
        const cellOf = (e: Event): Cell | null => {
            const t = e.target as HTMLElement;
            if (!t.dataset || t.dataset.x === undefined) return null;
            return { x: Number(t.dataset.x), y: Number(t.dataset.y) };
        };
        const over = (e: Event) => {
            const c = cellOf(e);
            const h = ctl.hover();
            if (c && (!h || h.x !== c.x || h.y !== c.y)) ctl.hover.set(c);
        };
        const click = (e: Event) => {
            const c = cellOf(e);
            if (c) ctl.clickCell(c);
        };
        const leave = () => ctl.hover.set(null);
        node.addEventListener('mouseover', over);
        node.addEventListener('click', click);
        node.addEventListener('mouseleave', leave);
        return () => {
            node.removeEventListener('mouseover', over);
            node.removeEventListener('click', click);
            node.removeEventListener('mouseleave', leave);
        };
    });

    // ------------------------------------------------------------ tokens
    const restingAnim = (p: Piece) => {
        const holding = m.carrier()?.id === p.id;
        if (p.player.cls === 'keeper') return holding ? 'gk_hold' : 'gk_ready';
        if (p.staggered || p.stamina < cfg.fatigue.exhausted) return 'tired';
        return 'idle';
    };
    const currentAnim = (p: Piece) => {
        const o = ctl.anim.get(p.id);
        const name = o && o.until > performance.now() ? o.name : restingAnim(p);
        return resolveAnim(p, name);
    };

    const Token = (p: Piece) => {
        const R = cfg.sprites.renderPx;
        const feet = (cfg.sprites.feetY / cfg.sprites.framePx) * R;
        const wrap = derived(ctl.tick, () => {
            const ms = ctl.moveMs.get(p.id) ?? 0;
            return `left:${cx(p.pos.x)}px;top:${px(p.pos.y) + C / 2}px;z-index:${Math.round(px(p.pos.y) + C / 2) + 1};transition:left ${ms}ms linear, top ${ms}ms linear`;
        });
        const cls = derived(ctl.tick, () => {
            const active = !m.state.over && m.active().id === p.id;
            const carrier = m.carrier();
            const holds = carrier?.id === p.id;
            const crowd = !!carrier && !holds && cheb(p.pos, carrier.pos) <= 2;
            return `token team${p.team}${active ? ' active' : ''}${p.staggered ? ' staggered' : ''}${!p.reactionReady ? ' spent' : ''}${holds ? ' carrier' : ''}${crowd ? ' crowd' : ''}`;
        });
        const sprite = derived(
            ctl.tick,
            () =>
                `${spriteStyle(cfg, p.player.sprite, currentAnim(p), p.facing, p.player)};width:${R}px;height:${R}px;left:${-R / 2}px;top:${-feet}px`,
        );
        const kit = kitColor(m.state.clubs[p.team].kit);
        const tokenStam = derived(ctl.tick, () =>
            p.stamina < cfg.fatigue.tired
                ? html`<div class="tok-stam ${p.stamina < cfg.fatigue.exhausted ? 'low' : ''}"><i style="width:${String(Math.round(p.stamina * 2))}%"></i></div>`
                : html``,
        );
        const badges = derived(ctl.tick, () => {
            const s = p.status;
            const b: string[] = [];
            if (p.yellows) b.push('▮');
            if (s.commanded) b.push('⚑');
            if (s.markOn) b.push('⌖');
            if (s.pressured) b.push('⊳');
            if (s.fouled) b.push('✋');
            if (s.grounded || s.groundedNext) b.push('↓');
            return b.join('');
        });
        return html`<div ${attr({ class: cls, style: wrap })}>
            <div class="ground" style="--kit:${kit}"></div>
            <div class="stand">
                <div class="sprite" ${attr({ style: sprite })}></div>
                <div class="tag" style="--kit:${kit}">${String(p.player.number)}<span class="badges">${badges}</span></div>
                <div class="carrier-mark"><i></i></div>
                ${$render(tokenStam)}
            </div>
        </div>`;
    };

    const ballStyle = derived(ctl.tick, () => {
        const b = m.state.ball;
        let x: number;
        let y: number;
        if (b.kind === 'held') {
            const h = m.piece(b.by);
            const off = h.facing === 'right' ? 0.38 : h.facing === 'left' ? -0.38 : 0;
            const offY = h.facing === 'down' ? 0.3 : h.facing === 'up' ? -0.2 : 0.12;
            x = cx(h.pos.x) + off * C;
            y = px(h.pos.y) + C / 2 + offY * C;
        } else {
            x = cx(b.at.x);
            y = px(b.at.y) + C / 2;
        }
        if (ctl.ballAt) {
            x = cx(ctl.ballAt.x);
            y = px(ctl.ballAt.y) + C / 2;
        }
        const ms = ctl.ballMs;
        return `left:${x}px;top:${y}px;z-index:${Math.round(y) + 2};transition:left ${ms}ms cubic-bezier(.3,.6,.4,1), top ${ms}ms cubic-bezier(.3,.6,.4,1)`;
    });

    // ------------------------------------------------------------ HUD pieces
    const club = (t: TeamSide) => m.state.clubs[t];
    const scoreText = (t: TeamSide) => derived(ctl.tick, () => String(m.state.score[t]));
    const roundText = derived(ctl.tick, () => {
        const half = m.state.round <= Math.floor(cfg.match.rounds / 2) ? '1st half' : '2nd half';
        return `Round ${m.state.round} / ${cfg.match.rounds} · ${half}`;
    });
    const noTimer = cfg.match.timerSeconds <= 0;
    const timerStyle = derived(
        combined([ctl.timer, ctl.awaitingHuman]),
        ([t, a]) => `transform:scaleX(${a ? t : 0});${t < 0.3 ? 'background:var(--danger)' : ''}`,
    );

    /** Every ability of the player's classes, locked ones greyed with their unlock level. */
    const kitList = (p: Piece) => {
        const classes = Object.keys(p.player.levels);
        const ids = allAbilities(cfg).filter((id) => classes.includes(abilityDef(cfg, id).cls));
        const owned = abilitiesOf(cfg, p.player);
        const passives = passivesOf(cfg, p.player);
        return html`<div class="kitlist">
            ${ids.map((id) => {
                const a = abilityDef(cfg, id);
                const have = owned.includes(id);
                const cd = cooldownLeft(p, id, m.state.round);
                const tip = `${a.label}: ${a.desc}${have ? '' : ` (unlocks at ${cfg.classes[a.cls].short} ${a.unlock}; has ${classLevel(p.player, a.cls)})`}`;
                return html`<span class="chip ${have ? '' : 'locked'}" data-tip="${tip}">${a.icon} ${a.label}${have ? (cd ? html` <b>${String(cd)}</b>` : html``) : html` <i>${cfg.classes[a.cls].short}${String(a.unlock)}</i>`}</span>`;
            })}
            ${passives.map((id) => html`<span class="chip passive" data-tip="${cfg.passives[id].label} (passive): ${cfg.passives[id].desc}">◆ ${cfg.passives[id].label}</span>`)}
        </div>`;
    };

    const activeCard = derived(ctl.tick, () => {
        if (m.state.over) return html`<div class="card"></div>`;
        const p = m.active();
        const s = p.player.stats;
        const kit = kitColor(club(p.team).kit);
        const human = ctl.isHuman(p.team);
        return html`<div class="card" style="--kit:${kit}">
            <div class="card-head">
                <div class="portrait"><div class="sprite still" style="${spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player)}"></div></div>
                <div>
                    <div class="pname">#${String(p.player.number)} ${p.player.name}</div>
                    <div class="pmeta">${classLabel(cfg, p.player)} · ${club(p.team).short} · ${human ? 'You' : 'AI'}</div>
                    <div class="pmeta">Move ${String(movePoints(cfg, p))} · Reaction ${p.reactionReady ? 'ready' : 'spent'}</div>
                    <div class="pmeta stam">Stamina ${staminaBar(p.stamina)} ${String(Math.round(p.stamina))}</div>
                </div>
            </div>
            ${human ? html`` : kitList(p)}
            <div class="stats">
                ${statBar('SPD', s.speed)}${statBar('PAC', s.pace)}${statBar('PAS', s.passing)}${statBar('SHO', s.shooting)}
                ${statBar('DRI', s.dribbling)}${statBar('TAC', s.tackling)}${statBar('REF', s.reflexes)}${statBar('COM', s.composure)}
            </div>
        </div>`;
    });

    const hint = derived(
        combined([ctl.tick, ctl.awaitingHuman, ctl.hover, ctl.mode, ctl.tip, ctl.setupSel]),
        ([, awaiting, hover, mode]) => {
            if (m.state.over) return 'Full time.';
            const sp = m.state.setPiece;
            if (sp?.stage === 'setup') {
                const what = sp.kind === 'corner' ? 'Corner' : 'Free kick';
                if (!awaiting)
                    return `${what}: ${club(sp.next).short} ${sp.next === sp.team ? 'push players forward' : 'organise the defence'}…`;
                const left = sp.left[sp.next];
                const role =
                    sp.next === sp.team
                        ? 'Lose your markers: put runners in space near goal.'
                        : 'Mark their runners goal-side: cover the dangerous ones.';
                return `${what} setup (${left} move${left === 1 ? '' : 's'} left). ${role} Click a highlighted player, then a cell. Space when you're happy.`;
            }
            const p = m.active();
            if (m.state.bonusTurn === p.id && awaiting && !mode) {
                return m.state.phase === 'move'
                    ? 'Extra turn for winning the ball: carry it clear of the scrum (or Space to stay).'
                    : 'Extra turn: pass it on, or Space to keep it. Shooting waits for your normal turn.';
            }
            if (sp?.stage === 'take' && sp.taker === p.id && awaiting) {
                return sp.kind === 'corner'
                    ? 'Corner: aim into the box — teammates within 2 of the drop attack a header. Or play it short.'
                    : 'Free kick: shoot over the wall, whip it into the box, or play it short. Nobody can tackle you.';
            }
            if (ctl.tip()) return 'Coach Marlow has a word. Enter to carry on — the clock is paused.';
            if (!awaiting)
                return ctl.isHuman(p.team)
                    ? ctl.needsOrders(p)
                        ? 'Resolving…'
                        : `${p.player.name} keeps formation on their own (Focus: F)`
                    : `${club(p.team).short} is thinking…`;
            const isCarrier = m.carrier()?.id === p.id;
            // the armed bar says what to click; the hint just restates the plan in words
            if (mode) return abilityDef(cfg, mode).short;
            if (m.state.phase === 'move') {
                if (p.status.fouled) return 'You were fouled: free kick. Stay put (Space), then pass or shoot.';
                return isCarrier
                    ? 'Dribble: click a cell (pink = a defender can react). Click yourself or Space to stay and pass/shoot.'
                    : 'Move: click a blue cell. Click yourself or Space to hold position.';
            }
            if (isCarrier) {
                if (hover) {
                    const kind = m.kickKind(p, hover);
                    if (kind === 'shot')
                        return `Shoot — the orange zone is where it may go. ${dist(p.pos, hover) > 18 ? 'Speculative from here.' : ''}`;
                    if (kind === 'pass')
                        return `Pass ${dist(p.pos, hover) > cfg.ball.loftThreshold ? '(lofted: only contestable at take-off and landing)' : '(driven: contestable along the whole lane)'}`;
                }
                return 'Aim a pass at any cell, or the goal mouth to shoot. Space keeps the ball.';
            }
            const c = m.carrier();
            if (c && c.team !== p.team && cheb(c.pos, p.pos) <= 2)
                return 'Click the carrier to tackle, or use an ability. Space ends your turn.';
            return 'Use an ability, or Space to end your turn.';
        },
    );

    type Lane = 'before' | 'after';
    const laneOf = (id: AbilityId): Lane => (abilityDef(cfg, id).phase === 'act' ? 'after' : 'before');
    /** What arming the ability asks of you next. */
    const kindOf = (id: AbilityId) =>
        MOVE_MODES.includes(id) ? 'Pick a cell' : KICK_MODES.includes(id) ? 'Aim a kick' : TARGET_MODES.includes(id) ? 'Pick a player' : 'Instant';
    const infoFor = grain<AbilityId | null>(null);
    ctl.awaitingHuman.subscribe(() => infoFor.set(null));
    /** While an ability is armed: what to click, and a way out. */
    const armedBar = derived(combined([ctl.mode, ctl.awaitingHuman]), ([mode, awaiting]) => {
        if (!mode || !awaiting) return html``;
        const a = abilityDef(cfg, mode);
        const what = MOVE_MODES.includes(mode) ? 'Click a highlighted cell' : KICK_MODES.includes(mode) ? 'Aim with the mouse, click to kick' : 'Click a highlighted player';
        return html`<div class="armed-bar"><span class="ic">${a.icon}</span><b>${a.label}</b><span>${what}</span>
            <button class="ghost" ${on('click', () => { ctl.mode.set(null); ctl.bump(); })}>Cancel <kbd>Esc</kbd></button></div>`;
    });

    const phaseAbilities = (p: Piece) => {
        const phase = m.state.phase;
        return abilitiesOf(cfg, p.player).filter((id) =>
            phase === 'move' ? abilityDef(cfg, id).phase !== 'act' : abilityDef(cfg, id).phase === 'act',
        );
    };

    const phaseStep = derived(combined([ctl.tick, ctl.awaitingHuman]), ([, awaiting]) => {
        if (!awaiting || m.state.over || m.state.setPiece?.stage === 'setup') return html``;
        const ph = m.state.phase;
        return html`<div class="steps"><span class="${ph === 'move' ? 'on' : 'done'}">1 · Move</span><i></i><span class="${ph === 'act' ? 'on' : ''}">2 · Act</span></div>`;
    });

    const actions = derived(combined([ctl.tick, ctl.awaitingHuman, ctl.mode]), ([, awaiting, mode]) => {
        if (!awaiting || m.state.over) return html`<div class="dock-row"></div>`;
        const sp = m.state.setPiece;
        if (sp?.stage === 'setup') {
            const left = sp.left[sp.next];
            return html`<div class="dock-row setup-dock">
                <div class="setup-info"><b>${sp.kind === 'corner' ? 'Corner' : 'Free kick'} · ${sp.next === sp.team ? 'Attacking' : 'Defending'}</b><span>${String(left)} placement${left === 1 ? '' : 's'} left · then the other side answers</span></div>
                <div class="core"><button class="primary" ${on('click', () => ctl.pass())}>Done placing <kbd>Space</kbd></button></div>
            </div>`;
        }
        const p = m.active();
        const phase = m.state.phase;
        const isCarrier = m.carrier()?.id === p.id;
        const nowLane: Lane = phase === 'move' ? 'before' : 'after';
        const keyed = phaseAbilities(p); // number keys follow the current step's cards
        const owned = abilitiesOf(cfg, p.player);
        const card = (id: AbilityId) => {
            const a = abilityDef(cfg, id);
            const reason = m.blockReason(p, id);
            const cd = cooldownLeft(p, id, m.state.round);
            const inLane = laneOf(id) === nowLane;
            const armed = mode === id;
            const k = keyed.indexOf(id) + 1;
            const st = armed ? 'armed' : !inLane ? 'later' : cd > 0 ? 'wait' : reason ? 'blocked' : 'ready';
            const label =
                st === 'armed' ? 'Armed' : st === 'later' ? (nowLane === 'before' ? 'After you move' : 'Before moving only') : st === 'wait' ? `Recharging · ${cd}` : st === 'blocked' ? reason : 'Ready';
            const enter = on('mouseenter', () => {
                infoFor.set(id);
                if (st === 'ready') ctl.preview.set(id);
            });
            const leave = on('mouseleave', () => {
                infoFor.set(null);
                ctl.preview.set(null);
            });
            return html`<button class="acard ${st}" ${enter} ${leave} ${on('click', () => ctl.useAbility(id))}>
                <span class="ic">${a.icon}</span>
                <span class="txt"><b>${a.label}</b><span>${kindOf(id)}</span></span>
                <span class="state">${label}${st === 'ready' && k ? html`<kbd>${String(k)}</kbd>` : html``}</span>
                ${st === 'wait' ? html`<span class="cd"><i style="width:${String(100 - (cd / Math.max(1, a.cooldown)) * 100)}%"></i></span>` : html``}
            </button>`;
        };
        const lane = (which: Lane) => {
            const ids = owned.filter((id) => laneOf(id) === which);
            if (!ids.length) return html``;
            return html`<div class="lane ${which === nowLane ? 'now' : 'later'}">
                <span class="lane-label">${which === 'before' ? 'Before moving' : 'After moving'}</span>
                <div class="lane-cards">${ids.map(card)}</div>
            </div>`;
        };
        const passives = passivesOf(cfg, p.player);
        return html`<div class="dock-row">
            <div class="cards">
                ${owned.length ? html`${lane('before')}${lane('after')}` : html`<span class="no-abilities">No abilities yet. They unlock as this player levels up.</span>`}
                ${passives.length ? html`<div class="passives"><span class="lane-label">Always on</span>${passives.map((id) => html`<span class="passive" title="${cfg.passives[id].desc}">◆ ${cfg.passives[id].label}</span>`)}</div>` : html``}
            </div>
            <div class="core">
                ${phase === 'move' ? html`<button ${on('click', () => ctl.pass())}>${isCarrier ? 'Stay & kick' : 'Hold'} <kbd>Space</kbd></button>` : html``}
                ${phase === 'act' && m.canTackle(p) ? html`<button class="warn" ${on('click', () => ctl.input({ t: 'act', d: { kind: 'tackle' } }))}>Tackle <kbd>T</kbd></button>` : html``}
                ${phase === 'act' ? html`<button ${on('click', () => ctl.pass())}>${isCarrier ? 'Keep ball' : 'End turn'} <kbd>Space</kbd></button>` : html``}
                <button class="ghost" ${on('click', () => ctl.input({ t: 'auto' }))}>Auto <kbd>A</kbd></button>
            </div>
        </div>`;
    });

    /** Explains the hovered or armed ability, above the dock (instead of a tiny tooltip). */
    const abilityInfo = derived(combined([infoFor, ctl.mode, ctl.awaitingHuman, ctl.tick]), ([hovered, armed, awaiting]) => {
        if (!awaiting || m.state.over) return html``;
        const p = m.active();
        // a card can be re-rendered away under the mouse (new turn): only explain this player's abilities
        const owned = abilitiesOf(cfg, p.player);
        const id = hovered && owned.includes(hovered) ? hovered : armed;
        if (!id) return html``;
        const a = abilityDef(cfg, id);
        const reason = m.blockReason(p, id);
        const cd = cooldownLeft(p, id, m.state.round);
        return html`<div class="ab-info">
            <div class="ab-head"><span class="ic">${a.icon}</span><div><b>${a.label}</b><small>${laneOf(id) === 'before' ? 'Before moving' : 'After moving'} · ${kindOf(id)}${a.cooldown ? ` · recharges for ${a.cooldown} round${a.cooldown > 1 ? 's' : ''}` : ''}</small></div></div>
            <p>${a.desc}</p>
            <p class="how"><b>How:</b> ${a.how}</p>
            ${cd > 0 ? html`<p class="why">Recharging: ready in ${String(cd)} round${cd > 1 ? 's' : ''}.</p>` : reason ? html`<p class="why">Not now: ${reason}.</p>` : html``}
        </div>`;
    });

    const queue = derived(ctl.tick, () => {
        // a tackle winner's extra turn sits in front of the normal order
        const ids = m.state.bonusTurn
            ? [m.state.bonusTurn, ...m.state.order.slice(m.state.turnIndex + 1, m.state.turnIndex + 12)]
            : m.state.order.slice(m.state.turnIndex, m.state.turnIndex + 12);
        return html`<div class="queue">${ids.map((id, i) => {
            const p = m.piece(id);
            const auto = ctl.isHuman(p.team) && !ctl.needsOrders(p);
            return html`<div class="qitem ${i === 0 ? 'now' : ''} ${auto ? 'auto' : ''}" style="--kit:${kitColor(club(p.team).kit)}" title="${p.player.name}${auto ? ' (acts on their own — Focus)' : ''}">
                <div class="sprite still" style="${spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player)}"></div>
                <span>${cfg.classes[p.player.cls].short}${String(p.player.number)}</span>
            </div>`;
        })}</div>`;
    });

    const log = derived(
        ctl.commentary,
        (lines) =>
            html`<div class="log"><h5>Commentary <small>B. Quill</small></h5><ul>${lines.slice(0, 8).map((l) => html`<li class="${l.team === null ? '' : `t${l.team}`} ${l.tone}"><b>${String(l.minute)}'</b> ${l.text}</li>`)}</ul></div>`,
    );

    const caption = derived(ctl.caption, (c) =>
        c
            ? html`<div class="caption ${c.team === null ? '' : `t${c.team}`}" style="--kit:${c.team === null ? 'var(--gold)' : kitColor(club(c.team).kit)}">
        <b>${c.title}</b><span>${c.text}</span></div>`
            : html``,
    );

    const shakeClass = derived(ctl.shake, (n) => `viewport ${n ? (n % 2 ? 'shake-a' : 'shake-b') : ''}`);

    const ballImgStyle = derived(ctl.ballArc, (a) => {
        if (!a) return '';
        // spins while travelling (faster for shots); lofted balls also rise and fall
        const turns = Math.max(1, Math.round((a.ms / 1000) * 6 * a.spin));
        const spin = `ball-spin ${Math.round(a.ms / turns)}ms steps(4) ${turns}`;
        return a.height
            ? `--arc-h:${-a.height}px;animation:${a.id % 2 ? 'arc-a' : 'arc-b'} ${a.ms}ms cubic-bezier(.3,.6,.4,1) both, ${spin}`
            : `animation:${spin}`;
    });

    const burst = (b: { id: number; at: { x: number; y: number }; kind: 'confetti' | 'dust'; colors: string[] }) => {
        const n = b.kind === 'confetti' ? 26 : 9;
        const parts = Array.from({ length: n }, (_, i) => {
            const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const r = b.kind === 'confetti' ? 40 + Math.random() * 90 : 10 + Math.random() * 18;
            const dx = Math.cos(ang) * r;
            const dy = -Math.abs(Math.sin(ang)) * r * (b.kind === 'confetti' ? 1.4 : 0.6) - 10;
            return html`<i style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--c:${b.colors[i % b.colors.length]!};animation-delay:${String(Math.round(Math.random() * 120))}ms"></i>`;
        });
        return html`<div class="burst ${b.kind}" style="left:${cx(b.at.x)}px;top:${px(b.at.y) + C / 2}px"><div class="stand">${parts}</div></div>`;
    };

    const tipPanel = derived(ctl.tip, (t) =>
        t
            ? html`<div class="tip">
        <div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:96px;height:96px;background-size:${String((cfg.animFrames.shout ?? 12) * 96)}px 96px;--strip:${String((cfg.animFrames.shout ?? 12) * 96)}px"></div></div>
        <div class="tip-body"><small>Coach Marlow</small><h3>${t.title}</h3><p>${t.text}</p>
            <div class="tip-actions"><button class="ghost" ${on('click', () => ctl.dismissTip(true))}>No more tips</button><button class="primary" ${on('click', () => ctl.dismissTip())}>Got it <kbd>Enter</kbd></button></div></div>
    </div>`
            : html``,
    );

    const lessonPanel = derived(combined([ctl.lesson, ctl.tutorialDone]), ([l, done]) => {
        const coach = html`<div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:96px;height:96px;background-size:${String((cfg.animFrames.shout ?? 12) * 96)}px 96px;--strip:${String((cfg.animFrames.shout ?? 12) * 96)}px"></div></div>`;
        if (done)
            return html`<div class="tip lesson done">${coach}<div class="tip-body"><small>Training complete</small><h3>You're ready.</h3>
            <p>That's the whole game: make space, move the ball, deny space, beat the clock. A quick match against Easy AI is a good next step, then a career.</p>
            <div class="tip-actions"><button class="primary" ${on('click', onExit)}>Back to menu</button></div></div></div>`;
        if (!l) return html``;
        return html`<div class="tip lesson">${coach}<div class="tip-body"><small>Lesson ${String(l.i + 1)} of ${String(l.n)} · Coach Marlow</small><h3>${l.title}</h3><p>${l.text}</p>
            ${l.retry ? html`<p class="lesson-retry">${l.retry}</p>` : html``}${l.praise ? html`<p class="lesson-praise">✓ ${l.praise}</p>` : html``}
            <div class="tip-actions"><button class="ghost" ${on('click', onExit)}>Leave training</button>${l.info ? html`<button class="primary" ${on('click', () => ctl.nextLesson())}>Continue <kbd>Enter</kbd></button>` : html``}</div></div></div>`;
    });

    const toast = derived(ctl.toast, (t) => (t ? html`<div class="toast">${t}</div>` : html``));
    const focusChip = derived(
        combined([prefs, ctl.tick]),
        ([p]) =>
            html`<button class="ghost focus-chip" title="Which of your players ask for orders" ${on('click', () => ctl.cycleControl())}>Focus: ${CONTROL_MODES.find((c) => c.id === p.controlMode)!.label} <kbd>F</kbd></button>`,
    );

    const muteChip = derived(
        prefs,
        (p) =>
            html`<button class="set-btn" title="Mute (M)" ${on('click', () => setPref('muted', !p.muted))}>${p.muted ? '♪̸' : '♪'}</button>`,
    );
    const report = derived(ctl.report, (r) => (r ? MatchReport(ctl, onExit, continueLabel) : html``));

    const minimap = derived(ctl.tick, () => {
        const s = 4;
        const dots = m.state.pieces
            .map((p) => {
                const active = !m.state.over && m.active().id === p.id;
                return `<circle cx="${p.pos.x * s + s / 2}" cy="${p.pos.y * s + s / 2}" r="${active ? 3.4 : 2.4}" fill="${kitColor(club(p.team).kit)}" stroke="${active ? 'var(--active)' : '#0008'}" stroke-width="${active ? 1.5 : 0.8}" />`;
            })
            .join('');
        const b = m.ballCell();
        const svg = `<svg width="${cols * s}" height="${rows * s}" viewBox="0 0 ${cols * s} ${rows * s}">
            <rect width="100%" height="100%" fill="#2f6b34" />
            <line x1="${(cols * s) / 2}" y1="0" x2="${(cols * s) / 2}" y2="${rows * s}" stroke="#fff6" />
            <rect x="0" y="${gTop * s}" width="2" height="${cfg.pitch.goalWidth * s}" fill="#fff" />
            <rect x="${cols * s - 2}" y="${gTop * s}" width="2" height="${cfg.pitch.goalWidth * s}" fill="#fff" />
            ${dots}<circle cx="${b.x * s + s / 2}" cy="${b.y * s + s / 2}" r="3.2" fill="#fff" stroke="#2f8cff" stroke-width="1.6" />
        </svg>`;
        return html`<div class="minimap" ${createDirective((n) => {
            n.innerHTML = svg;
        })}></div>`;
    });

    const banner = derived(ctl.banner, (b) =>
        b
            ? html`<div class="banner"><div class="banner-text">${b.text}</div>${b.sub ? html`<div class="banner-sub">${b.sub}</div>` : html``}
              </div>`
            : html``,
    );

    // ------------------------------------------------------------ bench & substitutions
    const staminaBar = (v: number) =>
        html`<span class="stam-bar ${v < cfg.fatigue.exhausted ? 'low' : v < cfg.fatigue.tired ? 'mid' : ''}"><i style="width:${String(Math.round(v))}%"></i></span>`;
    const benchPanel = derived(combined([ctl.tick, benchPick, ctl.awaitingHuman]), ([, pick, awaiting]) => {
        // whose bench: the human side (in hotseat, whoever is on the move)
        const team: TeamSide = ctl.isHuman(0) && ctl.isHuman(1) ? m.active().team : ctl.isHuman(1) ? 1 : 0;
        const mine = ctl.isHuman(team);
        const onPitch = m.state.pieces.filter((p) => p.team === team).sort((a, b) => a.stamina - b.stamina);
        const bench = m.bench(team);
        const left = m.subsLeft(team);
        const why = pick.off && pick.on ? m.subBlock(team, pick.off, pick.on) : null;
        const canGo = mine && awaiting && !!pick.off && !!pick.on && !why && !ctl.inSetup();
        const go = () => {
            if (!pick.off || !pick.on) return;
            const err = ctl.substitute(pick.off, pick.on);
            benchPick.set({ off: null, on: null, msg: err });
            if (!err) showBench.set(false);
        };
        return html`<div class="modal-body bench-panel">
            <header><h2>Bench · ${club(team).short}</h2><span class="subs-left">${String(left)} of ${String(cfg.subs.max)} substitutions left</span><button class="ghost" ${on('click', () => showBench.set(false))}>Close <kbd>Esc</kbd></button></header>
            <div class="bench-grid">
                <section><h4>On the pitch <small>tiredest first</small></h4><ul class="bench-list">${onPitch.map(
                    (
                        p,
                    ) => html`<li class="${pick.off === p.id ? 'on' : ''}" ${on('click', () => benchPick.set({ ...pick, off: p.id, msg: null }))}>
                    <div class="sprite still" style="${spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player)}"></div>
                    <b>#${String(p.player.number)} ${p.player.name}</b><span class="cl">${cfg.classes[p.player.cls].short}</span>${staminaBar(p.stamina)}<span class="num">${String(Math.round(p.stamina))}</span></li>`,
                )}</ul></section>
                <section><h4>Bench</h4>${
                    bench.length
                        ? html`<ul class="bench-list">${bench.map(
                              (
                                  p,
                              ) => html`<li class="${pick.on === p.id ? 'on' : ''}" ${on('click', () => benchPick.set({ ...pick, on: p.id, msg: null }))}>
                    <div class="sprite still" style="${spriteStyle(cfg, p.sprite, 'idle', 'down', p)}"></div>
                    <b>#${String(p.number)} ${p.name}</b><span class="cl">${classLabel(cfg, p)}</span><span class="num">Lv ${String(p.level)}</span></li>`,
                          )}</ul>`
                        : html`<p class="muted">Nobody left on the bench.</p>`
                }</section>
            </div>
            <footer class="bench-foot">
                <span class="muted">${pick.msg ?? why ?? (!mine ? 'Watching: the AI manages its own bench.' : !awaiting ? 'Substitutions happen on your turn.' : 'Tired players move less (under 50) and react worse (under 25). Pick one off, one on.')}</span>
                <button class="primary" ${attr({ disabled: !canGo })} ${on('click', go)}>Make the change</button>
            </footer>
        </div>`;
    });

    // ------------------------------------------------------------ keyboard + resize
    const lifecycle = mounted<HTMLDivElement>(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
            if (ctl.tip() && (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape')) {
                e.preventDefault();
                ctl.dismissTip();
                return;
            }
            if (ctl.lesson()?.info && e.key === 'Enter') {
                e.preventDefault();
                ctl.nextLesson();
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                ctl.pass();
            } else if (e.key === 't' || e.key === 'T') ctl.input({ t: 'act', d: { kind: 'tackle' } });
            else if (e.key === 'a' || e.key === 'A') ctl.input({ t: 'auto' });
            else if (e.key === 'Escape') {
                ctl.mode.set(null);
                showPlaybook.set(false);
                showBench.set(false);
            } else if (e.key === 'b' || e.key === 'B') showBench.update((v) => !v);
            else if (e.key === 'h' || e.key === 'H') showPlaybook.update((v) => !v);
            else if (e.key === 'f' || e.key === 'F') ctl.cycleControl();
            else if (e.key === 'p' || e.key === 'P') ctl.togglePause();
            else if (e.key === 'z' || e.key === 'Z') setPref('showZoc', !prefs().showZoc);
            else if (e.key === '+' || e.key === '=') zoomBias.update((z) => Math.min(1.8, z * 1.12));
            else if (e.key === '-' || e.key === '_') zoomBias.update((z) => Math.max(0.6, z / 1.12));
            else if (e.key === '0') zoomBias.set(1);
            else if (e.key === 'm' || e.key === 'M') setPref('muted', !prefs().muted);
            else if (/^[1-9]$/.test(e.key)) {
                const id = phaseAbilities(m.active())[Number(e.key) - 1];
                if (id) ctl.useAbility(id);
            }
        };
        window.addEventListener('keydown', onKey);
        // palette-swapped strips arrive asynchronously: redraw when they land, warm the common ones now
        const unRecolor = recolorVersion.subscribe(() => ctl.bump());
        for (const p of m.state.pieces) prewarmPlayer(p.player.sprite, p.player, p.player.cls === 'keeper');
        const wheel = (e: WheelEvent) => {
            if (!(e.target as HTMLElement).closest('.viewport')) return;
            e.preventDefault();
            zoomBias.update((z) => Math.max(0.6, Math.min(1.8, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
        };
        window.addEventListener('wheel', wheel, { passive: false });
        audio.unlock();
        void ctl.run();
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('wheel', wheel);
            unRecolor();
            ctl.stop();
        };
    });

    return html`<div class="match ${cfg.camera.tiltDeg ? 'cam-3d' : 'cam-2d'}" ${lifecycle}>
        <div ${attr({ class: shakeClass, style: viewportStyle })}>
            <div class="world" ${attr({ style: camera })}>
                <div class="pitch cond-${stadium.condition}" style="width:${W}px;height:${H}px" ${pitchLayer}></div>
                <div class="grid" style="width:${W}px;height:${H}px" ${gridLayer}></div>
                <div class="overlays">
                    ${$each(zoc)
                        .$withKey((z) => z.k)
                        .$as(
                            (z) =>
                                html`<div class="zoc zoc-${z.kind}" style="left:${px(z.x)}px;top:${px(z.y)}px;width:${C}px;height:${C}px"></div>`,
                        )}
                    ${$each(overlays)
                        .$withKey((o) => o.k)
                        .$as(
                            (o) =>
                                html`<div class="ov ov-${o.kind}" style="left:${px(o.x)}px;top:${px(o.y)}px;width:${C}px;height:${C}px"></div>`,
                        )}
                    ${$each(reactors)
                        .$withKey((p) => p.id)
                        .$as(
                            (p) =>
                                html`<div class="reactor" ${attr({ style: derived(ctl.tick, () => `left:${cx(p.pos.x)}px;top:${px(p.pos.y) + C / 2}px`) })}></div>`,
                        )}
                </div>
                <div class="tokens">
                    ${stadiumProps(stadium, conditions, kitColor(club(0).kit), { L: px(0), T: px(0), PW: cols * C, PH: rows * C, C, W, H, S: cfg.sprites.renderPx / cfg.sprites.framePx, tilt: cfg.camera.tiltDeg })}
                    ${goalSprite('left')}${goalSprite('right')}
                    ${$each(() => m.state.pieces)
                        .$withKey((p) => p.id)
                        .$as(Token)}
                    <div class="ball" ${attr({ style: ballStyle })}>
                        <div class="ball-shadow"></div><div class="ball-ring"></div>
                        <div class="stand"><img class="ball-img" src="assets/props/ball_classic.png" ${attr({ style: ballImgStyle })} /></div>
                    </div>
                    ${$each(ctl.popups)
                        .$withKey((p) => p.id)
                        .$as(
                            (p) =>
                                html`<div class="popup ${p.tone}" style="left:${cx(p.at.x)}px;top:${px(p.at.y)}px"><div class="stand"><span>${p.text}</span></div></div>`,
                        )}
                    ${$each(ctl.bursts)
                        .$withKey((b) => b.id)
                        .$as(burst)}
                </div>
            </div>
        ${atmosphere(conditions)}
        </div>

        <header class="hud-top">
            <div class="team t0 ${isLightKit(club(0).kit) ? 'light' : ''}" style="--kit:${kitColor(club(0).kit)}"><span class="kit"></span>${club(0).name}${ctl.isHuman(0) ? html`<em>you</em>` : html``}</div>
            <div class="score"><b>${scoreText(0)}</b><span>–</span><b>${scoreText(1)}</b></div>
            <div class="team t1 ${isLightKit(club(1).kit) ? 'light' : ''}" style="--kit:${kitColor(club(1).kit)}">${ctl.isHuman(1) ? html`<em>you</em>` : html``}${club(1).name}<span class="kit"></span></div>
            <div class="round">${roundText}</div>
            ${noTimer ? html`<div class="round notimer">No timer · take your time</div>` : html`<div class="timer"><i ${attr({ style: timerStyle })}></i></div>`}
        </header>
        ${$render(caption)}

        <aside class="hud-left">${$render(activeCard)}
            <div class="legend">
                <div><i class="sw move"></i>Movement</div>
                <div><i class="sw scatter"></i>Ball may land</div>
                <div><i class="sw danger"></i>Reaction zone</div>
                <div><i class="sw active"></i>Active player</div>
                <div><i class="sw pick"></i>Pick a target / run-in zone</div>
                <div ${on('click', () => setPref('showZoc', !prefs().showZoc))} class="legend-toggle"><i class="sw zoc"></i>Their zone of control <kbd>Z</kbd></div>
                <div><i class="sw zoc-own"></i>Your cover</div>
            </div>
        </aside>
        <aside class="hud-right">
            <div class="tools">
                <button class="exit" title="Leave the match" ${on('click', onExit)}>Menu</button>
                <button class="pb-btn" title="Playbook (H)" ${on('click', () => showPlaybook.update((v) => !v))}>?</button>
                <button class="set-btn" title="Bench & substitutions (B)" ${on('click', () => showBench.update((v) => !v))}>⇄</button>
                <button class="set-btn" title="Pause (P)" ${on('click', () => ctl.togglePause())}>❚❚</button>
                ${$render(muteChip)}
                ${onSettings ? html`<button class="set-btn" title="Settings" ${on('click', onSettings)}>⚙</button>` : html``}
            </div>
            ${$render(focusChip)}
            ${$render(minimap)}${$render(queue)}${$render(log)}</aside>
        <footer class="hud-bottom">
            ${$render(abilityInfo)}
            ${$render(armedBar)}
            <div class="dock-head">${$render(phaseStep)}<div class="hint">${hint}</div></div>
            ${$render(actions)}
        </footer>

        ${$if(showPlaybook).$then(
            () => html`<div class="modal" ${on('click', (e) => {
                if (e.target === e.currentTarget) showPlaybook.set(false);
            })}>
            <div class="modal-body"><header><h2>Playbook</h2><button class="ghost" ${on('click', () => showPlaybook.set(false))}>Close <kbd>Esc</kbd></button></header>${Playbook(cfg)}</div>
        </div>`,
        )}
        ${$if(showBench).$then(
            () =>
                html`<div class="modal" ${on('click', (e) => {
                    if (e.target === e.currentTarget) showBench.set(false);
                })}>${$render(benchPanel)}</div>`,
        )}
        ${$render(tipPanel)}
        ${$render(lessonPanel)}
        ${$if(ctl.paused).$then(() => html`<div class="pause-veil"><div class="banner"><div class="banner-text">Paused</div><div class="banner-sub">Read the commentary, plan your move. P to resume.</div><button class="primary" ${on('click', () => ctl.togglePause())}>Resume</button></div></div>`)}
        ${$render(toast)}
        ${$render(banner)}
        ${$render(report)}
    </div>`;
};
