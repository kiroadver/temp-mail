import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { receiveEmail, cleanup, normalizeAddress } from "../src/worker.js";

// Adapter SQLite lokal untuk memeriksa SQL dan kontrak D1.
// Ini bukan pengganti pengujian workerd/Cloudflare.
function setup(overrides = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const env = {
    MAIL_DOMAINS: "example.com", ALLOWED_ORIGINS: "https://singgah.pages.dev",
    RATE_LIMIT_ENABLED: "false", EMAIL_TTL_HOURS: "24", MAILBOX_TTL_HOURS: "168",
    MAX_EMAILS_PER_ADDRESS: "2", MAX_EMAIL_BYTES: "1048576", ...overrides
  };
  env.DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() {
          const result = db.prepare(sql).run(...args);
          return { meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT"); return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  };
  return { db, env };
}
async function call(env, path, method = "GET", mailbox = null, body, origin = "https://singgah.pages.dev") {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (mailbox) {
    headers.set("Authorization", `Bearer ${mailbox.token}`);
    headers.set("X-Mailbox-Address", mailbox.address);
  }
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request(`https://worker.example${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}
async function create(env, username) {
  const response = await call(env, "/api/mailboxes", "POST", null, { username });
  assert.equal(response.status, 201);
  return response.json();
}
async function deliver(env, address, content = "Kode OTP: 482916", bytesOverride) {
  const raw = `From: Ruang <hello@sender.example>\r\nTo: ${address}\r\nSubject: Kode verifikasi\r\nMessage-ID: <test@sender.example>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${content}\r\n`;
  const bytes = new TextEncoder().encode(raw);
  let rejection = null;
  const message = { from: "hello@sender.example", to: address, rawSize: bytesOverride ?? bytes.length,
    raw: new Blob([bytes]).stream(), setReject(text) { rejection = text; } };
  await receiveEmail(message, env);
  return rejection;
}

test("validasi alamat normalisasi dan domain", () => {
  assert.equal(normalizeAddress("Custom_Name@EXAMPLE.COM", ["example.com"]), "custom_name@example.com");
  for (const address of ["ab@example.com", "x.y@example.com", "abc@other.com", "../@example.com", "abc@@example.com"]) {
    assert.throws(() => normalizeAddress(address, ["example.com"]));
  }
});
test("config, CORS allowlist, preflight, dan error JSON", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const cfg = await call(env, "/api/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.headers.get("Access-Control-Allow-Origin"), "https://singgah.pages.dev");
  assert.equal((await cfg.json()).poll_seconds, 7);
  assert.equal((await call(env, "/api/config", "OPTIONS")).status, 204);
  const bad = await call(env, "/api/config", "GET", null, undefined, "https://evil.example");
  assert.equal(bad.status, 403); assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await call(env, "/missing")).status, 404);
});
test("pembuatan alamat, token hash, dan konflik custom", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const a = await create(env, "contoh");
  assert.equal(a.address, "contoh@example.com"); assert.match(a.token, /^[a-f0-9]{64}$/);
  const stored = db.prepare("SELECT token_hash FROM mailboxes WHERE address = ?").get(a.address);
  assert.notEqual(stored.token_hash, a.token);
  assert.equal((await call(env, "/api/mailboxes", "POST", null, { username: "contoh" })).status, 409);
});
test("isolasi kotak masuk, MIME, baca, read endpoint, dan hapus", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const a = await create(env, "alpha"); const b = await create(env, "bravo");
  assert.equal(await deliver(env, a.address), null);
  const path = `/api/inbox?address=${a.address}`;
  assert.equal((await call(env, path)).status, 401);
  assert.equal((await call(env, path, "GET", b)).status, 401);
  const inbox = await (await call(env, path, "GET", a)).json();
  assert.equal(inbox.messages.length, 1); assert.equal(inbox.unread, 1);
  assert.equal(inbox.messages[0].otp, "482916");
  assert.equal("text_body" in inbox.messages[0], false);
  const messagePath = `/api/message/${inbox.messages[0].id}`;
  assert.equal((await call(env, messagePath, "GET", b)).status, 404);
  assert.equal((await call(env, messagePath, "DELETE", b)).status, 404);
  const detail = await (await call(env, messagePath, "GET", a)).json();
  assert.equal(detail.message.is_read, true);
  assert.match(detail.message.text_body, /482916/);
  assert.equal((await call(env, `${messagePath}/read`, "POST", a)).status, 200);
  assert.equal((await (await call(env, path, "GET", a)).json()).unread, 0);
  assert.equal((await call(env, messagePath, "DELETE", a)).status, 200);
  assert.equal((await call(env, messagePath, "GET", a)).status, 404);
});
test("menolak penerima tak aktif dan ukuran terlalu besar", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  assert.match(await deliver(env, "unknown@example.com"), /not active/);
  assert.match(await deliver(env, "unknown@evil.example"), /not supported/);
  const a = await create(env);
  assert.match(await deliver(env, a.address, "test", 1048577), /size limit/);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM emails").get().n, 0);
});
test("batas jumlah email, hapus semua, dan expiry terfilter sebelum cron", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const a = await create(env);
  await deliver(env, a.address); await deliver(env, a.address); await deliver(env, a.address);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM emails").get().n, 2);
  db.exec("UPDATE emails SET expires_at = 0");
  const path = `/api/inbox?address=${a.address}`;
  assert.equal((await (await call(env, path, "GET", a)).json()).messages.length, 0);
  await cleanup(env);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM emails").get().n, 0);
  await deliver(env, a.address);
  await call(env, path, "DELETE", a);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM emails").get().n, 0);
});
test("cron menghapus mailbox kedaluwarsa, email anak, dan rate bucket", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const a = await create(env); await deliver(env, a.address);
  db.exec("UPDATE mailboxes SET expires_at = 0; INSERT INTO rate_limits VALUES ('expired', 3, 0)");
  await cleanup(env);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM mailboxes").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM emails").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(1) AS n FROM rate_limits").get().n, 0);
});
test("rate limit pembuatan dan Retry-After", async t => {
  const { db, env } = setup({ RATE_LIMIT_ENABLED: "true", CREATE_LIMIT_PER_HOUR: "1" }); t.after(() => db.close());
  await create(env);
  const limited = await call(env, "/api/mailboxes", "POST", null, {});
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "3600");
});
test("metode unsupported dan JSON rusak tidak menjadi error 500", async t => {
  const { db, env } = setup(); t.after(() => db.close());
  const a = await create(env);
  assert.equal((await call(env, `/api/inbox?address=${a.address}`, "POST", a, {})).status, 405);
  const malformed = await worker.fetch(new Request("https://worker.example/api/mailboxes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{"
  }), env);
  assert.equal(malformed.status, 400);
});