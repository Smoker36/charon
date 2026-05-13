import { db } from '../db/connection.js';
import { now, safeJson } from '../utils.js';
import { positionSnapshotCandidate } from './summary.js';

const BUCKETS = [
  { label: '0', min: 0, max: 0 },
  { label: '1-2', min: 1, max: 2 },
  { label: '3-5', min: 3, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11+', min: 11, max: Infinity },
];

function bucket(count) {
  return BUCKETS.find(b => count >= b.min && count <= b.max) || BUCKETS[0];
}

export function summarizeSmartDegenWindow(windowMs) {
  const cutoff = now() - windowMs;
  const closed = db.prepare(`
    SELECT * FROM dry_run_positions
    WHERE status = 'closed'
      AND opened_at_ms >= ?
      AND COALESCE(execution_mode, 'dry_run') = 'dry_run'
    ORDER BY opened_at_ms ASC
  `).all(cutoff);

  const byBucket = new Map(BUCKETS.map(b => [b.label, { label: b.label, min: b.min, max: b.max, count: 0, wins: 0, losses: 0, pnlPercent: 0 }]));

  for (const pos of closed) {
    const candidate = positionSnapshotCandidate(pos);
    const smartDegen = Number(candidate.metrics?.trendingSmartDegenCount ?? 0);
    const pnl = Number(pos.pnl_percent || 0);
    const b = bucket(smartDegen);
    const row = byBucket.get(b.label);
    row.count += 1;
    row.wins += pnl > 0 ? 1 : 0;
    row.losses += pnl < 0 ? 1 : 0;
    row.pnlPercent += pnl;
  }

  const bucketStats = [...byBucket.values()]
    .filter(b => b.count > 0)
    .map(b => ({
      ...b,
      winRate: b.count ? b.wins / b.count * 100 : null,
      avgPnlPercent: b.count ? b.pnlPercent / b.count : null,
    }))
    .sort((a, b) => (b.avgPnlPercent ?? 0) - (a.avgPnlPercent ?? 0));

  // Best performing bucket with at least 2 trades
  const bestBucket = bucketStats.find(b => b.count >= 2) || null;
  // Worst performing bucket with at least 2 trades
  const worstBucket = [...bucketStats].reverse().find(b => b.count >= 2) || null;

  // Top 5 positions with highest smartDegen count and their outcomes
  const topDegenPositions = closed
    .map(pos => {
      const candidate = positionSnapshotCandidate(pos);
      return {
        mint: pos.mint,
        symbol: pos.symbol,
        pnlPercent: Number(pos.pnl_percent || 0),
        exitReason: pos.exit_reason,
        smartDegenCount: Number(candidate.metrics?.trendingSmartDegenCount ?? 0),
      };
    })
    .sort((a, b) => b.smartDegenCount - a.smartDegenCount)
    .slice(0, 5);

  // Correlation: positions where smartDegen >= 3 vs < 3
  const highDegen = closed.filter(pos => {
    const c = positionSnapshotCandidate(pos);
    return Number(c.metrics?.trendingSmartDegenCount ?? 0) >= 3;
  });
  const lowDegen = closed.filter(pos => {
    const c = positionSnapshotCandidate(pos);
    return Number(c.metrics?.trendingSmartDegenCount ?? 0) < 3;
  });

  const highDegenAvgPnl = highDegen.length
    ? highDegen.reduce((s, p) => s + Number(p.pnl_percent || 0), 0) / highDegen.length
    : null;
  const lowDegenAvgPnl = lowDegen.length
    ? lowDegen.reduce((s, p) => s + Number(p.pnl_percent || 0), 0) / lowDegen.length
    : null;

  return {
    windowMs,
    fromMs: cutoff,
    toMs: now(),
    totalClosed: closed.length,
    bucketStats,
    bestBucket,
    worstBucket,
    topDegenPositions,
    correlation: {
      highDegen: { count: highDegen.length, avgPnl: highDegenAvgPnl },
      lowDegen: { count: lowDegen.length, avgPnl: lowDegenAvgPnl },
    },
  };
}
