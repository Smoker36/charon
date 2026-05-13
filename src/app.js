import { setDefaultResultOrder } from 'node:dns';
import { APP_NAME, SIGNAL_SERVER_URL, SIGNAL_POLL_MS, GRADUATED_POLL_MS, TRENDING_POLL_MS, POSITION_CHECK_MS, validateConfig } from './config.js';
import { initDb } from './db/connection.js';
import { initLiveExecution } from './liveExecutor.js';
import { setupTelegram } from './telegram/commands.js';
import { monitorPositions } from './execution/positions.js';
import { processCandidateFromSignals, maybeProcessDegenCandidate, handleSmartWalletSell } from './pipeline/orchestrator.js';
import { sendTelegram } from './telegram/send.js';
import { makeFailureTracker, log } from './utils.js';

setDefaultResultOrder('ipv4first');
validateConfig();

export async function startCharon() {
  initDb();
  initLiveExecution();
  setupTelegram();

  if (SIGNAL_SERVER_URL) {
    // ── Server mode: fetch signals from signal server ──────────────────────
    const { fetchServerSignals, setCandidateHandler, setDegenHandler } = await import('./signals/serverClient.js');

    setCandidateHandler(processCandidateFromSignals);
    setDegenHandler(maybeProcessDegenCandidate);

    const alert = (msg) => sendTelegram(msg);
    const trackServer = makeFailureTracker('server signals', alert);
    const trackDip = makeFailureTracker('dip monitor', alert);

    await fetchServerSignals().catch(error => log('server', `initial fetch failed: ${error.message}`));
    setInterval(() => trackServer(() => fetchServerSignals()), SIGNAL_POLL_MS);

    // Price monitor for dip buy strategy
    const { monitorPriceAlerts, cleanupAlerts } = await import('./signals/priceMonitor.js');
    const { setCandidateHandler: setAlertHandler } = await import('./signals/priceMonitor.js');
    setAlertHandler(processCandidateFromSignals);
    setInterval(() => trackDip(() => monitorPriceAlerts()), 10_000);
    setInterval(() => cleanupAlerts(), 60 * 60 * 1000);

    log('bot', `${APP_NAME} started (server mode: ${SIGNAL_SERVER_URL})`);
  } else {
    // ── Standalone mode: direct polling (legacy) ───────────────────────────
    const { fetchGraduatedCoins } = await import('./signals/graduated.js');
    const { fetchGmgnTrending, setDegenHandler } = await import('./signals/trending.js');
    const { startWebsocket, setCandidateHandler } = await import('./signals/feeClaim.js');

    setDegenHandler(maybeProcessDegenCandidate);
    setCandidateHandler(processCandidateFromSignals);

    await fetchGraduatedCoins().catch(error => log('graduated', `initial fetch failed: ${error.message}`));
    await fetchGmgnTrending().catch(error => log('trending', `initial fetch failed: ${error.message}`));

    setInterval(() => fetchGraduatedCoins().catch(error => log('graduated', error.message)), GRADUATED_POLL_MS);
    setInterval(() => fetchGmgnTrending().catch(error => log('trending', error.message)), TRENDING_POLL_MS);
    startWebsocket();

    log('bot', `${APP_NAME} started (standalone mode)`);
  }

  // Smart wallet auto-refresh (optional, off by default)
  const { autoImportWallets } = await import('./enrichment/smartWalletImport.js');
  const { numSetting: ns } = await import('./db/settings.js');
  const smartRefreshMs = ns('smart_wallet_auto_refresh_ms', 0);
  if (smartRefreshMs > 0) {
    setInterval(() => autoImportWallets({ source: 'gmgn', kind: 'smartwallet', limit: 50, period: '7d' }).catch(err => log('smartwallet', err.message)), smartRefreshMs);
    log('bot', `Smart wallet auto-refresh every ${Math.round(smartRefreshMs / 60000)}m`);
  }

  // Smart wallet buy monitor: watch smart/KOL wallet transactions and trigger pipeline
  const { monitorWalletBuys, setCandidateHandler: setWalletHandler, setSellSignalHandler } = await import('./signals/walletMonitor.js');
  setWalletHandler(processCandidateFromSignals);
  setSellSignalHandler(handleSmartWalletSell);
  const walletMonitorMs = ns('smart_wallet_monitor_ms', 0);
  if (walletMonitorMs > 0) {
    // Prime cursors on startup (first call just records latest signatures, doesn't trigger pipeline)
    await monitorWalletBuys().catch(err => log('wallet-monitor', `prime failed: ${err.message}`));
    setInterval(() => monitorWalletBuys().catch(err => log('wallet-monitor', err.message)), walletMonitorMs);
    log('bot', `Wallet buy monitor active — polling every ${Math.round(walletMonitorMs / 1000)}s`);
  }

  // Position monitoring runs in both modes
  const trackPositions = makeFailureTracker('position monitor', (msg) => sendTelegram(msg));
  setInterval(() => trackPositions(() => monitorPositions()), POSITION_CHECK_MS);
}
