# XAU/USDT Perpetual — Live Signal Dashboard

Dashboard real-time gaya TradingView untuk **XAU/USDT Perpetual (Binance Futures)**, dengan isyarat **sharp entry buy/sell**, **re-entry buy/sell**, dan **stop loss** automatik.

100% front-end (HTML/CSS/JS) — tiada backend/server diperlukan. Data diambil terus dari **Binance Futures API** (`fapi.binance.com` + WebSocket `fstream.binance.com`) dari dalam pelayar pengguna.

> ⚠️ **Disclaimer**: Alat ini untuk tujuan pendidikan dan analisis teknikal sahaja. Ia **bukan nasihat kewangan**. Trading perpetual/leverage berisiko tinggi terhadap modal anda — buat keputusan berdasarkan penilaian dan pengurusan risiko anda sendiri.

## Ciri-ciri

- **Chart candlestick live** (Binance TradingView Lightweight Charts) + volume + EMA 9/21/50
- **RSI(14)** panel berasingan
- **Sharp entry signal** (gabungan strategi):
  1. Trend filter — EMA9 > EMA21 > EMA50 (uptrend) atau sebaliknya
  2. Momentum — RSI melintas paras 50
  3. Konfirmasi volume — volume semasa > Volume MA(20)
  4. Pencetus — breakout swing high/low terkini (price action)
- **Re-entry signal** — apabila harga *pullback* ke EMA21 dalam trend yang sama dan RSI reset/pulih, sistem cadangkan re-entry mengikut arah trend
- **Stop loss automatik** — swing low/high terkini atau 1.5× ATR(14), mana yang lebih konservatif
- **Take profit cadangan** — nisbah risk:reward 1:2 (boleh ubah)
- **Log isyarat live** + panel kedudukan semasa (entry/SL/TP/RR)
- Pilihan timeframe: 1m / 5m / 15m / 1h

## Fail dalam repo

```
xau-dashboard/
├── index.html   # struktur & layout dashboard
├── style.css    # tema gelap + aksen emas
├── app.js       # data feed Binance, semua logik indicator & isyarat
└── README.md
```

## Jalankan secara tempatan

Tiada build step. Buka terus `index.html` dalam pelayar, ATAU (disyorkan, elak isu CORS/file://) jalankan local server ringkas:

```bash
python3 -m http.server 8000
# lawati http://localhost:8000
```

## Push ke GitHub

```bash
cd xau-dashboard
git init
git add .
git commit -m "Init: XAU/USDT live signal dashboard"
git branch -M main
git remote add origin https://github.com/<username>/<nama-repo>.git
git push -u origin main
```

## Deploy percuma dengan GitHub Pages

1. Push repo seperti di atas.
2. Di GitHub → repo anda → **Settings → Pages**.
3. Under **Build and deployment**, pilih source **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Simpan — dashboard akan live di `https://<username>.github.io/<nama-repo>/` dalam beberapa minit.

## Tala semula strategi (`app.js` → objek `CFG`)

| Parameter | Kegunaan | Default |
|---|---|---|
| `emaFast` / `emaSlow` / `emaTrend` | Trend filter | 9 / 21 / 50 |
| `rsiPeriod` | Momentum | 14 |
| `volConfirmMult` | Ambang konfirmasi volume | 1.1× |
| `swingLookback` | Julang cari swing high/low | 20 bar |
| `slAtrMult` | Jarak stop loss (ATR) | 1.5× |
| `rrTarget` | Nisbah risk:reward untuk TP | 1:2 |
| `reentryPullbackATR` | Jarak pullback dibenarkan untuk re-entry | 1.0× ATR |
| `reentryCooldownBars` | Bar minimum antara re-entry | 3 |

## Nota teknikal

- Simbol Binance Futures untuk emas ialah **`XAUUSDT`** (TradFi Perpetual, settle dalam USDT, ±3% deviation band semasa off-hours).
- Jika Binance sekat akses IP tertentu (contoh rantau tersekat), pertimbangkan proksi/VPN yang dibenarkan atau tukar kepada exchange lain (Bybit/OKX) — struktur `app.js` mudah diubah suai (tukar `REST_BASE`, `WS_BASE`, dan format kline).
- Semua pengiraan (EMA/RSI/ATR/swing) dilakukan di sisi klien (client-side) setiap kali candle baru **ditutup**, bukan setiap tick, supaya isyarat tidak "repaint" berulang kali dalam satu candle.
