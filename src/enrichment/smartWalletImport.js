import { db } from '../db/connection.js';
import { now, log, logError } from '../utils.js';
import { gmgnFetch } from './gmgn.js';
import { JSON_HEADERS } from '../config.js';

// Auto-imported wallets use a label prefix so they can be purged cleanly
const AUTO_PREFIX = 'auto';

// GMGN tries multiple endpoints — different API versions expose smart money differently
const GMGN_ENDPOINTS = [
  ['/v1/smartmoney/sol/wallets', { orderby: 'realized_profit', direction: 'desc' }],
  ['/v1/stat/sol/top_traders',   { orderby: 'pnl', direction: 'desc' }],
  ['/v1/smartmoney/sol/wallet_list', { tag: 'pump_smart_degen', orderby: 'realized_profit', direction: 'desc' }],
];

function extractWalletRows(payload) {
  const candidates = [
    payload?.data?.data?.wallets,
    payload?.data?.wallets,
    payload?.data?.data?.rank,
    payload?.data?.rank,
    payload?.data?.data,
    payload?.data,
    payload?.wallets,
    payload?.rank,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

function resolveKindFromRow(row, defaultKind) {
  const tag = String(row?.tag || row?.tags?.[0] || '').toLowerCase();
  if (tag.includes('kol')) return 'kol';
  return defaultKind;
}

async function fetchGmgnTopTraders({ limit = 50, period = '7d' } = {}) {
  for (const [endpoint, extra] of GMGN_ENDPOINTS) {
    try {
      const payload = await gmgnFetch(endpoint, {
        params: { limit, period, ...extra },
      });
      const rows = extractWalletRows(payload);
      if (rows.length > 0) {
        log('smartwallet', `GMGN ${endpoint} returned ${rows.length} wallets`);
        return rows;
      }
    } catch (err) {
      log('smartwallet', `GMGN ${endpoint} failed: ${err.message}`);
    }
  }
  return [];
}

// Jupiter doesn't expose a public top-traders leaderboard, but we can enrich
// known wallets using the PnL API. For now the jupiter source is a no-op
// that returns [] — it's wired here so the UI can show the option without crashing.
async function fetchJupiterTopTraders({ limit = 50 } = {}) {
  try {
    const url = new URL('https://datapi.jup.ag/v1/leaderboard');
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), { headers: JSON_HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = extractWalletRows(data);
    log('smartwallet', `Jupiter leaderboard returned ${rows.length} wallets`);
    return rows;
  } catch {
    return [];
  }
}

function addressFromRow(row) {
  return row?.wallet_address || row?.address || row?.wallet || row?.walletAddress || null;
}

function labelFromAddress(address, prefix) {
  return `${prefix}_${address.slice(0, 8)}`;
}

/**
 * Import top traders from an external source into saved_wallets.
 * @param {object} opts
 * @param {'gmgn'|'jupiter'} opts.source
 * @param {'smartwallet'|'kol'} opts.kind - default kind if row tag doesn't override
 * @param {number} opts.limit
 * @param {string} opts.period - time period for GMGN ('1d'|'7d'|'30d')
 * @param {boolean} opts.replace - purge existing auto-wallets of this kind before importing
 * @returns {{ imported, skipped, updated, errors, total }}
 */
export async function autoImportWallets({ source = 'gmgn', kind = 'smartwallet', limit = 50, period = '7d', replace = false } = {}) {
  let rows = [];
  if (source === 'gmgn') rows = await fetchGmgnTopTraders({ limit, period });
  else if (source === 'jupiter') rows = await fetchJupiterTopTraders({ limit });

  if (!rows.length) return { imported: 0, skipped: 0, updated: 0, errors: 0, total: 0, source };

  if (replace) {
    const deleted = db.prepare(
      `DELETE FROM saved_wallets WHERE label LIKE ? AND kind = ?`
    ).run(`${AUTO_PREFIX}_%`, kind).changes;
    log('smartwallet', `Purged ${deleted} existing auto-${kind} wallets before re-import`);
  }

  const insert = db.prepare(`
    INSERT INTO saved_wallets (label, address, created_at_ms, kind) VALUES (?, ?, ?, ?)
    ON CONFLICT(label) DO UPDATE SET address = excluded.address, kind = excluded.kind, created_at_ms = excluded.created_at_ms
  `);
  // Check for existing by address to avoid counting address-conflicts as errors
  const existsByAddress = db.prepare('SELECT label FROM saved_wallets WHERE address = ?');

  let imported = 0, skipped = 0, updated = 0, errors = 0;

  for (const row of rows) {
    const address = addressFromRow(row);
    if (!address || typeof address !== 'string' || address.length < 32) { skipped++; continue; }

    const resolvedKind = resolveKindFromRow(row, kind);
    const label = labelFromAddress(address, AUTO_PREFIX);

    try {
      const existing = existsByAddress.get(address);
      if (existing && existing.label !== label) {
        // Same address already saved under a different (manual) label — skip to preserve it
        skipped++;
        continue;
      }
      const result = insert.run(label, address, now(), resolvedKind);
      if (result.changes > 0) {
        // SQLite reports changes=1 for both insert and update; check if it was truly new
        const existed = existing != null;
        if (existed) updated++; else imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      logError('smartwallet', `insert ${address.slice(0, 8)}: ${err.message}`);
      errors++;
    }
  }

  log('smartwallet', `import done — ${imported} new, ${updated} updated, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, updated, errors, total: rows.length, source };
}

/**
 * Remove all auto-imported wallets (label starts with 'auto_').
 * If kind is given, only purge that kind.
 */
export function purgeAutoWallets(kind = null) {
  if (kind) {
    return db.prepare(`DELETE FROM saved_wallets WHERE label LIKE ? AND kind = ?`).run(`${AUTO_PREFIX}_%`, kind).changes;
  }
  return db.prepare(`DELETE FROM saved_wallets WHERE label LIKE ?`).run(`${AUTO_PREFIX}_%`).changes;
}

export function autoWalletCount(kind = null) {
  if (kind) {
    return db.prepare(`SELECT COUNT(*) AS c FROM saved_wallets WHERE label LIKE ? AND kind = ?`).get(`${AUTO_PREFIX}_%`, kind).c;
  }
  return db.prepare(`SELECT COUNT(*) AS c FROM saved_wallets WHERE label LIKE ?`).get(`${AUTO_PREFIX}_%`).c;
}
