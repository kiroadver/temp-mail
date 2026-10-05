import test from "node:test";
import assert from "node:assert/strict";
import { extractOtps, extractLinks, htmlToText, safeUrl, decodeEntities } from "../src/extract.js";

test("menemukan OTP 6 digit dengan prioritas kata kunci", () => {
  assert.equal(extractOtps("Kode verifikasi", "Kode OTP Anda: 482916")[0], "482916");
});
test("menemukan kode alfanumerik di dekat keyword", () => {
  assert.equal(extractOtps("", "Verification code: AB12CD")[0], "AB12CD");
});
test("tidak menganggap kata biasa dan tahun sebagai OTP", () => {
  assert.deepEqual(extractOtps("Selamat datang", "Halo teman, selamat datang pada 2026."), []);
});
test("menghapus URL sebelum menambang OTP", () => {
  assert.deepEqual(extractOtps("", "https://example.com/verify?token=123456"), []);
});
test("HTML menjadi teks dan entitas didekode", () => {
  assert.equal(htmlToText("<style>.x{}</style><p>Halo &amp; sampai jumpa</p>"), "Halo & sampai jumpa");
  assert.equal(decodeEntities("&#x41;&#66;&#999999999;"), "AB");
});
test("fallback OTP dari HTML", () => {
  assert.equal(extractOtps("", "", "<p>Kode Anda: <b>123456</b></p>")[0], "123456");
});
test("kode sama tidak diduplikasi", () => {
  assert.deepEqual(extractOtps("OTP 123456", "Kode 123456"), ["123456"]);
});
test("link verifikasi didahulukan dari unsubscribe dan gambar", () => {
  const links = extractLinks("https://example.com/unsubscribe https://example.com/a.png",
    '<a href="https://example.com/verify?token=abc&amp;x=1">Verifikasi</a>');
  assert.equal(links[0], "https://example.com/verify?token=abc&x=1");
  assert.equal(links.length, 3);
});
test("link hanya http(s), tanpa kredensial", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "https://user:pass@example.com"]) {
    assert.equal(safeUrl(url), null);
  }
  assert.equal(safeUrl("https://example.com/login"), "https://example.com/login");
});
test("link aman dari href kutip tunggal, ganda, atau tanpa kutip", () => {
  assert.equal(extractLinks("", "<a href='https://example.com/a'>A</a>").length, 1);
  assert.equal(extractLinks("", '<a href="https://example.com/b">B</a>').length, 1);
  assert.equal(extractLinks("", "<a href=https://example.com/c>C</a>").length, 1);
});
test("link duplikat hanya satu dan tanda titik teks dipangkas", () => {
  assert.deepEqual(extractLinks("https://example.com/verify.", '<a href="https://example.com/verify">Verify</a>'),
    ["https://example.com/verify"]);
});
test("input panjang tetap terbatas", () => {
  const candidates = extractOtps("", "otp 123456 ".repeat(20000));
  assert.deepEqual(candidates, ["123456"]);
});