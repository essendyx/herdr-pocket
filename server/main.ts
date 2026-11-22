// herdr App: HTTP-API, WebSocket und statische Dateien.
import { DialogWatch } from "./dialogwatch.ts";
import { usageView } from "./usage.ts";
import { parseTip, tipInfo, tipStoreFile } from "./tip.ts";
import { createProject, ProjectError } from "./projects.ts";
import { versionAssets, assetVersions } from "./assets.ts";
import { statSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, extname, normalize } from "path";
import { Poller } from "./poller.ts";
import { Actions, ActionError } from "./actions.ts";
import { PromptQueue } from "./queue.ts";
import { Activity, LABEL } from "./activity.ts";
import { readSession, transcriptPath, type SessionInfo } from "./transcript.ts";
import { sessionUsage } from "./cost.ts";
import { accessVerifier, checkCsrf } from "./auth.ts";
import { loadConfig, ConfigError } from "./config.ts";
import { imagePath } from "./images.ts";
import { pinKey, setPin, isPinned } from "./pins.ts";
import { markSeen, isSeen } from "./seen.ts";
import { parseAuth, parsePanel, parseSpinner } from "./prompt.ts";
import { listCommands, type Cmd } from "./commands.ts";
import { STATE_DIR, ensureDir, readJson, writeJson, DEFAULT_SETTINGS, type Settings } from "./store.ts";
import { call } from "./herdr.ts";
import { browserHealth, subPath, proxyHttp, isUpgrade, protocolsOf, targetUrl, openBridge, type Bridge } from "./browser.ts";
import { PushHub, setupVapid, shouldNotify, pushPayload } from "./push.ts";
import type { Agent, Status } from "./model.ts";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 7683);
const DEV = process.env.HERDR_APP_DEV === "1" && HOST === "127.0.0.1";
const WEB = join(import.meta.dir, "../web");
let CFG;
try { CFG = loadConfig(process.env, homedir(), DEV); }
catch (e) { if (e instanceof ConfigError) { console.error("Konfiguration: " + e.message); process.exit(1); } throw e; }
const ORIGIN = CFG.origin;
const IMG_DIR = CFG.imageDir;
const BROWSER = CFG.browser;
const MAX_IMG = 25 * 1024 * 1024;

ensureDir();
// Ein Fehler in einem Hintergrund-Callback darf den Server nicht beenden
process.on("unhandledRejection", e => console.error("Unbehandelt:", e));
process.on("uncaughtException", e => console.error("Ausnahme:", e));
const poller = new Poller();
const actions = new Actions(undefined as any, () => poller.snapshot);
// Startauftrag, den ein blockierendes Terminal (z. B. Ordner-Vertrauen) aufhält: geht raus, sobald der Agent frei ist
actions.onPending = (pane, text) => { queue.push(pane, text); scheduleState(); };
const queue = new PromptQueue(join(STATE_DIR, "queue.json"));
const activity = new Activity();
let settings: Settings = readJson("settings.json", DEFAULT_SETTINGS);
let pins: string[] = readJson("pins.json", []);
let seen: Record<string, number> = readJson("seen.json", {});
export const hooks = { onStatus: [] as ((a: Agent, from: Status, to: Status, s: Settings) => void)[] };

let verify: ((r: Request) => Promise<{ email: string } | null>) | null = null;
if (CFG.auth.kind === "cloudflare") verify = accessVerifier(CFG.auth.issuer, CFG.auth.aud, CFG.auth.email);

// Verlaufsdaten je Agent, zwischengespeichert nach Änderungszeit der Datei
const sessions = new Map<string, { mtime: number; info: SessionInfo | null }>();
function mtimeOf(a: Agent): number {
  if (!a.sessionId) return 0;
  try { return statSync(transcriptPath(a.cwd, a.sessionId)).mtimeMs; } catch { return 0; }
}
async function session(a: Agent): Promise<SessionInfo | null> {
  const m = mtimeOf(a);
  const c = sessions.get(a.id);
  if (c && c.mtime === m) return c.info;
  let info: SessionInfo | null = null;
  try { info = a.sessionId && m ? await readSession(a.cwd, a.sessionId) : null; } catch (e) { console.error("Verlauf:", e); }
  sessions.set(a.id, { mtime: m, info });
  return info;
}

// Tipps des Plugins "You should know": Datei nur neu lesen, wenn sie sich geändert hat
const TIP_FILE = tipStoreFile();
let tipMtime = -1, usageMtime = 0;
function tipMtimeNow() { try { return TIP_FILE ? statSync(TIP_FILE).mtimeMs : 0; } catch { return 0; } }

const readVisible = async (id: string): Promise<string> => (await call("pane.read", { pane_id: id, source: "visible" }).catch(() => null))?.read?.text ?? "";

const cmdCache = new Map<string, { at: number; list: Cmd[] }>();
async function stateJson() {
  const s = poller.snapshot;
  const agents = await Promise.all(s.agents.map(async a => {
    const i = await session(a);
    const dialog = a.status === "blocked" ? await actions.dialog(a.id).catch(() => null) : null;
    const tip = tipInfo(TIP_FILE, a.sessionId);
    const lastActive = i?.last || mtimeOf(a) || null;
    // Token-Verbrauch der Sitzung samt Subagents; liest nur, was seit dem letzten Mal dazugekommen ist
    const tp = a.sessionId && mtimeOf(a) ? transcriptPath(a.cwd, a.sessionId) : "";
    const usage = tp ? await sessionUsage(tp, tp.replace(/\.jsonl$/, "") + "/subagents").catch(() => null) : null;
    return { ...a, usage, pinned: isPinned(pins, a), seen: isSeen(seen, { ...a, lastActive }), dialog, tip, lastActive, browserAt: i?.browserAt ?? 0, ctx: i?.ctx ?? 0, model: i?.model ?? null, effort: i?.effort ?? null, mode: i?.mode ?? null, plan: i?.plan ?? [], subs: i?.subs ?? 0, queue: queue.list(a.id), hasHistory: !!i };
  }));
  return { ...s, agents, browser: !!BROWSER, usage: usageView(readJson("usage.json", null)) };
}

// WebSocket-Verteilung
const clients = new Set<any>();
function broadcast(msg: unknown) {
  const t = JSON.stringify(msg);
  for (const c of clients) { try { c.send(t); } catch {} }
}
let pendingState = false;
function scheduleState() {
  if (pendingState) return;
  pendingState = true;
  setTimeout(async () => {
    pendingState = false;
    try { broadcast({ type: "state", data: await stateJson() }); } catch (e) { console.error("Zustand:", e); }
  }, 50);
}
poller.addEventListener("snapshot", scheduleState);
// Wartende Agents: ändert sich die Frage ohne Statuswechsel (Teilfragen), sofort neu verteilen
const dialogWatch = new DialogWatch();
let dialogBusy = false;
setInterval(async () => {
  if (dialogBusy) return; dialogBusy = true;
  try {
    const blocked = poller.snapshot.agents.filter(a => a.status === "blocked");
    dialogWatch.keepOnly(blocked.map(a => a.id));
    let changed = false;
    for (const a of blocked) {
      const d = await actions.dialog(a.id).catch(() => null);
      if (dialogWatch.update(a.id, d ? d.hash : null)) { changed = true; broadcast({ type: "feed", pane: a.id }); }
    }
    if (changed) scheduleState();
  } finally { dialogBusy = false; }
}, 1000);

// Verläufe beobachten: geänderte Datei heißt neuer Feed
const lastMtime = new Map<string, number>();
setInterval(() => {
  const um = (() => { try { return statSync(join(STATE_DIR, "usage.json")).mtimeMs; } catch { return 0; } })();
  if (um !== usageMtime) { usageMtime = um; scheduleState(); }
  const tm = tipMtimeNow();
  if (tm !== tipMtime) { const first = tipMtime < 0; tipMtime = tm; if (!first) { scheduleState(); for (const a of poller.snapshot.agents) broadcast({ type: "feed", pane: a.id }); } }
  for (const a of poller.snapshot.agents) {
    const m = mtimeOf(a);
    if (m && lastMtime.get(a.id) !== m) {
      const first = !lastMtime.has(a.id);
      lastMtime.set(a.id, m);
      if (!first) { broadcast({ type: "feed", pane: a.id }); scheduleState(); }
    }
  }
}, 1000);

poller.addEventListener("status", (e: any) => {
  const { agent, from, to } = e.detail as { agent: Agent; from: Status; to: Status };
  try {
    const entry = activity.add({ s: to, pane: agent.id, project: agent.project, w: LABEL[to], d: agent.title });
    broadcast({ type: "activity", entry });
  } catch (err) { console.error("Aktivität:", err); }
  try {
    const next = queue.onStatus(agent.id, to);
    if (next) actions.sendPrompt(agent.id, next.text).catch(err => {
      // Nicht zugestellt: wieder vorne einreihen, nichts geht verloren
      queue.restore(agent.id, next); scheduleState();
      console.error("Warteschlange:", err.message);
    }).then(() => scheduleState());
  } catch (err) { console.error("Warteschlange:", err); }
  for (const h of hooks.onStatus) { try { h(agent, from, to, settings); } catch (err) { console.error(err); } }
});

// Rückgängig nach dem Beenden
const undo = new Map<string, { info: any; exp: number }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);
const agentOf = (pane: string) => poller.snapshot.agents.find(a => a.id === pane);
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };

async function route(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = (re: RegExp) => { const x = p.match(re); if (!x) return null; try { return x.map(v => decodeURIComponent(v)) as RegExpMatchArray; } catch { return null; } };
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  let r: RegExpMatchArray | null;

  if (req.method === "GET" && p === "/api/state") return json(await stateJson());
  if (req.method === "GET" && (r = m(/^\/api\/agents\/([^/]+)\/feed$/))) {
    const a = agentOf(r[1]); if (!a) return fail(404, "Agent nicht gefunden");
    const i = await session(a);
    let screen: string | null = null;
    if (!i) screen = (await call("pane.read", { pane_id: a.id, source: "recent", lines: 80 }).catch(() => null))?.read?.text ?? null;
    const dialog = a.status === "blocked" ? await actions.dialog(a.id).catch(() => null) : null;
    // Tipp-Optionen stehen nur auf dem Bildschirm (ändern sich z. B. nach "Learn more")
    const tipInfoNow = tipInfo(TIP_FILE, a.sessionId);
    const visible = await readVisible(a.id);
    const tipScreen = tipInfoNow ? parseTip(visible) : null;
    // MCP-Anmeldung im Terminal: als Karte mit sauberem Link und Feld für die Adresse aus dem Browser
    const auth = a.status === "working" || a.status === "blocked" ? parseAuth(visible) : null;
    // Maßgeblich ist das Terminal: steht dort kein Tipp mehr (z. B. nach "Dismiss"), gibt es keine Karte, auch wenn die Plugin-Datei noch hinterherhinkt
    return json({ feed: i?.feed.slice(-300) ?? [], screen, dialog, tip: tipInfoNow && tipScreen ? { ...tipInfoNow, options: tipScreen.options } : null, auth,
      // Sonstiges offenes Menü im Terminal (z. B. /mcp): im Chat zeigen, sonst sieht man es nur im Terminal
      panel: !auth && !tipScreen && !dialog ? parsePanel(visible, a.kind === "claude") : null,
      // Statuszeile beim Arbeiten (Dauer, Tokens), damit man sieht, dass wirklich noch etwas passiert
      spinner: a.status === "working" ? parseSpinner(visible) : null,
      // Eingereiht, aber von Claude noch nicht aufgenommen; nach Ende der Runde ist die Liste ohnehin leer
      pending: a.status === "working" || a.status === "blocked" ? i?.pending ?? [] : [] });
  }
  // Slash-Befehle für die Autovervollständigung, je Projektordner eine Minute zwischengespeichert
  if (req.method === "GET" && (r = m(/^\/api\/agents\/([^/]+)\/commands$/))) {
    const a = agentOf(r[1]); if (!a) return fail(404, "Agent nicht gefunden");
    const c = cmdCache.get(a.cwd);
    if (c && Date.now() - c.at < 60_000) return json({ commands: c.list });
    const list = listCommands(homedir(), a.cwd);
    cmdCache.set(a.cwd, { at: Date.now(), list });
    return json({ commands: list });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/auth$/))) {
    await actions.authPaste(r[1], String((await body()).text || ""));
    setTimeout(() => broadcast({ type: "feed", pane: r![1] }), 1500);
    return json({ ok: true });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/tip$/))) {
    const b = await body();
    await actions.tipKey(r[1], String(b.key ?? ""));
    setTimeout(() => broadcast({ type: "feed", pane: r![1] }), 600);
    return json({ ok: true });
  }
  if (req.method === "GET" && (r = m(/^\/api\/agents\/([^/]+)\/changes$/))) {
    const a = agentOf(r[1]); if (!a) return fail(404, "Agent nicht gefunden");
    return json({ changes: (await session(a))?.changes ?? [] });
  }
  if (req.method === "GET" && (r = m(/^\/api\/panes\/([^/]+)\/screen$/))) {
    const source = url.searchParams.get("source") === "recent" ? "recent" : "visible";
    const res = await call("pane.read", { pane_id: r[1], source, lines: source === "recent" ? 200 : undefined }).catch(() => null);
    if (!res) return fail(404, "Fenster nicht gefunden");
    return json({ text: res.read.text });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/prompt$/))) {
    const a = agentOf(r[1]); if (!a) return fail(404, "Agent nicht gefunden");
    const b = await body();
    const text = String(b.text || "").trim(); if (!text) return fail(400, "Leere Nachricht");
    if (a.status === "working" && !b.now) { queue.push(a.id, text); scheduleState(); return json({ queued: true }); }
    await actions.sendPrompt(a.id, text); return json({ ok: true });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/queue\/([\w-]+)\/send$/))) {
    const e = queue.take(r[1], r[2]); if (!e) return fail(404, "Eintrag ist schon weg");
    scheduleState();
    try { await actions.sendPrompt(r[1], e.text); } catch (err) { queue.restore(r[1], e); scheduleState(); throw err; }
    return json({ ok: true });
  }
  if (req.method === "DELETE" && (r = m(/^\/api\/agents\/([^/]+)\/queue\/([\w-]+)$/))) {
    if (!queue.drop(r[1], r[2])) return fail(404, "Eintrag ist schon weg");
    scheduleState(); return json({ ok: true });
  }
  if (req.method === "POST" && (r = m(/^\/api\/panes\/([^/]+)\/keys$/))) { await actions.sendKeys(r[1], (await body()).keys || []); return json({ ok: true }); }
  if (req.method === "POST" && (r = m(/^\/api\/panes\/([^/]+)\/line$/))) { await actions.sendShellLine(r[1], String((await body()).text || "")); return json({ ok: true }); }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/answer$/))) {
    const b = await body();
    if (typeof b.text === "string") { await actions.answerText(r[1], String(b.hash || ""), b.text); setTimeout(scheduleState, 500); setTimeout(scheduleState, 1500); return json({ ok: true }); }
    await actions.answer(r[1], String(b.hash || ""), b.option === "esc" ? "esc" : Number(b.option));
    setTimeout(scheduleState, 500); setTimeout(scheduleState, 1500);
    return json({ ok: true });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/config$/))) {
    const a = agentOf(r[1]); if (!a) return fail(404, "Agent nicht gefunden");
    const b = await body();
    if ((b.model || b.effort) && !(await session(a))) return fail(409, "Modell und Effort gehen erst, wenn die Sitzung eine Nachricht hat");
    await actions.setConfig(a.id, { mode: b.mode, model: b.model, effort: b.effort });
    sessions.delete(a.id); scheduleState(); return json({ ok: true });
  }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/end$/))) {
    const a = agentOf(r[1]);
    const info = await actions.endAgent(r[1], !!(await body()).keepShell);
    if (a) activity.add({ s: "end", pane: a.id, project: a.project, w: LABEL.end, d: a.title });
    const token = crypto.randomUUID();
    undo.set(token, { info, exp: Date.now() + 120000 });
    return json({ undo: token });
  }
  if (req.method === "POST" && (r = m(/^\/api\/undo\/([\w-]+)$/))) {
    const u = undo.get(r[1]); undo.delete(r[1]);
    if (!u || u.exp < Date.now()) return fail(410, "Rückgängig ist nicht mehr möglich");
    return json({ pane: await actions.resume(u.info) });
  }
  if (req.method === "POST" && (r = m(/^\/api\/shells\/([^/]+)\/claude$/))) {
    const b = await body(); await actions.claudeHere(r[1], { mode: b.mode, model: b.model, effort: b.effort }); return json({ ok: true });
  }
  if (req.method === "DELETE" && (r = m(/^\/api\/panes\/([^/]+)$/))) { await actions.closePane(r[1]); return json({ ok: true }); }
  if (req.method === "DELETE" && (r = m(/^\/api\/spaces\/([^/]+)$/))) { await actions.closeSpace(r[1]); return json({ ok: true }); }
  if (req.method === "POST" && (r = m(/^\/api\/agents\/([^/]+)\/image$/))) {
    const form = await req.formData().catch(() => null);
    const f = form?.get("image");
    if (!(f instanceof Blob) || !/^image\/(png|jpeg|gif|webp|heic|heif)$/.test(f.type)) return fail(400, "Nur Bilder");
    if (f.size > MAX_IMG) return fail(413, "Bild ist größer als 25 MB");
    mkdirSync(IMG_DIR, { recursive: true });
    const ext = f.type.split("/")[1].replace("jpeg", "jpg");
    const path = join(IMG_DIR, `herdr-app-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`);
    await Bun.write(path, f);
    return json({ path });
  }
  if (req.method === "GET" && p === "/api/image") {
    const f = imagePath(IMG_DIR, url.searchParams.get("path") || "");
    if (!f) return fail(404, "Bild nicht gefunden");
    const ext = extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
    return new Response(Bun.file(f), { headers: { "content-type": "image/" + ext, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  if (req.method === "GET" && p === "/api/projects") {
    const root = join(homedir(), "src");
    const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name).sort((x, y) => x.localeCompare(y, "de"));
    return json({ root, projects: dirs });
  }
  if (req.method === "POST" && p === "/api/agents") {
    const b = await body();
    let name = String(b.project || "");
    if (b.newProject) {
      try { name = createProject(join(homedir(), "src"), String(b.newProject)); }
      catch (e) { if (e instanceof ProjectError) return fail(e.status, e.message); throw e; }
      if (b.newSpace === true) b.newSpace = name;
    }
    if (!/^[^/\\]+$/.test(name) || name.startsWith(".")) return fail(400, "Projekt ungültig");
    const cwd = join(homedir(), "src", name);
    try { if (!statSync(cwd).isDirectory()) throw 0; } catch { return fail(404, "Projektordner fehlt"); }
    const pane = await actions.startAgent({ ws: b.ws || undefined, newSpace: b.newSpace || undefined, cwd, mode: b.mode, model: b.model, effort: b.effort, prompt: b.prompt, shell: !!b.shell, agent: b.agent ? String(b.agent) : "claude" });
    return json({ pane });
  }
  if (req.method === "GET" && p === "/api/activity") return json({ entries: activity.recent(200) });
  if (req.method === "GET" && p === "/api/settings") return json(settings);
  if (req.method === "PUT" && (r = m(/^\/api\/agents\/([^/]+)\/pin$/))) {
    const a = poller.snapshot.agents.find(x => x.id === r![1]);
    if (!a) return fail(404, "Agent nicht gefunden");
    const b = await body();
    pins = setPin(pins, pinKey(a), !!b.pinned);
    writeJson("pins.json", pins); scheduleState();
    return json({ pinned: !!b.pinned });
  }
  // Fertige Agents als gesehen markieren (Chat geöffnet oder "Als gesehen markieren"), gilt für alle Geräte
  if (req.method === "POST" && p === "/api/seen") {
    const b = await body();
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    let n = 0;
    for (const a of poller.snapshot.agents) {
      if (!ids.includes(a.id) || a.status !== "done") continue;
      seen = markSeen(seen, { ...a, lastActive: (await session(a))?.last || mtimeOf(a) || null }); n++;
    }
    if (n) { writeJson("seen.json", seen); scheduleState(); }
    return json({ marked: n });
  }
  if (req.method === "PUT" && p === "/api/settings") {
    const b = await body();
    settings = { notify: { blocked: !!b.notify?.blocked, done: !!b.notify?.done, working: !!b.notify?.working }, quiet: !!b.quiet };
    writeJson("settings.json", settings); return json(settings);
  }
  for (const h of extraRoutes) { const res = await h(req, url); if (res) return res; }
  return fail(404, "Nicht gefunden");
}
export const extraRoutes: ((req: Request, url: URL) => Promise<Response | null>)[] = [];

async function serveStatic(p: string): Promise<Response> {
  const rel = normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
  const f = Bun.file(join(WEB, rel));
  if (!rel.startsWith("/") || !(await f.exists())) return new Response("Nicht gefunden", { status: 404 });
  if (rel === "/index.html") {
    const html = versionAssets(await f.text(), assetVersions(WEB));
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response(f, { headers: { "content-type": MIME[extname(rel)] || "application/octet-stream", "cache-control": "no-cache" } });
}

export const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") return json({ ok: true, herdr: poller.snapshot.ok });
    if (url.pathname === "/api/health/browser") {
      if (!BROWSER) return fail(404, "Browser nicht eingerichtet");
      const up = await browserHealth(BROWSER);
      return json({ ok: up }, up ? 200 : 503);
    }
    if (verify && !(await verify(req))) return fail(401, "Nicht angemeldet");
    // Browser-Ansicht: eigene Oberfläche, deshalb ohne X-Herdr-App, aber nur vom eigenen Origin (Schreiben und WebSocket)
    if (subPath(url.pathname) !== null) {
      if (!BROWSER) return fail(404, "Nicht gefunden");
      const write = req.method !== "GET" && req.method !== "HEAD";
      if ((write || isUpgrade(req)) && ORIGIN && req.headers.get("origin") !== ORIGIN) return fail(403, "Anfrage abgelehnt");
      if (isUpgrade(req)) {
        const protocols = protocolsOf(req);
        const ok = srv.upgrade(req, { data: { browser: targetUrl(BROWSER, url, true), protocols }, headers: protocols.length ? { "Sec-WebSocket-Protocol": protocols[0] } : undefined });
        return ok ? undefined as any : fail(400, "WebSocket erwartet");
      }
      return proxyHttp(req, url, BROWSER);
    }
    if (!checkCsrf(req, ORIGIN)) return fail(403, "Anfrage abgelehnt");
    if (url.pathname === "/ws" && ORIGIN && req.headers.get("origin") !== ORIGIN) return fail(403, "Anfrage abgelehnt");
    if (url.pathname === "/ws") return srv.upgrade(req) ? undefined as any : fail(400, "WebSocket erwartet");
    if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname);
    try {
      return await route(req, url);
    } catch (e: any) {
      if (e instanceof ActionError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "Interner Fehler");
    }
  },
  websocket: {
    async open(ws: any) {
      if (ws.data?.browser) { ws.data.bridge = openBridge(ws.data.browser, ORIGIN, ws.data.protocols || [], ws); return; }
      clients.add(ws);
      try { ws.send(JSON.stringify({ type: "state", data: await stateJson() })); } catch (e) { console.error("WebSocket:", e); }
    },
    close(ws: any, code: number, reason: string) { if (ws.data?.bridge) (ws.data.bridge as Bridge).close(code, reason); else clients.delete(ws); },
    message(ws: any, m) { if (ws.data?.bridge) (ws.data.bridge as Bridge).send(m as any); },
  },
});

// Web Push
const vapidKey = setupVapid(/^https:/.test(ORIGIN) ? ORIGIN : "mailto:herdr-app@localhost");
const pushHub = new PushHub();
hooks.onStatus.push((a, _from, to, s) => {
  if (!shouldNotify(to, s, new Date())) return;
  pushHub.notifyAll(pushPayload(a, to)).catch(e => console.error("Push:", e));
});
extraRoutes.push(async (req, url) => {
  if (req.method === "GET" && url.pathname === "/api/push/key") return json({ key: vapidKey, subscribed: pushHub.count() });
  if (req.method === "POST" && url.pathname === "/api/push/subscribe") {
    try { pushHub.subscribe(await req.json()); } catch { return fail(400, "Ungültiges Abo"); }
    return json({ ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/push/test") {
    await pushHub.notifyAll({ title: "herdr", body: "Testnachricht: Push funktioniert.", pane: "" });
    return json({ ok: true, subscribed: pushHub.count() });
  }
  return null;
});

poller.start(1000);
console.log(`herdr App lauscht auf http://${HOST}:${PORT}${DEV ? " (DEV, ohne Access-Prüfung)" : ""}`);
