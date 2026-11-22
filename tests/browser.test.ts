import { test, expect, beforeAll, afterAll } from "bun:test";
import { browserHealth, parseUpstream, subPath, targetUrl, requestHeaders, responseHeaders, proxyHttp, openBridge, browserTool, describeBrowser } from "../server/browser.ts";
import { parseTranscript } from "../server/transcript.ts";
import { loadConfig, ConfigError } from "../server/config.ts";

// Gefälschte Selkies-Oberfläche: HTTP mit Weiterleitung und Cookie, WebSocket mit Echo
let up: any;
const seen: { path: string; headers: Record<string, string>; body?: string }[] = [];
beforeAll(() => {
  up = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req, srv) {
      const u = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => { headers[k] = v; });
      if (u.pathname === "/ws") return srv.upgrade(req, { data: { origin: req.headers.get("origin") } }) ? undefined as any : new Response("x", { status: 400 });
      seen.push({ path: u.pathname + u.search, headers, body: req.method === "POST" ? await req.text() : undefined });
      if (u.pathname === "/weg") return new Response(null, { status: 302, headers: { location: "/ziel" } });
      if (u.pathname === "/keks") return new Response("ok", { headers: { "set-cookie": "a=1; Path=/; SameSite=Strict" } });
      return new Response("<html>" + u.pathname + "</html>", { headers: { "content-type": "text/html" } });
    },
    websocket: {
      open(ws: any) { ws.send("hallo " + ws.data.origin); },
      message(ws, m) { ws.send(m); },
    },
  });
});
afterAll(() => up.stop(true));
const UP = () => `http://127.0.0.1:${up.port}`;

test("parseUpstream: leer heißt aus, nur Schema und Host erlaubt", () => {
  expect(parseUpstream(undefined)).toBeNull();
  expect(parseUpstream(" ")).toBeNull();
  expect(parseUpstream("http://127.0.0.1:7684/")).toBe("http://127.0.0.1:7684");
  expect(() => parseUpstream("127.0.0.1:7684")).toThrow();
  expect(() => parseUpstream("http://127.0.0.1:7684/pfad")).toThrow();
});

test("subPath und targetUrl: nur /browser und darunter, Abfrage bleibt erhalten", () => {
  expect(subPath("/browser")).toBe("");
  expect(subPath("/browser/")).toBe("/");
  expect(subPath("/browser/assets/x.js")).toBe("/assets/x.js");
  expect(subPath("/browserx")).toBeNull();
  expect(subPath("/api/state")).toBeNull();
  expect(targetUrl("http://h:1", new URL("https://app/browser/api/x?a=1"))).toBe("http://h:1/api/x?a=1");
  expect(targetUrl("http://h:1", new URL("https://app/browser/websockets"), true)).toBe("ws://h:1/websockets");
});

test("requestHeaders: keine Cookies und keine Access-Header an den Browser", () => {
  const h = requestHeaders(new Headers({ cookie: "CF_Authorization=geheim", "cf-access-jwt-assertion": "jwt", "x-forwarded-for": "1.2.3.4", host: "app", accept: "text/html", origin: "https://app" }));
  expect(h.get("cookie")).toBeNull();
  expect(h.get("cf-access-jwt-assertion")).toBeNull();
  expect(h.get("x-forwarded-for")).toBeNull();
  expect(h.get("host")).toBeNull();
  expect(h.get("accept")).toBe("text/html");
  expect(h.get("origin")).toBe("https://app");
});

test("responseHeaders: Weiterleitung und Cookie-Pfad unter /browser", () => {
  const src = new Headers({ location: "/ziel", "content-encoding": "gzip", "content-length": "5" });
  src.append("set-cookie", "a=1; Path=/; SameSite=Strict");
  const h = responseHeaders(src);
  expect(h.get("location")).toBe("/browser/ziel");
  expect(h.get("content-encoding")).toBeNull();
  expect(h.get("content-length")).toBeNull();
  expect(h.getSetCookie()[0]).toBe("a=1; Path=/browser/; SameSite=Strict");
  expect(responseHeaders(new Headers({ location: "https://anders/x" })).get("location")).toBe("https://anders/x");
});

test("proxyHttp: Seite, Weiterleitung, POST mit Inhalt, ohne Schrägstrich 308", async () => {
  seen.length = 0;
  const get = (p: string, init?: RequestInit) => proxyHttp(new Request("https://app" + p, init), new URL("https://app" + p), UP());
  const r1 = await get("/browser/");
  expect(r1.status).toBe(200);
  expect(await r1.text()).toBe("<html>/</html>");
  const r2 = await get("/browser/weg");
  expect(r2.status).toBe(302);
  expect(r2.headers.get("location")).toBe("/browser/ziel");
  const r3 = await get("/browser/api/x?y=1", { method: "POST", body: "daten", headers: { cookie: "CF_Authorization=geheim" } });
  expect(r3.status).toBe(200);
  expect(seen.at(-1)).toMatchObject({ path: "/api/x?y=1", body: "daten" });
  expect(seen.at(-1)!.headers.cookie).toBeUndefined();
  const r4 = await get("/browser?q=1");
  expect(r4.status).toBe(308);
  expect(r4.headers.get("location")).toBe("/browser/?q=1");
});

test("proxyHttp: Browser aus heißt 502 statt Absturz", async () => {
  const r = await proxyHttp(new Request("https://app/browser/"), new URL("https://app/browser/"), "http://127.0.0.1:1");
  expect(r.status).toBe(502);
});

test("openBridge: puffert vor dem Öffnen, setzt Origin, reicht beide Richtungen durch", async () => {
  const got: any[] = [];
  let closed: any = null;
  const client = { send: (d: any) => got.push(typeof d === "string" ? d : new TextDecoder().decode(d)), close: (c?: number) => { closed = c; } };
  const b = openBridge(`ws://127.0.0.1:${up.port}/ws`, "https://app.example", [], client);
  b.send("früh");
  for (let i = 0; i < 50 && got.length < 2; i++) await new Promise(r => setTimeout(r, 20));
  expect(got).toEqual(["hallo https://app.example", "früh"]);
  b.send(new TextEncoder().encode("binär"));
  for (let i = 0; i < 50 && got.length < 3; i++) await new Promise(r => setTimeout(r, 20));
  expect(got[2]).toBe("binär");
  b.close(1000);
  await new Promise(r => setTimeout(r, 50));
  expect(closed).toBeNull();
});

test("openBridge: Browser nicht erreichbar schließt den Client", async () => {
  let closed: any = null;
  openBridge("ws://127.0.0.1:1/ws", "", [], { send() {}, close: (c?: number) => { closed = c; } });
  for (let i = 0; i < 50 && closed === null; i++) await new Promise(r => setTimeout(r, 20));
  expect(closed).toBe(1011);
});

test("browserTool und describeBrowser: Schritte der Chrome-Erweiterung lesbar", () => {
  expect(browserTool("mcp__claude-in-chrome__navigate")).toBe("navigate");
  expect(browserTool("Bash")).toBeNull();
  expect(describeBrowser("navigate", { url: "https://example.org", tabId: 1 })).toBe("https://example.org");
  expect(describeBrowser("computer", { action: "left_click", coordinate: [1, 2], action_summary: "Öffnet das Menü", tabId: 3 })).toBe("Öffnet das Menü");
  expect(describeBrowser("computer", { action: "screenshot", tabId: 3 })).toBe("screenshot");
  expect(describeBrowser("find", { query: "Suchfeld", tabId: 3 })).toBe("Suchfeld");
});

test("Verlauf: browserAt ist der letzte Browser-Schritt, Beschreibung im Feed", () => {
  const line = (ts: string, name: string, input: any, id: string) => JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id, name, input }] } });
  const t = [
    line("2026-11-22T10:00:00Z", "mcp__claude-in-chrome__navigate", { url: "https://example.org" }, "a"),
    line("2026-11-22T10:05:00Z", "Bash", { command: "ls" }, "b"),
    line("2026-11-22T10:01:00Z", "mcp__claude-in-chrome__computer", { action: "type", action_summary: "Tippt Suchbegriff" }, "c"),
  ].join("\n");
  const s = parseTranscript(t);
  expect(s.browserAt).toBe(Date.parse("2026-11-22T10:01:00Z"));
  expect(s.feed.map(x => (x as any).a)).toEqual(["https://example.org", "ls", "Tippt Suchbegriff"]);
  expect(parseTranscript(line("2026-11-22T10:00:00Z", "Bash", { command: "ls" }, "x")).browserAt).toBe(0);
});

test("Konfiguration: Browser optional, ungültige Adresse verhindert den Start", () => {
  const base = { HERDR_APP_ORIGIN: "https://app.example", HERDR_APP_AUTH: "none" };
  expect(loadConfig(base, "/home/x").browser).toBeNull();
  expect(loadConfig({ ...base, HERDR_APP_BROWSER_UPSTREAM: "http://127.0.0.1:7684" }, "/home/x").browser).toBe("http://127.0.0.1:7684");
  expect(() => loadConfig({ ...base, HERDR_APP_BROWSER_UPSTREAM: "kaputt" }, "/home/x")).toThrow(ConfigError);
});

test("browserHealth: erreichbar ja, sonst nein", async () => {
  expect(await browserHealth(UP())).toBe(true);
  expect(await browserHealth("http://127.0.0.1:1", 500)).toBe(false);
});
