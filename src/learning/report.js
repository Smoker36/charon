import { escapeHtml, fmtPct, fmtSol, gmgnLink, short } from '../format.js';
import { formatWindow } from '../utils.js';

export function learningReportText(runId, summary, lessons) {
  return [
    '🧠 <b>Charon Learning</b>',
    '',
    `Run: <b>#${runId}</b> · Window: <b>${formatWindow(summary.windowMs)}</b>`,
    `Closed: ${summary.positions.closed}/${summary.positions.opened} · Win rate: ${fmtPct(summary.positions.winRate)}`,
    `Avg PnL: ${fmtPct(summary.positions.avgPnlPercent)} · Total: ${fmtSol(summary.positions.totalPnlSol)} SOL`,
    summary.positions.byRoute?.length ? `Best route: <b>${escapeHtml(summary.positions.byRoute[0].route)}</b> avg ${fmtPct(summary.positions.byRoute[0].avgPnlPercent)} (${summary.positions.byRoute[0].count})` : null,
    '',
    '<b>Lessons</b>',
    ...lessons.map((item, index) => `${index + 1}. ${escapeHtml(item.lesson)}`),
  ].filter(Boolean).join('\n');
}

export function smartDegenReportText(summary, lessons) {
  const { bucketStats, correlation, topDegenPositions, totalClosed, windowMs } = summary;
  const hi = correlation.highDegen;
  const lo = correlation.lowDegen;
  const lines = [
    '🎰 <b>SmartDegen Learning</b>',
    '',
    `Window: <b>${formatWindow(windowMs)}</b> · Closed positions: <b>${totalClosed}</b>`,
    '',
    '<b>PnL by smart degen count bucket</b>',
    ...bucketStats.map(b =>
      `  SmartDegen <b>${b.label}</b>: ${b.count} trades · win rate ${fmtPct(b.winRate)} · avg PnL ${fmtPct(b.avgPnlPercent)}`
    ),
    bucketStats.length === 0 ? '  No closed positions with data yet.' : null,
    '',
    '<b>High (≥3) vs Low (&lt;3) smart degen</b>',
    hi.count > 0 ? `  ≥3 smart degen: ${hi.count} trades · avg PnL ${fmtPct(hi.avgPnl)}` : '  ≥3 smart degen: no data',
    lo.count > 0 ? `  &lt;3 smart degen: ${lo.count} trades · avg PnL ${fmtPct(lo.avgPnl)}` : '  &lt;3 smart degen: no data',
    '',
    topDegenPositions.length ? '<b>Top smart degen positions</b>' : null,
    ...topDegenPositions.map(p =>
      `  <a href="${gmgnLink(p.mint)}">${escapeHtml(p.symbol || short(p.mint))}</a> · degen ${p.smartDegenCount} · ${fmtPct(p.pnlPercent)} [${escapeHtml(p.exitReason || '?')}]`
    ),
    '',
    lessons.length ? '<b>Lessons</b>' : null,
    ...lessons.map((item, i) => `${i + 1}. ${escapeHtml(item.lesson)}`),
  ];
  return lines.filter(Boolean).join('\n');
}
