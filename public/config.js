/**
 * Produksi: ganti apiBase dengan URL Worker HTTPS, tanpa slash terakhir.
 * Nilai localhost hanya untuk pengembangan dengan `npm run dev`.
 * Tidak ada secret Cloudflare ataupun token kotak masuk di file ini.
 */
window.TEMPMAIL_CONFIG = {
  apiBase: "http://localhost:8787",
  demo: false
};