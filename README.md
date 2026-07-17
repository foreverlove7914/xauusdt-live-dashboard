# XAUT/USDT Perpetual — Signal Terminal

Dashboard real-time untuk XAUT/USDT Perpetual (Tether Gold), gaya TradingView, dengan:

- **Chart live** — widget TradingView terus (`BINANCE:XAUTUSDT`, boleh tukar exchange/timeframe dalam chart itu sendiri)
- **Entry Utama** — arah trend + isyarat "sharp" (EMA9/EMA21 crossover baru + RSI confluence + badan candle kuat)
- **Re-Entry** — isyarat sambungan bila harga pullback ke zon EMA9 dan trend masih utuh
- **Stop Loss** — dikira automatik untuk setiap jenis entry (berdasarkan ATR14 + swing low/high terkini)
- **Skor Sharpness (0–100)** — gauge keyakinan confluence untuk setiap isyarat
- **Log isyarat** — 12 isyarat terkini dengan masa, jenis dan harga

Data harga: `fapi.binance.com` (Binance Futures public API, XAUTUSDT), refresh setiap 20 saat.

## Cara guna

1. Buka `index.html` terus dalam browser — tiada build step, tiada server diperlukan.
2. Atau host melalui **GitHub Pages**:
   ```bash
   git init
   git add .
   git commit -m "XAUT/USDT signal terminal"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
   Kemudian aktifkan GitHub Pages dalam repo Settings → Pages → pilih branch `main` / root.

## Logik isyarat (ringkas)

| Isyarat | Syarat |
|---|---|
| Entry Sharp BUY | EMA9 baru cross atas EMA21 (≤3 candle) + RSI14 > 55 + badan candle > 0.25×ATR |
| Entry Sharp SELL | EMA9 baru cross bawah EMA21 (≤3 candle) + RSI14 < 45 + badan candle > 0.25×ATR |
| Re-entry BUY | Trend naik utuh + harga pullback dekat EMA9 (±0.25×ATR) + candle confirm naik + RSI > 55 |
| Re-entry SELL | Trend turun utuh + harga pullback dekat EMA9 (±0.25×ATR) + candle confirm turun + RSI < 45 |
| SL Entry | min(low 5 candle, EMA21 − 0.5×ATR) untuk BUY / max(high 5 candle, EMA21 + 0.5×ATR) untuk SELL |
| SL Re-entry | swing low/high 3 candle ± 0.3×ATR |

Semua parameter (period EMA/RSI/ATR, ambang confluence) ada dalam `<script>` di `index.html` — boleh ubah suai ikut gaya trading anda.

## ⚠️ Penting

Ini alat bantu analisis teknikal, **bukan nasihat kewangan**. Perdagangan leverage/perpetual berisiko tinggi. Sentiasa sahkan isyarat dengan timeframe lain, konteks fundamental, dan urus risiko (position sizing, max drawdown) sebelum membuka posisi.
