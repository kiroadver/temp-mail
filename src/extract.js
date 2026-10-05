/** Ekstraksi heuristik, bukan jaminan bahwa kode/link tersebut benar atau aman. */
export function decodeEntities(value = "") {
  return String(value)
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "
    })[name.toLowerCase()]);
}

export function htmlToText(html = "") {
  return decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ").trim();
}

export function extractOtps(subject = "", text = "", html = "") {
  // Jangan menambang angka dari URL, CSS, atau HTML mentah.
  const body = `${subject}\n${text || htmlToText(html)}`
    .replace(/https?:\/\/[^\s<>]+/gi, " ")
    .slice(0, 150000);
  const keywords = /\b(?:otp|kode|code|verification|verifikasi|pin|passcode|one.time.password|security)\b/gi;
  const keywordPositions = Array.from(body.matchAll(keywords), m => m.index);
  const found = new Map();
  function nearestKeyword(index) {
    let lo = 0, hi = keywordPositions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keywordPositions[mid] < index) lo = mid + 1; else hi = mid;
    }
    return Math.min(lo < keywordPositions.length ? Math.abs(keywordPositions[lo] - index) : Infinity,
      lo > 0 ? Math.abs(keywordPositions[lo - 1] - index) : Infinity);
  }
  for (const m of body.matchAll(/\b[A-Za-z0-9]{4,8}\b/g)) {
    const code = m[0];
    const numeric = /^\d{4,8}$/.test(code);
    const mixed = /[A-Za-z]/.test(code) && /\d/.test(code);
    if (!numeric && !mixed) continue;
    const distance = nearestKeyword(m.index);
    if (!numeric && distance > 60) continue;
    // Tahun dan potongan nomor panjang kurang relevan tanpa kata kunci dekat.
    if (/^(19|20)\d{2}$/.test(code) && distance > 30) continue;
    if (/^\d[\d\s()+-]{0,3}$/.test(body.slice(Math.max(0, m.index - 4), m.index)) && distance > 30) continue;
    const score = (distance <= 60 ? 200 - distance : 0) +
      (code.length === 6 ? 20 : 0) + (m.index < subject.length ? 10 : 0);
    const prior = found.get(code);
    if (!prior || score > prior.score) found.set(code, { code, score, index: m.index });
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5).map(item => item.code);
}

export function safeUrl(value) {
  try {
    const url = new URL(decodeEntities(value).trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.href.length > 4096) return null;
    return url.href;
  } catch { return null; }
}

export function extractLinks(text = "", html = "") {
  const urls = new Map();
  const add = (candidate, label = "") => {
    const url = safeUrl(candidate);
    if (!url) return;
    let score = /verify|confirm|activate|reset|login|magic|token|verifikasi/i.test(`${url} ${label}`) ? 100 : 10;
    if (/unsubscribe|optout|opt-out|berhenti|tracking|track\.|pixel/i.test(`${url} ${label}`)) score -= 150;
    if (/\.(?:png|jpe?g|gif|svg|webp|ico)(?:[?#]|$)/i.test(url)) score -= 150;
    if (url.startsWith("https:")) score += 5;
    if (!urls.has(url) || score > urls.get(url).score) urls.set(url, { url, score });
  };
  for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    add(match[1] ?? match[2] ?? match[3], htmlToText(match[4]));
  }
  for (const match of String(text).matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    add(match[0].replace(/[.,;!?]+$/, ""));
  }
  return [...urls.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(item => item.url);
}