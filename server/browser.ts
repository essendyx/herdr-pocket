// Browser-Ansicht: leitet /browser/ an eine Selkies-Weboberfläche weiter (HTTP und WebSocket),
// damit die App den Browser des Agents ohne zweite Anmeldung und ohne zweite Adresse einbetten kann.

export const PREFIX = "/browser";

// Adresse der Weboberfläche, z. B. http://127.0.0.1:7684 (ohne Pfad)
export function parseUpstream(s: string | undefined): string | null {
  const v = (s || "").trim().replace(/\/+$/, "");
  if (!v) return null;
  if (!/^https?:\/\/[^/?#\s]+$/.test(v)) throw new Error("HERDR_APP_BROWSER_UPSTREAM ungültig, z. B. http://127.0.0.1:7684");
  return v;
}

// Pfad hinter /browser oder null, wenn die Anfrage nicht zur Browser-Ansicht gehört
export function subPath(pathname: string): string | null {
  if (pathname === PREFIX) return "";
  if (pathname.startsWith(PREFIX + "/")) return pathname.slice(PREFIX.length);
  return null;
}

export function targetUrl(upstream: string, url: URL, ws = false): string {
  const sub = subPath(url.pathname) || "/";
  const base = ws ? upstream.replace(/^http/, "ws") : upstream;
  return base + sub + url.search;
}

// Nur weitergeben, was die Oberfläche braucht. Anmelde-Cookies und Access-Header bleiben in der App.
const DROP_REQ = new Set(["host", "cookie", "authorization", "connection", "upgrade", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding",
  "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol", "content-length"]);
export function requestHeaders(h: Headers): Headers {
  const out = new Headers();
  h.forEach((v, k) => {
    const l = k.toLowerCase();
    if (DROP_REQ.has(l) || l.startsWith("cf-") || l.startsWith("x-forwarded-") || l === "x-real-ip") return;
    out.set(k, v);
  });
  return out;
}

// fetch entpackt komprimierte Antworten selbst: Länge und Kodierung stimmen danach nicht mehr
const DROP_RES = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "server"]);
export function responseHeaders(h: Headers): Headers {
  const out = new Headers();
  h.forEach((v, k) => {
    const l = k.toLowerCase();
    if (DROP_RES.has(l) || l === "set-cookie") return;
    if (l === "location" && v.startsWith("/") && !v.startsWith("//")) v = PREFIX + v;
    out.set(k, v);
  });
  for (const c of h.getSetCookie?.() ?? []) out.append("set-cookie", c.replace(/;\s*path=\/(?=;|$)/i, "; Path=" + PREFIX + "/"));
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "same-origin");
  return out;
}

export async function proxyHttp(req: Request, url: URL, upstream: string): Promise<Response> {
  // Relative Pfade der Oberfläche (./assets/...) brauchen den Schrägstrich am Ende
  if (url.pathname === PREFIX) return new Response(null, { status: 308, headers: { location: PREFIX + "/" + url.search } });
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(targetUrl(upstream, url), { method: req.method, headers: requestHeaders(req.headers), body: hasBody ? await req.arrayBuffer() : undefined, redirect: "manual" });
  } catch {
    return new Response("Browser nicht erreichbar", { status: 502, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: responseHeaders(res.headers) });
}

// Für die Überwachung: antwortet die Oberfläche? (ohne Anmeldung abrufbar, verrät nur ja oder nein)
export async function browserHealth(upstream: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const r = await fetch(upstream + "/", { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await r.body?.cancel();
    return r.ok;
  } catch { return false; }
}

export const isUpgrade = (req: Request) => (req.headers.get("upgrade") || "").toLowerCase() === "websocket";
export const protocolsOf = (req: Request): string[] =>
  (req.headers.get("sec-websocket-protocol") || "").split(",").map(s => s.trim()).filter(Boolean);

// Verbindet einen WebSocket der App mit der Oberfläche. Nachrichten vor dem Öffnen werden gepuffert.
export type Bridge = { send(d: string | ArrayBuffer | Uint8Array): void; close(code?: number, reason?: string): void };
export function openBridge(target: string, origin: string, protocols: string[], client: { send(d: any): any; close(code?: number, reason?: string): void },
  Ws: any = WebSocket): Bridge {
  const up = new Ws(target, { headers: origin ? { Origin: origin } : {}, protocols });
  up.binaryType = "arraybuffer";
  const queue: any[] = [];
  let closed = false;
  up.onopen = () => { for (const m of queue.splice(0)) up.send(m); };
  up.onmessage = (e: any) => { try { client.send(e.data); } catch {} };
  const end = (code?: number, reason?: string) => {
    if (closed) return; closed = true;
    // 1005/1006 dürfen nicht gesendet werden
    const c = code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011;
    try { client.close(c, reason || ""); } catch {}
  };
  up.onclose = (e: any) => end(e?.code, e?.reason);
  up.onerror = () => end(1011, "Browser nicht erreichbar");
  return {
    send(d) { if (up.readyState === 1) up.send(d); else if (up.readyState === 0) queue.push(d); },
    close(code, reason) { closed = true; try { up.close(code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason || ""); } catch {} },
  };
}

// Werkzeuge der Chrome-Erweiterung im Claude-Verlauf
const TOOL_PREFIX = "mcp__claude-in-chrome__";
export const browserTool = (name: string): string | null => (name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : null);

// Kurzbeschreibung eines Browser-Schritts für den Chat
export function describeBrowser(tool: string, input: any): string {
  const i = input && typeof input === "object" ? input : {};
  const s = (v: any) => (typeof v === "string" ? v : "");
  let v = "";
  if (tool === "computer") v = s(i.action_summary) || [s(i.action), s(i.text)].filter(Boolean).join(" ");
  else if (tool === "browser_batch" && Array.isArray(i.actions)) v = i.actions.map((a: any) => s(a?.action_summary) || s(a?.input?.action_summary) || s(a?.tool) || s(a?.name)).filter(Boolean).join(", ");
  else v = s(i.url) || s(i.query) || s(i.action_summary) || s(i.text) || "";
  return v.replace(/\s+/g, " ").slice(0, 120);
}
