(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const demo = window.TEMPMAIL_CONFIG?.demo === true;
  const storageKey = demo ? "singgah-demo-mailbox-v1" : "singgah-mailbox-v1";
  const cfg = window.TEMPMAIL_CONFIG || {};
  const base = String(cfg.apiBase || "").replace(/\/$/, "");
  const state = { config: null, mailbox: null, messages: [], detail: null, epoch: 0, routeEpoch: 0,
    pending: null, busy: false, timer: null, lastSignature: "", knownIds: new Set(), firstLoad: true };
  let toastTimer;
  let storageWarned = false;

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function saveMailbox(mailbox) {
    try { localStorage.setItem(storageKey, JSON.stringify(mailbox)); }
    catch {
      if (!storageWarned) { toast("Penyimpanan browser diblokir. Alamat hanya aktif selama halaman ini terbuka."); storageWarned = true; }
    }
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`); svg.append(use); return svg;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function toast(message) {
    clearTimeout(toastTimer); $("toast-text").textContent = message; $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3800);
  }
  function report(error) {
    $("error-text").textContent = error.message || "Tidak dapat terhubung ke server.";
    $("error-banner").hidden = false;
    $("sync-status").textContent = "Koneksi terputus";
    $("mailbox-status").classList.add("offline");
    $("mailbox-status-text").textContent = error.status === 401 ? "Kedaluwarsa" : "Terputus";
    $("announcer").textContent = $("error-text").textContent;
  }
  function clearError() {
    $("error-banner").hidden = true;
    $("mailbox-status").classList.remove("offline");
    $("mailbox-status-text").textContent = demo ? "Mode demo" : "Aktif";
  }
  async function copy(value) {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = el("textarea", "sr-only");
        input.value = value; input.setAttribute("readonly", ""); document.body.append(input);
        input.select(); const ok = document.execCommand("copy"); input.remove();
        if (!ok) throw new Error("Clipboard tidak tersedia.");
      }
      toast("Tersalin ✓");
    } catch {
      toast("Tidak bisa menyalin otomatis. Pilih dan salin teks secara manual.");
    }
  }
  function confirmAction(message) {
    return new Promise(resolve => {
      const dialog = $("confirm-dialog");
      $("confirm-text").textContent = message;
      dialog.returnValue = "cancel";
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }
  async function api(path, { method = "GET", body, mailbox = state.mailbox } = {}) {
    if (demo) return window.SinggahDemo.request(path, { method, body, mailbox });
    if (!base) throw new Error("URL API belum diisi pada public/config.js.");
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (mailbox) {
      headers.Authorization = `Bearer ${mailbox.token}`;
      headers["X-Mailbox-Address"] = mailbox.address;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
      });
      let data;
      try { data = await response.json(); } catch { throw new Error("Respons API bukan JSON. Periksa URL Worker."); }
      if (!response.ok) {
        const error = new Error(data.error || `Permintaan gagal (${response.status}).`);
        error.status = response.status; throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Server terlalu lama merespons. Coba lagi.");
      if (error instanceof TypeError) throw new Error("Tidak dapat menghubungi API. Periksa koneksi, URL Worker, dan ALLOWED_ORIGINS.");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function relativeTime(timestamp) {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (diff < 60) return "Baru saja";
    if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return `${Math.floor(diff / 86400)} hari lalu`;
  }
  function fullDate(timestamp) {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "long", timeStyle: "short"
    }).format(new Date(timestamp * 1000));
  }
  function activateMailbox(mailbox) {
    state.epoch++; state.mailbox = mailbox; state.messages = []; state.detail = null;
    state.lastSignature = ""; state.knownIds.clear(); state.firstLoad = true;
    saveMailbox(mailbox);
    $("address").textContent = mailbox.address;
    $("copy-address").disabled = false;
    $("refresh").disabled = false;
    $("new-address").disabled = false;
    $("custom-address").disabled = false;
    $("loading").hidden = false;
    $("empty-state").hidden = true;
    $("message-list").replaceChildren();
    $("unread-count").textContent = "0";
    $("clear-inbox").disabled = true;
    $("message-count").textContent = "0 pesan";
  }
  async function createAddress(username, domain) {
    if (state.busy) return;
    state.busy = true;
    $("new-address").disabled = true; $("custom-submit").disabled = true; $("custom-address").disabled = true;
    try {
      const mailbox = await api("/api/mailboxes", { method: "POST", body: { username, domain }, mailbox: null });
      activateMailbox(mailbox); clearError();
      $("custom-dialog").close();
      location.hash = "/inbox"; route();
      await refresh();
      toast(username ? "Alamat custom siap digunakan." : "Alamat baru siap digunakan.");
    } finally {
      state.busy = false;
      $("new-address").disabled = !state.config;
      $("custom-address").disabled = !state.config;
      $("custom-submit").disabled = false;
    }
  }

  function renderInbox() {
    const unread = state.messages.filter(message => !message.is_read).length;
    $("unread-count").textContent = String(unread);
    $("unread-count").setAttribute("aria-label", `${unread} pesan belum dibaca`);
    $("message-count").textContent = `${state.messages.length} pesan`;
    $("clear-inbox").disabled = !state.messages.length;
    $("loading").hidden = true;
    $("empty-state").hidden = state.messages.length !== 0;
    document.title = unread ? `(${unread}) Singgah — Kotak masuk` : "Singgah — Email sebentar, tenang lebih lama.";
    const signature = JSON.stringify(state.messages);
    if (signature !== state.lastSignature) {
      state.lastSignature = signature;
      const focusedId = document.activeElement?.dataset?.messageId;
      const fragment = document.createDocumentFragment();
      for (const message of state.messages) {
        const button = el("button", `mail-row${message.is_read ? "" : " unread"}`);
        button.type = "button"; button.dataset.messageId = message.id;
        button.setAttribute("aria-label", `${message.is_read ? "" : "Belum dibaca. "}${message.from_name || message.from_addr}. ${message.subject}`);
        const sender = message.from_name || message.from_addr || "?";
        button.append(el("span", "sender-avatar", sender[0].toUpperCase()));
        const content = el("div", "mail-content");
        const top = el("div", "mail-topline");
        top.append(el("span", "mail-sender", sender));
        const time = el("time", "mail-time", relativeTime(message.received_at));
        time.dateTime = new Date(message.received_at * 1000).toISOString();
        time.dataset.timestamp = message.received_at; time.title = fullDate(message.received_at);
        top.append(time); content.append(top);
        content.append(el("span", "mail-subject", message.subject || "(Tanpa subjek)"));
        content.append(el("div", "mail-preview", message.preview || ""));
        const tags = el("div", "mail-tags");
        if (message.otp) {
          const tag = el("span", "otp-badge", "OTP"); tag.append(el("strong", "", message.otp)); tags.append(tag);
        }
        if (message.links?.length) {
          const tag = el("span", "link-badge"); tag.append(icon("external"), document.createTextNode("Link tersedia")); tags.append(tag);
        }
        if (tags.childNodes.length) content.append(tags);
        button.append(content);
        button.addEventListener("click", () => { location.hash = `/message/${message.id}`; });
        fragment.append(button);
      }
      $("message-list").replaceChildren(fragment);
      if (focusedId) {
        const target = [...$("message-list").children].find(node => node.dataset.messageId === focusedId);
        target?.focus({ preventScroll: true });
      }
    } else {
      document.querySelectorAll("time[data-timestamp]").forEach(node => {
        node.textContent = relativeTime(Number(node.dataset.timestamp));
      });
    }
  }

  async function refresh({ manual = false } = {}) {
    if (!state.mailbox) return;
    const epoch = state.epoch;
    if (state.pending?.epoch === epoch) return state.pending.promise;
    const mailbox = { ...state.mailbox };
    const task = (async () => {
      $("sync-status").textContent = "Menyegarkan…";
      try {
        const data = await api(`/api/inbox?address=${encodeURIComponent(mailbox.address)}`, { mailbox });
        if (epoch !== state.epoch) return;
        const fresh = data.messages.filter(message => !state.knownIds.has(message.id)).length;
        state.messages = data.messages;
        if (!state.firstLoad && fresh) $("announcer").textContent = `${fresh} email baru masuk.`;
        state.firstLoad = false;
        state.knownIds = new Set(data.messages.map(m => m.id));
        clearError(); renderInbox();
        $("sync-status").textContent = "Baru diperbarui";
        if (manual) toast("Kotak masuk diperbarui.");
      } catch (error) {
        if (epoch === state.epoch) { $("loading").hidden = true; report(error); }
      } finally {
        if (state.pending?.epoch === epoch) state.pending = null;
      }
    })();
    state.pending = { epoch, promise: task };
    return task;
  }

  // Template inert mencegah aktivasi resource saat parsing. Bangun ulang hanya tag aman,
  // tanpa seluruh atribut HTML asli, gambar, form, media, SVG, CSS, atau navigasi.
  function safeEmailDocument(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const safeTags = new Set(["P", "DIV", "SPAN", "BR", "HR", "STRONG", "B", "EM", "I", "U", "S",
      "SMALL", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE",
      "PRE", "CODE", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "SUB", "SUP"]);
    const drop = new Set(["SCRIPT", "STYLE", "SVG", "MATH", "IFRAME", "OBJECT", "EMBED", "LINK",
      "META", "BASE", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "IMG", "VIDEO", "AUDIO", "SOURCE", "TEMPLATE", "NOSCRIPT"]);
    const output = document.createElement("div");
    // Iteratif: email dengan nesting ekstrem tidak menyebabkan stack overflow.
    const stack = [...template.content.childNodes].reverse().map(node => ({ node, parent: output, depth: 0 }));
    let count = 0;
    while (stack.length && count++ < 20000) {
      const { node, parent, depth } = stack.pop();
      if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE || drop.has(node.tagName) || depth > 80) continue;
      const next = document.createElement(safeTags.has(node.tagName) ? node.tagName.toLowerCase() : "span");
      if (["TD", "TH"].includes(node.tagName)) {
        for (const attribute of ["colspan", "rowspan"]) {
          const n = Number(node.getAttribute(attribute));
          if (n >= 1 && n <= 20) next.setAttribute(attribute, String(Math.floor(n)));
        }
      }
      parent.append(next);
      for (const child of [...node.childNodes].reverse()) stack.push({ node: child, parent: next, depth: depth + 1 });
    }
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>body{font:14px/1.75 system-ui,sans-serif;color:#263d32;background:#fff;padding:18px;margin:0;overflow-wrap:anywhere}table{max-width:100%;border-collapse:collapse}td,th{padding:7px;vertical-align:top}pre{white-space:pre-wrap}h1,h2,h3{line-height:1.3}blockquote{border-left:3px solid #c9dfcf;margin-left:0;padding-left:15px}a{color:inherit}</style></head><body>${output.innerHTML}</body></html>`;
  }
  function safeLink(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function renderDetail(message) {
    $("message-subject").textContent = message.subject || "(Tanpa subjek)";
    $("message-from").textContent = message.from_name || message.from_addr;
    $("message-from-address").textContent = message.from_addr;
    $("sender-avatar").textContent = (message.from_name || message.from_addr || "?")[0].toUpperCase();
    $("message-to").textContent = message.address;
    $("message-date").textContent = fullDate(message.received_at);
    $("message-expiry").textContent = fullDate(message.expires_at);
    $("otp-card").hidden = !message.otp;
    $("otp-value").textContent = message.otp || "";
    $("message-links").replaceChildren();
    const links = (message.links || []).map(safeLink).filter(Boolean);
    $("links-card").hidden = !links.length;
    for (const link of links) {
      const row = el("div", "link-item");
      const title = el("span", "link-title", link); title.title = link;
      const open = el("a", "button secondary", "Buka link"); open.href = link;
      open.target = "_blank"; open.rel = "noopener noreferrer"; open.referrerPolicy = "no-referrer";
      open.setAttribute("aria-label", `Buka link ke ${new URL(link).hostname}`); open.append(icon("external"));
      const copyButton = el("button", "icon-button"); copyButton.type = "button"; copyButton.title = "Salin link";
      copyButton.setAttribute("aria-label", `Salin link ke ${new URL(link).hostname}`);
      copyButton.append(icon("copy")); copyButton.addEventListener("click", () => copy(link));
      row.append(title, open, copyButton); $("message-links").append(row);
    }
    $("message-text").textContent = message.text_body || "(Tidak ada isi teks)";
    $("message-frame").srcdoc = message.html_body ? safeEmailDocument(message.html_body) : "";
    $("message-frame").hidden = !message.html_body;
    $("message-text").hidden = !!message.html_body;
    $("toggle-body").hidden = !message.html_body;
    $("toggle-body").textContent = "Lihat teks biasa";
    $("message-subject").focus({ preventScroll: true });
  }

  async function route() {
    const routeEpoch = ++state.routeEpoch;
    const match = location.hash.match(/^#\/message\/([a-f0-9-]{36})$/);
    if (!match || !state.mailbox) {
      state.detailBusy = false;
      $("detail-view").hidden = true; $("inbox-view").hidden = false;
      if (location.hash !== "#/inbox") history.replaceState(null, "", "#/inbox");
      return;
    }
    const epoch = state.epoch;
    state.detail = null;
    $("delete-message").disabled = true;
    $("inbox-view").hidden = true; $("detail-view").hidden = false;
    $("detail-loading").hidden = false; $("message-article").hidden = true;
    try {
      state.detailBusy = true;
      // Selesaikan polling yang sedang berjalan sebelum perubahan status dibaca.
      const pending = state.pending?.promise;
      if (pending) await pending;
      if (routeEpoch !== state.routeEpoch || epoch !== state.epoch) return;
      const data = await api(`/api/message/${match[1]}`);
      if (routeEpoch !== state.routeEpoch || epoch !== state.epoch) return;
      state.detail = data.message;
      const listItem = state.messages.find(item => item.id === data.message.id);
      if (listItem) listItem.is_read = true;
      renderInbox();
      $("message-article").hidden = false; $("delete-message").disabled = false;
      renderDetail(data.message); clearError();
      $("detail-view").scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      if (routeEpoch === state.routeEpoch) { report(error); location.hash = "/inbox"; }
    } finally {
      if (routeEpoch === state.routeEpoch) { $("detail-loading").hidden = true; state.detailBusy = false; }
    }
  }
  function schedulePoll() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      if (!document.hidden && !state.busy && !state.detailBusy) await refresh();
      schedulePoll();
    }, (state.config?.poll_seconds || 7) * 1000);
  }

  async function boot() {
    if (state.booting) return;
    state.booting = true;
    try {
      state.config = await api("/api/config", { mailbox: null });
      if (!state.config.domains?.length) throw new Error("Belum ada domain email yang dikonfigurasi.");
      $("ttl-hours").textContent = `${state.config.email_ttl_hours} jam`;
      $("poll-caption").textContent = `Diperbarui otomatis setiap ${state.config.poll_seconds} detik`;
      $("custom-domain").replaceChildren(...state.config.domains.map(domain => {
        const option = el("option", "", `@${domain}`); option.value = domain; return option;
      }));
      $("new-address").disabled = false; $("custom-address").disabled = false;
      const saved = readStorage(storageKey);
      const validSaved = saved && typeof saved.address === "string" && typeof saved.token === "string" &&
        saved.expires_at > Date.now() / 1000 && state.config.domains.includes(saved.address.split("@")[1]);
      if (validSaved) {
        activateMailbox(saved); await refresh(); await route();
      } else {
        const mailbox = await api("/api/mailboxes", { method: "POST", body: {}, mailbox: null });
        activateMailbox(mailbox); await refresh(); await route();
      }
      schedulePoll();
    } catch (error) { $("loading").hidden = true; report(error); }
    finally { state.booting = false; }
  }

  $("theme-toggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("singgah-theme", theme); } catch { /* Preferensi hanya berlaku untuk sesi ini. */ }
    $("theme-toggle").setAttribute("aria-label", theme === "dark" ? "Aktifkan tema terang" : "Aktifkan tema gelap");
  });
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  systemTheme.addEventListener("change", event => {
    try { if (localStorage.getItem("singgah-theme")) return; } catch { /* Ikuti sistem jika storage diblokir. */ }
    document.documentElement.dataset.theme = event.matches ? "dark" : "light";
  });
  $("copy-address").addEventListener("click", () => copy(state.mailbox?.address));
  $("copy-otp").addEventListener("click", () => copy(state.detail?.otp));
  $("refresh").addEventListener("click", () => refresh({ manual: true }));
  $("retry").addEventListener("click", () => state.mailbox ? refresh({ manual: true }) : boot());
  $("back-inbox").addEventListener("click", () => { location.hash = "/inbox"; });
  $("custom-address").addEventListener("click", () => {
    $("custom-error").textContent = ""; $("custom-dialog").showModal(); $("custom-username").focus();
  });
  $("close-custom").addEventListener("click", () => $("custom-dialog").close());
  $("custom-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.busy) return;
    if (state.mailbox && !await confirmAction("Alamat lama tidak akan disimpan di aplikasi ini. Pesan lama tetap kedaluwarsa otomatis. Gunakan alamat custom?")) return;
    try { await createAddress($("custom-username").value.trim().toLowerCase(), $("custom-domain").value); }
    catch (error) { $("custom-error").textContent = error.message; }
  });
  $("new-address").addEventListener("click", async () => {
    if (!await confirmAction("Ganti alamat? Akses ke kotak masuk lama akan dilepas dari browser ini. Pesan lama terhapus sesuai masa berlakunya.")) return;
    try { await createAddress(); } catch (error) { report(error); }
  });
  $("clear-inbox").addEventListener("click", async () => {
    const mailbox = state.mailbox; const epoch = state.epoch;
    if (!mailbox || !await confirmAction("Hapus semua pesan di kotak masuk ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      state.detailBusy = true;
      if (state.pending) await state.pending.promise;
      if (epoch !== state.epoch) return;
      await api(`/api/inbox?address=${encodeURIComponent(mailbox.address)}`, { method: "DELETE", mailbox });
      await refresh(); toast("Semua pesan dihapus.");
    } catch (error) { report(error); } finally { state.detailBusy = false; }
  });
  $("delete-message").addEventListener("click", async () => {
    const message = state.detail; const mailbox = state.mailbox; const epoch = state.epoch;
    if (!message || !await confirmAction("Hapus pesan ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      state.detailBusy = true;
      if (state.pending) await state.pending.promise;
      if (epoch !== state.epoch) return;
      await api(`/api/message/${message.id}`, { method: "DELETE", mailbox });
      location.hash = "/inbox"; toast("Pesan dihapus."); await refresh();
    } catch (error) { report(error); } finally { state.detailBusy = false; }
  });
  $("toggle-body").addEventListener("click", () => {
    const showHtml = $("message-frame").hidden;
    $("message-frame").hidden = !showHtml; $("message-text").hidden = showHtml;
    $("toggle-body").textContent = showHtml ? "Lihat teks biasa" : "Lihat tampilan HTML";
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => refresh());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("storage", event => {
    if (event.key !== storageKey) return;
    const saved = readStorage(storageKey);
    if (saved?.address && saved?.token) {
      activateMailbox(saved); location.hash = "/inbox"; route(); refresh();
      toast("Alamat disinkronkan dari tab lain.");
    }
  });
  if (demo) {
    $("demo-banner").hidden = false;
    $("demo-add").addEventListener("click", async () => {
      if (!state.mailbox) return;
      window.SinggahDemo.addSample(state.mailbox.address); await refresh(); toast("Satu email contoh masuk.");
    });
  }
  boot();
})();