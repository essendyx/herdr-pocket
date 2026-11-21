// README-Screenshots mit erfundenen Daten. Die Web-Dateien kommen aus web/, alle API-Antworten und der WebSocket sind gefälscht,
// es läuft also kein Server und kein herdr. Handy-Bilder bekommen einen iPhone-Rahmen.
//
//   PLAYWRIGHT_CORE=/pfad/zu/node_modules/playwright-core node scripts/screenshots.cjs
//
// Ergebnis: docs/screenshots/*.png
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), WEB = path.join(ROOT, "web"), OUT = process.env.SHOTS_OUT || path.join(ROOT, "docs/screenshots");

const now = Date.now(), min = 60000, H = 3600000;
const perm = (h, q, det, opts) => ({ hash: "d" + h, kind: "permission", title: "Bash command", question: q, detail: det, options: opts, descs: opts.map(() => ""), freeText: null });
const base = { plan: [], subs: 0, queue: [], hasHistory: true, pinned: false, seen: false };
const agents = [
  { ...base, id: "w1:p1", kind: "claude", ws: "w1", tab: "w1:t1", project: "webshop", cwd: "/home/alex/src/webshop", title: "Checkout-Seite überarbeiten", status: "blocked", sessionId: "s1", since: now - 3 * min, lastActive: now - min,
    dialog: perm(1, "Do you want to proceed?", "npm run deploy -- --env staging", ["Yes", "Yes, and don't ask again for npm run deploy", "No"]), ctx: 41, model: "claude-opus-5-5", effort: "high", mode: "default" },
  { ...base, id: "w1:p2", kind: "claude", ws: "w1", tab: "w1:t2", project: "garden-planner", cwd: "/home/alex/src/garden-planner", title: "Datenmodell für Beete", status: "blocked", sessionId: "s2", since: now - 6 * min, lastActive: now - 2 * min,
    dialog: { hash: "q1", kind: "question", title: "Datenbank", tabs: [{ label: "Beete", done: true }, { label: "Datenbank", done: false }, { label: "Fotos", done: false }], step: 1, question: "Beete, Pflanzen und Gießtermine sollen gespeichert werden, später vielleicht auch für mehrere Leute im Haushalt. Welche Datenbank soll die App nutzen?", detail: "", options: ["SQLite", "PostgreSQL", "Type something.", "Chat about this"], descs: ["Eine Datei, kein Server nötig. Reicht für eine Person.", "Eigener Dienst, besser für viele gleichzeitige Nutzer.", "", ""], freeText: 3 },
    ctx: 22, model: "claude-opus-5-5", effort: "medium", mode: "plan" },
  { ...base, id: "w1:p3", kind: "claude", ws: "w1", tab: "w1:t3", project: "blog", cwd: "/home/alex/src/blog", title: "Bildgrößen im Build optimieren", status: "working", sessionId: "s3", since: now - 4 * min, lastActive: now, pinned: true,
    dialog: null, ctx: 63, model: "claude-sonnet-5-5", effort: "medium", mode: "acceptEdits", plan: [["Bilder im Build finden", "done"], ["Größen messen", "done"], ["Umwandlung nach WebP", "run"], ["Vorher und nachher vergleichen", "todo"]], subs: 1,
    usage: { in: 1840, out: 61200, cr: 9412000, cw: 388000, cost: 3.19, msgs: 74, subMsgs: 12, models: [{ model: "claude-sonnet-5-5", in: 1800, out: 58900, cr: 9300000, cw: 371000, cost: 3.18 }, { model: "claude-haiku-5-5", in: 40, out: 2300, cr: 112000, cw: 17000, cost: 0.004 }] } },
  { ...base, id: "w2:p1", kind: "claude", ws: "w2", tab: "w2:t1", project: "homelab", cwd: "/home/alex/src/homelab", title: "Backup-Skript prüfen", status: "done", sessionId: "s4", since: now - 20 * min, lastActive: now - 12 * min,
    dialog: null, ctx: 35, model: "claude-opus-5-5", effort: "high", mode: "auto" },
  { ...base, id: "w2:p2", kind: "codex", ws: "w2", tab: "w2:t2", project: "dotfiles", cwd: "/home/alex/src/dotfiles", title: "Shell-Aliase aufräumen", status: "idle", sessionId: null, since: now - 2 * H, lastActive: now - 2 * H,
    dialog: null, ctx: 0, model: null, effort: null, mode: null, hasHistory: false },
  { ...base, id: "w2:p3", kind: "opencode", ws: "w2", tab: "w2:t3", project: "recipes", cwd: "/home/alex/src/recipes", title: "Einkaufsliste als PDF", status: "idle", sessionId: null, since: now - 3 * H, lastActive: now - 3 * H,
    dialog: null, ctx: 0, model: null, effort: null, mode: null, hasHistory: false },
  { ...base, id: "w1:p4", kind: "claude", ws: "w1", tab: "w1:t4", project: "webshop", cwd: "/home/alex/src/webshop", title: "Tests für den Warenkorb", status: "idle", sessionId: "s7", since: now - 5 * H, lastActive: now - 5 * H,
    dialog: null, ctx: 18, model: "claude-haiku-5-5", effort: "low", mode: "auto" },
];
const STATE = { ok: true, spaces: [{ id: "w1", label: "Arbeit", number: 1 }, { id: "w2", label: "Privat", number: 2 }], shells: [{ id: "w2:p9", ws: "w2", cwd: "/home/alex/src/homelab", title: "" }], agents,
  usage: { at: now, five: { pct: 34, resetsAt: now + 2 * H + 20 * min }, week: { pct: 58, resetsAt: now + 3 * 24 * H } } };

const FEEDS = {
  "w1:p3": [
    { t: "compact", trigger: "auto", v: "Summary:\n1. Ziel: Ladezeit der Blogseite auf dem Handy senken." },
    { t: "user", v: "/home/alex/bilder/herdr-app-2026-11-21T09-12-00-000Z.png Die Seite lädt auf dem Handy zu langsam. Schau dir bitte die Bilder im Build an." },
    { t: "text", v: "Ich schaue zuerst, welche Bilder im Build landen und wie groß sie sind." },
    { t: "tool", k: "Bash", a: "find dist -name '*.png' -size +200k", s: "ok" },
    { t: "tool", k: "Read", a: "/home/alex/src/blog/astro.config.mjs", s: "ok" },
    { t: "text", v: "Die größten Brocken:\n\n| Datei | Größe | Anteil |\n|---|--:|--:|\n| hero.png | 2,4 MB | 61 % |\n| team.png | 820 KB | 21 % |\n| logo.png | 96 KB | 2 % |\n\nIch wandle sie im Build nach **WebP** um. Zum Gegenprüfen kannst du das selbst laufen lassen:\n\n```\n! npm run build && du -sh dist\n```" },
    { t: "diff", f: "/home/alex/src/blog/astro.config.mjs", add: 3, del: 1, lines: ["   integrations: [", "-    sitemap(),", "+    sitemap(),", "+    imageTools({ format: 'webp', quality: 80 }),", "   ],"] },
    { t: "tool", k: "Bash", a: "npm run build", s: "run" },
  ],
  "w1:p2": [{ t: "user", v: "Plane das Datenmodell für die Beete. Noch nichts ändern." }, { t: "text", v: "Ich brauche vorher eine Entscheidung zur Datenbank." }],
  "w1:p1": [{ t: "user", v: "Bitte auf Staging ausrollen." }, { t: "text", v: "Die Tests sind grün. Ich rolle jetzt auf Staging aus." }],
  "w2:p1": [{ t: "user", v: "Prüf bitte das Backup-Skript, ob alle Ordner drin sind." }, { t: "text", v: "Zwei Pfade fehlten, ich habe sie ergänzt. Das Skript läuft jetzt sauber durch." }, { t: "user", v: "/usage" }],
};
// Offenes Menü im Terminal (hier /usage), wird im Chat als Karte gezeigt
const PANELS = {
  "w2:p1": { footer: "", text: [
    "Settings  Status   Config   Usage   Stats", "",
    "Current session          34% used", "Resets 4:20pm", "",
    "Current week (all)       58% used", "Resets Mon 2pm", "",
    "Current week (Opus)      41% used", "Resets Mon 2pm", "",
    "MCP servers            % of usage", "filesystem                    12%", "github                         7%",
  ].join("\n") },
};
const COMMANDS = [
  ["compact", "Unterhaltung zusammenfassen, Kontext frei machen"], ["config", "Einstellungen"], ["context", "Kontext-Belegung anzeigen"], ["cost", "Kosten dieser Sitzung"],
  ["commit-commands:commit", "Create a git commit"], ["commit-commands:commit-push-pr", "Commit, push, and open a PR"], ["clear", "Unterhaltung leeren, neu anfangen"],
  ["mcp", "MCP-Dienste verwalten und anmelden"], ["model", "Modell wählen"], ["usage", "Abo-Verbrauch anzeigen"], ["superpowers:brainstorming", "Before any creative work"],
].map(([name, desc]) => ({ name, desc }));
const ACT = [
  { t: now - 2 * min, pane: "w1:p2", project: "garden-planner", w: "wartet", s: "blocked", d: "Welche Datenbank soll die App nutzen?" },
  { t: now - 12 * min, pane: "w2:p1", project: "homelab", w: "fertig", s: "end", d: "Backup-Skript geprüft, zwei Pfade korrigiert" },
  { t: now - 40 * min, pane: "w1:p3", project: "blog", w: "gestartet", s: "working", d: "Bildgrößen im Build optimieren" },
];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

async function page(b, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(st => {
    class FakeWS { constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.onmessage && this.onmessage({ data: JSON.stringify({ type: "state", data: st }) }); }, 30); } send() {} close() {} }
    window.WebSocket = FakeWS;
    try { localStorage.clear(); } catch (_) {}
    navigator.serviceWorker && Object.defineProperty(navigator, "serviceWorker", { value: undefined });
  }, STATE);
  const p = await ctx.newPage();
  await p.route("http://demo.local/**", async r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/api/")) {
      const J = d => r.fulfill({ json: d });
      if (u.pathname === "/api/state") return J(STATE);
      if (u.pathname === "/api/activity") return J({ entries: ACT });
      if (u.pathname === "/api/settings") return J({ notify: { blocked: true, done: true, working: false }, quiet: true });
      if (u.pathname === "/api/projects") return J({ root: "/home/alex/src", projects: ["blog", "dotfiles", "garden-planner", "homelab", "recipes", "webshop"] });
      if (u.pathname.endsWith("/commands")) return J({ commands: COMMANDS });
      const m = u.pathname.match(/^\/api\/agents\/([^/]+)\/feed$/);
      if (m) { const id = decodeURIComponent(m[1]); const a = agents.find(x => x.id === id); return J({ feed: FEEDS[id] || [], screen: null, dialog: a && a.dialog, tip: null, auth: null, panel: PANELS[id] || null, spinner: id === "w1:p3" ? { secs: 287, tokens: "4.1k", note: "thinking" } : null }); }
      if (u.pathname.endsWith("/changes")) return J({ changes: FEEDS["w1:p3"].filter(x => x.t === "diff") });
      return J({ ok: true });
    }
    const f = path.join(WEB, u.pathname === "/" ? "index.html" : u.pathname);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ body: fs.readFileSync(f), contentType: MIME[path.extname(f)] || "application/octet-stream" });
  });
  await p.goto("http://demo.local/"); await p.waitForTimeout(700);
  return p;
}

// iPhone-Rahmen: App-Bild unter Statusleiste mit Dynamic Island, unten der Home-Balken
const PHONE = { w: 393, h: 852, top: 54, bottom: 30 };
async function shootPhone(p, b, name, scheme) {
  const shot = await p.screenshot({ type: "png" });
  const colors = await p.evaluate(() => {
    const bg = el => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return getComputedStyle(document.body).backgroundColor; };
    return { top: bg(document.elementFromPoint(200, 2)), bottom: bg(document.elementFromPoint(200, innerHeight - 2)) };
  });
  const fg = scheme === "dark" ? "#fff" : "#000";
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;background:transparent}
    .wrap{padding:24px 30px;display:inline-block}
    .phone{position:relative;width:${PHONE.w}px;height:${PHONE.h}px;padding:13px;border-radius:68px;background:linear-gradient(145deg,#3a3d42,#1b1c1f 40%,#2c2e33);box-shadow:0 0 0 2px #0b0b0c inset,0 30px 60px rgba(0,0,0,.35)}
    .btn{position:absolute;width:4px;border-radius:2px;background:#2a2c30}
    .screen{position:relative;width:100%;height:100%;border-radius:55px;overflow:hidden;background:${colors.top};display:flex;flex-direction:column}
    .sb{height:${PHONE.top}px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:4px 34px 0 46px;box-sizing:border-box;color:${fg};font:600 17px -apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif}
    .icons{display:flex;gap:7px;align-items:center}
    .island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000}
    .app{flex:1;min-height:0;display:block;width:100%}
    .home{height:${PHONE.bottom}px;flex:none;background:${colors.bottom};position:relative}
    .home i{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:${fg};opacity:.85}
  </style></head><body><div class="wrap"><div class="phone">
    <span class="btn" style="left:-3px;top:150px;height:32px"></span><span class="btn" style="left:-3px;top:210px;height:62px"></span><span class="btn" style="left:-3px;top:285px;height:62px"></span><span class="btn" style="right:-3px;top:240px;height:96px"></span>
    <div class="screen"><div class="island"></div>
      <div class="sb"><span>9:41</span><span class="icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="${fg}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="${fg}"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.2.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.5 3.8 1.5L13 6a7.2 7.2 0 0 0-10 0l1.2 1.3A5.4 5.4 0 0 1 8 5.8Zm0 3.6c.5 0 1 .2 1.4.6L8 11.6 6.6 10c.4-.4.9-.6 1.4-.6Z"/></svg>
        <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="${fg}" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="${fg}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="${fg}" opacity=".5"/></svg>
      </span></div>
      <img class="app" src="data:image/png;base64,${shot.toString("base64")}">
      <div class="home"><i></i></div>
    </div></div></div></body></html>`;
  const ctx = await b.newContext({ viewport: { width: PHONE.w + 120, height: PHONE.h + 120 }, deviceScaleFactor: 2 });
  const fp = await ctx.newPage();
  await fp.setContent(html); await fp.waitForTimeout(150);
  await (await fp.$(".wrap")).screenshot({ path: path.join(OUT, name + ".png"), omitBackground: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const mob = scheme => ({ viewport: { width: PHONE.w, height: PHONE.h - PHONE.top - PHONE.bottom }, deviceScaleFactor: 3, colorScheme: scheme, isMobile: true, hasTouch: true });
  const fresh = async (scheme = "dark") => page(b, mob(scheme));

  let p = await fresh();
  await shootPhone(p, b, "mobile-agents", "dark");
  await p.click('[data-group="project"]'); await p.waitForTimeout(200);
  await shootPhone(p, b, "mobile-projects", "dark");
  await p.click('[data-group="status"]');
  await p.click('[data-agent="w1:p3"]'); await p.waitForTimeout(600);
  // Ab deiner Nachricht mit Bild: Tabelle und Befehl zum Mitlaufen sind dann im Bild
  await p.evaluate(() => { const u = document.querySelector(".feed .msg-user"); if (u) u.scrollIntoView({ block: "start" }); });
  await p.waitForTimeout(200);
  await shootPhone(p, b, "mobile-chat", "dark");
  await p.context().close();

  p = await fresh();
  await p.click('.card[data-agent="w1:p2"]'); await p.waitForTimeout(600);
  await shootPhone(p, b, "mobile-question", "dark");
  await p.context().close();

  // Slash-Befehle mit Vorschlägen
  p = await fresh();
  await p.click('.card[data-agent="w1:p4"]'); await p.waitForTimeout(500);
  await p.fill("#msg", "/co"); await p.dispatchEvent("#msg", "input"); await p.waitForTimeout(400);
  await shootPhone(p, b, "mobile-slash", "dark");
  await p.context().close();

  // Menü im Terminal (/usage) als Karte im Chat
  p = await fresh();
  await p.click('.card[data-agent="w2:p1"]'); await p.waitForTimeout(600);
  await p.evaluate(() => { const f = document.querySelector(".feed"); const c = document.querySelector(".panelcard"); if (c) c.scrollIntoView({ block: "end" }); else if (f) f.scrollTop = f.scrollHeight; });
  await p.waitForTimeout(200);
  await shootPhone(p, b, "mobile-menu", "dark");
  await p.context().close();

  for (const scheme of ["dark", "light"]) {
    p = await page(b, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    await p.click('.card[data-agent="w1:p3"]'); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, "desktop-" + scheme + ".png") });
    await p.context().close();
  }
  // Verbrauch einer Sitzung: Tipp auf den Kosten-Chip
  p = await fresh();
  await p.click('.card[data-agent="w1:p3"]'); await p.waitForTimeout(600);
  await p.click("[data-usage]"); await p.waitForTimeout(300);
  await shootPhone(p, b, "mobile-usage", "dark");
  await p.context().close();

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
