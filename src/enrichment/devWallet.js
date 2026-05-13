import { now } from '../utils.js';

// Extract dev/creator address from all available data sources
export function extractDevAddress({ graduatedCoin, gmgn, jupiterAsset } = {}) {
  return graduatedCoin?.creator
    || graduatedCoin?.coinCreator
    || graduatedCoin?.creatorAddress
    || graduatedCoin?.deployer
    || gmgn?.creator
    || gmgn?.dev_address
    || gmgn?.deployer
    || jupiterAsset?.creator
    || jupiterAsset?.deployer
    || null;
}

// Check dev holding status against holder list + GMGN data
export function checkDevHolding(devAddress, holders, gmgn) {
  if (!devAddress) return null;

  const holderList = holders?.holders || [];
  const devHolder = holderList.find(h => h.address === devAddress);

  // GMGN may carry explicit dev sell rate (0–1 ratio)
  const gmgnSellRate = Number(gmgn?.dev_sell_rate ?? gmgn?.dev_sold_pct ?? gmgn?.dev_sold_ratio ?? -1);
  const gmgnSoldPct = gmgnSellRate >= 0 && gmgnSellRate <= 1
    ? gmgnSellRate * 100
    : gmgnSellRate > 1
      ? gmgnSellRate   // already a percent
      : null;

  // Holding percent from holder list (real-time)
  const holdingPercent = devHolder ? Number(devHolder.percent ?? 0) : 0;

  // Determine sold percent: prefer GMGN explicit data, otherwise infer from absence in top holders
  // Note: dev may hold a tiny amount below top-N cutoff — so "not in list" ≠ fully sold without GMGN data
  const soldPercent = gmgnSoldPct != null
    ? gmgnSoldPct
    : devHolder
      ? null           // in holder list but no GMGN sell data — unknown how much sold
      : null;

  return {
    address: devAddress,
    isHolding: devHolder != null || (gmgnSoldPct != null && gmgnSoldPct < 100),
    holdingPercent,
    soldPercent,
    dataSource: gmgnSoldPct != null ? 'gmgn' : 'holders',
    checkedAt: now(),
  };
}
