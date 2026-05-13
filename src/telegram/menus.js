import { escapeHtml, fmtPct, fmtSol, fmtUsd, short } from '../format.js';
import { numSetting, boolSetting, setting, activeStrategy, allStrategies } from '../db/settings.js';
import { openPositionCount, tradingMode, openPositions, inactivePositions, inactivePositionCount, topPerformingPositions, pnlByStrategy } from '../db/positions.js';
import { savedWallets } from '../enrichment/wallets.js';
import { gmgnStatusText } from '../enrichment/gmgn.js';
import { formatPosition } from './format.js';
import { ENABLE_LLM, LLM_API_KEY } from '../config.js';

const TELEGRAM_MESSAGE_SAFE_LIMIT = 3800;

function fitPositionSection(items, formatter, emptyText, maxChars) {
  if (!items.length) return { text: emptyText, hiddenCount: 0 };
  const rendered = [];
  let used = 0;
  let hiddenCount = 0;
  for (const item of items) {
    const chunk = formatter(item);
    const add = (rendered.length ? 2 : 0) + chunk.length;
    if (used + add > maxChars) {
      hiddenCount += 1;
      continue;
    }
    rendered.push(chunk);
    used += add;
  }
  if (!rendered.length) {
    return { text: `Too many details to display here. Open a position from buttons below.`, hiddenCount: items.length };
  }
  return { text: rendered.join('\n\n'), hiddenCount };
}

export function menuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Agent', callback_data: 'menu:agent' },
          { text: 'Strategy', callback_data: 'menu:strategy' },
        ],
        [
          { text: 'Positions', callback_data: 'menu:positions' },
          { text: 'History Trade', callback_data: 'menu:historytrade' },
        ],
        [
          { text: 'Wallets', callback_data: 'menu:wallets' },
          { text: 'Filters', callback_data: 'menu:filters' },
          { text: 'PnL', callback_data: 'menu:pnl' },
          { text: 'Learning', callback_data: 'menu:learn' },
        ],
      ],
    },
  };
}

export function filtersText() {
  const strat = activeStrategy();
  return [
    `⚙️ <b>Charon Filters</b> (${escapeHtml(strat.name)})`,
    `Min claim fee: ${fmtSol(strat.min_fee_claim_sol)} SOL`,
    `Min mcap: ${fmtUsd(strat.min_mcap_usd)}`,
    `Max mcap: ${strat.max_mcap_usd > 0 ? fmtUsd(strat.max_mcap_usd) : 'off'}`,
    `Min trading fees: ${fmtSol(strat.min_gmgn_total_fee_sol)} SOL`,
    `Min grad volume: ${fmtUsd(strat.min_graduated_volume_usd)}`,
    `Min holders: ${strat.min_holders || 'off'}`,
    `Max holder: ${strat.max_top20_holder_percent < 100 ? fmtPct(strat.max_top20_holder_percent) : 'off'}`,
    `Min saved holders: ${strat.min_saved_wallet_holders || 'off'}`,
    `Min smart wallet holders: ${strat.min_smart_wallet_holders || 'off'}`,
    `Min KOL holders: ${strat.min_kol_holders || 'off'}`,
    strat.max_ath_distance_pct < 0 ? `Max ATH distance: ${strat.max_ath_distance_pct}%` : null,
    '',
    `Min sources: ${strat.min_source_count}`,
    `Fee required: ${strat.require_fee_claim ? 'yes' : 'no'}`,
    '',
    `Trending: <b>${boolSetting('trending_enabled', true) ? 'on' : 'off'}</b> · Source: <b>${escapeHtml(setting('trending_source', 'jupiter'))}</b>`,
    `Dex Paid: <b>${boolSetting('dex_paid', false) ? 'on' : 'off'}</b>`,
    `GMGN status: token-info ${escapeHtml(gmgnStatusText('token'))} · trending ${escapeHtml(gmgnStatusText('trending'))}`,
    `Trending interval: ${escapeHtml(setting('trending_interval', '5m'))} · Limit: ${numSetting('trending_limit', 100)}`,
    `Min trend volume: ${fmtUsd(strat.trending_min_volume_usd)} · Min swaps: ${strat.trending_min_swaps}`,
    `Max trend rug: ${fmtPct(strat.trending_max_rug_ratio * 100)} · Max bundler: ${fmtPct(strat.trending_max_bundler_rate * 100)}`,
  ].filter(Boolean).join('\n');
}

export const numericFilterLabels = {
  min_fee_claim_sol: 'minimum creator fee-claim SOL',
  min_mcap_usd: 'minimum mcap USD',
  max_mcap_usd: 'maximum mcap USD',
  min_gmgn_total_fee_sol: 'minimum total trading fees SOL (GMGN)',
  min_graduated_volume_usd: 'minimum graduated volume USD',
  max_top20_holder_percent: 'maximum holder percent',
  min_saved_wallet_holders: 'minimum saved-wallet holders',
  trending_limit: 'trending result limit',
  trending_min_volume_usd: 'minimum trending volume USD',
  trending_min_swaps: 'minimum trending swaps',
  trending_max_rug_ratio: 'maximum trending rug ratio (0.3 = 30%)',
  trending_max_bundler_rate: 'maximum trending bundler rate (0.5 = 50%)',
};

export const strategyNumericLabels = {
  min_fee_claim_sol: 'minimum creator fee-claim SOL',
  min_mcap_usd: 'minimum mcap USD',
  max_mcap_usd: 'maximum mcap USD',
  min_gmgn_total_fee_sol: 'minimum total trading fees SOL (GMGN)',
  min_graduated_volume_usd: 'minimum graduated volume USD',
  min_holders: 'minimum holders',
  max_top20_holder_percent: 'maximum top holder percent',
  min_saved_wallet_holders: 'minimum saved-wallet holders',
  min_smart_wallet_holders: 'minimum smart-wallet holders',
  min_kol_holders: 'minimum KOL holders',
  max_ath_distance_pct: 'maximum ATH distance percent (-40 = 40% below ATH, 0 = off)',
  min_source_count: 'minimum source count',
  token_age_max_ms: 'maximum token age milliseconds',
  trending_min_volume_usd: 'minimum trending volume USD',
  trending_min_swaps: 'minimum trending swaps',
  trending_max_rug_ratio: 'maximum trending rug ratio (0.3 = 30%)',
  trending_max_bundler_rate: 'maximum trending bundler rate (0.5 = 50%)',
  llm_min_confidence: 'LLM minimum confidence percent',
  position_size_sol: 'position size SOL',
  max_open_positions: 'maximum open positions',
  tp_percent: 'take profit percent',
  sl_percent: 'stop loss percent',
  trailing_percent: 'trailing percent',
  partial_tp_at_percent: 'partial TP trigger percent',
  partial_tp_sell_percent: 'partial TP sell percent',
  max_hold_ms: 'maximum hold milliseconds',
  profit_lock_trigger_1_percent: 'profit-lock first trigger percent',
  profit_lock_floor_1_percent: 'profit-lock first locked profit percent',
  profit_lock_trigger_2_percent: 'profit-lock second trigger percent',
  profit_lock_floor_2_percent: 'profit-lock second locked profit percent',
  profit_lock_trigger_3_percent: 'profit-lock dynamic trigger percent',
  profit_lock_floor_3_percent: 'profit-lock minimum floor after dynamic trigger',
  profit_lock_dynamic_drawdown_percent: 'profit-lock dynamic drawdown from high PnL',
  min_holder_growth_pct: 'minimum holder growth percent',
  min_buy_sell_ratio: 'minimum buy/sell ratio',
};

export function filtersKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Configure in Strategy', callback_data: 'menu:strategy' }],
        [
          { text: 'Trend On/Off', callback_data: 'toggle:trending_enabled' },
          { text: 'Dex Paid On/Off', callback_data: 'toggle:dex_paid' },
        ],
        [
          { text: 'Use Jupiter', callback_data: 'set:trending_source:jupiter' },
          { text: 'Use GMGN', callback_data: 'set:trending_source:gmgn' },
        ],
        [
          { text: 'Trend 5m', callback_data: 'set:trending_interval:5m' },
          { text: 'Trend 1h', callback_data: 'set:trending_interval:1h' },
          { text: 'Trend 6h', callback_data: 'set:trending_interval:6h' },
        ],
        [{ text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
}

export function agentText() {
  const strat = activeStrategy();
  return [
    '🛶 <b>Charon Agent</b>',
    `Strategy: <b>${escapeHtml(strat.name)}</b>`,
    `Agent: <b>${boolSetting('agent_enabled', true) ? 'on' : 'off'}</b>`,
    `Mode: <b>${escapeHtml(tradingMode())}</b>`,
    `LLM: <b>${strat.use_llm && ENABLE_LLM && LLM_API_KEY ? 'configured' : 'disabled'}</b>`,
    `Confidence: ${fmtPct(strat.llm_min_confidence || numSetting('llm_min_confidence', 75))}`,
    `Open positions: ${openPositionCount()}/${strat.max_open_positions || 'unlimited'}`,
    `Batch candidates: ${numSetting('llm_candidate_pick_count', 10)}`,
    `Candidate freshness: ${Math.round(numSetting('llm_candidate_max_age_ms', 600000) / 1000)}s`,
    `Size: ${fmtSol(strat.position_size_sol)} SOL`,
    `TP/SL: ${strat.profit_lock_enabled ? 'unlimited' : fmtPct(strat.tp_percent)} / ${fmtPct(strat.sl_percent)}`,
    `Trailing: ${strat.profit_lock_enabled ? 'ignored' : strat.trailing_enabled ? fmtPct(strat.trailing_percent) : 'off'}`,
  ].join('\n');
}

export function agentKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Toggle Agent', callback_data: 'toggle:agent' }],
        [
          { text: 'Dry Run', callback_data: 'set:trading_mode:dry_run' },
          { text: 'Confirm', callback_data: 'set:trading_mode:confirm' },
          { text: 'Live', callback_data: 'set:trading_mode:live' },
        ],
        [
          { text: 'Max Pos 1', callback_data: 'set:max_open_positions:1' },
          { text: 'Max Pos 3', callback_data: 'set:max_open_positions:3' },
          { text: 'Max Pos 5', callback_data: 'set:max_open_positions:5' },
        ],
        [
          { text: 'Batch 5', callback_data: 'set:llm_candidate_pick_count:5' },
          { text: 'Batch 10', callback_data: 'set:llm_candidate_pick_count:10' },
        ],
        [
          { text: 'Fresh 5m', callback_data: 'set:llm_candidate_max_age_ms:300000' },
          { text: 'Fresh 10m', callback_data: 'set:llm_candidate_max_age_ms:600000' },
          { text: 'Fresh 20m', callback_data: 'set:llm_candidate_max_age_ms:1200000' },
        ],
        [{ text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
}

export function navKeyboard(rows = []) {
  return {
    reply_markup: {
      inline_keyboard: [
        ...rows,
        [{ text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
}

export function mainMenuText() {
  return `🛶 <b>Charon</b>\nDry-run trench agent online.`;
}

export function walletsText() {
  const rows = savedWallets();
  if (!rows.length) return `👛 <b>Saved Wallets</b>\n\nNo saved wallets. Use /walletadd &lt;label&gt; &lt;address&gt; [smartwallet|kol]`;
  const groups = { wallet: [], smartwallet: [], kol: [] };
  for (const row of rows) (groups[row.kind || 'wallet'] || groups.wallet).push(row);
  const sections = [];
  if (groups.wallet.length) sections.push(`<b>Wallets</b>\n${groups.wallet.map(r => `• <b>${escapeHtml(r.label)}</b>: <code>${escapeHtml(r.address)}</code>`).join('\n')}`);
  if (groups.smartwallet.length) sections.push(`<b>Smart Wallets</b>\n${groups.smartwallet.map(r => `• <b>${escapeHtml(r.label)}</b>: <code>${escapeHtml(r.address)}</code>`).join('\n')}`);
  if (groups.kol.length) sections.push(`<b>KOL Wallets</b>\n${groups.kol.map(r => `• <b>${escapeHtml(r.label)}</b>: <code>${escapeHtml(r.address)}</code>`).join('\n')}`);
  return `👛 <b>Saved Wallets</b>\n\n${sections.join('\n\n')}`;
}

export function positionsText() {
  const active = openPositions();
  const lines = [
    '📍 <b>Active Positions</b>',
    '',
    `🟢 <b>Total</b>: ${active.length}`,
  ];
  const activeSection = fitPositionSection(active, formatPosition, 'No active positions.', 3000);
  lines.push(activeSection.text);
  if (activeSection.hiddenCount > 0) {
    lines.push(`<i>${activeSection.hiddenCount} active position(s) hidden to avoid Telegram message limit.</i>`);
  }
  const text = lines.join('\n');
  if (text.length <= TELEGRAM_MESSAGE_SAFE_LIMIT) return text;
  return `${text.slice(0, TELEGRAM_MESSAGE_SAFE_LIMIT - 80)}\n\n<i>Output truncated to fit Telegram limit.</i>`;
}

export function historyTradeText() {
  const inactive = inactivePositions(20);
  const inactiveCount = inactivePositionCount();
  const lines = [
    '📚 <b>Trade History</b>',
    '',
    `⚪ <b>Closed Positions</b>: ${inactiveCount}`,
  ];
  const inactiveSection = fitPositionSection(inactive, formatPosition, 'No trade history yet.', 3000);
  lines.push(inactiveSection.text);
  if (inactiveSection.hiddenCount > 0) {
    lines.push(`<i>${inactiveSection.hiddenCount} closed position(s) hidden to avoid Telegram message limit.</i>`);
  }
  const text = lines.join('\n');
  if (text.length <= TELEGRAM_MESSAGE_SAFE_LIMIT) return text;
  return `${text.slice(0, TELEGRAM_MESSAGE_SAFE_LIMIT - 80)}\n\n<i>Output truncated to fit Telegram limit.</i>`;
}

export function positionsKeyboard() {
  const active = openPositions().slice(0, 10);
  const keyboard = [];
  for (const position of active) {
    const label = position.symbol || short(position.mint);
    keyboard.push([
      { text: `View #${position.id} ${label}`, callback_data: `pos:${position.id}` },
      { text: `Manual Sell #${position.id}`, callback_data: `sell:${position.id}` },
    ]);
  }
  keyboard.push([
    { text: 'Refresh', callback_data: 'menu:positions' },
    { text: 'History Trade', callback_data: 'menu:historytrade' },
  ]);
  keyboard.push([{ text: 'Back', callback_data: 'menu:main' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
}

export function historyTradeKeyboard() {
  const inactive = inactivePositions(10);
  const keyboard = [];
  for (const position of inactive) {
    const label = position.symbol || short(position.mint);
    keyboard.push([{ text: `View closed #${position.id} ${label}`, callback_data: `pos:${position.id}` }]);
  }
  keyboard.push([
    { text: 'Refresh', callback_data: 'menu:historytrade' },
    { text: 'Active Positions', callback_data: 'menu:positions' },
  ]);
  keyboard.push([{ text: 'Back', callback_data: 'menu:main' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
}

export function strategyMenuText() {
  const strat = activeStrategy();
  const all = allStrategies();
  const entryIcons = { immediate: '⚡', wait_for_dip: '📉', after_confirmation: '🧠' };
  return [
    '🎯 <b>Strategy</b>',
    '',
    `Active: <b>${escapeHtml(strat.name)}</b>`,
    `Entry: ${entryIcons[strat.entry_mode] || '?'} ${strat.entry_mode}`,
    `Min sources: ${strat.min_source_count}`,
    `Fee required: ${strat.require_fee_claim ? 'yes' : 'no'}`,
    `Size: ${fmtSol(strat.position_size_sol)} SOL`,
    `TP/SL: ${strat.profit_lock_enabled ? 'unlimited' : fmtPct(strat.tp_percent)} / ${fmtPct(strat.sl_percent)}`,
    `Trailing: ${strat.profit_lock_enabled ? 'ignored' : strat.trailing_enabled ? fmtPct(strat.trailing_percent) : 'off'}`,
    `Max positions: ${strat.max_open_positions}`,
    strat.min_holders > 0 ? `Min holders: ${strat.min_holders}` : null,
    strat.min_holder_growth_pct > 0 ? `Min holder growth: ${strat.min_holder_growth_pct}%` : null,
    strat.min_buy_sell_ratio > 0 ? `Min buy/sell ratio: ${strat.min_buy_sell_ratio}` : null,
    strat.max_ath_distance_pct < 0 ? `Max ATH distance: ${strat.max_ath_distance_pct}%` : null,
    strat.partial_tp ? `Partial TP: ${strat.partial_tp_sell_percent}% at ${fmtPct(strat.partial_tp_at_percent)}` : null,
    strat.profit_lock_enabled ? `Profit lock: ${fmtPct(strat.profit_lock_trigger_1_percent)}→${fmtPct(strat.profit_lock_floor_1_percent)}, ${fmtPct(strat.profit_lock_trigger_2_percent)}→${fmtPct(strat.profit_lock_floor_2_percent)}, ${fmtPct(strat.profit_lock_trigger_3_percent)}→max(${fmtPct(strat.profit_lock_floor_3_percent)}, high-${fmtPct(strat.profit_lock_dynamic_drawdown_percent)})` : 'Profit lock: off',
    strat.profit_lock_enabled ? 'Profit lock mode: TP unlimited, trailing ignored' : null,
    strat.max_hold_ms > 0 ? `Max hold: ${Math.round(strat.max_hold_ms / 60000)}m` : null,
    strat.use_llm ? `LLM: yes (min ${strat.llm_min_confidence}%)` : 'LLM: no (rule-based)',
    '',
    ...all.map(s => `${s.enabled ? '▶' : '○'} ${s.name}`),
  ].filter(Boolean).join('\n');
}

export function strategyKeyboard() {
  const strat = activeStrategy();
  const all = allStrategies();
  const selector = [];
  for (let i = 0; i < all.length; i += 2) {
    const left = all[i];
    const right = all[i + 1];
    const row = [{
      text: `${left.enabled ? '▶ ' : ''}${left.name}`,
      callback_data: `strategy:select:${left.id}`,
    }];
    if (right) {
      row.push({
        text: `${right.enabled ? '▶ ' : ''}${right.name}`,
        callback_data: `strategy:select:${right.id}`,
      });
    }
    selector.push(row);
  }
  const config = [
    [
      { text: `TP +${strat.tp_percent}%`, callback_data: 'stratinput:tp_percent' },
      { text: `SL ${strat.sl_percent}%`, callback_data: 'stratinput:sl_percent' },
    ],
    [
      { text: `Size ${strat.position_size_sol} SOL`, callback_data: 'stratinput:position_size_sol' },
      { text: `Max Pos ${strat.max_open_positions}`, callback_data: 'stratinput:max_open_positions' },
    ],
    [
      { text: `Min Mcap ${strat.min_mcap_usd > 0 ? fmtUsd(strat.min_mcap_usd) : 'off'}`, callback_data: 'stratinput:min_mcap_usd' },
      { text: `Max Mcap ${strat.max_mcap_usd > 0 ? fmtUsd(strat.max_mcap_usd) : 'off'}`, callback_data: 'stratinput:max_mcap_usd' },
    ],
    [
      { text: `Trail ${strat.trailing_enabled ? fmtPct(strat.trailing_percent) : 'off'}`, callback_data: 'stratinput:trailing_percent' },
      { text: `Min Src ${strat.min_source_count}`, callback_data: 'stratinput:min_source_count' },
    ],
    [
      { text: `Fee Req ${strat.require_fee_claim ? 'on' : 'off'}`, callback_data: 'stratcfg:require_fee_claim' },
      { text: `LLM ${strat.use_llm ? 'on' : 'off'}`, callback_data: 'stratcfg:use_llm' },
    ],
    [
      { text: `Min Holders ${strat.min_holders}`, callback_data: 'stratinput:min_holders' },
      { text: `Conf ${strat.llm_min_confidence}%`, callback_data: 'stratinput:llm_min_confidence' },
    ],
    [
      { text: `Partial TP ${strat.partial_tp ? 'on' : 'off'}`, callback_data: 'stratcfg:partial_tp' },
      { text: `Profit Lock ${strat.profit_lock_enabled ? 'on' : 'off'}`, callback_data: 'stratcfg:profit_lock_enabled' },
    ],
    [
      { text: `Max Hold ${strat.max_hold_ms > 0 ? Math.round(strat.max_hold_ms/60000)+'m' : 'off'}`, callback_data: 'stratinput:max_hold_ms' },
      { text: `PL T1 ${strat.profit_lock_trigger_1_percent}%`, callback_data: 'stratinput:profit_lock_trigger_1_percent' },
    ],
    [
      { text: `Claim Fee ${fmtSol(strat.min_fee_claim_sol)} SOL`, callback_data: 'stratinput:min_fee_claim_sol' },
      { text: `Trading Fees ${fmtSol(strat.min_gmgn_total_fee_sol)} SOL`, callback_data: 'stratinput:min_gmgn_total_fee_sol' },
    ],
    [
      { text: `Grad Vol ${fmtUsd(strat.min_graduated_volume_usd)}`, callback_data: 'stratinput:min_graduated_volume_usd' },
      { text: `Max Holder ${strat.max_top20_holder_percent < 100 ? fmtPct(strat.max_top20_holder_percent) : 'off'}`, callback_data: 'stratinput:max_top20_holder_percent' },
    ],
    [
      { text: `Saved ${strat.min_saved_wallet_holders || 'off'}`, callback_data: 'stratinput:min_saved_wallet_holders' },
      { text: `ATH ${strat.max_ath_distance_pct < 0 ? `${strat.max_ath_distance_pct}%` : 'off'}`, callback_data: 'stratinput:max_ath_distance_pct' },
    ],
    [
      { text: `Smart ${strat.min_smart_wallet_holders || 'off'}`, callback_data: 'stratinput:min_smart_wallet_holders' },
      { text: `KOL ${strat.min_kol_holders || 'off'}`, callback_data: 'stratinput:min_kol_holders' },
    ],
    [
      { text: `Age ${strat.token_age_max_ms > 0 ? Math.round(strat.token_age_max_ms / 60000) + 'm' : 'off'}`, callback_data: 'stratinput:token_age_max_ms' },
      { text: `Trend Vol ${fmtUsd(strat.trending_min_volume_usd)}`, callback_data: 'stratinput:trending_min_volume_usd' },
    ],
    [
      { text: `Trend Swaps ${strat.trending_min_swaps}`, callback_data: 'stratinput:trending_min_swaps' },
      { text: `Max Rug ${fmtPct(strat.trending_max_rug_ratio * 100)}`, callback_data: 'stratinput:trending_max_rug_ratio' },
    ],
    [
      { text: `Min Holder Growth ${strat.min_holder_growth_pct ? `${strat.min_holder_growth_pct}%` : 'off'}`, callback_data: 'stratinput:min_holder_growth_pct' },
      { text: `Min B/S Ratio ${strat.min_buy_sell_ratio || 'off'}`, callback_data: 'stratinput:min_buy_sell_ratio' },
    ],
    [
      { text: `Max Bundler ${fmtPct(strat.trending_max_bundler_rate * 100)}`, callback_data: 'stratinput:trending_max_bundler_rate' },
      { text: `Partial Sell ${strat.partial_tp_sell_percent}%`, callback_data: 'stratinput:partial_tp_sell_percent' },
    ],
    [
      { text: `Partial At ${strat.partial_tp_at_percent}%`, callback_data: 'stratinput:partial_tp_at_percent' },
      { text: `PL F1 ${strat.profit_lock_floor_1_percent}%`, callback_data: 'stratinput:profit_lock_floor_1_percent' },
    ],
    [
      { text: `PL T2 ${strat.profit_lock_trigger_2_percent}%`, callback_data: 'stratinput:profit_lock_trigger_2_percent' },
      { text: `PL F2 ${strat.profit_lock_floor_2_percent}%`, callback_data: 'stratinput:profit_lock_floor_2_percent' },
    ],
    [
      { text: `PL T3 ${strat.profit_lock_trigger_3_percent}%`, callback_data: 'stratinput:profit_lock_trigger_3_percent' },
      { text: `PL F3 ${strat.profit_lock_floor_3_percent}%`, callback_data: 'stratinput:profit_lock_floor_3_percent' },
    ],
    [
      { text: `PL Drawdown ${strat.profit_lock_dynamic_drawdown_percent}%`, callback_data: 'stratinput:profit_lock_dynamic_drawdown_percent' },
    ],
  ];
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '── Select Strategy ──', callback_data: 'noop' }],
        ...selector,
        [{ text: '── Configure ──', callback_data: 'noop' }],
        ...config,
        [{ text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
}

export function candidateButtons(candidateId, decision = null) {
  const verdict = String(decision?.verdict || '').toUpperCase();
  if (verdict && verdict !== 'BUY') {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Skipped: ${verdict}`, callback_data: 'noop' }],
          [
            { text: 'View Candidate', callback_data: `cand:${candidateId}` },
            { text: 'Ignore', callback_data: `ign:${candidateId}` },
          ],
          [{ text: 'Positions', callback_data: 'menu:positions' }],
        ],
      },
    };
  }
  if (verdict === 'BUY') {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'LLM BUY selected', callback_data: 'noop' }],
          [
            { text: 'View Candidate', callback_data: `cand:${candidateId}` },
            { text: 'Positions', callback_data: 'menu:positions' },
          ],
          [
            { text: 'Set TP/SL', callback_data: `tpsl:c:${candidateId}` },
            { text: 'Ignore', callback_data: `ign:${candidateId}` },
          ],
        ],
      },
    };
  }
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'View Candidate', callback_data: `cand:${candidateId}` },
          { text: 'Dry Buy', callback_data: `buy:${candidateId}` },
        ],
        [
          { text: 'Set TP/SL', callback_data: `tpsl:c:${candidateId}` },
          { text: 'Ignore', callback_data: `ign:${candidateId}` },
        ],
        [{ text: 'Positions', callback_data: 'menu:positions' }],
      ],
    },
  };
}

export function batchRevealButtons(batchId, rows, decision, triggerCandidateId = null) {
  const selectedId = Number(decision.selected_candidate_id || 0);
  const triggerId = Number(triggerCandidateId || 0);
  const keyboard = [];
  if (selectedId) keyboard.push([{ text: 'Reveal Pick', callback_data: `cand:${selectedId}` }]);
  keyboard.push([{ text: 'Reveal Batch', callback_data: `batch:${batchId}` }]);
  if (triggerId && triggerId !== selectedId) keyboard.push([{ text: 'Reveal Trigger', callback_data: `cand:${triggerId}` }]);
  keyboard.push([{ text: 'Positions', callback_data: 'menu:positions' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
}

export function positionButtons(positionId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Manual Sell', callback_data: `sell:${positionId}` },
          { text: 'Refresh', callback_data: `pos:${positionId}` },
        ],
        [
          { text: 'TP +25%', callback_data: `tp:${positionId}:25` },
          { text: 'TP +50%', callback_data: `tp:${positionId}:50` },
        ],
        [
          { text: 'SL -15%', callback_data: `sl:${positionId}:-15` },
          { text: 'SL -25%', callback_data: `sl:${positionId}:-25` },
        ],
        [{ text: 'Trail On/Off', callback_data: `trail:${positionId}` }],
      ],
    },
  };
}

export function intentButtons(intentId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Confirm Buy', callback_data: `intent:${intentId}:confirm` },
          { text: 'Reject', callback_data: `intent:${intentId}:reject` },
        ],
        [{ text: 'Positions', callback_data: 'menu:positions' }],
      ],
    },
  };
}

export async function sendTpSlDefaults(chatId, query = null) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Default TP +25%', callback_data: 'set:default_tp_percent:25' },
          { text: 'Default TP +50%', callback_data: 'set:default_tp_percent:50' },
        ],
        [
          { text: 'Default SL -15%', callback_data: 'set:default_sl_percent:-15' },
          { text: 'Default SL -25%', callback_data: 'set:default_sl_percent:-25' },
        ],
        [
          { text: 'Trail On', callback_data: 'set:default_trailing_enabled:true' },
          { text: 'Trail Off', callback_data: 'set:default_trailing_enabled:false' },
        ],
        [{ text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
  if (query) return editMenuMessage(query, agentText(), keyboard);
  const { bot } = await import('./bot.js');
  await bot.sendMessage(chatId, agentText(), { parse_mode: 'HTML', ...keyboard });
}

export function topPnlText(orderBy = 'pnl_percent', mode = 'all', window = '30d') {
  const windowMap = { '7d': 7 * 24 * 3600000, '30d': 30 * 24 * 3600000, 'all': 0 };
  const windowMs = windowMap[window] ?? 30 * 24 * 3600000;
  const positions = topPerformingPositions({ limit: 10, mode, orderBy, windowMs });
  const stratRows = pnlByStrategy({ mode, windowMs });
  const orderLabels = { pnl_percent: 'PnL %', pnl_sol: 'PnL SOL', closed_at_ms: 'Recent' };
  const modeLabel = mode === 'all' ? 'All Modes' : mode === 'dry_run' ? 'Dry-run' : 'Live';

  const lines = [`🏆 <b>Top Performance PnL</b>`, `${modeLabel} · Sort: ${orderLabels[orderBy] || orderBy} · Window: ${window}`, ''];

  if (positions.length) {
    lines.push('<b>Top Positions</b>');
    for (const p of positions) {
      const sym = escapeHtml(p.symbol || short(p.mint));
      const pnlPct = fmtPct(p.pnl_percent ?? 0);
      const pnlSol = p.pnl_sol != null ? ` (${p.pnl_sol >= 0 ? '+' : ''}${Number(p.pnl_sol).toFixed(4)} SOL)` : '';
      lines.push(`• <b>${sym}</b> ${pnlPct}${pnlSol}`);
    }
  } else {
    lines.push('No closed positions yet.');
  }

  if (stratRows.length) {
    lines.push('', '<b>By Strategy</b>');
    for (const s of stratRows) {
      const wr = s.total > 0 ? Math.round((s.wins / s.total) * 100) : 0;
      const sign = s.total_pnl_sol >= 0 ? '+' : '';
      lines.push(`• <b>${escapeHtml(s.strategy)}</b>: ${s.total} trades · WR ${wr}% · ${sign}${Number(s.total_pnl_sol).toFixed(4)} SOL`);
    }
  }

  return lines.join('\n');
}

export function topPnlKeyboard(orderBy = 'pnl_percent', mode = 'all', window = '30d') {
  const modes = ['all', 'dry_run', 'live'];
  const orders = ['pnl_percent', 'pnl_sol', 'closed_at_ms'];
  const windows = ['7d', '30d', 'all'];
  return {
    reply_markup: {
      inline_keyboard: [
        modes.map(m => ({ text: `${m === mode ? '▶ ' : ''}${m === 'dry_run' ? 'Dry' : m === 'live' ? 'Live' : 'All'}`, callback_data: `toppnl:${orderBy}:${m}:${window}` })),
        orders.map(o => ({ text: `${o === orderBy ? '▶ ' : ''}${o === 'pnl_percent' ? 'PnL%' : o === 'pnl_sol' ? 'SOL' : 'Recent'}`, callback_data: `toppnl:${o}:${mode}:${window}` })),
        windows.map(w => ({ text: `${w === window ? '▶ ' : ''}${w}`, callback_data: `toppnl:${orderBy}:${mode}:${w}` })),
        [{ text: 'Back to PnL', callback_data: 'menu:pnl' }, { text: 'Back', callback_data: 'menu:main' }],
      ],
    },
  };
}

async function editMenuMessage(query, text, extra = {}) {
  const { TELEGRAM_CHAT_ID } = await import('../config.js');
  const chatId = query.message?.chat?.id || TELEGRAM_CHAT_ID;
  const messageId = query.message?.message_id;
  const { bot } = await import('./bot.js');
  if (!messageId) {
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }
  try {
    return await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (err) {
    if (/message is not modified/i.test(err.message)) return null;
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }
}
