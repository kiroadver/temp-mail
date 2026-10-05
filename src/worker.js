import PostalMime from "postal-mime";
import { extractOtps, extractLinks, htmlToText } from "./extract.js";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const boundedInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

export function settings(env) {
  return {
    domains: String(env.MAIL_DOMAINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
    origins: String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
    ttlHours: boundedInt(env.EMAIL_TTL_HOURS, 24, 1, 168),
    mailboxHours: boundedInt(env.MAILBOX_TTL_HOURS, 168, 1, 720),
    maxEmails: boundedInt(env.MAX_EMAILS_PER_ADDRESS, 50, 1, 200),
    maxBytes: boundedInt(env.MAX_EMAIL_BYTES, 1048576, 1024, 2097152),
    pollSeconds: boundedInt(env.POLL_INTERVAL_SECONDS, 7, 5, 10)
  };
}

export function normalizeAddress(value, domains) {
  if (typeof value !== "string" || value.length > 254) throw new HttpError(400, "Alamat email tidak valid.");
  const address = value.trim().toLowerCase();
  const parts = address.split("@");
  if (parts.length !== 2 || !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(parts[0]) || !domains.includes(parts[1])) {
    throw new HttpError(400, "Gunakan nama 3–32 karakter: huruf, angka, _ atau -, dan domain yang tersedia.");
  }
  return address;
}

function randomHex(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(n => n.toString(16).padStart(2, "0")).join("");
}
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
}
async function parseJson(request) {
  const limit = 2048;
  if (Number(request.headers.get("Content-Length")) > limit) throw new HttpError(413, "Permintaan terlalu besar.");
  if (!request.body) throw new HttpError(400, "JSON tidak valid.");
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, "Permintaan terlalu besar."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, "JSON tidak valid."); }
}

function headersFor(request, cfg) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  });
  const origin = request.headers.get("Origin");
  if (origin && cfg.origins.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mailbox-Address");
  headers.set("Access-Control-Max-Age", "600");
  return headers;
}

// Batas ini disengaja sederhana. Hash IP bersifat pseudonim dan tetap perlu kebijakan privasi.
async function rateLimit(request, env, creation) {
  if (env.RATE_LIMIT_ENABLED === "false") return;
  const seconds = creation ? 3600 : 60;
  const time = nowSeconds();
  const window = Math.floor(time / seconds);
  const ip = request.headers.get("CF-Connecting-IP") || "local-development";
  const key = await hash(`${creation ? "create" : "api"}:${window}:${ip}`);
  const limit = creation
    ? boundedInt(env.CREATE_LIMIT_PER_HOUR, 20, 1, 1000)
    : boundedInt(env.RATE_LIMIT_PER_MINUTE, 120, 10, 10000);
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?) " +
    "ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits"
  ).bind(key, (window + 1) * seconds + 300).first();
  if (row.hits > limit) throw new HttpError(429, "Terlalu banyak permintaan. Coba lagi setelah batas waktu berakhir.");
}

async function authorize(request, env, cfg, value) {
  const address = normalizeAddress(value, cfg.domains);
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new HttpError(401, "Kunci kotak masuk tidak tersedia. Buat alamat baru.");
  const row = await env.DB.prepare(
    "SELECT address, expires_at FROM mailboxes WHERE address = ? AND token_hash = ? AND expires_at > ?"
  ).bind(address, await hash(token), nowSeconds()).first();
  if (!row) throw new HttpError(401, "Kunci tidak valid atau kotak masuk telah kedaluwarsa.");
  return row;
}

async function createMailbox(request, env, cfg) {
  const body = await parseJson(request);
  if (!body || Array.isArray(body) || typeof body !== "object") throw new HttpError(400, "Isi permintaan tidak valid.");
  const domain = typeof body.domain === "string" ? body.domain.toLowerCase() : cfg.domains[0];
  if (!cfg.domains.includes(domain)) throw new HttpError(400, "Domain tidak tersedia.");
  const custom = body.username !== undefined && body.username !== "";
  if (custom && typeof body.username !== "string") throw new HttpError(400, "Nama alamat tidak valid.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const address = normalizeAddress(`${custom ? body.username : randomHex(6)}@${domain}`, cfg.domains);
    const token = randomHex(32);
    const time = nowSeconds();
    const expires = time + cfg.mailboxHours * 3600;
    // INSERT OR IGNORE membedakan benturan alamat dari kegagalan D1.
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO mailboxes (address, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(address, await hash(token), time, expires).run();
    if (result.meta.changes > 0) return { address, token, expires_at: expires };
    if (custom) throw new HttpError(409, "Alamat ini sudah digunakan. Pilih nama lain.");
  }
  throw new HttpError(503, "Belum dapat membuat alamat. Coba lagi.");
}

function shapeMessage(row, detail = false) {
  let links = [];
  try { links = JSON.parse(row.links || "[]"); } catch { /* Nilai lama yang rusak menjadi daftar kosong. */ }
  const result = { ...row, links, is_read: Boolean(row.is_read) };
  if (!detail) result.preview = String(row.preview || "").replace(/\s+/g, " ").trim().slice(0, 150);
  return result;
}

async function route(request, env, cfg) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/config") {
    return { domains: cfg.domains, email_ttl_hours: cfg.ttlHours, mailbox_ttl_hours: cfg.mailboxHours,
      max_emails: cfg.maxEmails, max_email_bytes: cfg.maxBytes, poll_seconds: cfg.pollSeconds };
  }
  const create = request.method === "POST" && path === "/api/mailboxes";
  await rateLimit(request, env, create);
  if (create) return createMailbox(request, env, cfg);
  const match = path.match(/^\/api\/message\/([a-f0-9-]{36})(\/read)?$/);
  if (path !== "/api/inbox" && !match) throw new HttpError(404, "Endpoint tidak ditemukan.");
  const mailbox = await authorize(request, env, cfg,
    path === "/api/inbox" ? url.searchParams.get("address") : request.headers.get("X-Mailbox-Address"));
  const time = nowSeconds();
  if (path === "/api/inbox") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, address, from_addr, from_name, subject, substr(text_body, 1, 180) AS preview, " +
        "otp, links, is_read, received_at, expires_at FROM emails " +
        "WHERE address = ? AND expires_at > ? ORDER BY received_at DESC, id DESC LIMIT ?"
      ).bind(mailbox.address, time, cfg.maxEmails).all();
      return { messages: results.map(row => shapeMessage(row)), unread: results.filter(r => !r.is_read).length,
        mailbox_expires_at: mailbox.expires_at };
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM emails WHERE address = ?").bind(mailbox.address).run();
      return { ok: true };
    }
    throw new HttpError(405, "Metode tidak didukung.");
  }
  const id = match[1];
  const row = await env.DB.prepare(
    "SELECT id, address, from_addr, from_name, subject, text_body, html_body, otp, links, is_read, received_at, expires_at " +
    "FROM emails WHERE id = ? AND address = ? AND expires_at > ?"
  ).bind(id, mailbox.address, time).first();
  if (!row) throw new HttpError(404, "Pesan tidak ditemukan atau sudah kedaluwarsa.");
  if (request.method === "DELETE" && !match[2]) {
    await env.DB.prepare("DELETE FROM emails WHERE id = ? AND address = ?").bind(id, mailbox.address).run();
    return { ok: true };
  }
  if ((request.method === "GET" && !match[2]) || (request.method === "POST" && match[2])) {
    await env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ? AND address = ?").bind(id, mailbox.address).run();
    row.is_read = 1;
    return match[2] ? { ok: true } : { message: shapeMessage(row, true) };
  }
  throw new HttpError(405, "Metode tidak didukung.");
}

export async function receiveEmail(message, env) {
  const cfg = settings(env);
  let address;
  try { address = normalizeAddress(message.to, cfg.domains); }
  catch { message.setReject("Recipient is not supported."); return; }
  if (message.rawSize > cfg.maxBytes) { message.setReject("Message exceeds the size limit."); return; }
  const time = nowSeconds();
  const mailbox = await env.DB.prepare("SELECT expires_at FROM mailboxes WHERE address = ? AND expires_at > ?")
    .bind(address, time).first();
  if (!mailbox) { message.setReject("Mailbox is not active."); return; }
  const raw = await new Response(message.raw).arrayBuffer();
  if (raw.byteLength > cfg.maxBytes) { message.setReject("Message exceeds the size limit."); return; }
  let parsed;
  try { parsed = await PostalMime.parse(raw); }
  catch { message.setReject("Message could not be parsed."); return; }
  const subject = String(parsed.subject || "(Tanpa subjek)").slice(0, 998);
  // Batas raw juga membatasi biaya parsing; lampiran sengaja tidak disimpan.
  const html = String(parsed.html || "").slice(0, cfg.maxBytes);
  const text = String(parsed.text || htmlToText(html)).slice(0, cfg.maxBytes);
  const otp = extractOtps(subject, text, html)[0] || null;
  const links = JSON.stringify(extractLinks(text, html));
  // Jangan simpan pesan lebih lama daripada masa hidup kotak masuk.
  const expires = Math.min(time + cfg.ttlHours * 3600, mailbox.expires_at);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO emails (id, address, from_addr, from_name, subject, text_body, html_body, otp, links, is_read, received_at, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(crypto.randomUUID(), address, String(parsed.from?.address || message.from).slice(0, 320),
      String(parsed.from?.name || "").slice(0, 200), subject, text, html, otp, links, time, expires),
    env.DB.prepare("DELETE FROM emails WHERE address = ? AND expires_at <= ?").bind(address, time),
    env.DB.prepare(
      "DELETE FROM emails WHERE address = ? AND id NOT IN " +
      "(SELECT id FROM emails WHERE address = ? ORDER BY received_at DESC, id DESC LIMIT ?)"
    ).bind(address, address, cfg.maxEmails)
  ]);
}

export async function cleanup(env, time = nowSeconds()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM emails WHERE expires_at <= ?").bind(time),
    env.DB.prepare("DELETE FROM emails WHERE address IN (SELECT address FROM mailboxes WHERE expires_at <= ?)").bind(time),
    env.DB.prepare("DELETE FROM mailboxes WHERE expires_at <= ?").bind(time),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(time)
  ]);
}

export default {
  async fetch(request, env) {
    const cfg = settings(env);
    const headers = headersFor(request, cfg);
    let status = 200;
    let data;
    try {
      const origin = request.headers.get("Origin");
      if (origin && !cfg.origins.includes(origin)) throw new HttpError(403, "Origin frontend belum diizinkan.");
      if (!cfg.domains.length) throw new HttpError(503, "Domain email belum dikonfigurasi.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      data = await route(request, env, cfg);
      if (request.method === "POST" && new URL(request.url).pathname === "/api/mailboxes") status = 201;
    } catch (error) {
      status = error instanceof HttpError ? error.status : 500;
      // Hindari logging alamat, isi pesan, token, maupun objek error yang dapat memuat SQL/data.
      if (status === 500) console.error("API storage/configuration failure");
      if (status === 429) headers.set("Retry-After", new URL(request.url).pathname === "/api/mailboxes" ? "3600" : "60");
      data = { error: error instanceof HttpError ? error.message : "Terjadi gangguan server. Coba lagi nanti." };
    }
    return new Response(JSON.stringify(data), { status, headers });
  },
  async email(message, env) {
    try { await receiveEmail(message, env); }
    catch {
      console.error("Inbound email processing failure");
      // Lempar ulang agar kegagalan penyimpanan tidak dilaporkan sebagai sukses.
      throw new Error("Inbound email processing failed.");
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
};