import { Dialog } from './Dialog';
/** Full-time report: score, goal timeline, team stat bars, Man of the Match, player ratings. */
import { html, on } from '@grainular/nord';
import type { MatchController } from './controller';
import { isLightKit, kitColor } from './kits';
import { spriteStyle } from './sprites';
import type { Piece, TeamSide } from '../types';

const ratingClass = (r: number) => (r >= 8 ? 'r-great' : r >= 7 ? 'r-good' : r >= 6 ? 'r-ok' : 'r-poor');

export const MatchReport = (ctl: MatchController, onContinue: () => void, continueLabel = 'Continue', verdictOverride?: string) => {
    const m = ctl.match;
    const s = ctl.stats;
    const clubs = m.state.clubs;
    const [a, b] = m.state.score;
    const name = (id: string) => m.piece(id).player.name;
    const motm = s.motm();
    const t = [s.team(0), s.team(1)] as const;
    const winner: TeamSide | null = a > b ? 0 : b > a ? 1 : null;
    const human: TeamSide | null = ctl.isHuman(0) && !ctl.isHuman(1) ? 0 : ctl.isHuman(1) && !ctl.isHuman(0) ? 1 : null;
    const verdict =
        human === null
            ? winner === null
                ? 'Honours even.'
                : `${clubs[winner].name} take it.`
            : winner === human
              ? 'Victory!'
              : winner === null
                ? 'A hard-earned draw.'
                : 'Defeat.';

    const bar = (label: string, x: number, y: number, fmt = (v: number) => String(v)) => {
        const total = Math.max(1, x + y);
        return html`<div class="rbar"><b>${fmt(x)}</b><div class="rbar-track"><i class="l" style="width:${String((x / total) * 100)}%;--kit:${kitColor(clubs[0].kit)}"></i><i class="r" style="width:${String((y / total) * 100)}%;--kit:${kitColor(clubs[1].kit)}"></i></div><b>${fmt(y)}</b><span>${label}</span></div>`;
    };

    const ratings = (team: TeamSide) => {
        const all = m
            .everyone()
            .filter((p) => p.team === team)
            .sort((x, y) => s.rating(y) - s.rating(x));
        return html`<ul class="ratings">${all.map((p: Piece) => {
            const l = s.players.get(p.id);
            const notes = [
                l?.goals ? `${l.goals}G` : '',
                l?.assists ? `${l.assists}A` : '',
                l?.saves ? `${l.saves} SV` : '',
                l?.tacklesWon ? `${l.tacklesWon} TK` : '',
            ]
                .filter(Boolean)
                .join(' ');
            const card = l?.red ? html`<i class="cardchip red"></i>` : l?.yellows ? html`<i class="cardchip yellow"></i>` : html``;
            return html`<li><span class="rnum">${String(p.player.number)}</span><span class="rname">${p.player.name}${card}</span><span class="rnotes">${notes}</span><b class="rating ${ratingClass(s.rating(p))}">${s.rating(p).toFixed(1)}</b></li>`;
        })}</ul>`;
    };

    return Dialog({
        label: 'Match report',
        className: 'modal report-modal',
        children: html`<div class="modal-body report">
            <div class="modal-scroll">
                <div class="report-head">
                    <div class="rteam ${isLightKit(clubs[0].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[0].kit)}">${clubs[0].name}</div>
                    <div class="rscore">${String(a)}<span>–</span>${String(b)}</div>
                    <div class="rteam ${isLightKit(clubs[1].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[1].kit)}">${clubs[1].name}</div>
                </div>
                <h2 class="verdict">${verdictOverride ?? verdict}</h2>
                <p class="ref-line">Referee ${m.state.referee.name} · ${m.cfg.referee.styles[m.state.referee.style].label} · ${String([...s.players.values()].reduce((n, l) => n + l.fouls, 0))} fouls</p>
                <div class="report-grid">
                    <section>
                        <h4>Goals</h4>
                        ${s.goals.length ? html`<ul class="goals">${s.goals.map((g) => html`<li class="t${String(g.team)}"><b>${String(g.minute)}'</b> ${name(g.scorer)}${g.how === 'penalty' ? ' (pen)' : g.how === 'header' ? ' (header)' : ''}${g.assist ? html`<em> · assist ${name(g.assist)}</em>` : html``}</li>`)}</ul>` : html`<p class="muted">No goals. The defences won the day.</p>`}
                        <h4>Match stats</h4>
                        <div class="rbars">
                            ${bar('Possession', t[0].possession, t[1].possession, (v) => `${v}%`)}
                            ${bar('Shots', t[0].shots, t[1].shots)}
                            ${bar('On target', t[0].onTarget, t[1].onTarget)}
                            ${bar('Passes completed', t[0].passesOk, t[1].passesOk)}
                            ${bar('Tackles won', t[0].tacklesWon, t[1].tacklesWon)}
                            ${bar('Saves', t[0].saves, t[1].saves)}
                        </div>
                    </section>
                    <section class="motm">
                        <h4>Man of the Match</h4>
                        ${
                            motm
                                ? html`<div class="motm-card">
                            <div class="podium"><div class="sprite" style="${spriteStyle(ctl.cfg, motm.player.sprite, 'celebrate', 'down', motm.player)};width:128px;height:128px;background-size:${String((ctl.cfg.animFrames.celebrate ?? 12) * 128)}px 128px;--strip:${String((ctl.cfg.animFrames.celebrate ?? 12) * 128)}px"></div></div>
                            <b>${motm.player.name}</b><span>${clubs[motm.team].name}</span><em class="rating r-great">${s.rating(motm).toFixed(1)}</em>
                        </div>`
                                : html``
                        }
                    </section>
                    <section><h4>${clubs[0].short} ratings</h4>${ratings(0)}</section>
                    <section><h4>${clubs[1].short} ratings</h4>${ratings(1)}</section>
                </div>
            </div>
            <footer><button class="primary" ${on('click', onContinue)}>${continueLabel} →</button></footer>
        </div>`,
    });
};
