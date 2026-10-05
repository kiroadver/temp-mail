# Status pengujian dan daftar penerimaan

## Yang benar-benar dijalankan saat penyerahan

**16 pemeriksaan statis lulus:**

1. ID HTML tidak duplikat.
2. Seluruh ID literal yang dirujuk JavaScript tersedia pada HTML.
3. Seluruh aset lokal yang dirujuk HTML tersedia.
4. Seluruh simbol SVG yang dipakai tersedia.
5. Iframe email memiliki sandbox tanpa izin.
6. `package.json` merupakan JSON valid dan postal-mime dipatok ke 2.4.3.
7. `wrangler.toml` valid dan cron dikonfigurasi setiap lima menit.
8. Mode demo nonaktif pada konfigurasi produksi bawaan.
9. Fixture email mencakup Message-ID, MIME, dan OTP.
10. Kolom skema PRD tercantum.
11. Query mailbox mencakup alamat, hash token, dan masa berlaku.
12. Query detail mencakup ID, alamat, dan masa berlaku.
13. Query pemangkasan jumlah email dibatasi alamat.
14. HTML tidak memuat JavaScript pihak ketiga.
15. CSP dan header nosniff tercantum.
16. Empat pasangan warna teks/aksen utama memiliki rasio kontras minimal 4.5:1: 4.79, 6.30, 7.82, 8.66.

Validasi statis **bukan** bukti bahwa seluruh alur runtime sudah lulus, dan bukan audit keamanan atau WCAG lengkap. Keberadaan `postal-mime@2.4.3` juga diperiksa pada registry npm.

## Belum dijalankan di lingkungan penyiapan

VM tidak dapat disediakan karena batas kapasitas proyek. Runtime yang tersedia tidak memiliki Node, browser pengujian, atau modul SQLite.

- `npm install`, `npm run check`, dan `npm test`.
- Eksekusi SQLite/D1 serta pengujian adapter SQLite.
- `wrangler deploy --dry-run` dan deployment nyata.
- Pengujian browser/Playwright, ukuran viewport, clipboard, dialog, hash routing, dan screenshot visual.
- Email end-to-end melalui SMTP/Cloudflare, latensi, dan eksekusi Cron produksi.

Jangan menganggap daftar ini sudah lulus hanya karena kodenya disertakan. Jalankan perintah di bawah dan selesaikan checklist sebelum layanan dibuka ke publik.

## Pengujian otomatis yang disertakan

```bash
npm install
npm run check
npm test
npm run build:worker
```

Butuh Node ≥22.16. Pengujian memakai `node:test`, `node:assert/strict`, dan `node:sqlite`; tidak membutuhkan kredensial Cloudflare.

### `tests/extract.test.js` — 12 pengujian

OTP numerik dan alfanumerik, prioritas keyword, tidak mengambil angka URL/tahun, fallback HTML, deduplikasi, entitas, urutan link, protokol aman, bentuk atribut href, dan batas input panjang.

### `tests/worker.test.js` — 9 pengujian

Validasi alamat; config/CORS/preflight; pembuatan dan konflik mailbox; token hanya disimpan sebagai hash; isolasi mailbox; parsing MIME; read/delete; penolakan penerima dan ukuran; jumlah email; expiry; Cron; rate limiting; metode unsupported dan JSON rusak.

Adapter SQLite meniru operasi D1 menggunakan SQLite lokal. Ini menguji logika dan SQL, **bukan** semua karakteristik Cloudflare D1/workerd, limits, distributed execution, atau deployment.

### CI

Workflow GitHub Actions menjalankan perintah tersebut pada push/PR. Setelah `npm install` pertama menghasilkan lockfile, commit `package-lock.json`; Anda dapat mengganti langkah instalasi CI menjadi `npm ci` agar reproducible.

## Checklist browser dan backend

Jalankan terhadap mode API lokal, lalu ulangi yang relevan terhadap produksi. Mode demo saja tidak menguji Worker.

- [ ] Saat halaman dibuka pertama kali, POST mailbox berhasil dan alamat acak tampil.
- [ ] Refresh halaman mempertahankan alamat dan token.
- [ ] Alamat custom 3–32 karakter diterima; domain luar/karakter berbahaya ditolak.
- [ ] Nama custom yang sedang dipakai mendapat 409 tanpa membocorkan isi mailbox.
- [ ] Ganti alamat menampilkan konfirmasi dan tidak menampilkan pesan alamat lama.
- [ ] Tombol salin alamat, OTP, dan link bekerja di HTTPS/localhost.
- [ ] Email fixture tampil setelah handler berhasil; polling 7 detik.
- [ ] Pengirim/subjek/preview yang mengandung `<script>` hanya menjadi teks.
- [ ] Badge belum dibaca turun ketika detail dibuka; status bertahan setelah reload.
- [ ] Tombol Kembali, browser Back/Forward, dan refresh pada hash detail bekerja.
- [ ] Buka pesan cepat-bergantian tidak menampilkan isi pesan yang keliru.
- [ ] Email tanpa subjek/nama/HTML tetap dapat dibaca.
- [ ] HTML dengan event handler, iframe, SVG, form, meta refresh, remote image, dan tracking pixel tidak menjalankan kode atau request jaringan.
- [ ] Periksa tab Network ketika membuka pesan berbahaya: tidak ada request ke domain pengirim/pelacak.
- [ ] Kartu link hanya http(s), rel noopener noreferrer, domain terlihat, teks panjang terpotong secara visual.
- [ ] Tema mengikuti sistem sebelum pilihan manual, lalu tersimpan setelah refresh.
- [ ] Modal dapat ditutup dengan Escape, tombol fokus jelas, urutan Tab masuk akal.
- [ ] Screen reader mengumumkan email baru tanpa membaca ulang seluruh daftar setiap polling.
- [ ] Layout pada lebar 360, 390, 768, dan 1440 px tidak meluber; uji nama/subjek/alamat panjang.
- [ ] Hapus satu dan hapus semua perlu konfirmasi dan tidak memengaruhi mailbox lain.
- [ ] Request tanpa token mendapat 401; token mailbox B tidak membaca/menghapus mailbox A.
- [ ] Request dari Origin luar allowlist ditolak; OPTIONS pada origin valid berhasil.
- [ ] Offline, timeout, token kedaluwarsa, 429, dan 500 memberikan pesan error yang dapat dipahami.
- [ ] Raw email di atas batas ditolak, lampiran tidak tersimpan.
- [ ] Email ke alamat belum terdaftar ditolak.
- [ ] Email lebih dari batas jumlah memangkas pesan terlama pada alamat itu saja.
- [ ] Email kedaluwarsa segera hilang dari API walaupun cron belum berjalan.
- [ ] Cron menghapus email/mailbox/rate bucket kedaluwarsa.
- [ ] Banner demo tidak tampil pada deployment produksi.
- [ ] Tidak ada API token Cloudflare atau data nyata dalam repository.

## Menguji expiry tanpa menunggu 24 jam

Gunakan **database lokal**, bukan produksi:

```bash
npx wrangler d1 execute temp-mail-db --local --command "UPDATE emails SET expires_at = 0"
```

Refresh inbox: pesan tidak boleh tampil. Jalankan simulasi cron seperti di README lalu periksa tabel lokal:

```bash
npx wrangler d1 execute temp-mail-db --local --command "SELECT COUNT(1) AS jumlah FROM emails"
```

## Mengukur latensi

Catat waktu email tersimpan (`received_at`) dan waktu pertama terlihat pada polling. Gunakan beberapa sampel di jaringan normal pada tab aktif. Ini mengukur latensi aplikasi, bukan total antrean SMTP sejak pengirim menekan Kirim. Laporkan kedua angka secara terpisah bila mengukur end-to-end.

## Batas penilaian

Kode ini adalah implementasi awal yang perlu diuji pada akun Cloudflare Anda. Sebelum dipakai layanan publik berskala besar, lakukan review keamanan independen, load test, pengetesan abuse/rate limit, penganggaran biaya, serta tinjauan kebijakan privasi dan retensi.