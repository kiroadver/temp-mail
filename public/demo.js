/**
 * Adapter demo terpisah: tidak pernah aktif pada konfigurasi produksi.
 * State hanya di browser. Tidak terhubung ke Cloudflare atau penerimaan email.
 */
(() => {
  if (window.TEMPMAIL_CONFIG?.demo !== true) return;
  const key = "singgah-demo-data-v1";
  const time = () => Math.floor(Date.now() / 1000);
  let store = { boxes: {} };
  try { store = JSON.parse(localStorage.getItem(key) || '{"boxes":{}}'); } catch { /* Gunakan memori. */ }
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(store)); } catch { /* Gunakan memori. */ } };
  const id = () => crypto.randomUUID();
  const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
  const error = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  function samples(address) {
    const created = time();
    return [
      { id: id(), address, from_addr: "halo@ruang.example", from_name: "Ruang",
        subject: "Kode verifikasi untuk langkah berikutnya", preview: "Sedikit lagi! Gunakan kode berikut untuk memverifikasi alamat email kamu.",
        text_body: "Halo!\n\nSedikit lagi. Gunakan kode verifikasi 482916 untuk melanjutkan.\n\nKode berlaku selama 10 menit. Jangan bagikan kode ini.\n\nSalam,\nTim Ruang",
        html_body: "<h2>Selamat datang di Ruang.</h2><p>Sedikit lagi! Masukkan kode verifikasi berikut untuk melanjutkan:</p><h1>482916</h1><p>Kode berlaku selama 10 menit. Jangan bagikan kode ini.</p><p>Salam,<br>Tim Ruang</p>",
        otp: "482916", links: [], is_read: false, received_at: created - 70, expires_at: created + 86400 },
      { id: id(), address, from_addr: "hello@studio.example", from_name: "Studio",
        subject: "Satu klik untuk mengonfirmasi email kamu",
        preview: "Ruang kreatifmu sudah siap. Konfirmasikan alamat email untuk memulai.",
        text_body: "Ruang kreatifmu sudah siap.\n\nKonfirmasi email: https://example.com/verify?token=contoh-demo\n\nIni pesan demonstrasi; link bukan verifikasi sungguhan.",
        html_body: "<h2>Ide bagus dimulai di sini.</h2><p>Konfirmasikan alamat email untuk menyiapkan ruang kreatifmu.</p><p><a href='https://example.com/verify?token=contoh-demo'>Konfirmasi email</a></p><p>Ini pesan demonstrasi.</p>",
        otp: null, links: ["https://example.com/verify?token=contoh-demo"], is_read: false, received_at: created - 300, expires_at: created + 86400 },
      { id: id(), address, from_addr: "catatan@singgah.example", from_name: "Tim Singgah",
        subject: "Singgah sebentar, kenalan dulu 👋",
        preview: "Kotak masuk kecil untuk semua hal yang hanya perlu sebentar.",
        text_body: "Halo, selamat datang di Singgah!\n\nIni pratinjau interaktif dengan data contoh. Coba buka pesan, salin OTP, ganti tema, dan buat alamat custom.\n\nKlik “Simulasikan email masuk” untuk mencoba pesan baru.\n\nDemo ini tidak menerima email sungguhan. Untuk itu, deploy proyek ke Cloudflare lalu aktifkan Email Routing di domain milikmu.",
        html_body: "", otp: null, links: [], is_read: true, received_at: created - 1020, expires_at: created + 86400 }
    ];
  }
  function addSample(address) {
    const box = store.boxes[address]; if (!box) return;
    const code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
    box.messages.unshift({ id: id(), address, from_addr: "halo@ruang.example", from_name: "Ruang",
      subject: "Kode masuk baru untuk kamu", preview: `Kode verifikasi kamu adalah ${code}. Pesan ini adalah simulasi.`,
      text_body: `Kode verifikasi kamu adalah ${code}.\n\nPesan ini adalah simulasi, bukan email sungguhan.`,
      html_body: "", otp: code, links: [], is_read: false, received_at: time(), expires_at: time() + 86400 });
    box.messages = box.messages.slice(0, 50); persist();
  }
  async function request(path, { method = "GET", body, mailbox } = {}) {
    await new Promise(resolve => setTimeout(resolve, 160));
    const url = new URL(path, "https://demo.invalid");
    if (url.pathname === "/api/config") return { domains: ["singgah.example"], email_ttl_hours: 24,
      mailbox_ttl_hours: 168, max_emails: 50, poll_seconds: 7, max_email_bytes: 1048576 };
    if (url.pathname === "/api/mailboxes" && method === "POST") {
      const username = body?.username || token().slice(0, 12);
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) error(400, "Nama alamat tidak valid.");
      if (body?.domain && body.domain !== "singgah.example") error(400, "Domain tidak tersedia.");
      const address = `${username}@singgah.example`;
      if (store.boxes[address]) error(409, "Alamat ini sudah digunakan. Pilih nama lain.");
      const mailbox = { address, token: token(), expires_at: time() + 168 * 3600 };
      store.boxes[address] = { ...mailbox, messages: samples(address) }; persist();
      return mailbox;
    }
    const box = mailbox && store.boxes[mailbox.address];
    if (!box || box.token !== mailbox.token || box.expires_at <= time()) error(401, "Kotak masuk demo kedaluwarsa. Buat alamat baru.");
    box.messages = box.messages.filter(message => message.expires_at > time());
    if (url.pathname === "/api/inbox") {
      if (url.searchParams.get("address") !== mailbox.address) error(401, "Alamat tidak cocok.");
      if (method === "DELETE") { box.messages = []; persist(); return { ok: true }; }
      return { messages: structuredClone(box.messages).map(({ html_body, text_body, ...message }) => message),
        unread: box.messages.filter(m => !m.is_read).length, mailbox_expires_at: box.expires_at };
    }
    const messageId = url.pathname.split("/")[3];
    const message = box.messages.find(item => item.id === messageId);
    if (!message) error(404, "Pesan tidak ditemukan.");
    if (method === "DELETE") { box.messages = box.messages.filter(item => item.id !== messageId); persist(); return { ok: true }; }
    message.is_read = true; persist();
    return { message: structuredClone(message) };
  }
  window.SinggahDemo = { request, addSample };
})();