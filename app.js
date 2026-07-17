/* =========================================================================
   XAU/USDT PERPETUAL — LIVE SIGNAL DASHBOARD
   Data source : Binance USDⓈ-M Futures (fapi / fstream) — symbol XAUUSDT
   Strategy    : Gabungan EMA trend filter + RSI momentum + Volume
                 confirmation + Price-action breakout (sharp entry),
                 dengan pullback re-entry dan stop loss berasaskan
                 swing point / ATR.
   NOTE: Alat pendidikan / analisis teknikal — bukan nasihat kewangan.
   ========================================================================= */

const SYMBOL = 'XAUUSDT';
const REST_BASE = 'https://fapi.binance.com';
const WS_BASE = 'wss://fstream.binance.com/ws';

const CFG = {
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  volMaPeriod: 20,
  swingLookback: 20,      // window used to find recent swing high/low
  swingExclude: 2,        // exclude the most recent N candles (not yet confirmed)
  volConfirmMult: 1.1,    // volume must exceed VolMA * this
  rsiOverbought: 70,
  rsiOversold: 30,
  reentryPullbackATR: 1.0,  // how close price must pull back to EMA21 (in ATR)
  reentryCooldownBars: 3,   // min bars between re-entries
  rrTarget: 2,               // risk:reward for suggested TP
  slAtrMult: 1.5
};

let state = {
  timeframe: '1m',
  candles: [],          // {time(sec), open, high, low, close, volume}
  chart: null, candleSeries: null, volumeSeries: null,
  rsiChart: null, rsiSeries: null,
  ema9Series: null, ema21Series: null, ema50Series: null,
  ws: null,
  position: null,       // null | {side:'long'|'short', entry, sl, tp, barIndex}
  lastReentryBar: -999,
  signals: [],
  markers: []
};

/* ----------------------------- INDICATORS ------------------------------ */

function ema(values, period, prevEma) {
  const k = 2 / (period + 1);
  if (prevEma === undefined || prevEma === null) {
    // seed with SMA of first `period` values (caller handles indexing)
    return values;
  }
  return values * k + prevEma * (1 - k);
}

function computeEmaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i];
  sma /= period;
  out[period - 1] = sma;
  let prev = sma;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function computeRsiSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = 100 - (100 / (1 + (avgLoss === 0 ? 999 : avgGain / avgLoss)));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 999 : avgGain / avgLoss;
    out[i] = 100 - (100 / (1 + rs));
  }
  return out;
}

function computeAtrSeries(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  let prevAtr = sum / period;
  out[period] = prevAtr;
  for (let i = period + 1; i < candles.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trs[i]) / period;
    out[i] = prevAtr;
  }
  return out;
}

function swingHighLow(candles, uptoIndex) {
  const start = Math.max(0, uptoIndex - CFG.swingLookback);
  const end = uptoIndex - CFG.swingExclude; // exclude most recent bars
  if (end <= start) return { high: null, low: null };
  let hi = -Infinity, lo = Infinity;
  for (let i = start; i <= end; i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  return { high: hi, low: lo };
}

/* ------------------------------- SIGNAL ENGINE -------------------------- */

function evaluateSignal() {
  const candles = state.candles;
  const n = candles.length;
  if (n < CFG.emaTrend + 5) return;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const emaFastArr = computeEmaSeries(closes, CFG.emaFast);
  const emaSlowArr = computeEmaSeries(closes, CFG.emaSlow);
  const emaTrendArr = computeEmaSeries(closes, CFG.emaTrend);
  const rsiArr = computeRsiSeries(closes, CFG.rsiPeriod);
  const atrArr = computeAtrSeries(candles, CFG.atrPeriod);

  const i = n - 1; // last CLOSED candle
  const iPrev = n - 2;

  const ef = emaFastArr[i], es = emaSlowArr[i], et = emaTrendArr[i];
  const efP = emaFastArr[iPrev], esP = emaSlowArr[iPrev];
  const rsi = rsiArr[i], rsiP = rsiArr[iPrev];
  const atr = atrArr[i];
  const vol = volumes[i];

  if ([ef, es, et, efP, esP, rsi, rsiP, atr].some(v => v === null || v === undefined || isNaN(v))) return;

  // volume MA
  let volMa = null;
  if (i >= CFG.volMaPeriod) {
    let s = 0;
    for (let k = i - CFG.volMaPeriod + 1; k <= i; k++) s += volumes[k];
    volMa = s / CFG.volMaPeriod;
  }
  if (volMa === null) return;

  const { high: swingHigh, low: swingLow } = swingHighLow(candles, i);
  if (swingHigh === null || swingLow === null) return;

  const close = candles[i].close;
  const uptrend = ef > es && es > et;
  const downtrend = ef < es && es < et;
  const volConfirm = vol > volMa * CFG.volConfirmMult;
  const rsiCrossUp = rsiP <= 50 && rsi > 50 && rsi < CFG.rsiOverbought;
  const rsiCrossDown = rsiP >= 50 && rsi < 50 && rsi > CFG.rsiOversold;
  const breakoutUp = close > swingHigh;
  const breakoutDown = close < swingLow;

  const barTime = candles[i].time;

  // ---- Manage existing position: SL hit / trend flip exit ----
  if (state.position) {
    const pos = state.position;
    if (pos.side === 'long') {
      if (close <= pos.sl) {
        logSignal('exit', `SL HIT (long) @ ${fmt(close)}`, barTime, close);
        state.position = null;
      } else if (!uptrend) {
        logSignal('exit', `Trend flip — tutup LONG @ ${fmt(close)}`, barTime, close);
        state.position = null;
      }
    } else if (pos.side === 'short') {
      if (close >= pos.sl) {
        logSignal('exit', `SL HIT (short) @ ${fmt(close)}`, barTime, close);
        state.position = null;
      } else if (!downtrend) {
        logSignal('exit', `Trend flip — tutup SHORT @ ${fmt(close)}`, barTime, close);
        state.position = null;
      }
    }
  }

  // ---- SHARP ENTRY (fresh signal, no open position) ----
  if (!state.position) {
    if (uptrend && rsiCrossUp && volConfirm && breakoutUp) {
      const sl = Math.min(swingLow, close - CFG.slAtrMult * atr);
      const tp = close + CFG.rrTarget * (close - sl);
      openPosition('long', close, sl, tp, i, barTime, 'BUY — Sharp Entry');
    } else if (downtrend && rsiCrossDown && volConfirm && breakoutDown) {
      const sl = Math.max(swingHigh, close + CFG.slAtrMult * atr);
      const tp = close - CFG.rrTarget * (sl - close);
      openPosition('short', close, sl, tp, i, barTime, 'SELL — Sharp Entry');
    }
    return;
  }

  // ---- RE-ENTRY (pullback continuation, trend still intact) ----
  const cooldownOk = (i - state.lastReentryBar) >= CFG.reentryCooldownBars;
  if (state.position && cooldownOk) {
    const pos = state.position;
    const pullbackBand = CFG.reentryPullbackATR * atr;
    const candleUp = close > candles[i].open;
    const candleDown = close < candles[i].open;

    if (pos.side === 'long' && uptrend) {
      const nearEma21 = Math.abs(close - es) <= pullbackBand;
      const rsiRecovering = rsi > rsiP && rsi > 40 && rsi < 60;
      if (nearEma21 && rsiRecovering && candleUp) {
        const sl = Math.min(swingLow, close - CFG.slAtrMult * atr);
        const tp = close + CFG.rrTarget * (close - sl);
        state.lastReentryBar = i;
        logSignal('buy', `BUY — Re-entry (pullback EMA21) @ ${fmt(close)} · SL ${fmt(sl)} · TP ${fmt(tp)}`, barTime, close);
        addMarker(barTime, 'belowBar', '#22c55e', 'arrowUp', 'RE-BUY');
        drawStopLine(sl, 'long');
      }
    } else if (pos.side === 'short' && downtrend) {
      const nearEma21 = Math.abs(close - es) <= pullbackBand;
      const rsiRecovering = rsi < rsiP && rsi < 60 && rsi > 40;
      if (nearEma21 && rsiRecovering && candleDown) {
        const sl = Math.max(swingHigh, close + CFG.slAtrMult * atr);
        const tp = close - CFG.rrTarget * (sl - close);
        state.lastReentryBar = i;
        logSignal('sell', `SELL — Re-entry (pullback EMA21) @ ${fmt(close)} · SL ${fmt(sl)} · TP ${fmt(tp)}`, barTime, close);
        addMarker(barTime, 'aboveBar', '#ef4444', 'arrowDown', 'RE-SELL');
        drawStopLine(sl, 'short');
      }
    }
  }
}

function openPosition(side, entry, sl, tp, barIndex, barTime, label) {
  state.position = { side, entry, sl, tp, barIndex };
  state.lastReentryBar = barIndex;
  const tag = side === 'long' ? 'buy' : 'sell';
  logSignal(tag, `${label} @ ${fmt(entry)} · SL ${fmt(sl)} · TP ${fmt(tp)}`, barTime, entry);
  if (side === 'long') addMarker(barTime, 'belowBar', '#22c55e', 'arrowUp', 'BUY');
  else addMarker(barTime, 'aboveBar', '#ef4444', 'arrowDown', 'SELL');
  drawStopLine(sl, side);
  renderPositionPanel();
}

let currentSlLine = null;
function drawStopLine(price, side) {
  if (currentSlLine) {
    try { state.candleSeries.removePriceLine(currentSlLine); } catch (e) {}
  }
  currentSlLine = state.candleSeries.createPriceLine({
    price: price,
    color: side === 'long' ? '#ef4444' : '#ef4444',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: 'SL'
  });
}

function addMarker(time, position, color, shape, text) {
  state.markers.push({ time, position, color, shape, text });
  // keep sorted & unique by time+text
  state.candleSeries.setMarkers(state.markers);
}

function logSignal(type, text, barTime, price) {
  const ts = new Date(barTime * 1000).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.signals.unshift({ type, text, ts });
  state.signals = state.signals.slice(0, 50);
  renderSignalLog();
  if (type === 'exit') renderPositionPanel();
}

function fmt(v) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* -------------------------------- RENDER UI ----------------------------- */

function renderSignalLog() {
  const el = document.getElementById('signalLog');
  if (state.signals.length === 0) {
    el.innerHTML = '<div class="log-empty">Isyarat akan dipaparkan di sini secara live.</div>';
    return;
  }
  el.innerHTML = state.signals.map(s => {
    const cls = s.type === 'buy' ? 'buy' : s.type === 'sell' ? 'sell' : 'exit';
    const tag = s.type === 'buy' ? 'BUY' : s.type === 'sell' ? 'SELL' : 'EXIT';
    return `<div class="log-item ${cls}"><span class="ts">${s.ts}</span><span class="tag">${tag}</span> ${s.text}</div>`;
  }).join('');
}

function renderPositionPanel() {
  const el = document.getElementById('positionBody');
  const pos = state.position;
  if (!pos) {
    el.innerHTML = '<div class="pos-empty">Tiada kedudukan aktif — menunggu isyarat sharp entry.</div>';
    return;
  }
  const rr = pos.side === 'long'
    ? ((pos.tp - pos.entry) / (pos.entry - pos.sl)).toFixed(2)
    : ((pos.entry - pos.tp) / (pos.sl - pos.entry)).toFixed(2);
  el.innerHTML = `
    <div class="pos-row"><span>Arah</span><span class="pos-side ${pos.side}">${pos.side === 'long' ? 'LONG / BUY' : 'SHORT / SELL'}</span></div>
    <div class="pos-row"><span>Entry</span><span>${fmt(pos.entry)}</span></div>
    <div class="pos-row"><span>Stop Loss</span><span>${fmt(pos.sl)}</span></div>
    <div class="pos-row"><span>Take Profit</span><span>${fmt(pos.tp)}</span></div>
    <div class="pos-row"><span>Risk:Reward</span><span>1 : ${rr}</span></div>
  `;
}

/* -------------------------------- DATA FEED ------------------------------ */

async function fetchInitialCandles(interval) {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${SYMBOL}&interval=${interval}&limit=500`;
  const res = await fetch(url);
  const raw = await res.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

function setChartData() {
  const candleData = state.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  const volumeData = state.candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' }));
  state.candleSeries.setData(candleData);
  state.volumeSeries.setData(volumeData);

  const closes = state.candles.map(c => c.close);
  const e9 = computeEmaSeries(closes, CFG.emaFast);
  const e21 = computeEmaSeries(closes, CFG.emaSlow);
  const e50 = computeEmaSeries(closes, CFG.emaTrend);
  const rsiArr = computeRsiSeries(closes, CFG.rsiPeriod);

  state.ema9Series.setData(state.candles.map((c, idx) => e9[idx] !== null ? { time: c.time, value: e9[idx] } : null).filter(Boolean));
  state.ema21Series.setData(state.candles.map((c, idx) => e21[idx] !== null ? { time: c.time, value: e21[idx] } : null).filter(Boolean));
  state.ema50Series.setData(state.candles.map((c, idx) => e50[idx] !== null ? { time: c.time, value: e50[idx] } : null).filter(Boolean));
  state.rsiSeries.setData(state.candles.map((c, idx) => rsiArr[idx] !== null ? { time: c.time, value: rsiArr[idx] } : null).filter(Boolean));
}

function updateLastBarVisual() {
  const c = state.candles[state.candles.length - 1];
  state.candleSeries.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
  state.volumeSeries.update({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' });
}

function updateTicker(price, changePct) {
  document.getElementById('lastPrice').textContent = fmt(price);
  const chEl = document.getElementById('priceChange');
  chEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  chEl.className = 'price-change ' + (changePct >= 0 ? 'up' : 'down');
}

function connectWs(interval) {
  if (state.ws) { try { state.ws.close(); } catch (e) {} }
  const streams = `${SYMBOL.toLowerCase()}@kline_${interval}/${SYMBOL.toLowerCase()}@ticker`;
  const ws = new WebSocket(`${WS_BASE}/${SYMBOL.toLowerCase()}@kline_${interval}`);
  const tickerWs = new WebSocket(`${WS_BASE}/${SYMBOL.toLowerCase()}@ticker`);

  ws.onopen = () => setWsStatus(true);
  ws.onclose = () => setWsStatus(false);
  ws.onerror = () => setWsStatus(false);

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    const k = data.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v)
    };
    const last = state.candles[state.candles.length - 1];
    if (last && last.time === candle.time) {
      state.candles[state.candles.length - 1] = candle;
    } else {
      state.candles.push(candle);
      if (state.candles.length > 600) state.candles.shift();
    }
    updateLastBarVisual();

    if (k.x) { // candle CLOSED
      setChartData();
      evaluateSignal();
    }
  };

  tickerWs.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    updateTicker(parseFloat(data.c), parseFloat(data.P));
  };

  state.ws = ws;
  state.tickerWs = tickerWs;
}

function setWsStatus(on) {
  document.getElementById('wsDot').className = 'dot ' + (on ? 'dot-on' : 'dot-off');
  document.getElementById('wsLabel').textContent = on ? 'Live' : 'Terputus';
}

/* --------------------------------- CHART SETUP --------------------------- */

function buildCharts() {
  const chartOpts = {
    layout: { background: { color: 'transparent' }, textColor: '#8a8f9c' },
    grid: { vertLines: { color: '#1c2029' }, horzLines: { color: '#1c2029' } },
    rightPriceScale: { borderColor: '#262b38' },
    timeScale: { borderColor: '#262b38', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  };

  const chartEl = document.getElementById('chart');
  state.chart = LightweightCharts.createChart(chartEl, { ...chartOpts, width: chartEl.clientWidth, height: chartEl.clientHeight });

  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444',
    borderUpColor: '#22c55e', borderDownColor: '#ef4444',
    wickUpColor: '#22c55e', wickDownColor: '#ef4444'
  });

  state.volumeSeries = state.chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  state.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  state.ema9Series = state.chart.addLineSeries({ color: '#4fc3f7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  state.ema21Series = state.chart.addLineSeries({ color: '#ffb74d', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  state.ema50Series = state.chart.addLineSeries({ color: '#ba68c8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

  const rsiEl = document.getElementById('rsiChart');
  state.rsiChart = LightweightCharts.createChart(rsiEl, { ...chartOpts, width: rsiEl.clientWidth, height: rsiEl.clientHeight });
  state.rsiSeries = state.rsiChart.addLineSeries({ color: '#d4af37', lineWidth: 1 });
  state.rsiChart.priceScale('right').applyOptions({ autoScale: false, scaleMargins: { top: 0.1, bottom: 0.1 } });
  // draw 30/70 reference via a second thin series would need more data; skip for simplicity

  state.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    state.rsiChart.timeScale().setVisibleLogicalRange(range);
  });

  window.addEventListener('resize', () => {
    state.chart.resize(chartEl.clientWidth, chartEl.clientHeight);
    state.rsiChart.resize(rsiEl.clientWidth, rsiEl.clientHeight);
  });
}

/* ---------------------------------- BOOT ---------------------------------- */

async function loadTimeframe(interval) {
  state.timeframe = interval;
  state.candles = await fetchInitialCandles(interval);
  state.markers = [];
  state.position = null;
  state.lastReentryBar = -999;
  renderPositionPanel();
  setChartData();
  evaluateSignal();
  connectWs(interval);
}

document.getElementById('tfGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.tf-btn');
  if (!btn) return;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadTimeframe(btn.dataset.tf);
});

buildCharts();
loadTimeframe(state.timeframe);
