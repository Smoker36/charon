import { HELIUS_API_KEY } from '../config.js';
import { db } from '../db/connection.js';
import { now, log, logError, pruneSeen, sleep } from '../utils.js';
import { boolSetting } from '../db/settings.js';
import { graduated } from './graduated.js';
import { trending, storeSignalEvent } from './trending.js';

let candidateHandler = null;
export function setCandidateHandler(fn) { candidateHandler = fn; }

let sellSignalHandler = null;
export function setSellSignalHandler(fn) { sellSignalHandler = fn; }

// Per-wallet cursor: last seen signature used as Helius pagination "before" param
const walletCursors = new Map();
// Global dedup: signature → timestamp, pruned every 30m
const seenTxns = new Map();

// Mints to ignore when detecting buys (SOL, USDC, USDT, WSOL)
const IGNORED_MINTS = new Set([
  'So11111111111111111111111111111111111111111',
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

async function fetchRecentSwaps(walletAddress, cursor = null) {
  const url = new URL(`https://api.helius.xyz/v0/addresses/${walletAddress}/transactions`);
  url.searchParams.set('api-key', HELIUS_API_KEY);
  url.searchParams.set('type', 'SWAP');
  url.searchParams.set('limit', '20');
  if (cursor) url.searchParams.set('before', cursor);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (res.status === 429) throw Object.assign(new Error('Helius rate limited'), { rateLimited: true });
  if (!res.ok) throw new Error(`Helius ${res.status}`);
  return res.json();
}

// Return mints sent FROM walletAddress in this swap tx (i.e. tokens sold)
function extractSoldMints(tx, walletAddress) {
  const mints = new Set();
  for (const t of tx.tokenTransfers || []) {
    if (
      t.fromUserAccount === walletAddress &&
      t.mint &&
      !IGNORED_MINTS.has(t.mint) &&
      Number(t.tokenAmount || 0) > 0
    ) {
      mints.add(t.mint);
    }
  }
  return [...mints];
}

// Return mints received by walletAddress in this swap tx (i.e. tokens bought)
function extractBoughtMints(tx, walletAddress) {
  const mints = new Set();
  for (const t of tx.tokenTransfers || []) {
    if (
      t.toUserAccount === walletAddress &&
      t.mint &&
      !IGNORED_MINTS.has(t.mint) &&
      Number(t.tokenAmount || 0) > 0
    ) {
      mints.add(t.mint);
    }
  }
  return [...mints];
}

async function processWallet(wallet) {
  const { address, kind, label } = wallet;
  const isFirstPoll = !walletCursors.has(address);
  const cursor = walletCursors.get(address) || null;

  let txns;
  try {
    txns = await fetchRecentSwaps(address, cursor);
  } catch (err) {
    if (err.rateLimited) {
      log('wallet-monitor', `rate limited, backing off 10s`);
      await sleep(10_000);
    } else {
      logError('wallet-monitor', `${label}: ${err.message}`);
    }
    return;
  }

  if (!Array.isArray(txns) || !txns.length) return;

  // Always update cursor to newest signature seen
  walletCursors.set(address, txns[0].signature);

  // On very first poll: just set cursor, don't process historic trades
  if (isFirstPoll) return;

  pruneSeen(seenTxns, 30 * 60_000);

  for (const tx of txns) {
    if (seenTxns.has(tx.signature)) continue;
    seenTxns.set(tx.signature, now());

    const boughtMints = extractBoughtMints(tx, address);
    for (const mint of boughtMints) {
      await triggerForMint(mint, wallet, tx.signature);
    }

    const soldMints = extractSoldMints(tx, address);
    for (const mint of soldMints) {
      if (!sellSignalHandler) continue;
      log('wallet-monitor', `${kind} ${label.slice(0, 12)} SOLD ${mint.slice(0, 8)} → checking positions`);
      try {
        await sellSignalHandler({ mint, wallet, signature: tx.signature });
      } catch (err) {
        logError('wallet-monitor', `sell handler ${mint.slice(0, 8)}: ${err.message}`);
      }
    }
  }
}

async function triggerForMint(mint, wallet, signature) {
  const { address, kind, label } = wallet;
  const graduatedCoin = graduated.get(mint) || null;
  const trendingEnabled = boolSetting('trending_enabled', true);
  const trendingToken = trendingEnabled ? trending.get(mint) || null : null;
  const route = kind === 'kol' ? 'kol_buy' : 'smart_wallet_buy';

  storeSignalEvent(mint, route, `wallet:${label}`, {
    walletAddress: address,
    walletKind: kind,
    walletLabel: label,
    signature,
  });

  log('wallet-monitor', `${kind} ${label.slice(0, 12)} → ${mint.slice(0, 8)} (${route})`);

  if (!candidateHandler) return;
  try {
    await candidateHandler({
      mint,
      graduatedCoin,
      trendingToken,
      route,
      walletSignal: { address, kind, label, signature },
    });
  } catch (err) {
    logError('wallet-monitor', `pipeline ${mint.slice(0, 8)}: ${err.message}`);
  }
}

export async function monitorWalletBuys() {
  if (!HELIUS_API_KEY) {
    log('wallet-monitor', 'HELIUS_API_KEY not set — skipping');
    return;
  }

  const wallets = db.prepare(
    `SELECT label, address, kind FROM saved_wallets WHERE kind IN ('smartwallet', 'kol') ORDER BY label`
  ).all();

  if (!wallets.length) return;

  // Pace: spread requests so we don't burst Helius
  const paceMs = Math.max(150, Math.ceil(2000 / wallets.length));

  for (const wallet of wallets) {
    await processWallet(wallet);
    await sleep(paceMs);
  }
}

export function walletMonitorStats() {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM saved_wallets WHERE kind IN ('smartwallet', 'kol')`).get().c;
  return { monitoring: total, cursors: walletCursors.size, seenTxns: seenTxns.size };
}
