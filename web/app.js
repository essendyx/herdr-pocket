// herdr App: Oberfläche aus dem freigegebenen Entwurf, Daten live vom Server.
(function () {
  const API = window.HerdrApi;
  const $ = s => document.querySelector(s);
  const app = $("#app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  // Links (http/https) anklickbar; Satzzeichen am Ende gehören nicht zum Link
  const linkify = h => h.replace(/\bhttps?:\/\/(?:[^\s<>"`*&]|&amp;)+/g, u => { const m = u.match(/^(.*?)([.,;:!?)\]]*)$/); const url = m[1]; return '<a href="' + (IOS_APP ? "x-safari-" : "") + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + m[2]; });
  // In der iPhone-App vom Home-Bildschirm öffnet x-safari-https:// den Link im echten Safari (iOS 17+), nicht im eingebetteten Fenster
  const md = s => linkify(esc(s)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  // Markdown-Tabellen (| a | b | mit Trennzeile |---|) als echte Tabelle, Rest wie gehabt
  const TROW = /^\s*\|.*\|\s*$/, TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const cells = l => l.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0000").split("|").map(c => c.trim().replace(/\u0000/g, "|"));
  function mdTables(s) {
    const lines = s.split("\n"), out = [];
    let buf = [];
    const flush = () => { if (buf.length) out.push(md(buf.join("\n"))); buf = []; };
    for (let i = 0; i < lines.length; i++) {
      if (TROW.test(lines[i]) && i + 1 < lines.length && TSEP.test(lines[i + 1]) && cells(lines[i]).length === cells(lines[i + 1]).length) {
        flush();
        const al = cells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "");
        const st = k => al[k] ? ' style="text-align:' + al[k] + '"' : "";
        let h = '<div class="tablewrap"><table><thead><tr>' + cells(lines[i]).map((c, k) => "<th" + st(k) + ">" + md(c) + "</th>").join("") + "</tr></thead><tbody>";
        i += 2;
        for (; i < lines.length && TROW.test(lines[i]); i++) h += "<tr>" + cells(lines[i]).map((c, k) => "<td" + st(k) + ">" + md(c) + "</td>").join("") + "</tr>";
        i--;
        out.push(h + "</tbody></table></div>");
      } else buf.push(lines[i]);
    }
    flush();
    return out.join("");
  }
  // Antworttext mit Codeblöcken (```): eigener Kasten mit Kopieren; eine einzelne "!"-Zeile bekommt einen Senden-Knopf
  const FENCE = /^([ \t]*)```[^\n]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;
  function mdText(s) {
    let out = "", last = 0, m;
    FENCE.lastIndex = 0;
    while ((m = FENCE.exec(s))) {
      out += mdTables(s.slice(last, m.index).replace(/\n$/, ""));
      const ind = m[1].length;
      const code = m[2].split("\n").map(l => l.slice(Math.min(ind, l.length - l.trimStart().length))).join("\n");
      const one = code.trim(), run = !one.includes("\n") && /^!\s*\S/.test(one);
      out += '<div class="codewrap"><pre class="codeblock"><code>' + esc(code) + '</code></pre><div class="cbtns">' +
        (run ? '<button type="button" class="btn primary" data-runline="' + esc(one) + '">Senden</button>' : "") +
        '<button type="button" class="btn" data-copy="' + esc(code) + '">Kopieren</button></div></div>';
      last = FENCE.lastIndex;
    }
    return out + mdTables(s.slice(last).replace(/^\n/, ""));
  }
  const isDesk = () => matchMedia("(min-width: 960px)").matches;
  // iPhone/iPad-App vom Home-Bildschirm: dort liefert die Spracherkennung nichts, also kein Mikrofon-Knopf
  const IOS_APP = /iPhone|iPad|iPod/.test(navigator.userAgent) && (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("herdr:" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("herdr:" + k, JSON.stringify(v)); } catch (_) {} },
  };

  // Anzeige-Texte
  const MODES = [
    { v: "default", s: "Fragt", l: "Fragt nach", d: "Fragt vor jeder Änderung und jedem Befehl" },
    { v: "acceptEdits", s: "Edits auto", l: "Änderungen automatisch", d: "Dateien ändern ohne Rückfrage, Befehle mit Rückfrage" },
    { v: "plan", s: "Plan", l: "Nur planen", d: "Liest und plant, ändert nichts" },
    { v: "auto", s: "Auto", l: "Auto-Modus", d: "Arbeitet selbstständig, fragt nur bei riskanten Schritten" },
  ];
  const MODE = Object.fromEntries(MODES.map(m => [m.v, m]));
  const MODELS = [
    { v: "opus", n: "Opus 5.5", d: "Standard für anspruchsvolle Aufgaben" },
    { v: "sonnet", n: "Sonnet 5.5", d: "Schneller, für Routinearbeit" },
    { v: "haiku", n: "Haiku 5.5", d: "Am schnellsten, für Kleinkram" },
    { v: "fable", n: "Fable 5.2", d: "" },
  ];
  const EFFORTS = [["low", "niedrig"], ["medium", "mittel"], ["high", "hoch"], ["xhigh", "sehr hoch"], ["max", "max"]];
  const EFF = Object.fromEntries(EFFORTS);
  const ST = { blocked: "Wartet auf dich", working: "Arbeitet", done: "Fertig", idle: "Bereit" };
  const SHORT = { blocked: "wartet", working: "arbeitet", done: "fertig", idle: "bereit" };
  const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };
  const KEYMAP = { "Enter": "enter", "Esc": "esc", "Tab": "tab", "↑": "up", "↓": "down", "Strg+C": "ctrl+c", "Strg+D": "ctrl+d" };
  const CAPPED = /^(Strg\+C|\/clear)$/;
  const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l3 3.2v2H6v-2z"/></svg>';
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';
  const BACK = '<button type="button" class="iconbtn mobile-only" data-back title="Zurück"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg></button>';
  // Kleines ✕ im Eingabefeld: leert den noch nicht gesendeten Text
  const CLEARX = '<button type="button" class="clearmsg" data-clear-msg title="Eingabe leeren" aria-label="Eingabe leeren" hidden>✕</button>';
  const SEND = '<button type="button" class="round send" data-send title="Senden"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>';
  const TERM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>';
  const countText = (a, sh) => (a ? a + (a === 1 ? " Agent" : " Agents") : "keine Agents") + (sh ? " · " + sh + (sh === 1 ? " Shell" : " Shells") : "");
  const modelName = id => { if (!id) return "unbekannt"; const m = MODELS.find(x => id.includes(x.v)); return m ? m.n : id.replace(/^claude-/, ""); };
  const modelKey = id => { const m = MODELS.find(x => (id || "").includes(x.v)); return m ? m.v : "opus"; };
  // Agent-Arten: Claude, Codex (ChatGPT-Abo), opencode mit lokalem Modell
  const KIND_NAME = { claude: "Claude", codex: "Codex", opencode: "Lokale KI" };
  const KIND_LONG = { codex: "Codex · ChatGPT-Abo", opencode: "Lokale KI · Qwen 3.5 9B" };
  const isClaude = a => !a.kind || a.kind === "claude";
  const home = p => String(p || "").replace(/^\/home\/[^/]+/, "~");

  // Zustand
  let S = { ok: false, agents: [], shells: [], spaces: [] };
  let wsOnline = false, loaded = false;
  const state = { tab: "agents", list: "agents", space: null, agent: null, shell: null, filter: null, q: "", view: "chat", planOpen: false };
  const feeds = {};        // pane -> { feed, screen, dialog }
  let changes = {};        // pane -> diff-Liste
  let screens = {};        // pane -> Bildschirmtext
  let activity = [];
  let settings = { notify: { blocked: true, done: true, working: false }, quiet: true };
  let seenDone = store.get("seenDone", {});
  let drafts = store.get("drafts", {});
  let armed = null, armT, toastT, undoT, undoFn = null, pending = [], cfgAgent = null;
  const draft = Object.assign({ mode: "auto", model: "opus", effort: "high" }, store.get("newDraft", {}));

  const byId = id => S.agents.find(a => a.id === id);
  const shellById = id => S.shells.find(x => x.id === id);
  const wsLabel = id => (S.spaces.find(s => s.id === id) || {}).label || id;
  // Letzte Nachricht, bei neuen Agents ohne Nachricht die Startzeit
  const recency = a => a.lastActive || a.since || 0;
  // "fertig" gilt als gesehen, wenn der Server es meldet (alle Geräte) oder hier gerade markiert wurde
  const shown = a => (a.status === "done" && (a.seen || seenDone[a.id] === a.since) ? "idle" : a.status);

  function ago(ms, status) {
    if (!ms) return "";
    const m = Math.round((Date.now() - ms) / 60000);
    const pre = status === "working" ? "seit " : "vor ";
    if (m < 1) return "gerade";
    if (m < 60) return pre + m + " Min";
    const h = Math.round(m / 60);
    if (h < 24) return pre + h + " Std";
    const d = new Date(ms);
    if (h < 48) return "gestern";
    return d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
  }

  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), Math.min(8000, Math.max(2200, String(t).length * 65))); }
  async function act(fn, okText) {
    try { const r = await fn(); if (okText) toast(okText); return r; }
    catch (e) { toast(e.message || "Fehler"); throw e; }
  }

  // Karten und Listen
  function cardHTML(a, inGroup) {
    const st = shown(a);
    const cur = state.agent === a.id && isDesk() ? ' aria-current="true"' : "";
    let ask = "";
    if (a.status === "blocked" && a.dialog && a.dialog.kind === "question") {
      ask = '<div class="ask"><code>' + esc(a.dialog.question) + '</code><div class="btnrow"><span class="btn primary">Beantworten</span></div></div>';
    } else if (a.status === "blocked" && a.dialog) {
      const hh = ' data-hash="' + esc(a.dialog.hash) + '"';
      ask = '<div class="ask"><code>' + esc(a.dialog.detail || a.dialog.question) + '</code><div class="btnrow"><span class="btn primary" data-approve="' + esc(a.id) + '"' + hh + '>Erlauben</span><span class="btn" data-deny="' + esc(a.id) + '"' + hh + '>Ablehnen</span></div></div>';
    }
    return '<button type="button" class="card' + (a.status === "blocked" ? " is-blocked" : "") + '" data-agent="' + a.id + '"' + cur + '>' +
      (inGroup ? "" : '<span class="proj">' + esc(a.project) + '</span>') +
      '<span class="dot ' + st + '"></span>' +
      '<span class="title">' + (a.pinned ? '<span class="pinmark" title="Angeheftet">' + PIN_SVG + '</span>' : "") + (a.tip ? '<span class="tipmark" title="Offener Tipp">✦</span> ' : "") + esc(a.title || a.project) + '</span>' +
      '<span class="time">' + esc(ago(st === "working" ? a.since : a.lastActive || a.since, st)) + '</span>' +
      '<span class="meta">' + esc(wsLabel(a.ws)) + '</span>' +
      (isClaude(a) ? '<span class="cfgmini" title="Modell, Modus und Effort">' + esc(modelName(a.model).split(" ")[0]) + ' · ' + esc((MODE[a.mode] || MODE.default).s.split(" ")[0]) + ' · ' + esc(EFF[a.effort] || a.effort || "?") + '</span>'
        : '<span class="cfgmini kind-' + esc(a.kind) + '">' + esc(KIND_NAME[a.kind] || a.kind) + '</span>') +
      ask + '</button>';
  }

  function shellHTML(x) {
    const cur = state.shell === x.id && isDesk() ? ' aria-current="true"' : "";
    return '<div class="shell"' + cur + '><button type="button" class="shell-main" data-shell="' + x.id + '"><span class="sh-ic">' + TERM_SVG + '</span><span class="sh-t"><b>Shell</b><code>' + esc(home(x.cwd)) + '</code></span></button>' +
      '<div class="btnrow"><button type="button" class="btn primary" data-claude-here="' + x.id + '">Claude hier starten</button><button type="button" class="btn" data-close-shell="' + x.id + '">Schließen</button></div></div>';
  }

  function renderConn() {
    const bar = $("#connbar");
    const msg = !wsOnline && loaded ? "Verbinde neu …" : !S.ok && loaded ? "Keine Verbindung zu herdr" : "";
    bar.textContent = msg;
    bar.hidden = !msg;
  }

  function renderList() {
    const c = { blocked: 0, working: 0, done: 0, idle: 0 };
    S.agents.forEach(a => c[shown(a)]++);
    $("#counts").innerHTML = ["blocked", "working", "done", "idle"].map(s =>
      '<button type="button" class="count" data-filter="' + s + '" aria-pressed="' + (state.filter === s) + '"><span class="dot ' + s + '"></span><span class="n">' + c[s] + '</span>' + SHORT[s] + '</button>').join("");
    // Abo-Verbrauch wie im Entwurf: 5 Stunden und Woche, mit Zeitpunkt des Zurücksetzens
    const U = S.usage, qw = (label, w) => {
      if (!w) return "";
      const d = new Date(w.resetsAt), soon = w.resetsAt - Date.now() < 86400000;
      const when = soon ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { weekday: "short" }) + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return '<span class="q" title="Zurückgesetzt ' + esc(when) + '">' + label + ' <span class="mini' + (w.pct >= 80 ? " hot" : "") + '"><i style="width:' + w.pct + '%"></i></span>' + w.pct + ' %<small>bis ' + esc(when) + '</small></span>';
    };
    $("#quota").innerHTML = U ? '<span>Claude-Abo</span>' + qw("5 h", U.five) + qw("Woche", U.week) : "";
    $("#quota").hidden = !U;
    $("#tabBadge").textContent = c.blocked;
    $("#tabBadge").hidden = !c.blocked;
    $("#counts").hidden = state.list === "spaces";
    $("#q").placeholder = state.list === "spaces" ? "Space oder Projekt suchen" : "Projekt oder Thema suchen";

    const q = state.q.toLowerCase();
    const textMatch = a => !q || (a.title + " " + a.project + " " + wsLabel(a.ws)).toLowerCase().includes(q);
    let h = "";
    if (!loaded) h = '<div class="loading">Lade …</div>';
    else if (state.list === "spaces" && state.space) {
      const w = state.space;
      const all = S.agents.filter(a => a.ws === w);
      const g = all.filter(textMatch).sort((x, y) => RANK[shown(x)] - RANK[shown(y)]);
      const sh = S.shells.filter(x => x.ws === w);
      const projects = [...new Set(all.map(a => a.project).concat(sh.map(x => x.cwd.split("/").pop())))];
      h += '<div class="crumb"><button type="button" data-spaces-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>Alle Spaces</button></div>' +
        '<h2 class="space-h">' + esc(wsLabel(w)) + '</h2><div class="space-sub">' + countText(all.length, sh.length) + (projects.length ? ' · ' + projects.length + (projects.length === 1 ? " Projekt" : " Projekte") : "") + '</div>';
      if (all.length) h += '<div class="section-h"><span>Agents</span></div><div class="list">' + g.map(a => cardHTML(a)).join("") + '</div>';
      if (all.length && !g.length) h += '<div class="empty">Kein Agent passt zu „' + esc(state.q) + '“.</div>';
      if (sh.length) h += '<div class="section-h"><span>Shells</span></div><div class="list">' + sh.map(shellHTML).join("") + '</div>';
      if (!all.length && !sh.length) {
        h += '<div class="emptyspace">' + TERM_SVG + '<b>Hier läuft nichts mehr</b><span>In diesem Space ist kein Fenster offen.</span><div class="btnrow"><button type="button" class="btn primary" data-new>Agent starten</button><button type="button" class="btn" data-close-space="' + w + '">Space schließen</button></div></div>';
      } else {
        h += '<div class="space-actions"><button type="button" class="btn ghost danger" data-close-space="' + w + '">Space schließen</button></div>';
      }
    } else if (state.list === "spaces") {
      const rank = w => { const g = S.agents.filter(a => a.ws === w); return g.length ? Math.min(...g.map(a => RANK[shown(a)])) : (S.shells.some(x => x.ws === w) ? 8 : 9); };
      const ids = S.spaces.map(s => s.id).filter(w => !q || wsLabel(w).toLowerCase().includes(q) || S.agents.some(a => a.ws === w && textMatch(a)) || S.shells.some(x => x.ws === w && x.cwd.toLowerCase().includes(q)));
      ids.sort((x, y) => rank(x) - rank(y));
      h += '<div class="spaces">' + ids.map(w => {
        const g = S.agents.filter(a => a.ws === w);
        const sh = S.shells.filter(x => x.ws === w);
        const c2 = { blocked: 0, working: 0, done: 0 };
        g.forEach(a => { const s = shown(a); if (s in c2) c2[s]++; });
        const pills = ["blocked", "working", "done"].filter(s => c2[s]).map(s => '<span class="pill ' + s + '">' + c2[s] + " " + SHORT[s] + '</span>').join("");
        const rest = g.length ? '<span class="pill">alle bereit</span>' : (sh.length ? '<span class="pill">nur Shell</span>' : '<span class="pill">leer</span>');
        return '<button type="button" class="space' + (c2.blocked ? " has-blocked" : "") + (g.length ? "" : " dim") + '" data-space="' + w + '"><span class="nm">' + esc(wsLabel(w)) + '</span><span class="n">' + countText(g.length, sh.length) + '</span>' +
          '<span class="pr">' + esc([...new Set(g.map(a => a.project).concat(sh.map(x => x.cwd.split("/").pop())))].join(", ") || "kein Fenster offen") + '</span>' +
          '<span class="st">' + (pills || rest) + '</span></button>';
      }).join("") + '</div>';
      if (!ids.length) h = '<div class="empty">' + (q ? 'Kein Space passt zu „' + esc(state.q) + '“.' : "Keine Spaces.") + '</div>';
    } else {
      const all = S.agents.filter(a => textMatch(a) && (!state.filter || shown(a) === state.filter));
      const pinned = all.filter(a => a.pinned).sort((x, y) => recency(y) - recency(x));
      const list = all.filter(a => !a.pinned);
      const grp = store.get("group", "status");
      h += '<div class="groupby" role="group" aria-label="Gruppieren"><button type="button" data-group="status" aria-pressed="' + (grp !== "project") + '">Nach Status</button><button type="button" data-group="project" aria-pressed="' + (grp === "project") + '">Nach Projekt</button></div>';
      if (pinned.length) h += '<div class="section-h"><span>Angeheftet</span></div><div class="list">' + pinned.map(a => cardHTML(a)).join("") + '</div>';
      if (grp === "project") {
        // Zuletzt aktives Projekt oben, in der Gruppe der zuletzt aktive Agent oben
        const by = new Map();
        list.forEach(a => { if (!by.has(a.project)) by.set(a.project, []); by.get(a.project).push(a); });
        const recent = g => Math.max(0, ...g.map(recency));
        [...by.entries()].sort((x, y) => recent(y[1]) - recent(x[1]) || x[0].localeCompare(y[0], "de")).forEach(([p, g]) => {
          g.sort((x, y) => recency(y) - recency(x));
          h += '<div class="proj-h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span class="pname">' + esc(p) + '</span><span class="pn">' + g.length + '</span></div><div class="list">' + g.map(a => cardHTML(a, true)).join("") + '</div>';
        });
      } else ["blocked", "working", "done", "idle"].forEach(s => {
        const g = list.filter(a => shown(a) === s).sort((x, y) => recency(y) - recency(x));
        if (!g.length) return;
        h += '<div class="section-h"><span>' + ST[s] + '</span>' + (s === "done" ? '<button type="button" data-clear>Als gesehen markieren</button>' : "") + '</div><div class="list">' + g.map(a => cardHTML(a)).join("") + '</div>';
      });
      if (!all.length) h += '<div class="empty">' + (q || state.filter ? 'Kein Agent passt.' : "Gerade läuft kein Agent. Starte einen mit dem Plus.") + '</div>';
    }
    $("#listBody").innerHTML = h;
  }

  // Bildpfade in eigenen Nachrichten wie in der Konsole als [Bild N] zeigen
  const IMG_PATH = /(?:Bild:\s*)?(\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|heic|heif))\b/gi;
  // Anklickbar: öffnet das Bild groß
  function imgHTML(s) {
    let out = "", last = 0, n = 0, m;
    s = String(s); IMG_PATH.lastIndex = 0;
    while ((m = IMG_PATH.exec(s))) {
      out += esc(s.slice(last, m.index)) + '<button type="button" class="imgref" data-img="' + esc(m[1]) + '">[Bild ' + ++n + ']</button>';
      last = IMG_PATH.lastIndex;
    }
    return out + esc(s.slice(last));
  }
  function showImage(path) {
    $("#sheetHost").innerHTML = '<div class="lightbox" role="dialog" aria-label="Bild"><img alt="Angehängtes Bild" src="/api/image?path=' + encodeURIComponent(path) + '"><span class="lbx" aria-hidden="true">✕</span></div>';
    const img = $("#sheetHost .lightbox img");
    if (img) img.onerror = () => { const l = $("#sheetHost .lightbox"); if (l) l.innerHTML = '<div class="lbmiss">Bild nicht mehr vorhanden</div><span class="lbx" aria-hidden="true">✕</span>'; };
  }
  // Platzhalter [Bild N] im Eingabefeld als Ganzes löschen (Backspace dahinter oder Entf davor)
  function delImgToken(ta, back) {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;
    const re = /\[Bild (\d+)\]/g; let m;
    while ((m = re.exec(ta.value))) {
      const a = m.index, b = a + m[0].length;
      if (back ? (pos > a && pos <= b) : (pos >= a && pos < b)) {
        let before = ta.value.slice(0, a), after = ta.value.slice(b);
        if ((!before || / $/.test(before)) && after[0] === " ") after = after.slice(1);
        else if (/ $/.test(before) && !after) before = before.slice(0, -1);
        ta.value = before + after;
        ta.setSelectionRange(before.length, before.length);
        const key = state.shell ? "s:" + state.shell : state.agent;
        if (imgs[key]) { delete imgs[key][m[1]]; store.set("imgs", imgs); }
        if (key) { drafts[key] = ta.value; store.set("drafts", drafts); }
        autoGrow(ta);
        return true;
      }
    }
    return false;
  }
  // Angehängte Bilder im Eingabefeld: Platzhalter [Bild N], beim Senden durch den Pfad ersetzt
  const imgs = store.get("imgs", {});
  const uploading = {};   // Agent -> laufende Bild-Uploads
  const withPaths = (key, v) => v.replace(/\[Bild (\d+)\](?=(\S?))/g, (m, n, next) => { const p = imgs[key] && imgs[key][n]; return p ? p + (next ? " " : "") : m; });

  // Feed
  function itemHTML(x) {
    if (x.t === "user") return '<div class="msg-user">' + imgHTML(x.v) + '</div>';
    if (x.t === "text") return '<div class="msg-text">' + mdText(x.v) + '</div>';
    if (x.t === "compact") return '<details class="compact"><summary><span>Unterhaltung ' + (x.trigger === "manual" ? "komprimiert" : "automatisch komprimiert") + '</span><small>Zusammenfassung</small></summary><div class="msg-text">' + mdText(x.v || "") + '</div></details>';
    if (x.t === "tool") return '<div class="tool"><span class="k">' + esc(x.k) + '</span><code>' + esc(x.a) + '</code>' + (x.s === "ok" ? '<span class="ok">✓</span>' : x.s === "err" ? '<span class="err">Fehler</span>' : '<span class="run">läuft</span>') + '</div>';
    if (x.t === "diff") return diffHTML(x, false);
    return "";
  }
  function diffHTML(x, withComment) {
    return '<div class="diff"><div class="h"><span class="k" style="font-weight:600">Bearbeitet</span><code>' + esc(home(x.f)) + '</code><span class="add">+' + x.add + '</span><span class="del">−' + x.del + '</span>' + (withComment ? '<button type="button" data-comment="' + esc(home(x.f)) + '">Kommentieren</button>' : "") + '</div><pre>' + x.lines.map(l => '<span class="' + (l[0] === "+" ? "p" : l[0] === "-" ? "m" : "") + '">' + esc(l) + '</span>').join("\n") + '</pre></div>';
  }
  // Tipp des Plugins "You should know": Text, Erklärung zum Aufklappen, Knöpfe wie im Terminal (1, 2, 0 ...)
  const TIP_LABEL = { "Learn more": "Mehr erfahren", "Knew this already": "Wusste ich schon", "Dismiss": "Ausblenden", "Understood": "Verstanden", "Chat in main session": "Im Chat besprechen" };
  const tipOpen = {};
  function tipHTML(t) {
    const a = byId(state.agent) || { id: "" }, opts = t.options || [];
    const ex = t.explanation ? t.explanation.split("\n").map(l => l.trim()).filter(Boolean).map(l => /^[*-]\s+/.test(l) ? "<li>" + md(l.replace(/^[*-]\s+/, "")) + "</li>" : "<p>" + md(l) + "</p>").join("").replace(/(<li>.*?<\/li>)+/gs, m => "<ul>" + m + "</ul>") : "";
    return '<div class="tipcard"><div class="tiph"><span class="spark">✦</span>' + esc(t.tag || "Hinweis") + '</div><div class="tipt">' + md(t.line) + '</div>' +
      (ex ? '<details class="tipx"' + (tipOpen[a.id] ? " open" : "") + ' data-tipx="' + esc(a.id) + '"><summary>Erklärung</summary><div>' + ex + '</div></details>' : "") +
      (opts.length ? '<div class="btnrow">' + opts.filter(o => !(ex && /^Learn more$/i.test(o.label))).map((o, i) => '<button type="button" class="btn' + (i === 0 ? " primary" : "") + '" data-tipkey="' + esc(o.key) + '">' + esc(TIP_LABEL[o.label] || o.label) + '</button>').join("") +
        // "Mehr erfahren" entfällt, wenn die Erklärung schon aufklappbar ist. Besprechen geht immer.
        (opts.some(o => /^Chat in main session$/i.test(o.label)) ? "" : '<button type="button" class="btn" data-tipchat>Im Chat besprechen</button>') + '</div>'
        : '<div class="hint">Lade Auswahl …</div>') + '</div>';
  }
  // MCP-Anmeldung: Link öffnen, bestätigen, danach die Adresse aus der Adresszeile hier einfügen
  function authHTML(au) {
    const href = (IOS_APP ? "x-safari-" : "") + au.url;
    return '<div class="perm authcard"><div class="q">' + esc(au.server) + ' anmelden<small>MCP-Dienst braucht eine Anmeldung im Browser</small></div>' +
      '<div class="opts"><a class="btn primary" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Anmeldung öffnen</a></div>' +
      (au.paste ? '<ol class="authsteps"><li>Oben auf „Anmeldung öffnen“ tippen und den Zugriff bestätigen.</li><li>Danach zeigt der Browser eine Fehlerseite (localhost). Das ist normal.</li><li>Die komplette Adresse aus der Adresszeile kopieren, unten ins Eingabefeld einfügen und senden.</li></ol>' : '<div class="hint">Nach dem Bestätigen im Browser geht es hier von selbst weiter.</div>') +
      '<div class="btnrow"><button type="button" class="btn ghost" data-authcancel>Anmeldung abbrechen</button></div></div>';
  }
  // Offenes Menü im Terminal (z. B. /mcp): Inhalt zeigen und mit Tasten bedienen
  function panelHTML(p) {
    const K = [["left", "←"], ["up", "↑"], ["down", "↓"], ["right", "→"], ["enter", "Enter"], ["tab", "Tab"], ["esc", "Esc"]];
    return '<div class="perm panelcard"><div class="q">Menü im Terminal<small>' + esc(p.footer || "Mit den Pfeiltasten bedienen, Esc schließt") + '</small></div><pre>' + esc(p.text) + '</pre>' +
      '<div class="btnrow">' + K.map(([k, l]) => '<button type="button" class="btn" data-pkey="' + k + '">' + l + '</button>').join("") + '</div></div>';
  }
  function dialogHTML(d) {
    if (d.kind === "trust") {
      // Erster Start in einem Ordner: Claude fragt, ob es dem Ordner vertrauen darf
      return '<div class="perm trust"><div class="q">Diesem Ordner vertrauen?<small>Claude darf hier Dateien lesen, ändern und Befehle ausführen</small></div>' + (d.detail ? '<code>' + esc(d.detail) + '</code>' : "") +
        '<div class="opts"><button type="button" class="primary" data-opt="2" data-hash="' + esc(d.hash) + '">Ja, vertrauen</button><button type="button" data-opt="1" data-hash="' + esc(d.hash) + '">Nein, beenden</button></div></div>';
    }
    if (d.kind === "question") {
      const opts = d.options.map((o, i) => ({ o, i, desc: (d.descs || [])[i] || "" })).filter(x => x.i + 1 !== d.freeText);
      return '<div class="perm ask-q"><div class="q">' + esc(d.question || "Frage") + (d.title ? '<small>' + esc(d.title) + '</small>' : "") + '</div>' +
        '<div class="opts">' + opts.map(x => '<button type="button" data-opt="' + (x.i + 1) + '" data-hash="' + esc(d.hash) + '"><kbd>' + (x.i + 1) + '</kbd><span class="ot">' + esc(x.o) + (x.desc ? '<small>' + esc(x.desc) + '</small>' : "") + '</span></button>').join("") + '</div>' +
        (d.freeText ? '<div class="hint">Oder eigene Antwort unten ins Eingabefeld schreiben und senden.</div>' : "") + '</div>';
    }
    return '<div class="perm"><div class="q">' + esc(d.question || "Freigabe nötig") + (d.title ? '<small>' + esc(d.title) + '</small>' : "") + '</div>' + (d.detail ? '<code>' + esc(d.detail) + '</code>' : "") +
      '<div class="opts">' + d.options.map((o, i) => '<button type="button" data-opt="' + (i + 1) + '" data-hash="' + esc(d.hash) + '"><kbd>' + (i + 1) + '</kbd>' + esc(o) + '</button>').join("") + '</div></div>';
  }
  function feedHTML(a) {
    const F = feeds[a.id];
    if (!F) return '<div class="loading">Lade Verlauf …</div>';
    let h = "", grp = [];
    const flush = () => {
      if (!grp.length) return;
      if (grp.length === 1) { h += itemHTML(grp[0]); grp = []; return; }
      const run = grp.some(x => x.s === "run");
      const nd = grp.filter(x => x.t === "diff").length;
      h += '<details class="work"' + (run ? " open" : "") + '><summary><b>' + (run ? "Arbeitet gerade" : "Hat gearbeitet") + '</b>' + grp.length + ' Schritte' + (nd ? ' · ' + nd + (nd === 1 ? " Datei" : " Dateien") + ' geändert' : "") + CHEV + '</summary><div>' + grp.map(itemHTML).join("") + '</div></details>';
      grp = [];
    };
    if (!F.feed.length && F.screen) h += '<div class="screenfeed">' + esc(F.screen) + '</div>';
    if (!F.feed.length && !F.screen) h += '<div class="empty">Noch kein Verlauf. Schreib die erste Nachricht.</div>';
    F.feed.forEach(x => { if (x.t === "tool" || x.t === "diff") grp.push(x); else { flush(); h += itemHTML(x); } });
    flush();
    if (a.status === "working") h += '<div class="thinking"><i></i><i></i><i></i>Arbeitet</div>';
    if (a.status === "blocked" && a.dialog) h += dialogHTML(a.dialog);
    if (F.auth) h += authHTML(F.auth);
    if (F.panel) h += panelHTML(F.panel);
    if (F.tip) h += tipHTML(F.tip);
    h += (a.queue || []).map(q => '<div class="queued"><div>' + esc(q.text) + '</div><small>Wird nach diesem Zug gesendet<button type="button" data-qnow="' + esc(q.id) + '">Jetzt senden</button><button type="button" data-qdel="' + esc(q.id) + '">Verwerfen</button></small></div>').join("");
    return h;
  }
  function changesHTML(a) {
    const d = changes[a.id];
    if (!d) return '<div class="changes"><div class="loading">Lade …</div></div>';
    if (!d.length) return '<div class="changes"><div class="empty">Seit Beginn der Sitzung hat dieser Agent keine Dateien geändert.</div></div>';
    const add = d.reduce((n, x) => n + x.add, 0), del = d.reduce((n, x) => n + x.del, 0);
    return '<div class="changes"><div class="sum"><b>' + d.length + (d.length === 1 ? " Datei" : " Dateien") + '</b><span style="color:var(--done);font-weight:600">+' + add + '</span><span style="color:#d14343;font-weight:600">−' + del + '</span><span class="hint">seit Beginn der Sitzung, nur lesen</span></div>' +
      d.map(x => diffHTML(x, true)).join("") + '</div>';
  }
  function ringSVG(p) {
    const r = 7, c = 2 * Math.PI * r;
    return '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="3"/><circle cx="9" cy="9" r="' + r + '" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 9 9)"/></svg>';
  }
  function planHTML(a) {
    const p = a.plan || [];
    if (!p.length && !a.subs) return "";
    const done = p.filter(x => x[1] === "done").length, cur = (p.find(x => x[1] === "run") || [""])[0];
    return '<div class="planbar gutter"><button type="button" data-plan aria-expanded="' + !!state.planOpen + '">' +
      (p.length ? '<span class="lbl">Plan ' + done + '/' + p.length + '</span><span class="cur">' + esc(cur) + '</span>' : '<span class="cur"></span>') +
      (a.subs ? '<span class="pill working subs">' + a.subs + (a.subs === 1 ? " Subagent" : " Subagents") + '</span>' : "") + (p.length ? CHEV : "") + '</button>' +
      (p.length ? '<div class="bar"><i style="width:' + Math.round(done / p.length * 100) + '%"></i></div>' : "") +
      (state.planOpen && p.length ? '<ol>' + p.map(x => '<li class="' + x[1] + '"><span class="m">' + (x[1] === "done" ? "✓" : x[1] === "run" ? "●" : "○") + '</span>' + esc(x[0]) + '</li>').join("") + '</ol>' : "") + '</div>';
  }

  // Hauptbereich
  function keepComposer(fn) {
    const ta = $("#msg");
    const hadFocus = ta && document.activeElement === ta;
    const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    const fs = $("#feedScroll");
    const atBottom = !fs || fs.scrollHeight - fs.scrollTop - fs.clientHeight < 60;
    const top = fs ? fs.scrollTop : 0;
    fn();
    const nt = $("#msg");
    const key = state.shell ? "s:" + state.shell : state.agent;
    const mic = document.querySelector("[data-mic]"); if (mic) mic.classList.toggle("rec", !!rec);
    if (nt && key) { nt.value = drafts[key] || ""; autoGrow(nt); if (hadFocus) { nt.focus(); try { nt.setSelectionRange(sel[0], sel[1]); } catch (_) {} } }
    const nfs = $("#feedScroll");
    if (nfs) nfs.scrollTop = atBottom ? nfs.scrollHeight : top;
  }
  function syncClear() { const t = $("#msg"), b = document.querySelector("[data-clear-msg]"); if (t && b) b.hidden = !t.value; }
  function autoGrow(t) { setTimeout(syncClear, 0); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }

  function renderMain() {
    const m = $("#p-main");
    if (state.tab === "activity") { m.innerHTML = activityPane(); return; }
    if (state.tab === "settings") { m.innerHTML = settingsPane(); refreshPushStatus(); return; }
    if (state.shell) {
      const x = shellById(state.shell);
      if (x) { keepComposer(() => { m.innerHTML = shellPane(x); }); scrollTerm(); return; }
      state.shell = null;
    }
    let a = byId(state.agent);
    if (!a && isDesk() && S.agents.length) { a = [...S.agents].sort((x, y) => RANK[shown(x)] - RANK[shown(y)])[0]; state.agent = a.id; loadFeed(a.id); }
    if (!a) {
      if (state.agent && !isDesk()) { state.agent = null; app.dataset.mview = "list"; }
      m.innerHTML = isDesk() ? '<div class="empty">Wähle links einen Agent.</div>' : "";
      return;
    }
    const mode = MODE[a.mode] || MODE.default;
    keepComposer(() => {
      m.innerHTML =
        '<div class="dhead gutter">' + BACK +
          '<span class="dot ' + shown(a) + '" style="margin-top:0"></span>' +
          '<div class="t"><b>' + esc(a.title || a.project) + '</b><small>' + esc(home(a.cwd)) + ' · ' + esc(wsLabel(a.ws)) + '</small></div>' +
          '<button type="button" class="iconbtn" data-agent-menu title="Mehr"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' +
        '</div>' +
        '<div class="gutter" style="padding-block:8px 0;background:var(--bg)"><div class="segw"><button type="button" data-view="chat" aria-pressed="' + (state.view === "chat") + '">Chat</button><button type="button" data-view="changes" aria-pressed="' + (state.view === "changes") + '">Änderungen</button><button type="button" data-view="term" aria-pressed="' + (state.view === "term") + '">Terminal</button></div></div>' +
        (!isClaude(a) ? '<div class="cfgrow gutter"><span class="cfg kind-' + esc(a.kind) + '">' + esc(KIND_LONG[a.kind] || a.kind) + '</span></div>' : '<div class="cfgrow gutter">' +
          '<button type="button" class="cfg ctx' + (a.ctx >= 80 ? " hot" : "") + '" data-ctx title="Kontext-Füllstand">' + ringSVG(a.ctx || 0) + (a.ctx || 0) + ' %</button>' +
          '<button type="button" class="cfg mode-' + (a.mode === "acceptEdits" ? "edits" : a.mode) + '" data-cfg><span class="k">Modus</span>' + esc(mode.s) + CHEV + '</button>' +
          '<button type="button" class="cfg" data-cfg><span class="k">Modell</span>' + esc(modelName(a.model)) + CHEV + '</button>' +
          '<button type="button" class="cfg" data-cfg><span class="k">Effort</span>' + esc(EFF[a.effort] || a.effort || "?") + CHEV + '</button>' +
        '</div>') +
        planHTML(a) +
        (state.view === "chat"
          ? '<div class="scroll gutter" id="feedScroll"><div class="feed">' + feedHTML(a) + '</div></div>'
          : state.view === "changes"
          ? '<div class="scroll gutter">' + changesHTML(a) + '</div>'
          : '<pre class="term" id="term">' + esc(screens[a.id] || "Lade …") + '</pre>') +
        '<div class="composer gutter">' +
          '<div class="keys">' +
            (a.status === "blocked" && a.dialog && a.dialog.kind !== "trust" ? a.dialog.options.map((o, i) => i + 1 === a.dialog.freeText ? "" : '<button type="button" data-opt="' + (i + 1) + '" data-hash="' + esc(a.dialog.hash) + '">' + (i + 1) + ' ' + esc(o.split(/[ ,]/)[0]) + '</button>').join("") : "") +
            '<button type="button" data-key="Enter">⏎ Enter</button><button type="button" data-key="Esc">Esc</button><button type="button" data-key="/compact">/compact</button><button type="button" data-key="/clear">/clear</button>' +
            // Pfeile wirken nur im Terminal sichtbar (Verlauf, Menüs), im Chat passiert scheinbar nichts
            (state.view === "term" ? '<button type="button" data-key="↑">↑</button><button type="button" data-key="↓">↓</button>' : "") +
            '<button type="button" class="warn" data-key="Strg+C">Strg+C</button>' +
          '</div>' +
          '<div class="inrow">' +
            '<button type="button" class="round" data-photo title="Bild anhängen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-9 8"/></svg></button>' +
            '<div class="msgwrap"><textarea id="msg" rows="1" placeholder="' + (a.status === "blocked" && a.dialog && a.dialog.freeText ? "Eigene Antwort" : "Nachricht") + '"></textarea>' + CLEARX + '</div>' +
            (IOS_APP ? "" : '<button type="button" class="round" data-mic title="Diktieren"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>') +
            SEND +
          '</div>' +
        '</div>';
    });
    if (state.view === "term") scrollTerm();
  }
  function scrollTerm() { const t = $("#term"); if (t) t.scrollTop = t.scrollHeight; }

  function shellPane(x) {
    return '<div class="dhead gutter">' + BACK +
        '<span class="sh-ic">' + TERM_SVG + '</span>' +
        '<div class="t"><b>Shell</b><small>' + esc(home(x.cwd)) + ' · ' + esc(wsLabel(x.ws)) + '</small></div>' +
        '<button type="button" class="btn primary" data-claude-here="' + x.id + '" style="padding:7px 12px;font-size:13.5px">Claude starten</button>' +
      '</div>' +
      '<pre class="term" id="term">' + esc(screens[x.id] || "Lade …") + '</pre>' +
      '<div class="composer gutter">' +
        '<div class="keys"><button type="button" data-key="Tab">Tab</button><button type="button" data-key="↑">↑</button><button type="button" data-key="↓">↓</button><button type="button" data-key="Esc">Esc</button><button type="button" class="warn" data-key="Strg+C">Strg+C</button><button type="button" data-key="Strg+D">Strg+D</button><button type="button" class="warn" data-close-shell="' + x.id + '">Schließen</button></div>' +
        '<div class="inrow"><div class="msgwrap"><textarea id="msg" rows="1" placeholder="Befehl an die Shell" style="font-family:var(--font-mono);font-size:14px"></textarea>' + CLEARX + '</div>' + SEND + '</div>' +
      '</div>';
  }

  function tlHTML() {
    if (!activity.length) return '<div class="empty">Noch keine Aktivität seit dem Start der App.</div>';
    return activity.map(e => '<button type="button" class="tl-item" data-agent="' + esc(e.pane) + '"><span class="when">' + new Date(e.t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + '</span><span class="dot ' + (e.s === "end" ? "idle" : e.s) + '"></span><span class="what"><b>' + esc(e.project) + '</b> · ' + esc(e.w) + '<div>' + esc(e.d) + '</div></span></button>').join("");
  }
  function activityPane() {
    return '<div class="topbar gutter"><div class="brand"><b style="font-size:20px">Aktivität</b><span>zuletzt</span></div></div><div class="scroll gutter"><div class="tl">' + tlHTML() + '</div></div>';
  }

  // Einstellungen und Push
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function sw(key, label, sub, on) {
    return '<div class="row"><div class="lbl">' + label + (sub ? '<small>' + sub + '</small>' : "") + '</div><button type="button" class="switch" role="switch" data-sw="' + key + '" aria-checked="' + !!on + '" aria-label="' + label + '"></button></div>';
  }
  function settingsPane() {
    const ex = S.agents[0] ? S.agents[0].project : "Projekt";
    return '<div class="topbar gutter"><div class="brand"><b style="font-size:20px">Einstellungen</b></div></div><div class="scroll gutter"><div class="set">' +
      '<div class="gh">So sieht eine Push-Nachricht aus</div>' +
      '<div class="lock"><div class="clock">' + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + '</div><div class="date">' + new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) + '</div>' +
        '<div class="notif"><div class="ic">h</div><div class="a">' + esc(ex) + ' wartet auf dich</div><div class="w">jetzt</div><div class="b">Titel der Sitzung</div></div>' +
      '</div>' +
      '<div class="gh">Benachrichtigen, wenn ein Agent</div>' +
      '<div class="group">' + sw("blocked", "auf eine Freigabe wartet", "Kommt immer, auch nachts", settings.notify.blocked) + sw("done", "fertig ist", "", settings.notify.done) + sw("working", "anfängt zu arbeiten", "Meist zu viel, darum aus", settings.notify.working) + '</div>' +
      '<div class="gh">Ruhe</div>' +
      '<div class="group">' + sw("quiet", "Nachts nur Freigaben, 22:00 bis 7:00", "„Fertig“ und „Arbeitet“ kommen dann nicht", settings.quiet) + '</div>' +
      '<div class="gh">Dieses Gerät</div>' +
      '<div class="group" id="pushGroup"><div class="row"><div class="lbl">Push-Nachrichten<small id="pushInfo">Prüfe …</small></div><span id="pushAction"></span></div>' +
      '<div class="row"><div class="lbl">Darstellung<small>Folgt dem Gerät (hell oder dunkel)</small></div></div></div>' +
      '</div></div>';
  }
  async function refreshPushStatus() {
    const info = $("#pushInfo"), actEl = $("#pushAction");
    if (!info) return;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported || !standalone()) {
      info.textContent = /iPhone|iPad/.test(navigator.userAgent) && !standalone() ? "Erst über Teilen, „Zum Home-Bildschirm“ installieren und von dort öffnen" : supported ? "Für Push die App installieren" : "Dieser Browser kann keine Push-Nachrichten";
      actEl.innerHTML = ""; return;
    }
    let sub = null;
    try { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); } catch (_) {}
    if (Notification.permission === "denied") { info.textContent = "In den Systemeinstellungen blockiert"; actEl.innerHTML = ""; return; }
    if (sub && Notification.permission === "granted") {
      info.textContent = "Aktiv auf diesem Gerät";
      actEl.innerHTML = '<button type="button" class="btn" data-push-test>Test senden</button>';
    } else {
      info.textContent = "Aus";
      actEl.innerHTML = '<button type="button" class="btn primary" data-push-on>Einschalten</button>';
    }
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Benachrichtigungen nicht erlaubt"); refreshPushStatus(); return; }
    const { key } = await API.get("/api/push/key");
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4)), c => c.charCodeAt(0));
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    await API.post("/api/push/subscribe", sub.toJSON());
    toast("Push ist an");
    refreshPushStatus();
  }

  // Dialoge (Sheets)
  function cfgFields(c, pre) {
    const m = MODE[c.mode] || MODE.default;
    return '<div class="field"><label>Modus</label><div class="segw">' + MODES.map(x => '<button type="button" data-set="' + pre + 'mode" data-val="' + x.v + '" aria-pressed="' + (c.mode === x.v) + '">' + esc(x.s) + '</button>').join("") + '</div><div class="hint">' + esc(m.d) + '</div></div>' +
      '<div class="field"><label>Modell</label><div class="radios">' + MODELS.map(x => '<button type="button" data-set="' + pre + 'model" data-val="' + x.v + '" aria-pressed="' + (c.model === x.v) + '"><span class="r"></span><span><b>' + esc(x.n) + '</b>' + (x.d ? '<small>' + esc(x.d) + '</small>' : "") + '</span></button>').join("") + '</div></div>' +
      '<div class="field"><label>Effort</label><div class="segw">' + EFFORTS.map(e => '<button type="button" data-set="' + pre + 'effort" data-val="' + e[0] + '" aria-pressed="' + (c.effort === e[0]) + '">' + esc(e[1]) + '</button>').join("") + '</div><div class="hint">Mehr Effort heißt gründlicher, aber langsamer und teurer.</div></div>';
  }
  function openCfg(id) {
    cfgAgent = id || state.agent;
    const a = byId(cfgAgent); if (!a) return;
    const c = { mode: a.mode || "default", model: modelKey(a.model), effort: a.effort || "high" };
    const busy = a.status === "working" || a.status === "blocked";
    $("#sheetHost").innerHTML = '<div class="sheet-wrap" data-close><div class="sheet gutter" role="dialog" aria-label="Agent einstellen"><div class="grab"></div><h2>' + esc(a.project) + '</h2><div class="hint">' + esc(a.title) + '</div>' +
      cfgFields(c, "") +
      '<div class="hint">' + (busy ? "Der Agent arbeitet gerade. Änderungen gehen erst, wenn er fertig ist." : "Modell und Effort starten die Sitzung kurz neu, der Verlauf bleibt. Gilt nur für diesen Agent.") + '</div>' +
      '<div class="btnrow"><button type="button" class="btn primary" data-close-btn style="flex:1">Fertig</button></div></div></div>';
  }
  let projects = [];
  async function openSheet() {
    if (!projects.length) { try { projects = (await API.get("/api/projects")).projects; } catch (_) {} }
    // Space nur vorbelegen, wenn man gerade in einem steckt; sonst "ohne"
    const sp = state.list === "spaces" && state.space ? state.space : (byId(state.agent) ? byId(state.agent).ws : "");
    const inSp = S.agents.find(a => a.ws === sp) || S.shells.find(x => x.ws === sp);
    const pp = inSp ? (inSp.project || inSp.cwd.split("/").pop()) : projects[0];
    $("#sheetHost").innerHTML = '<div class="sheet-wrap" data-close><div class="sheet gutter" role="dialog" aria-label="Neuer Agent"><div class="grab"></div><h2>Neuer Agent</h2>' +
      '<div class="field"><label for="np">Projekt</label><select id="np">' + projects.map(p => '<option' + (p === pp ? " selected" : "") + '>' + esc(p) + '</option>').join("") + '<option value="__new__">+ Neues Projekt …</option></select>' +
        '<div class="newspace" id="newProjectBox"><input id="newProjectName" placeholder="Name des Projekts, z. B. mein-tool" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="hint" style="margin-top:6px">Legt den Ordner ~/src/&lt;Name&gt; an. Erlaubt: Buchstaben, Ziffern, Punkt, - und _.</div></div></div>' +
      '<div class="field"><label for="nws">Space (optional)</label><select id="nws">' +
        '<option value=""' + (sp ? "" : " selected") + '>Ohne: eigener Space mit Projektnamen</option>' +
        S.spaces.map(s => '<option value="' + esc(s.id) + '"' + (s.id === sp ? " selected" : "") + '>' + esc(s.label) + '</option>').join("") +
        '<option value="new">+ Neuer Space mit eigenem Namen …</option></select>' +
        '<div class="newspace" id="newSpaceBox"><input id="newSpaceName" placeholder="Name des neuen Space" autocomplete="off"></div></div>' +
      '<div class="field"><label>Agent</label><div class="chips" id="kindChips"><button type="button" aria-pressed="true" data-chip data-kind="claude">Claude Code</button><button type="button" aria-pressed="false" data-chip data-kind="codex">Codex</button><button type="button" aria-pressed="false" data-chip data-kind="opencode">Lokale KI</button><button type="button" aria-pressed="false" data-chip data-kind="shell">Shell</button></div><div class="hint" id="kindHint">Claude Code mit deinem Claude-Abo.</div></div>' +
      '<div id="draftCfg" style="display:grid;gap:14px">' + cfgFields(draft, "new-") + '</div>' +
      '<div class="field" id="firstMsg"><label for="nt">Erste Nachricht (optional)</label><textarea id="nt" rows="3" placeholder="Was soll der Agent tun?"></textarea></div>' +
      '<div class="btnrow"><button type="button" class="btn primary" data-start style="flex:1">Starten</button><button type="button" class="btn" data-close-btn>Abbrechen</button></div></div></div>';
  }
  function confirmSheet(title, text, btns) {
    pending = btns.map(b => b.act || null);
    $("#sheetHost").innerHTML = '<div class="sheet-wrap" data-close><div class="sheet gutter" role="dialog" aria-label="' + esc(title) + '"><div class="grab"></div><h2>' + esc(title) + '</h2>' + (text ? '<div class="hint">' + esc(text) + '</div>' : "") +
      '<div class="stack">' + btns.map((b, i) => '<button type="button" class="btn ' + (b.kind || "") + '" data-act="' + i + '">' + esc(b.l) + '</button>').join("") + '</div></div></div>';
  }
  const closeSheet = () => { $("#sheetHost").innerHTML = ""; };
  function showUndo(text, fn) {
    $("#undoText").textContent = text; undoFn = fn; $("#undo").hidden = false;
    clearTimeout(undoT); undoT = setTimeout(() => { $("#undo").hidden = true; undoFn = null; }, 10000);
  }
  function banner(title, body, pane) {
    const b = $("#banner");
    b.querySelector(".a").textContent = title;
    $("#bannerText").textContent = body;
    b.dataset.pane = pane || "";
    b.classList.add("show");
    setTimeout(() => b.classList.remove("show"), 6000);
  }

  // Navigation
  const isListTab = t => t === "agents" || t === "spaces";
  function markTabs() {
    document.querySelectorAll(".tabbar [data-tab]").forEach(b => { b.removeAttribute("aria-current"); if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); });
    document.querySelectorAll("#listSeg [data-tab]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === state.list));
  }
  function setTab(t) {
    if (isListTab(t)) {
      if (state.tab === t && state.list === "spaces") state.space = null;
      state.list = t; state.tab = t;
      if (!isDesk()) { state.agent = null; state.shell = null; }
      app.dataset.mview = isDesk() ? "main" : "list";
      $("#listScroll").scrollTop = 0;
    } else {
      state.tab = t;
      app.dataset.mview = "main";
      if (t === "activity") loadActivity();
    }
    markTabs(); renderAll();
  }
  function openAgent(id) {
    if (!byId(id)) { toast("Agent läuft nicht mehr"); return; }
    state.shell = null; state.agent = id; state.view = isClaude(byId(id)) ? "chat" : "term"; state.planOpen = false;
    if (!isListTab(state.tab)) state.tab = state.list;
    markTabs(); app.dataset.mview = "main";
    try { history.replaceState(null, "", "#agent-" + id.replace(/:/g, "-")); } catch (_) {}
    renderAll(); loadFeed(id);
  }
  function openShell(id) {
    state.shell = id; state.agent = null;
    if (!isListTab(state.tab)) state.tab = state.list;
    markTabs(); app.dataset.mview = "main"; renderAll(); pollScreen();
  }
  function goBack() {
    state.agent = null; state.shell = null; app.dataset.mview = "list";
    try { history.replaceState(null, "", "#"); } catch (_) {}
    renderAll();
  }

  // Daten laden
  async function loadFeed(id) {
    try { feeds[id] = await API.get("/api/agents/" + encodeURIComponent(id) + "/feed"); } catch (_) { return; }
    if (state.agent === id) renderMain();
  }
  // Anmeldefenster u. Ä. stehen nur im Terminal und ändern den Verlauf nicht: bei offenem, laufendem Agent regelmäßig nachsehen
  setInterval(() => {
    const a = state.agent && byId(state.agent);
    if (a && state.view === "chat" && document.visibilityState === "visible" && (a.status === "working" || (feeds[a.id] || {}).auth || (feeds[a.id] || {}).panel)) loadFeed(a.id);
  }, 4000);
  async function loadChanges(id) {
    try { changes[id] = (await API.get("/api/agents/" + encodeURIComponent(id) + "/changes")).changes; } catch (_) { changes[id] = []; }
    if (state.agent === id && state.view === "changes") renderMain();
  }
  async function loadActivity() {
    try { activity = (await API.get("/api/activity")).entries; } catch (_) {}
    renderSide(); if (state.tab === "activity") renderMain();
  }
  let screenTimer = null;
  async function pollScreen() {
    clearTimeout(screenTimer);
    const id = state.shell || (state.view === "term" ? state.agent : null);
    if (!id || document.visibilityState !== "visible") { screenTimer = setTimeout(pollScreen, 1500); return; }
    try {
      const r = await API.get("/api/panes/" + encodeURIComponent(id) + "/screen?source=" + (state.shell ? "recent" : "visible"));
      if (screens[id] !== r.text) {
        screens[id] = r.text;
        const t = $("#term");
        if (t && (state.shell === id || state.agent === id)) { t.textContent = r.text; scrollTerm(); }
      }
    } catch (_) {}
    screenTimer = setTimeout(pollScreen, 1000);
  }
  function renderSide() { $("#sideTl").innerHTML = tlHTML(); }
  // Geöffneter Chat zählt als gesehen, wie das Fokussieren in herdr: "fertig" wird "bereit"
  function markSeen() {
    const a = state.agent && document.visibilityState !== "hidden" && byId(state.agent);
    if (a && a.status === "done" && !a.seen && seenDone[a.id] !== a.since) { seenDone[a.id] = a.since; store.set("seenDone", seenDone); postSeen([a.id]); }
  }
  function postSeen(ids) { if (ids.length) API.post("/api/seen", { ids }).catch(() => {}); }
  function renderAll() { markSeen(); renderConn(); renderList(); renderMain(); renderSide(); }

  // Aktionen
  const enc = encodeURIComponent;
  // Wann welcher Dialog zuerst angezeigt wurde: frisch erschienene Dialoge sind kurz gesperrt
  const dialogSeen = {};
  const SETTLE_MS = 700;
  function noteDialogs() {
    S.agents.forEach(a => {
      if (a.dialog && (!dialogSeen[a.id] || dialogSeen[a.id].hash !== a.dialog.hash)) dialogSeen[a.id] = { hash: a.dialog.hash, at: Date.now() };
      if (!a.dialog) delete dialogSeen[a.id];
    });
  }
  async function answer(id, option, hash) {
    const a = byId(id);
    if (!a || !a.dialog) { toast("Kein Dialog offen"); return; }
    const seen = dialogSeen[id];
    if (!hash || hash !== a.dialog.hash || !seen || Date.now() - seen.at < SETTLE_MS) { toast("Neuer Dialog, bitte erst lesen"); return; }
    try {
      await API.post("/api/agents/" + enc(id) + "/answer", { hash, option });
      toast(option === "esc" ? "Abgelehnt" : a.dialog.kind === "question" ? "Gesendet" : "Erlaubt");
    } catch (e) {
      toast(e.status === 409 ? "Frage hat sich geändert, Ansicht aktualisiert" : e.message);
    }
    // Neuen Stand holen: bei Teilfragen kommt sofort die nächste Frage, ohne Statuswechsel
    refreshState(); loadFeed(id);
  }
  async function send() {
    const ta = $("#msg"); if (!ta) return;
    const key = state.shell ? "s:" + state.shell : state.agent;
    if (uploading[key] && uploading[key].length) { toast("Bild lädt noch …"); await Promise.all(uploading[key]); }
    const v = withPaths(key, ta.value.trim()); if (!v) { ta.focus(); return; }
    try {
      const auth = !state.shell && (feeds[state.agent] || {}).auth;
      if (state.shell) { await API.post("/api/panes/" + enc(state.shell) + "/line", { text: v }); }
      else if (auth && auth.paste) {
        // MCP-Anmeldung wartet auf die Adresse aus dem Browser: direkt dorthin, nicht in die Warteschlange
        const id = state.agent;
        await API.post("/api/agents/" + enc(id) + "/auth", { text: v });
        toast("Adresse an die Anmeldung geschickt"); setTimeout(() => loadFeed(id), 1500);
      }
      else if ((byId(state.agent) || {}).status === "blocked" && (byId(state.agent).dialog || {}).freeText) {
        const d = byId(state.agent).dialog, seen = dialogSeen[state.agent];
        if (!seen || Date.now() - seen.at < SETTLE_MS) { toast("Neue Frage, bitte erst lesen"); return; }
        await API.post("/api/agents/" + enc(state.agent) + "/answer", { hash: d.hash, text: v });
        toast("Antwort gesendet"); setTimeout(refreshState, 600);
      } else {
        const r = await API.post("/api/agents/" + enc(state.agent) + "/prompt", { text: v });
        toast(r.queued ? "In der Warteschlange" : "Gesendet");
        // Slash-Befehle öffnen oft ein Menü im Terminal: gleich nachsehen
        if (v.startsWith("/")) { const id = state.agent; setTimeout(() => loadFeed(id), 700); setTimeout(() => loadFeed(id), 2000); }
      }
      ta.value = ""; closeSlash(); delete drafts[key]; store.set("drafts", drafts); delete imgs[key]; store.set("imgs", imgs); autoGrow(ta);
    } catch (e) { toast(e.message); }
  }
  async function sendKey(label) {
    const id = state.shell || state.agent; if (!id) return;
    try {
      if (label.startsWith("/")) { await API.post("/api/agents/" + enc(id) + "/prompt", { text: label, now: true }); setTimeout(() => loadFeed(id), 700); setTimeout(() => loadFeed(id), 2000); }
      else await API.post("/api/panes/" + enc(id) + "/keys", { keys: [KEYMAP[label] || label] });
      toast("Gesendet: " + label);
    } catch (e) { toast(e.message); }
  }
  async function endAgent(id, keepShell) {
    const a = byId(id); if (!a) return;
    toast("Beende …");
    try {
      const r = await API.post("/api/agents/" + enc(id) + "/end", { keepShell });
      if (state.agent === id) goBack();
      showUndo(a.project + " beendet", async () => {
        try { const u = await API.post("/api/undo/" + r.undo); toast("Sitzung fortgesetzt"); setTimeout(() => openAgent(u.pane), 1500); }
        catch (e) { toast(e.message); }
      });
      if (!keepShell) setTimeout(() => maybeAskCloseSpace(a.ws), 1500);
    } catch (e) { toast(e.message); }
  }
  function maybeAskCloseSpace(w) {
    if (S.agents.some(a => a.ws === w) || S.shells.some(x => x.ws === w) || !S.spaces.some(s => s.id === w)) return;
    confirmSheet("Space „" + wsLabel(w) + "“ auch schließen?", "Das war das letzte Fenster in diesem Space.", [
      { l: "Space schließen", kind: "primary", act: () => closeSpace(w) },
      { l: "Leer behalten" },
    ]);
  }
  async function closeSpace(w) {
    try { await API.del("/api/spaces/" + enc(w)); if (state.space === w) state.space = null; toast("Space geschlossen"); } catch (e) { toast(e.message); }
  }
  async function closeShell(id) {
    const x = shellById(id);
    try {
      await API.del("/api/panes/" + enc(id));
      if (state.shell === id) goBack();
      toast("Shell geschlossen");
      if (x) setTimeout(() => maybeAskCloseSpace(x.ws), 1500);
    } catch (e) { toast(e.message); }
  }
  async function claudeHere(id) {
    toast("Starte Claude …");
    try {
      await API.post("/api/shells/" + enc(id) + "/claude", { mode: draft.mode, model: draft.model, effort: draft.effort });
      state.shell = null;
      setTimeout(() => { if (byId(id)) openAgent(id); else goBack(); }, 2000);
    } catch (e) { toast(e.message); }
  }
  async function setCfg(id, k, v) {
    const a = byId(id); if (!a) return;
    toast(k === "mode" ? "Modus wird gesetzt …" : "Sitzung startet mit neuen Einstellungen …");
    try {
      await API.post("/api/agents/" + enc(id) + "/config", { [k]: v });
      toast(k === "mode" ? "Modus: " + MODE[v].l : k === "model" ? "Modell: " + MODELS.find(m => m.v === v).n : "Effort: " + EFF[v]);
    } catch (e) { toast(e.message); }
  }
  async function startNew() {
    const wsv = $("#nws").value;
    const kind = document.querySelector('#kindChips [aria-pressed="true"]').dataset.kind;
    const np = $("#np").value === "__new__" ? $("#newProjectName").value.trim() : "";
    if ($("#np").value === "__new__" && !np) { toast("Name für das neue Projekt fehlt"); return; }
    if (np && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(np)) { toast("Projektname: nur Buchstaben, Ziffern, Punkt, - und _"); return; }
    if (np && projects.includes(np)) { toast("Projekt „" + np + "“ gibt es schon"); return; }
    const body = { agent: kind === "shell" ? undefined : kind, project: np || $("#np").value, newProject: np || undefined, mode: draft.mode, model: draft.model, effort: draft.effort, prompt: kind === "shell" ? "" : $("#nt").value, shell: kind === "shell" };
    if (wsv === "new") {
      body.newSpace = $("#newSpaceName").value.trim();
      if (!body.newSpace) { toast("Name für den neuen Space fehlt"); return; }
    } else if (wsv) body.ws = wsv;
    else body.newSpace = body.project;
    store.set("newDraft", draft);
    closeSheet(); toast("Starte …");
    try {
      const r = await API.post("/api/agents", body);
      if (np) projects = [];
      toast(kind === "shell" ? "Shell geöffnet" : "Agent gestartet");
      setTimeout(() => (kind === "shell" ? openShell(r.pane) : byId(r.pane) ? openAgent(r.pane) : null), 1500);
    } catch (e) { toast(e.message); }
  }

  // Diktieren über die Spracherkennung des Browsers (iPhone: Apple-Diktat). Tippen startet, nochmal tippen stoppt.
  let rec = null, recWatch = 0;
  function dictate(btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const ta = $("#msg");
    if (!ta) return;
    // iPhone-App vom Home-Bildschirm: Erkennung startet, liefert aber nie Text. Gleich auf die Tastatur verweisen.
    const iosApp = /iPhone|iPad|iPod/.test(navigator.userAgent) && (navigator.standalone || matchMedia("(display-mode: standalone)").matches);
    if (!SR || iosApp) { ta.focus(); toast("Zum Diktieren das Mikrofon der Tastatur nehmen"); return; }
    // Zweites Tippen beendet sofort, auch wenn der Browser kein "end" mehr meldet (iPhone-App vom Home-Bildschirm)
    if (rec) { const r = rec; rec = null; clearTimeout(recWatch); try { r.abort(); } catch (_) {} const b = document.querySelector("[data-mic]"); if (b) b.classList.remove("rec"); return; }
    const base = ta.value ? ta.value.replace(/\s*$/, " ") : "";
    let finalText = "";
    rec = new SR();
    rec.lang = "de-DE"; rec.continuous = true; rec.interimResults = true;
    const mark = on => { const b = document.querySelector("[data-mic]"); if (b) b.classList.toggle("rec", on); };
    rec.onresult = ev => {
      clearTimeout(recWatch);
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      const v = base + (finalText + interim).replace(/^\s+/, "");
      // Entwurf mitführen, damit ein Neuzeichnen während des Diktierens nichts verliert
      const k = state.shell ? "s:" + state.shell : state.agent; if (k) drafts[k] = v;
      const el = $("#msg"); if (!el) return;
      el.value = v; autoGrow(el);
    };
    rec.onerror = ev => {
      if (ev.error === "aborted") return;
      const msg = { "not-allowed": "Mikrofon nicht erlaubt (Einstellungen > Safari > Mikrofon)", "service-not-allowed": "Diktieren ist in dieser Ansicht gesperrt, nimm das Mikrofon der Tastatur", "no-speech": "Nichts gehört", "audio-capture": "Kein Mikrofon gefunden", "network": "Diktieren braucht Internet" }[ev.error];
      toast(msg || "Diktieren ging nicht (" + ev.error + ")");
    };
    const self = rec;
    rec.onend = () => { if (rec !== self) return; clearTimeout(recWatch); rec = null; mark(false); const el = $("#msg"); if (el) { const k = state.shell ? "s:" + state.shell : state.agent; drafts[k] = el.value; store.set("drafts", drafts); } };
    // Kommt nach 8 s gar nichts an, hängt die Erkennung: abbrechen statt ewig rot zu pulsieren
    const mine = rec;
    recWatch = setTimeout(() => { if (rec !== mine) return; rec = null; try { mine.abort(); } catch (_) {} mark(false); toast("Diktieren liefert hier nichts, nimm das Mikrofon der Tastatur"); }, 8000);
    try { rec.start(); mark(true); toast("Sprich jetzt, nochmal tippen zum Beenden"); }
    catch (e) { clearTimeout(recWatch); rec = null; mark(false); toast("Diktieren ging nicht"); }
  }

  // Tippen auf Code im Text (Befehle, Codes) kopiert ihn
  function copyText(v) {
    const ok = () => toast("Kopiert: " + (v.length > 30 ? v.slice(0, 30) + "…" : v));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, () => toast("Kopieren ging nicht"));
    else { const ta = document.createElement("textarea"); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (_) { toast("Kopieren ging nicht"); } ta.remove(); }
  }
  document.addEventListener("click", e => {
    const c = e.target.closest && e.target.closest(".msg-text code, .tipcard code");
    if (!c || c.closest("pre") || e.target.closest("a")) return;
    copyText(c.textContent);
  });
  // Klicks
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-cfgfor], button, [data-approve], [data-deny], [data-close]");
    if (!t) return;
    if (t.dataset.approve) { e.stopPropagation(); answer(t.dataset.approve, 1, t.dataset.hash); return; }
    if (t.dataset.deny) { e.stopPropagation(); answer(t.dataset.deny, "esc", t.dataset.hash); return; }
    if (t.dataset.cfgfor) { e.stopPropagation(); openCfg(t.dataset.cfgfor); return; }
    if (t.id === "banner") { t.classList.remove("show"); if (t.dataset.pane) openAgent(t.dataset.pane); return; }
    if (t.dataset.act != null) { const f = pending[+t.dataset.act]; closeSheet(); if (f) f(); return; }
    if (t.id === "undoBtn") { $("#undo").hidden = true; if (undoFn) undoFn(); undoFn = null; return; }
    if (t.dataset.agent) { openAgent(t.dataset.agent); return; }
    if (t.dataset.filter) { state.filter = state.filter === t.dataset.filter ? null : t.dataset.filter; renderList(); return; }
    if (t.dataset.shell) { openShell(t.dataset.shell); return; }
    if (t.dataset.claudeHere) { claudeHere(t.dataset.claudeHere); return; }
    if (t.dataset.closeShell) { closeShell(t.dataset.closeShell); return; }
    if (t.dataset.closeSpace) {
      const w = t.dataset.closeSpace, na = S.agents.filter(a => a.ws === w).length, ns = S.shells.filter(x => x.ws === w).length;
      if (!na && !ns) { closeSpace(w); return; }
      confirmSheet("Space „" + wsLabel(w) + "“ schließen?", "Dabei werden " + countText(na, ns).replace("keine Agents · ", "") + " beendet.", [
        { l: "Space schließen", kind: "danger", act: () => closeSpace(w) }, { l: "Abbrechen" }]);
      return;
    }
    if (t.hasAttribute("data-agent-menu")) {
      const a = byId(state.agent); if (!a) return;
      confirmSheet(a.project, a.title, [
        { l: a.pinned ? "Nicht mehr anheften" : "Anheften", act: () => act(() => API.put("/api/agents/" + enc(a.id) + "/pin", { pinned: !a.pinned }), a.pinned ? "Gelöst" : "Angeheftet").then(refreshState).catch(() => {}) },
        ...(isClaude(a) ? [{ l: "Modus, Modell, Effort", act: () => openCfg(a.id) }] : []),
        { l: "Agent beenden", kind: "danger", act: () => confirmSheet("Agent beenden?", "Claude wird beendet. Die Sitzung lässt sich später fortsetzen.", [
          { l: "Beenden, Shell offen lassen", kind: "primary", act: () => endAgent(a.id, true) },
          { l: "Beenden und Fenster schließen", kind: "danger", act: () => endAgent(a.id, false) },
          { l: "Abbrechen" }]) },
        { l: "Abbrechen" },
      ]);
      return;
    }
    if (t.hasAttribute("data-cfg")) { openCfg(); return; }
    if (t.dataset.set) {
      const k = t.dataset.set, v = t.dataset.val;
      if (k.startsWith("new-")) { draft[k.slice(4)] = v; $("#draftCfg").innerHTML = cfgFields(draft, "new-"); return; }
      const a = byId(cfgAgent);
      if (a && (a.status === "working" || a.status === "blocked")) { toast("Der Agent arbeitet gerade"); return; }
      closeSheet(); setCfg(cfgAgent, k, v); return;
    }
    if (t.dataset.space) { state.space = t.dataset.space; state.q = ""; $("#q").value = ""; $("#listScroll").scrollTop = 0; renderList(); return; }
    if (t.hasAttribute("data-spaces-back")) { state.space = null; renderList(); return; }
    if (t.hasAttribute("data-clear")) { const ids = S.agents.filter(a => a.status === "done").map(a => a.id); S.agents.forEach(a => { if (a.status === "done") seenDone[a.id] = a.since; }); store.set("seenDone", seenDone); postSeen(ids); toast("Als gesehen markiert"); renderAll(); return; }
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.hasAttribute("data-new")) { openSheet(); return; }
    if (t.hasAttribute("data-back")) { goBack(); return; }
    if (t.dataset.view) {
      state.view = t.dataset.view; renderMain();
      if (state.view === "changes") loadChanges(state.agent);
      if (state.view === "term") pollScreen();
      return;
    }
    if (t.dataset.opt) { answer(state.agent, Number(t.dataset.opt), t.dataset.hash); return; }
    if (t.hasAttribute("data-plan")) { state.planOpen = !state.planOpen; renderMain(); return; }
    if (t.hasAttribute("data-ctx")) {
      const a = byId(state.agent); if (!a) return;
      if (a.ctx >= 80) confirmSheet("Kontext fast voll", "Noch " + (100 - a.ctx) + " % frei. /compact fasst den bisherigen Verlauf zusammen und macht Platz.", [
        { l: "/compact senden", kind: "primary", act: () => sendKey("/compact") }, { l: "Später" }]);
      else toast("Kontext: " + a.ctx + " % belegt");
      return;
    }
    if (t.dataset.comment) { state.view = "chat"; renderMain(); const ta = $("#msg"); ta.value = "Zu " + t.dataset.comment + ": "; ta.focus(); return; }
    if (t.dataset.qnow != null) { act(() => API.post("/api/agents/" + enc(state.agent) + "/queue/" + enc(t.dataset.qnow) + "/send"), "Sofort gesendet"); return; }
    if (t.dataset.qdel != null) { act(() => API.del("/api/agents/" + enc(state.agent) + "/queue/" + enc(t.dataset.qdel))); return; }
    if (t.dataset.key && CAPPED.test(t.dataset.key) && armed !== t.dataset.key) {
      // Gefährliche Tasten brauchen ein zweites Tippen
      document.querySelectorAll(".keys .armed").forEach(b => b.classList.remove("armed"));
      armed = t.dataset.key; t.classList.add("armed"); toast("Nochmal tippen: " + t.dataset.key);
      clearTimeout(armT); armT = setTimeout(() => { armed = null; t.classList.remove("armed"); }, 2500);
      return;
    }
    if (t.dataset.key) { armed = null; sendKey(t.dataset.key); return; }
    // iOS öffnet die Tastatur nur direkt nach einem Tippen: Feld jetzt fokussieren, dann bleibt es nach der Fotoauswahl aktiv
    if (t.hasAttribute("data-photo")) { const ta = $("#msg"); if (ta) ta.focus(); $("#photoInput").click(); return; }
    if (t.dataset.img) { showImage(t.dataset.img); return; }
    if (t.dataset.group) { store.set("group", t.dataset.group); renderList(); return; }
    if (t.dataset.slash) { pickSlash(t.dataset.slash); return; }
    if (t.dataset.pkey) { const id = state.agent; if (id) API.post("/api/panes/" + enc(id) + "/keys", { keys: [t.dataset.pkey] }).then(() => { setTimeout(() => loadFeed(id), 400); setTimeout(() => loadFeed(id), 1200); }, e => toast(e.message)); return; }
    if (t.hasAttribute("data-authcancel")) { const id = state.agent; if (id) API.post("/api/panes/" + enc(id) + "/keys", { keys: ["esc"] }).then(() => { toast("Anmeldung abgebrochen"); setTimeout(() => loadFeed(id), 800); }, e => toast(e.message)); return; }
    if (t.dataset.tipkey != null || t.hasAttribute("data-tipchat")) {
      const id = state.agent, tip = (feeds[id] || {}).tip, opts = (tip && tip.options) || [];
      let key = t.dataset.tipkey;
      const opt = opts.find(o => o.key === key);
      if (tip && (t.hasAttribute("data-tipchat") || (opt && /^Chat in main session$/i.test(opt.label)))) {
        // Nicht an Claude schicken: Hinweis als Zitat ins Eingabefeld, du ergänzt und sendest selbst. Der Tipp gilt als verstanden.
        const body = [(tip.tag || "Hinweis") + " · " + tip.line].concat(tip.explanation ? ["", ...tip.explanation.split("\n").map(l => l.trim()).filter(Boolean)] : []);
        const ta = $("#msg");
        if (ta) {
          ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, "") + "\n\n" : "") + "Zu diesem Hinweis:\n\n" + body.map(l => l ? "> " + l : ">").join("\n") + "\n\n";
          drafts[id] = ta.value; store.set("drafts", drafts); autoGrow(ta);
          ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
        }
        const done = opts.find(o => /^Understood$/i.test(o.label)) || opts.find(o => /^Dismiss$/i.test(o.label)) || opts.find(o => o.key === "0");
        if (!done) return;
        key = done.key;
        toast("Im Eingabefeld, ergänze und sende selbst");
      }
      if (key === "1" && !(opt && /^Chat/i.test(opt.label))) tipOpen[id] = true;
      act(() => API.post("/api/agents/" + enc(id) + "/tip", { key })).then(() => { setTimeout(() => loadFeed(id), 700); setTimeout(() => loadFeed(id), 2000); }).catch(() => {});
      return;
    }
    if (t.dataset.runline) {
      const id = state.agent; if (!id) return;
      act(() => API.post("/api/agents/" + enc(id) + "/prompt", { text: t.dataset.runline }), "Gesendet: " + t.dataset.runline.slice(0, 40)).catch(() => {});
      return;
    }
    if (t.dataset.copy != null) {
      copyText(t.dataset.copy);
      return;
    }
    if (t.hasAttribute("data-clear-msg")) {
      const ta = $("#msg"); if (!ta) return;
      ta.value = ""; const key = state.shell ? "s:" + state.shell : state.agent;
      if (key) { delete drafts[key]; store.set("drafts", drafts); delete imgs[key]; store.set("imgs", imgs); }
      autoGrow(ta); ta.focus(); return;
    }
    if (t.hasAttribute("data-mic")) { dictate(t); return; }
    if (t.hasAttribute("data-send")) { send(); return; }
    if (t.dataset.sw) {
      const k = t.dataset.sw;
      if (k === "quiet") settings.quiet = !settings.quiet; else settings.notify[k] = !settings.notify[k];
      t.setAttribute("aria-checked", k === "quiet" ? settings.quiet : settings.notify[k]);
      API.put("/api/settings", settings).catch(err => toast(err.message));
      return;
    }
    if (t.hasAttribute("data-push-on")) { enablePush().catch(err => toast(err.message || "Push ging nicht")); return; }
    if (t.hasAttribute("data-push-test")) { act(() => API.post("/api/push/test"), "Testnachricht gesendet"); return; }
    if (t.hasAttribute("data-chip")) {
      t.parentElement.querySelectorAll("[data-chip]").forEach(c => c.setAttribute("aria-pressed", c === t));
      if (t.dataset.kind) {
        const k = t.dataset.kind;
        $("#draftCfg").hidden = k !== "claude"; $("#firstMsg").hidden = k === "shell";
        $("#kindHint").textContent = { claude: "Claude Code mit deinem Claude-Abo.", codex: "OpenAI Codex mit deinem ChatGPT-Abo.", opencode: "opencode mit Qwen 3.5 9B auf deiner Grafikkarte. Nichts verlässt das Heimnetz.", shell: "Eine leere Shell im Projektordner." }[k];
      }
      return;
    }
    if (t.hasAttribute("data-start")) { startNew(); return; }
    if (t.hasAttribute("data-close-btn") || (t.hasAttribute("data-close") && e.target === t)) { closeSheet(); return; }
  });
  // iPhone-Tastatur meldet Löschen oft nur als beforeinput
  document.addEventListener("beforeinput", e => {
    if (e.target.id === "msg" && (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") && delImgToken(e.target, e.inputType === "deleteContentBackward")) e.preventDefault();
  });
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#sheetHost .lightbox")) { closeSheet(); return; }
    const w = e.target.closest("[data-close]");
    if (w && e.target === w) closeSheet();
  });
  document.addEventListener("input", e => {
    if (e.target.id === "q") { state.q = e.target.value; renderList(); }
    if (e.target.id === "msg") {
      autoGrow(e.target); updateSlash(e.target);
      const key = state.shell ? "s:" + state.shell : state.agent;
      if (key) { drafts[key] = e.target.value; store.set("drafts", drafts); }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.target.id === "msg" && (e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey && delImgToken(e.target, e.key === "Backspace")) { e.preventDefault(); return; }
    if (e.isComposing || e.altKey) return;
    const inMsg = e.target.id === "msg", ta = inMsg ? e.target : null;
    // Vorschläge für Slash-Befehle: Pfeile wählen, Enter/Tab übernimmt, Esc schließt
    if (ta && slash && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slash.i = (slash.i + (e.key === "ArrowDown" ? 1 : -1) + slash.items.length) % slash.items.length; drawSlash(); return; }
      // Steht der gewählte Befehl schon vollständig da, schickt Enter ihn direkt ab
      if (e.key === "Enter" && ta.value.trim() === "/" + slash.items[slash.i].name) { e.preventDefault(); closeSlash(); send(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSlash(slash.items[slash.i].name); return; }
      if (e.key === "Escape") { e.preventDefault(); closeSlash(); return; }
    }
    const typing = !inMsg && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    // Offenes Menü im Terminal: Pfeile, Enter, Esc, Tab gehen dorthin, solange im Feld nichts steht
    const F = state.agent && !state.shell && state.view === "chat" && feeds[state.agent];
    const PK = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "enter", Escape: "esc", Tab: "tab" };
    if (F && F.panel && PK[e.key] && !e.shiftKey && !e.ctrlKey && !e.metaKey && !typing && (!ta || !ta.value.trim())) {
      e.preventDefault();
      const id = state.agent;
      API.post("/api/panes/" + enc(id) + "/keys", { keys: [PK[e.key]] }).then(() => { setTimeout(() => loadFeed(id), 400); setTimeout(() => loadFeed(id), 1200); }, err => toast(err.message));
      return;
    }
    if (!ta) return;
    // Enter schickt ab, Shift+Enter macht eine neue Zeile
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); return; }
    // Frühere eigene Nachrichten mit den Pfeiltasten holen, nur bei leerem Feld oder unveränderter geholter Nachricht
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.ctrlKey && !e.metaKey && state.agent && !state.shell) {
      const on = hist.key === state.agent && hist.i >= 0 && ta.value === hist.val;
      if (ta.value && !on) return;
      const list = ((feeds[state.agent] || {}).feed || []).filter(x => x.t === "user").map(x => x.v);
      if (!list.length) return;
      let i;
      if (e.key === "ArrowUp") i = on ? Math.max(0, hist.i - 1) : list.length - 1;
      else { if (!on) return; i = hist.i + 1; }
      e.preventDefault();
      if (i >= list.length) { hist = { key: "", i: -1, val: "" }; ta.value = ""; }
      else { hist = { key: state.agent, i, val: list[i] }; ta.value = list[i]; }
      autoGrow(ta); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    }
  });
  let hist = { key: "", i: -1, val: "" };

  // Autovervollständigung für Slash-Befehle (eingebaut, eigene, Projekt, Plugins), Liste pro Agent einmal vom Server
  const cmds = {};
  let slash = null;   // { items, i }
  function closeSlash() { slash = null; const el = $(".slash"); if (el) el.remove(); }
  function updateSlash(ta) {
    const id = state.agent, m = !state.shell && id && ta.value.match(/^\/(\S*)$/);
    if (!m) { closeSlash(); return; }
    if (!cmds[id]) {
      cmds[id] = [];
      API.get("/api/agents/" + enc(id) + "/commands").then(r => { cmds[id] = r.commands || []; const t = $("#msg"); if (t && state.agent === id) updateSlash(t); }, () => { delete cmds[id]; });
      return;
    }
    const q = m[1].toLowerCase(), list = cmds[id];
    const starts = c => c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().split(":").pop().startsWith(q);
    const items = list.filter(starts).concat(list.filter(c => !starts(c) && c.name.toLowerCase().includes(q)));
    if (!items.length) { closeSlash(); return; }
    const prev = slash && slash.items[slash.i];
    const i = prev ? Math.max(0, items.findIndex(c => c.name === prev.name)) : 0;
    slash = { items, i };
    drawSlash();
  }
  function drawSlash() {
    const wrap = $(".msgwrap"); if (!wrap || !slash) return;
    let el = $(".slash");
    if (!el) { el = document.createElement("div"); el.className = "slash"; el.setAttribute("role", "listbox"); el.addEventListener("mousedown", e => e.preventDefault()); wrap.appendChild(el); }
    el.innerHTML = slash.items.map((c, k) => '<button type="button" role="option" class="' + (k === slash.i ? "on" : "") + '" data-slash="' + esc(c.name) + '"><b>/' + esc(c.name) + '</b>' + (c.desc ? '<small>' + esc(c.desc) + '</small>' : "") + '</button>').join("");
    const on = el.querySelector(".on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }
  function pickSlash(name) {
    const ta = $("#msg"); if (!ta) return;
    ta.value = "/" + name + " "; closeSlash(); autoGrow(ta);
    const key = state.agent; if (key) { drafts[key] = ta.value; store.set("drafts", drafts); }
    ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  }
  $("#photoInput").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    attachImage(f);
  });
  // Bild aus der Zwischenablage (Strg+V) oder per Ziehen ins Eingabefeld: hochladen und den Pfad einfügen
  const imageFiles = dt => {
    if (!dt) return [];
    const fromItems = [...(dt.items || [])].filter(i => i.kind === "file" && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
    return fromItems.length ? fromItems : [...(dt.files || [])].filter(f => /^image\//.test(f.type));
  };
  document.addEventListener("paste", e => {
    if (e.target.id !== "msg" || !state.agent) return;
    const fs = imageFiles(e.clipboardData);
    if (!fs.length) return;
    e.preventDefault();
    fs.reduce((p, f) => p.then(() => attachImage(f)), Promise.resolve());
  });
  document.addEventListener("dragover", e => { if (e.target.id === "msg") e.preventDefault(); });
  document.addEventListener("drop", e => {
    if (e.target.id !== "msg" || !state.agent) return;
    const fs = imageFiles(e.dataTransfer);
    if (!fs.length) return;
    e.preventDefault();
    fs.reduce((p, f) => p.then(() => attachImage(f)), Promise.resolve());
  });
  // Platzhalter sofort einsetzen und ins Eingabefeld springen (am Handy öffnet sich die Tastatur nur direkt nach dem Antippen), Upload läuft dahinter
  function attachImage(f) {
    if (!f || !state.agent) return Promise.resolve();
    const key = state.agent, m = imgs[key] || (imgs[key] = {});
    const n = Math.max(0, ...Object.keys(m).map(Number)) + 1, tok = "[Bild " + n + "]";
    m[n] = "";
    const ta = $("#msg");
    if (ta) {
      ta.value = (ta.value ? ta.value.replace(/\s*$/, " ") : "") + tok + " "; autoGrow(ta);
      drafts[key] = ta.value; store.set("drafts", drafts);
      ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    }
    const form = new FormData(); form.append("image", f, f.name || "bild." + (f.type.split("/")[1] || "png"));
    toast("Lade Bild hoch …");
    const job = API.upload("/api/agents/" + enc(key) + "/image", form).then(r => {
      m[n] = r.path; store.set("imgs", imgs);
      toast("Bild angehängt");
    }, err => {
      delete m[n]; store.set("imgs", imgs);
      const drop = v => v.replace(tok + " ", "").replace(tok, "");
      const t = $("#msg");
      if (t && state.agent === key) { t.value = drop(t.value); autoGrow(t); drafts[key] = t.value; }
      else if (drafts[key]) drafts[key] = drop(drafts[key]);
      store.set("drafts", drafts);
      toast(err.message);
    }).finally(() => { uploading[key] = (uploading[key] || []).filter(x => x !== job); });
    (uploading[key] || (uploading[key] = [])).push(job);
    return job;
  }
  // Zurück in die App mit offenem Chat: der gilt jetzt als gesehen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.agent) renderAll(); });
  addEventListener("resize", () => {
    if (isDesk()) app.dataset.mview = "main";
    else if (isListTab(state.tab)) app.dataset.mview = state.agent || state.shell ? "main" : "list";
    renderAll();
  });

  // Live-Daten
  function refreshState() { API.get("/api/state").then(onState).catch(() => {}); }
  function onState(next) {
    const prev = S;
    S = next; loaded = true;
    noteDialogs();
    // Ein Agent ist weg: Ansicht schließen
    if (state.agent && !byId(state.agent) && prev.agents.some(a => a.id === state.agent)) { if (!isDesk()) app.dataset.mview = "list"; state.agent = null; }
    // Tipp im offenen Agent neu aufgetaucht oder verschwunden: Karte nachladen
    if (state.agent) { const o = prev.agents.find(a => a.id === state.agent), n = byId(state.agent); if (n && (o ? o.tip && o.tip.line : null) !== (n.tip ? n.tip.line : null)) loadFeed(state.agent); }
    renderConn(); renderList();
    const a = byId(state.agent);
    const pa = prev.agents.find(x => x.id === state.agent);
    const keyOf = x => x ? JSON.stringify([x.status, x.ctx, x.mode, x.model, x.effort, x.plan, x.subs, x.queue, x.title, x.dialog && x.dialog.hash]) : "";
    if (state.tab === "agents" || state.tab === "spaces") {
      if (!a || keyOf(a) !== keyOf(pa) || (state.shell && !shellById(state.shell))) renderMain();
    }
    if (a && pa && a.status !== pa.status) loadFeed(a.id);
  }
  function onMessage(m) {
    if (m.type === "state") onState(m.data);
    else if (m.type === "feed") { if (m.pane === state.agent) { loadFeed(m.pane); if (state.view === "changes") loadChanges(m.pane); } else delete feeds[m.pane]; }
    else if (m.type === "activity") {
      activity.unshift(m.entry); renderSide(); if (state.tab === "activity") renderMain();
      if ((m.entry.s === "blocked" || m.entry.s === "done") && document.visibilityState === "visible" && m.entry.pane !== state.agent) {
        banner(m.entry.project + (m.entry.s === "blocked" ? " wartet auf dich" : " ist fertig"), m.entry.d, m.entry.pane);
      }
    }
  }
  API.connect(onMessage, online => { wsOnline = online; renderConn(); });
  API.get("/api/settings").then(s => { settings = s; }).catch(() => {});
  loadActivity();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "open" && e.data.pane) openAgent(e.data.pane); });
  }
  // Direkt-Link aus der Push-Nachricht: #agent-w8-p3
  const hm = location.hash.match(/^#agent-(.+)$/);
  if (hm) {
    const pane = hm[1].replace(/^([^-]+)-/, "$1:");
    const wait = setInterval(() => { if (loaded) { clearInterval(wait); if (byId(pane)) openAgent(pane); } }, 200);
    setTimeout(() => clearInterval(wait), 10000);
  }
  // Aufgeklappte Erklärung beim Neuzeichnen offen lassen
  document.addEventListener("toggle", e => { const d = e.target; if (d && d.dataset && d.dataset.tipx) tipOpen[d.dataset.tipx] = d.open; }, true);
  document.addEventListener("change", e => {
    if (e.target.id === "np") { $("#newProjectBox").classList.toggle("on", e.target.value === "__new__"); if (e.target.value === "__new__") $("#newProjectName").focus(); }
    if (e.target.id === "nws") { $("#newSpaceBox").classList.toggle("on", e.target.value === "new"); if (e.target.value === "new") $("#newSpaceName").focus(); }
  });
  // Fenster (Neuer Agent, Einstellungen ...) nach unten wegwischen, wie der Strich oben andeutet
  (() => {
    let g = null;
    document.addEventListener("touchstart", e => {
      g = null;
      const sh = e.target.closest && e.target.closest(".sheet");
      if (!sh || e.touches.length !== 1 || e.target.closest("input, textarea, select")) return;
      // Nur vom Strich aus oder wenn das Fenster ganz oben steht, sonst scrollt man nur darin
      if (!e.target.closest(".grab, h2") && sh.scrollTop > 0) return;
      g = { sh, y: e.touches[0].clientY, x: e.touches[0].clientX, t0: Date.now(), dy: 0, on: false, off: false };
    }, { passive: true });
    document.addEventListener("touchmove", e => {
      if (!g || g.off) return;
      const dy = e.touches[0].clientY - g.y, dx = e.touches[0].clientX - g.x;
      if (!g.on) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy > 0 && dy > Math.abs(dx) && g.sh.scrollTop <= 0) { g.on = true; g.sh.style.transition = "none"; }
        else { g.off = true; return; }
      }
      e.preventDefault();
      g.dy = Math.max(0, dy);
      g.sh.style.transform = "translateY(" + g.dy + "px)";
    }, { passive: false });
    const end = () => {
      if (!g || !g.on) { g = null; return; }
      const { sh, dy, t0 } = g; g = null;
      const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.5;
      sh.style.transition = "transform 0.2s ease-out";
      if (dy > Math.min(140, sh.getBoundingClientRect().height * 0.3) || fast) {
        sh.style.transform = "translateY(100%)";
        setTimeout(closeSheet, 200);
      } else {
        sh.style.transform = "translateY(0)";
        setTimeout(() => { sh.style.transition = ""; sh.style.transform = ""; }, 200);
      }
    };
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
  })();
  // Wischgeste zurück wie in anderen iOS-Apps: nach rechts ziehen, die Ansicht folgt dem Finger
  (() => {
    const NO = ".keys, .cfgrow, .tablewrap, .lightbox, .panelcard pre, .term, .diff pre, textarea, input, select, .sheet-wrap";
    let g = null;
    const target = () => {
      if (isDesk()) return null;
      if (app.dataset.mview === "main" && (state.agent || state.shell)) return { el: $("#p-main"), back: goBack };
      if (app.dataset.mview === "list" && state.list === "spaces" && state.space) return { el: $("#p-list"), back: () => { state.space = null; renderList(); } };
      return null;
    };
    const reset = el => { el.style.transition = ""; el.style.transform = ""; el.style.boxShadow = ""; };
    document.addEventListener("touchstart", e => {
      g = null;
      if (e.touches.length !== 1 || (e.target.closest && e.target.closest(NO))) return;
      const t = target(); if (!t || !t.el) return;
      const p = e.touches[0];
      g = { ...t, x: p.clientX, y: p.clientY, t0: Date.now(), dx: 0, on: false, off: false };
    }, { passive: true });
    document.addEventListener("touchmove", e => {
      if (!g || g.off) return;
      const p = e.touches[0], dx = p.clientX - g.x, dy = p.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (dx > 0 && dx > Math.abs(dy) * 1.5) { g.on = true; g.el.style.transition = "none"; g.el.style.boxShadow = "-8px 0 24px rgb(0 0 0 / 0.35)"; }
        else { g.off = true; return; }
      }
      e.preventDefault();
      g.dx = Math.max(0, dx);
      g.el.style.transform = "translateX(" + g.dx + "px)";
    }, { passive: false });
    const end = () => {
      if (!g || !g.on) { g = null; return; }
      const { el, back, dx, t0 } = g; g = null;
      const w = el.getBoundingClientRect().width || innerWidth;
      const fast = dx > 50 && dx / Math.max(1, Date.now() - t0) > 0.5;
      el.style.transition = "transform 0.2s ease-out";
      if (dx > w * 0.33 || fast) {
        el.style.transform = "translateX(" + w + "px)";
        setTimeout(() => { reset(el); back(); }, 200);
      } else {
        el.style.transform = "translateX(0)";
        setTimeout(() => reset(el), 200);
      }
    };
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
  })();
  if (isDesk()) app.dataset.mview = "main";
  markTabs(); renderAll(); pollScreen();
})();
// iOS Safari ignoriert user-scalable=no teilweise: Pinch-Gesten zusätzlich abfangen
["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
// iOS schiebt die Seite beim Öffnen der Tastatur nach oben und lässt sie dort stehen: immer zurück auf 0
(() => {
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const reset = () => { if (typing()) return; if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } };
  window.addEventListener("scroll", reset, { passive: true });
  document.addEventListener("focusout", () => setTimeout(reset, 50));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => setTimeout(reset, 50));
})();
