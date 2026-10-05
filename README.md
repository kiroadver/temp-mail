# Singgah — Email sebentar, tenang lebih lama.

Aplikasi email sementara berbahasa Indonesia: **Cloudflare Pages + Workers + Email Routing + D1**. Frontend HTML, CSS, dan JavaScript murni, tanpa framework atau build frontend.

> **Status penyerahan:** kode lengkap, bukan layanan email yang sudah di-deploy. Isi konfigurasi domain/D1/URL terlebih dahulu. Pratinjau memakai data contoh, bukan email sungguhan. Validasi statis sudah dijalankan. Pengujian Node, SQLite, browser, bundling Wrangler, dan penerimaan email Cloudflare belum dijalankan di lingkungan penyiapan; langkahnya tersedia di `TESTING.md`.

## 1. Yang tersedia

- Alamat acak otomatis dan alamat custom, salin alamat, ganti alamat.
- Kotak masuk, jumlah belum dibaca, pembaruan otomatis setiap 7 detik, refresh manual.
- Detail pesan, status dibaca tersimpan di D1, tombol kembali dan browser Back.
- Deteksi OTP 4–8 karakter dan prioritas link verifikasi.
- HTML email dibangun ulang dengan daftar tag yang diizinkan lalu ditampilkan dalam iframe sandbox; fallback teks.
- Tema terang/gelap yang mengikuti sistem, tersimpan, diterapkan sebelum render.
- Responsif, indikator memuat, empty state, fokus keyboard, live announcement, toast.
- Masa hidup email 24 jam, maksimum 50 pesan per alamat, batas raw email 1 MiB, cron setiap 5 menit.
- Token kepemilikan kotak masuk tanpa akun; rate limit sederhana dan allowlist CORS.
- Demo interaktif terpisah, pengujian Node, contoh email, dan GitHub Actions.

**Tidak tersedia:** mengirim/meneruskan email, login, pemulihan kotak masuk, lampiran, atau jaminan semua situs menerima domain temp-mail.

## 2. Struktur proyek

```text
temp-mail/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── theme.js
│   ├── config.js
│   ├── demo.js
│   ├── favicon.svg
│   └── _headers
├── src/
│   ├── worker.js
│   └── extract.js
├── tests/
│   ├── extract.test.js
│   └── worker.test.js
├── fixtures/
│   └── sample.eml
├── .github/
│   └── workflows/
│       └── ci.yml
├── schema.sql
├── wrangler.toml
├── package.json
├── .gitignore
├── README.md
└── TESTING.md
```

`npm install` membuat `package-lock.json`. Commit file tersebut setelah instalasi berhasil agar resolusi versi stabil. `postal-mime` dipatok ke 2.4.3; Wrangler memakai versi mayor 4.

## 3. Prasyarat

1. Akun Cloudflare dan akun GitHub.
2. Domain milik sendiri dengan DNS/nameserver dikelola Cloudflare.
3. Akses mengelola Workers, Pages, D1, dan Email Routing pada akun yang sama.
4. Node.js **22.16 atau lebih baru**, npm, dan Git di komputer.
5. Browser modern dengan JavaScript; HTTPS untuk clipboard produksi.
6. Terminal. Contoh perintah memakai Bash/zsh/Git Bash; di PowerShell gunakan `curl.exe` untuk contoh curl.

**Penting sebelum mengubah MX:** jangan mengganti record MX email utama perusahaan atau domain yang masih digunakan Google Workspace/Microsoft 365 tanpa rencana migrasi. Gunakan domain khusus temp-mail atau subdomain yang telah dikonfigurasi untuk Email Routing. Mengarahkan MX ke Cloudflare dapat mengubah penerimaan email domain tersebut.

Tidak perlu server sendiri. Biaya domain dan pemakaian Cloudflare tetap berlaku; periksa kuota terbaru Workers/D1/Email Routing. Polling menghasilkan request dan rate limiting menggunakan penulisan D1.

## 4. Instalasi

Ekstrak ZIP, buka terminal pada folder `temp-mail`:

```bash
node --version
npm --version
git --version
npm install
npx wrangler login
```

Browser akan meminta login dan otorisasi akun Cloudflare. Kredensial tidak perlu ditulis pada frontend atau repository.

## 5. Buat database D1

```bash
npx wrangler d1 create temp-mail-db
```

Salin `database_id` dari output. Edit `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "temp-mail-db"
database_id = "UUID-ASLI-DARI-CLOUDFLARE"
```

`UUID-ASLI-DARI-CLOUDFLARE` di atas adalah contoh nilai konfigurasi yang wajib diganti, bukan kode yang hilang. UUID nol pada file bawaan juga harus diganti sebelum deploy.

Buat tabel pada database produksi:

```bash
npm run db:remote
```

Untuk database pengembangan lokal, yang **terpisah** dari produksi:

```bash
npm run db:local
```

Skema memakai `CREATE TABLE IF NOT EXISTS`, sehingga aman dijalankan kembali pada skema yang sama. Untuk perubahan skema masa depan gunakan migrasi; menjalankan ulang skema ini tidak mengubah struktur tabel lama.

## 6. Konfigurasi Worker

Pada `[vars]` di `wrangler.toml`, sesuaikan:

| Variabel | Contoh / default | Arti |
|---|---|---|
| `MAIL_DOMAINS` | `example.com` → ganti domain sendiri | Domain penerima, dipisahkan koma |
| `ALLOWED_ORIGINS` | `https://singgah-kamu.pages.dev,http://localhost:8080` | Origin web persis, tanpa slash akhir |
| `EMAIL_TTL_HOURS` | `24` | Masa hidup email, 1–168 jam |
| `MAILBOX_TTL_HOURS` | `168` | Masa hidup alamat/kunci, 1–720 jam |
| `MAX_EMAILS_PER_ADDRESS` | `50` | Maksimum pesan aktif per alamat, 1–200 |
| `MAX_EMAIL_BYTES` | `1048576` | Maksimum raw email termasuk lampiran; maksimum konfigurasi 2 MiB |
| `POLL_INTERVAL_SECONDS` | `7` | Interval frontend, dibatasi 5–10 detik |
| `RATE_LIMIT_ENABLED` | `true` | Rate limiting D1 |
| `RATE_LIMIT_PER_MINUTE` | `120` | Batas request API per IP per menit, di luar config/OPTIONS |
| `CREATE_LIMIT_PER_HOUR` | `20` | Batas membuat mailbox per IP per jam |

Contoh:

```toml
MAIL_DOMAINS = "email.domainkamu.com"
ALLOWED_ORIGINS = "https://singgah-kamu.pages.dev,http://localhost:8080,http://127.0.0.1:8080"
```

Nama host di atas hanyalah contoh. Daftarkan semua domain dalam `MAIL_DOMAINS` di Email Routing juga. Jangan memasukkan `*` ke `ALLOWED_ORIGINS`.

Tidak perlu binding `send_email`: aplikasi ini hanya menerima email.

## 7. Deploy Worker melalui CLI

```bash
npm run check
npm test
npm run build:worker
npm run deploy
```

Simpan URL Worker yang dicetak, misalnya:

```text
https://singgah-temp-mail.nama-akun.workers.dev
```

Verifikasi konfigurasi:

```bash
curl "https://singgah-temp-mail.nama-akun.workers.dev/api/config"
```

Respons harus JSON dengan domain yang benar. Endpoint ini tidak memerlukan token.

Pada Dashboard Worker, pastikan:
- Binding D1 bernama **DB**, bukan nama yang berbeda.
- Variabel sesuai `wrangler.toml`.
- Cron `*/5 * * * *` terpasang pada bagian Triggers/Cron.
- URL `workers.dev` aktif.

Perubahan Cron di Cloudflare dapat memerlukan waktu propagasi. Jangan mengandalkan trigger langsung aktif detik itu juga.

## 8. Konfigurasi frontend

Edit `public/config.js`:

```js
window.TEMPMAIL_CONFIG = {
  apiBase: "https://singgah-temp-mail.nama-akun.workers.dev",
  demo: false
};
```

Gunakan URL Worker milik Anda. Produksi harus HTTPS, tanpa `/api` atau slash di akhir. **Biarkan `demo: false`** agar web menerima data sungguhan.

`public/_headers` memberi CSP dan security headers di Cloudflare Pages. Untuk pengetatan lebih lanjut, setelah URL Worker diketahui, ganti `https:` pada direktif `connect-src` menjadi origin Worker persis. Sisakan origin localhost hanya pada pengembangan. Jangan menambahkan `unsafe-inline` untuk JavaScript.

Semua file di `public/` bersifat publik. Jangan masukkan API token Cloudflare, bearer mailbox pengguna, maupun secret lain ke sana.

## 9. Upload ke GitHub dari nol

Buat repository GitHub kosong bernama `temp-mail` melalui tombol **New repository**. Untuk menghindari konflik awal, jangan inisialisasi README, lisensi, atau `.gitignore` dari GitHub karena sudah ada di proyek.

Jalankan dari folder `temp-mail`:

```bash
git init
git branch -M main
git add .
git commit -m "Tambahkan aplikasi Singgah temp mail"
git remote add origin https://github.com/USERNAME/temp-mail.git
git push -u origin main
```

Ganti `USERNAME` dengan nama akun/organisasi GitHub. Jika Git menanyakan identitas:

```bash
git config user.name "Nama Anda"
git config user.email "alamat-git-anda@example.com"
```

Lalu ulangi `git commit` dan `git push`. Autentikasi GitHub gunakan credential manager, GitHub CLI, SSH, atau PAT sesuai pengaturan akun—bukan password akun dalam URL. Jangan commit token.

Workflow `.github/workflows/ci.yml` menjalankan pemeriksaan sintaks, pengujian Node/SQLite adapter, dan dry-run bundling Worker. Workflow **tidak melakukan deploy** dan tidak membutuhkan secret produksi.

## 10. Deploy Cloudflare Pages

Pilih **salah satu** jalur di bawah untuk proyek Pages baru. Integrasi Git dan proyek Direct Upload memiliki alur berbeda; pilih Git sejak awal bila ingin deploy otomatis setiap push.

### A. Connect to Git (disarankan)

1. Buka Cloudflare **Workers & Pages → Create application → Pages → Connect to Git** / **Import an existing Git repository**. Label menu dapat berubah.
2. Hubungkan akun GitHub dan pilih repository `temp-mail`.
3. Production branch: **main**.
4. Framework preset: **None**.
5. Root directory: kosong / root repository.
6. Build command: **`exit 0`** (frontend tidak perlu dibundel).
7. Build output directory: **`public`**.
8. Jika tersedia, set environment `NODE_VERSION=22`.
9. Save and Deploy.

`wrangler.toml` pada root adalah konfigurasi **Worker API**, bukan Pages Functions. Jangan memakai `npm run deploy` sebagai build command Pages. Frontend ini murni aset statis.

Simpan origin Pages yang diberikan, misalnya `https://singgah-kamu.pages.dev`. Perbarui `ALLOWED_ORIGINS` Worker dengan origin tersebut, lalu:

```bash
npm run deploy
git add .
git commit -m "Konfigurasi origin Pages dan URL API"
git push
```

Jika menambahkan custom domain web, tambahkan origin HTTPS custom tersebut ke `ALLOWED_ORIGINS` dan redeploy Worker. Preview branch Pages memakai origin berbeda; izinkan secara eksplisit bila diperlukan, bukan dengan wildcard.

### B. Direct Upload via Wrangler

```bash
npx wrangler pages project create singgah-kamu --production-branch main
npx wrangler pages deploy public --project-name singgah-kamu --branch main
```

Ganti `singgah-kamu` dengan nama proyek Pages yang tersedia. Perintah deploy berikutnya juga dapat memakai:

```bash
npm run deploy:web -- --project-name singgah-kamu --branch main
```

Tetap perbarui `ALLOWED_ORIGINS` setelah mengetahui origin Pages.

### Opsional: Worker terhubung Git

Worker dapat tetap dideploy lewat CLI, sementara Pages otomatis lewat Git. Bila ingin Worker otomatis:
- Tambahkan project Worker dari repository yang sama.
- Root: root repository.
- Build command: `npm install && npm run check && npm test`.
- Deploy command: `npx wrangler deploy`.
- Pastikan D1 sudah dibuat, skema sudah dijalankan, UUID/variabel benar.
- Project Worker dan project Pages adalah **dua deployment berbeda**.

Jangan menjalankan inisialisasi database produksi pada setiap build tanpa kebijakan migrasi yang jelas.

## 11. Aktifkan Email Routing dan catch-all

Pada dokumentasi Cloudflare terbaru, menu berada di **Compute → Email Service → Email Routing**. Pada tampilan lama: pilih domain → **Email → Email Routing**.

1. Onboard/pilih domain yang sama dengan `MAIL_DOMAINS`.
2. Ikuti wizard DNS untuk menambahkan MX/TXT yang diminta Cloudflare. Periksa kembali risiko konflik email yang sudah ada.
3. Jika onboarding meminta destination address, tambahkan alamat email yang Anda kuasai dan verifikasi melalui tautan yang dikirim Cloudflare. Aplikasi ini sendiri tidak meneruskan pesan ke alamat tersebut.
4. Tunggu status routing/DNS aktif.
5. Buka **Routing Rules**.
6. Aktifkan **Catch-all rule**.
7. Action: **Send to a Worker**.
8. Worker: **singgah-temp-mail**, sesuai `name` pada Wrangler.
9. Save, pastikan status **Active**.

Aturan exact-address yang sudah ada dapat mengambil prioritas atas catch-all. Periksa jika hanya beberapa alamat gagal. Setelah mengganti nama Worker, hubungkan ulang rule.

**Perubahan keamanan dibanding inbox publik:** catch-all menerima lalu memeriksa keberadaan mailbox aktif. Buka web dan buat alamat terlebih dahulu sebelum mengirim email. Email ke alamat sembarang yang belum dibuat akan ditolak. Ini mencegah inbox dapat dibaca hanya dengan menebak nama.

DNS dapat memerlukan waktu propagasi; jangan menganggap keterlambatan DNS sebagai bug aplikasi.

## 12. Pengembangan lokal

Kembalikan `public/config.js` ke:

```js
window.TEMPMAIL_CONFIG = {
  apiBase: "http://localhost:8787",
  demo: false
};
```

Pastikan `ALLOWED_ORIGINS` menyertakan `http://localhost:8080` dan `http://127.0.0.1:8080`. Untuk menguji dengan `example.com` tanpa mengubah konfigurasi produksi, gunakan override CLI pada dev.

Terminal 1:

```bash
npm run db:local
npx wrangler dev --var MAIL_DOMAINS:example.com
```

Terminal 2:

```bash
npm run dev:web
```

Buka **http://localhost:8080**. Jangan membuka `public/index.html` melalui `file://` untuk mode API.

Buat alamat custom `contoh` pada web, kemudian kirim fixture secara lokal:

```bash
curl --request POST \
  'http://localhost:8787/cdn-cgi/local/email?from=hello%40sender.example&to=contoh%40example.com' \
  --header 'Content-Type: message/rfc822' \
  --data-binary @fixtures/sample.eml
```

`sample.eml` mencakup `Message-ID`, wajib untuk endpoint pengujian email lokal. Jika alamat `contoh` sudah dimiliki sesi lain, pilih nama lain dan sesuaikan parameter `to`; penerima envelope pada parameter menentukan mailbox, bukan header `To` pada fixture.

Ini adalah **simulasi lokal**, bukan SMTP publik. Polling akan menampilkan email setelah handler menyimpannya.

Untuk menguji cron lokal:

```bash
npx wrangler dev --test-scheduled --var MAIL_DOMAINS:example.com
```

Lalu di terminal lain:

```bash
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'
```

Hentikan instance Wrangler sebelumnya sebelum memakai port yang sama. Kembalikan URL API HTTPS produksi sebelum push ke branch deployment.

### Demo tanpa backend

Ubah `demo: true` pada `public/config.js`, jalankan `npm run dev:web`, lalu buka localhost:8080. Demo menampilkan banner jelas, pesan contoh, dan tombol simulasi. Tidak memakai D1, Email Routing, atau Worker.

Data demo memakai namespace localStorage berbeda. Menghapus pesan, menandai dibaca, dan mengganti alamat hanya mengubah data contoh. Setelah selesai, **kembalikan `demo: false`**. File `demo.js` tidak mengeksekusi adapter demo pada mode produksi.

## 13. Cara mengetes produksi

1. Buka URL Pages dan pastikan banner demo **tidak** tampil.
2. Salin alamat baru.
3. Kirim email dari akun lain ke alamat tersebut; contoh isi: `Kode verifikasi: 482916`.
4. Setelah pesan diterima Worker dan disimpan D1, UI mengambilnya pada polling berikutnya (default 7 detik).
5. Verifikasi indikator belum dibaca, badge jumlah, OTP, tombol salin.
6. Buka email, tekan Kembali, lalu uji browser Back/Forward.
7. Kirim pesan dengan `https://example.com/verify?token=contoh` untuk menguji kartu link.
8. Uji tema, refresh halaman, custom address, hapus satu, hapus semua.
9. Uji 360 px, tablet, desktop, keyboard, dan browser aktual.
10. Buka browser/sesi terpisah: tanpa token, mailbox sebelumnya harus tidak dapat dibaca.

**Batas SLA:** interval polling 7 detik bukan jaminan email dari pengirim sampai layar dalam ≤10 detik. Antrean SMTP, DNS, jaringan, dan durasi handler berada di luar kontrol UI. Target ≤10 detik dihitung setelah email tersimpan di D1 pada tab aktif dan kondisi jaringan normal; tetap lakukan pengukuran deployment Anda. Polling dijeda saat tab tersembunyi dan dijalankan saat tab aktif kembali.

## 14. Kontrak API

Semua respons non-OPTIONS memakai JSON. OPTIONS mengembalikan 204 tanpa body. Error:

```json
{"error":"Pesan kesalahan berbahasa Indonesia"}
```

### Tambahan: membuat mailbox

`POST /api/mailboxes`

Body `{}` membuat alamat acak. Untuk custom:

```json
{"username":"contoh","domain":"example.com"}
```

Respons 201:

```json
{
  "address": "contoh@example.com",
  "token": "64-karakter-heksadesimal-acak",
  "expires_at": 1791818925
}
```

Contoh token di atas adalah ilustrasi format, bukan token untuk dipakai. Token asli 256-bit dibuat dengan `crypto.getRandomValues`. Hanya hash SHA-256 disimpan di database. Konflik nama custom mengembalikan 409.

### Endpoint lainnya

| Method | Endpoint | Auth / hasil |
|---|---|---|
| GET | `/api/config` | Publik; domain, TTL, interval, batas |
| GET | `/api/inbox?address=...` | Bearer token mailbox; `messages`, `unread`, `mailbox_expires_at` |
| GET | `/api/message/:id` | Bearer + `X-Mailbox-Address`; `{message}`, otomatis dibaca |
| POST | `/api/message/:id/read` | Bearer + `X-Mailbox-Address`; `{ok:true}` |
| DELETE | `/api/message/:id` | Bearer + `X-Mailbox-Address`; hapus satu |
| DELETE | `/api/inbox?address=...` | Bearer; hapus semua pesan alamat |

Inbox tidak mengirim seluruh body HTML/teks; hanya preview dan metadata. Detail mengirim body. Link disimpan JSON di D1 dan dikembalikan sebagai array. Timestamp dalam detik Unix; `is_read` menjadi boolean pada JSON.

Bearer dikirim lewat header, bukan query URL:

```text
Authorization: Bearer TOKEN-MAILBOX
X-Mailbox-Address: contoh@example.com
```

CORS bukan autentikasi. Request CLI tanpa Origin dapat memanggil API tetapi tetap harus memiliki token untuk membaca/menghapus email. Request browser dengan Origin yang tidak diizinkan ditolak.

## 15. Retensi dan keamanan

- **Email 24 jam:** API menyaring email kedaluwarsa langsung. Pembersihan fisik D1 dijalankan tiap 5 menit; dapat terlambat jika cron gagal.
- **Mailbox 7 hari:** kedaluwarsa tetap, tidak diperpanjang otomatis. Email tidak disimpan lebih lama dari mailbox. Kunci tidak dapat dipulihkan.
- **Pergantian alamat:** token alamat lama dilepas dari browser. Pesan lama tidak langsung dihapus, tetapi tetap tidak dapat dibaca tanpa token dan kedaluwarsa sesuai TTL.
- **Custom name dapat dipakai ulang** setelah mailbox kedaluwarsa dan cron menghapusnya. Pengguna baru tidak mendapatkan pesan lama, tetapi dapat menerima email yang baru dikirim ke nama sama. Jangan gunakan temp-mail untuk identitas permanen.
- **Kepemilikan berbasis token:** siapa pun yang mendapat token dapat membaca/menghapus mailbox. Jangan menyalin token ke chat, URL, screenshot DevTools, atau repository.
- **LocalStorage bukan enkripsi:** komputer/browser bersama dan ekstensi berbahaya dapat mengakses data sesi. CSP dan sandbox mengurangi, bukan menghapus, seluruh risiko.
- **HTML:** atribut dan tag berisiko dibuang; tautan di dalam body tidak aktif. Link dibuka hanya melalui kartu link dengan protokol http(s), target baru, dan noopener/noreferrer. Styling asli email dapat berubah.
- **Deteksi OTP/link adalah heuristik:** bisa salah atau tidak menemukan kandidat. Isi asli tetap tersedia dalam teks/HTML aman; periksa domain sebelum membuka link.
- **Lampiran:** termasuk dalam batas ukuran raw, diparse oleh postal-mime, tetapi tidak disimpan/ditampilkan. Gambar remote dan pelacak diblokir.
- **Tidak ada profil pengguna atau analitik pihak ketiga.** Namun isi email, alamat pengirim/penerima, serta hash IP sementara tetap merupakan data yang mungkin bersifat pribadi. Jangan mengklaim “tidak menyimpan data pribadi sama sekali”.
- **Rate limit bukan perlindungan DDoS lengkap.** Pengguna di IP NAT sama berbagi kuota. Hash IP tidak disimpan permanen; bucket dibersihkan sekitar 5 menit setelah jendela berakhir. Aktivasi bisa menambah biaya penulisan D1.
- **Batas per-mailbox bukan batas trafik global.** Untuk layanan publik besar, tambahkan Turnstile saat membuat alamat, WAF/rate-limit Cloudflare, pemantauan biaya, kuota global, dan abuse handling.
- **Tidak ada jaminan penghapusan dari backup platform.** Penghapusan di D1 aktif tidak berarti data langsung hilang dari backup/Time Travel/log infrastruktur Cloudflare. Tinjau kebijakan retensi penyedia.
- **Alamat pengirim dapat dipalsukan.** Aplikasi tidak memberi tanda kepercayaan hanya berdasarkan nama pengirim.
- Ikuti ketentuan Cloudflare, hukum setempat, dan ketentuan layanan tujuan. Aplikasi tidak dibuat untuk spam atau melewati pembatasan situs.

## 16. Troubleshooting

| Gejala | Pemeriksaan |
|---|---|
| Alamat tidak muncul | Lihat JSON `/api/config`, UUID D1, binding `DB`, skema, dan URL di config.js |
| “Origin frontend belum diizinkan” / CORS | Tambahkan origin persis Pages/custom domain ke `ALLOWED_ORIGINS`, tanpa slash akhir, lalu deploy Worker |
| UI masih memakai localhost | Perbarui config.js ke HTTPS Worker, commit/push atau deploy Pages ulang; refresh browser |
| Banner demo masih ada | Set `demo: false`; jangan memakai file pratinjau sebagai frontend produksi |
| Email tidak masuk | Buka web dahulu agar mailbox dibuat; cek domain/MX, status Email Routing, catch-all Send to Worker dan rule exact-address |
| “Mailbox is not active” | Alamat belum terdaftar, kedaluwarsa, domain berbeda, atau email dikirim ke alamat lama |
| “Message exceeds the size limit” | Raw MIME terlalu besar, termasuk lampiran; default 1 MiB |
| Worker tidak ada di dropdown | Pastikan deployed di akun yang sama dan memiliki handler `email()` |
| Error D1 “no such table” | Jalankan `npm run db:remote`; database lokal berbeda dari remote |
| 401 setelah membersihkan browser | Token hilang; tidak ada pemulihan. Klik Ganti alamat |
| 409 alamat custom | Nama sedang dipakai; gunakan nama lain atau tunggu mailbox kedaluwarsa dan dibersihkan |
| 429 | Batas per-IP tercapai; tunggu sesuai Retry-After, atau sesuaikan kuota secara bertanggung jawab |
| Salin gagal | Gunakan HTTPS/localhost dan izin clipboard; pada browser yang memblokir, salin teks secara manual |
| HTML tampak sederhana / gambar hilang | Disengaja untuk keamanan; gunakan tampilan teks atau kartu link |
| Preview branch Pages error CORS | Origin preview berbeda; tambahkan secara eksplisit atau gunakan domain staging tetap |
| Pesan kedaluwarsa masih ada di D1 | API sudah menyembunyikan; periksa Cron dan logs, tunggu eksekusi pembersihan |
| Test Node gagal impor `node:sqlite` | Upgrade Node ke ≥22.16; pada Node 22 modul ini dapat memberi experimental warning |
| Local email test gagal | Pastikan Wrangler terbaru, body RFC5322 dan Message-ID, penerima sudah didaftarkan pada D1 lokal |
| Email sesekali terlambat | Periksa antrean pengirim, log routing, durasi Worker, kuota D1, tab browser aktif, jaringan |
| Git push ditolak | Cek remote/repo permission dan autentikasi GitHub; jangan masukkan password ke kode |

Gunakan `npx wrangler tail` untuk diagnosis runtime. Aplikasi hanya mencatat pesan error umum, tidak sengaja menuliskan OTP/body/token ke log. Jangan menambahkan logging data sensitif di produksi.

## 17. Referensi resmi

Dokumentasi Cloudflare diperiksa saat penyiapan proyek; UI/kuota dapat berubah:
- [Mulai Email Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/)
- [Routing rules dan catch-all](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Pengujian Email Worker lokal](https://developers.cloudflare.com/email-service/local-development/routing/)
- [Pages untuk HTML statis](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [D1](https://developers.cloudflare.com/d1/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

Mulai dari langkah 4, isi konfigurasi, lalu ikuti urutan D1 → Worker → GitHub/Pages → Email Routing → pengujian produksi.