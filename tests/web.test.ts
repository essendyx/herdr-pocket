import { test, expect, beforeAll, afterAll } from "bun:test";
import { Window } from "happy-dom";
import { join } from "path";

// Gefälschter Server: liefert web/ und eine kleine API
const WEB = join(import.meta.dir, "../web");
const calls: { m: string; p: string; body: any }[] = [];
const DIALOG = { hash: "abcdef0123456789", title: "Bash command", question: "Do you want to proceed?", detail: "echo hi", options: ["Yes", "Yes, always", "No"], deny: 3 };
const STATE = {
  ok: true,
  spaces: [{ id: "w1", label: "Main", number: 1 }],
  shells: [{ id: "w1:p5", ws: "w1", cwd: "/home/alex/src/ideen", title: "" }],
  agents: [
    { id: "w1:p1", ws: "w1", tab: "w1:t1", project: "smarthome", cwd: "/home/alex/src/smarthome", title: "Firmware-Update", status: "blocked", sessionId: "s1", since: Date.now(), lastActive: Date.now(), dialog: DIALOG, ctx: 38, model: "claude-opus-5-5", effort: "high", mode: "default", plan: [], subs: 0, queue: [], hasHistory: true },
    { id: "w1:p2", ws: "w1", tab: "w1:t2", project: "idlegame", cwd: "/home/alex/src/idlegame", title: "Prio 1", status: "working", sessionId: "s2", since: Date.now(), lastActive: Date.now(), dialog: null, ctx: 71, model: "claude-sonnet-5-5", effort: "medium", mode: "auto", plan: [["A", "done"], ["B", "run"]], subs: 1, queue: [], hasHistory: true },
  ],
};
let srv: any;
beforeAll(() => {
  srv = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      if (!u.pathname.startsWith("/api/")) {
        const f = Bun.file(join(WEB, u.pathname === "/" ? "index.html" : u.pathname));
        return (await f.exists()) ? new Response(f) : new Response("x", { status: 404 });
      }
      if (authRedirect) return new Response(null, { status: 302, headers: { location: "https://myteam.cloudflareaccess.com/cdn-cgi/access/login/x" } });
      const body = req.method === "GET" ? null : await req.json().catch(() => null);
      calls.push({ m: req.method, p: decodeURIComponent(u.pathname), body });
      const J = (d: any) => Response.json(d);
      if (u.pathname === "/api/state") return J(STATE);
      if (u.pathname.endsWith("/image")) { calls.push({ m: req.method, p: decodeURIComponent(u.pathname), body: null }); return J({ path: "/home/alex/Bilder/herdr-app-x.png" }); }
      if (u.pathname === "/api/activity") return J({ entries: [] });
      if (u.pathname === "/api/settings") return J({ notify: { blocked: true, done: true, working: false }, quiet: true });
      if (u.pathname.endsWith("/feed")) return J({ feed: [{ t: "user", v: "Hallo" }, { t: "user", v: "Schau Bild: /home/alex/bilder/herdr-app-2026-11-20T08-15-14-439Z.png und /tmp/ab/x.JPG an" }, { t: "text", v: "Antwort" }, { t: "text", v: "Bitte so:\n1. Anmelden:\n   ```\n   ! codex login --device-auth\n   ```\n2. Fertig. Und `inline` bleibt. Link: https://auth.openai.com/codex/device?x=1&y=2. Format `x-safari-https://a.b/c` und **https://fett.example/x** und \"https://q.example/z\".\n```\nzeile eins\nzeile <zwei>\n```" }, { t: "text", v: "Übersicht:\n| Name | Wert |\n|---|:-:|\n| eins | **fett** |\n| zwei <b> | 2 |\nEnde." }], screen: null, dialog: DIALOG });
      return J({ ok: true });
    },
  });
});
afterAll(() => srv.stop(true));

class FakeWS {
  static last: FakeWS | null = null;
  static refuse = false;
  readyState = 0; onopen: any; onmessage: any; onclose: any;
  constructor() {
    FakeWS.last = this;
    setTimeout(() => { if (FakeWS.refuse) { this.readyState = 3; this.onclose?.(); } else { this.readyState = 1; this.onopen?.(); } }, 5);
  }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
  push(d: any) { this.onmessage?.({ data: JSON.stringify(d) }); }
}

let authRedirect = false;
function ev2(w: any, file: any) {
  const ev = new w.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }], getData: () => "" } });
  return ev;
}
async function boot() {
  const w = new Window({ url: `http://127.0.0.1:${srv.port}/`, width: 390, height: 844, settings: { disableCSSFileLoading: true, enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } as any });
  (w as any).WebSocket = FakeWS;
  (w as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  // Skripte selbst auswerten: happy-dom würde sie sonst synchron vom Testserver im selben Prozess laden
  const html = (await Bun.file(join(WEB, "index.html")).text()).replace(/<script[^>]*><\/script>/g, "").replace(/<link[^>]*>/g, "");
  FakeWS.last = null;
  w.document.write(html);
  (w as any).eval(await Bun.file(join(WEB, "api.js")).text());
  (w as any).__authLost = 0;
  (w as any).HerdrApi.authLost = () => { (w as any).__authLost++; };
  (w as any).eval(await Bun.file(join(WEB, "app.js")).text());
  for (let i = 0; i < 50 && !FakeWS.last; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 20));
  FakeWS.last!.push({ type: "state", data: STATE });
  await new Promise(r => setTimeout(r, 20));
  return w;
}

test("Liste zeigt die Agents aus dem Zustand, wartender oben mit Erlauben", async () => {
  const w = await boot();
  const d = w.document;
  const cards = [...d.querySelectorAll("#listBody .card")];
  expect(cards.length).toBe(2);
  expect(cards[0].textContent).toContain("Firmware-Update");
  expect(d.querySelector("#listBody [data-approve]")).not.toBeNull();
  expect(d.querySelector("#tabBadge")!.textContent).toBe("1");
  await w.happyDOM.abort(); w.close();
});

test("Erlauben schickt answer mit Hash und Option 1, Ablehnen mit deny", async () => {
  const w = await boot();
  await new Promise(r => setTimeout(r, 800));
  calls.length = 0;
  (w.document.querySelector("[data-approve]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  (w.document.querySelector("[data-deny]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  const a = calls.filter(c => c.p === "/api/agents/w1:p1/answer");
  expect(a[0].body).toEqual({ hash: "abcdef0123456789", option: 1 });
  expect(a[1].body).toEqual({ hash: "abcdef0123456789", option: "esc" });
  await w.happyDOM.abort(); w.close();
});

test("Agent öffnen lädt den Feed, Senden schickt prompt", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  expect(d.querySelector(".feed")!.textContent).toContain("Antwort");
  expect(d.querySelector(".planbar")!.textContent).toContain("Plan 1/2");
  (d.getElementById("msg") as any).value = "Weiter so";
  calls.length = 0;
  (d.querySelector("[data-send]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  expect(calls.find(c => c.p === "/api/agents/w1:p2/prompt")!.body).toEqual({ text: "Weiter so" });
  await w.happyDOM.abort(); w.close();
});

test("Verbindungsabbruch zeigt Hinweis, neue Verbindung räumt ihn weg", async () => {
  const w = await boot();
  const d = w.document;
  FakeWS.last!.close();
  expect((d.getElementById("connbar") as any).hidden).toBe(false);
  expect(d.getElementById("connbar")!.textContent).toContain("Verbinde neu");
  await new Promise(r => setTimeout(r, 1100));
  FakeWS.last!.push({ type: "state", data: STATE });
  await new Promise(r => setTimeout(r, 20));
  expect((d.getElementById("connbar") as any).hidden).toBe(true);
  expect(d.querySelectorAll("#listBody .card").length).toBe(2);
  await w.happyDOM.abort(); w.close();
});

test("herdr nicht erreichbar zeigt eigenen Hinweis", async () => {
  const w = await boot();
  FakeWS.last!.push({ type: "state", data: { ...STATE, ok: false, error: "herdr nicht erreichbar" } });
  expect(w.document.getElementById("connbar")!.textContent).toContain("Keine Verbindung zu herdr");
  await w.happyDOM.abort(); w.close();
});

test("Neuer Dialog: Freigabe-Knöpfe sind kurz gesperrt, danach geht der angezeigte Hash raus", async () => {
  const w = await boot();
  const d = w.document;
  await new Promise(r => setTimeout(r, 800));
  const B = { ...DIALOG, hash: "bbbbbbbbbbbbbbbb", detail: "rm -rf x" };
  FakeWS.last!.push({ type: "state", data: { ...STATE, agents: [{ ...STATE.agents[0], dialog: B }, STATE.agents[1]] } });
  await new Promise(r => setTimeout(r, 20));
  calls.length = 0;
  (d.querySelector("[data-approve]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  expect(calls.filter(c => c.p.endsWith("/answer")).length).toBe(0);
  expect((d.querySelector("[data-approve]") as any).dataset.hash).toBe("bbbbbbbbbbbbbbbb");
  await new Promise(r => setTimeout(r, 800));
  (d.querySelector("[data-approve]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  expect(calls.find(c => c.p.endsWith("/answer"))!.body).toEqual({ hash: "bbbbbbbbbbbbbbbb", option: 1 });
  await w.happyDOM.abort(); w.close();
});

test("Warteschlange: Verwerfen schickt die ID des Eintrags", async () => {
  const w = await boot();
  const d = w.document;
  const st = { ...STATE, agents: [STATE.agents[0], { ...STATE.agents[1], queue: [{ id: "q-1", text: "Danach Tests" }] }] };
  FakeWS.last!.push({ type: "state", data: st });
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  calls.length = 0;
  (d.querySelector("[data-qdel]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  expect(calls.find(c => c.m === "DELETE")!.p).toBe("/api/agents/w1:p2/queue/q-1");
  await w.happyDOM.abort(); w.close();
});

test("Abgelaufene Anmeldung: nach zwei WebSocket-Abbrüchen wird geprüft und neu geladen", async () => {
  const w = await boot();
  authRedirect = true; FakeWS.refuse = true;
  try {
    FakeWS.last!.close();
    await new Promise(r => setTimeout(r, 1400));
    expect((w as any).__authLost).toBeGreaterThan(0);
  } finally { authRedirect = false; FakeWS.refuse = false; }
  await w.happyDOM.abort(); w.close();
});

test("Codeblöcke: Kasten mit Kopieren, einzelne !-Zeile mit Senden-Knopf, der genau die Zeile schickt", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const blocks = [...d.querySelectorAll(".feed pre.codeblock")];
  expect(blocks.length).toBe(2);
  expect(blocks[0].textContent).toContain("! codex login --device-auth");
  expect(d.querySelector(".feed")!.textContent).not.toContain("```");
  expect(blocks[1].querySelector("code")!.innerHTML).toContain("zeile &lt;zwei&gt;");
  expect(d.querySelectorAll(".feed [data-runline]").length).toBe(1);
  expect(d.querySelectorAll(".feed [data-copy]").length).toBe(2);
  expect([...d.querySelectorAll(".feed .msg-text code")].filter(c => !c.closest("pre")).map(c => c.textContent)).toEqual(["inline", "x-safari-https://a.b/c"]);
  calls.length = 0;
  (d.querySelector(".feed [data-runline]") as any).click();
  await new Promise(r => setTimeout(r, 30));
  expect(calls.find(c => c.p === "/api/agents/w1:p2/prompt")!.body).toEqual({ text: "! codex login --device-auth" });
  await w.happyDOM.abort(); w.close();
});

test("Links im Antworttext sind anklickbar und öffnen in neuem Tab", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const a = [...d.querySelectorAll(".feed .msg-text a")].filter(x => !x.closest("pre"));
  expect(a.map(x => x.getAttribute("href"))).toEqual(["https://auth.openai.com/codex/device?x=1&y=2", "https://a.b/c", "https://fett.example/x", "https://q.example/z"]);
  // Nichts darf offen bleiben: kein Code-Tag um den Rest, Fettschrift sauber
  expect(d.querySelector(".feed .msg-text code a")!.textContent).toBe("https://a.b/c");
  expect(d.querySelector(".feed .msg-text strong a")!.textContent).toBe("https://fett.example/x");
  expect(d.querySelector("#msg")!.closest("code, a, strong")).toBeNull();
  expect(a[0].getAttribute("target")).toBe("_blank");
  expect(a[0].getAttribute("rel")).toBe("noopener noreferrer");
  await w.happyDOM.abort(); w.close();
});

test("Tippen auf Inline-Code kopiert ihn", async () => {
  const w = await boot();
  const d = w.document;
  let copied = "";
  Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (v: string) => { copied = v; } } });
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const c = [...d.querySelectorAll(".feed .msg-text code")].find(x => !x.closest("pre") && x.textContent === "inline") as any;
  c.click();
  await new Promise(r => setTimeout(r, 20));
  expect(copied).toBe("inline");
  await w.happyDOM.abort(); w.close();
});

test("Karte zeigt den Projektnamen deutlich als eigene Zeile", async () => {
  const w = await boot();
  const d = w.document;
  const proj = [...d.querySelectorAll("#listBody .card .proj")].map(e => e.textContent);
  expect(proj).toEqual(["smarthome", "idlegame"]);
  await w.happyDOM.abort(); w.close();
});

test("Agents nach Projekt gruppieren: Umschalter, Projekt als Überschrift, Wahl bleibt gespeichert", async () => {
  const w = await boot();
  const d = w.document;
  const btn = d.querySelector('[data-group="project"]') as any;
  expect(btn).not.toBeNull();
  btn.click();
  await new Promise(r => setTimeout(r, 20));
  const heads = [...d.querySelectorAll("#listBody .proj-h .pname")].map(e => e.textContent);
  expect(heads).toEqual(["smarthome", "idlegame"]);
  expect(d.querySelectorAll("#listBody .card").length).toBe(2);
  // In der Gruppe steht das Projekt schon oben, nicht noch einmal auf der Karte
  expect(d.querySelectorAll("#listBody .card .proj").length).toBe(0);
  expect(w.localStorage.getItem("herdr:group")).toBe('"project"');
  (d.querySelector('[data-group="status"]') as any).click();
  await new Promise(r => setTimeout(r, 20));
  expect(d.querySelectorAll("#listBody .proj-h").length).toBe(0);
  w.localStorage.removeItem("herdr:group");
  await w.happyDOM.abort(); w.close();
});

test("Bild per Strg+V ins Eingabefeld: wird hochgeladen und als Pfad eingefügt", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const ta = d.getElementById("msg") as any;
  ta.value = "Schau mal";
  calls.length = 0;
  const file = new (w as any).File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
  const ev = new (w as any).Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }], getData: () => "" } });
  ta.dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 100));
  expect(ev.defaultPrevented).toBe(true);
  expect(calls.some(c => c.p === "/api/agents/w1:p2/image")).toBe(true);
  expect(ta.value).toBe("Schau mal [Bild 1]");
  // Zweites Bild bekommt die nächste Nummer, beim Senden stehen die echten Pfade drin
  ta.dispatchEvent(ev2(w, file));
  await new Promise(r => setTimeout(r, 100));
  expect(ta.value).toBe("Schau mal [Bild 1] [Bild 2]");
  calls.length = 0;
  (d.querySelector("[data-send]") as any).click();
  await new Promise(r => setTimeout(r, 50));
  expect(calls.find(c => c.p === "/api/agents/w1:p2/prompt")!.body).toEqual({ text: "Schau mal /home/alex/Bilder/herdr-app-x.png /home/alex/Bilder/herdr-app-x.png" });
  await w.happyDOM.abort(); w.close();
});

test("Text einfügen bleibt normales Einfügen", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  calls.length = 0;
  const ev = new (w as any).Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files: [], items: [{ kind: "string", type: "text/plain" }], getData: () => "hallo" } });
  d.getElementById("msg")!.dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 50));
  expect(ev.defaultPrevented).toBe(false);
  expect(calls.some(c => c.p.endsWith("/image"))).toBe(false);
  await w.happyDOM.abort(); w.close();
});

test("Markdown-Tabelle im Chat wird als Tabelle gezeigt, seitlich scrollbar, Text drumherum bleibt", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const t = d.querySelector(".feed .msg-text .tablewrap table")!;
  expect(t).not.toBeNull();
  expect([...t.querySelectorAll("th")].map(e => e.textContent)).toEqual(["Name", "Wert"]);
  const rows = [...t.querySelectorAll("tbody tr")].map(r => [...r.querySelectorAll("td")].map(c => c.textContent));
  expect(rows).toEqual([["eins", "fett"], ["zwei <b>", "2"]]);
  expect(t.querySelector("td strong")!.textContent).toBe("fett");
  expect((t.querySelectorAll("th")[1] as any).style.textAlign).toBe("center");
  const txt = t.closest(".msg-text")!.textContent!;
  expect(txt).toContain("Übersicht:");
  expect(txt).toContain("Ende.");
  expect(txt).not.toContain("|---");
  await w.happyDOM.abort(); w.close();
});

test("Angeheftete Agents stehen oben in eigenem Abschnitt", async () => {
  const w = await boot();
  const d = w.document;
  FakeWS.last!.push({ type: "state", data: { ...STATE, agents: STATE.agents.map(a => a.id === "w1:p2" ? { ...a, pinned: true } : a) } });
  await new Promise(r => setTimeout(r, 20));
  const first = d.querySelector("#listBody .section-h")!;
  expect(first.textContent).toContain("Angeheftet");
  const cards = [...d.querySelectorAll("#listBody .card")];
  expect(cards.length).toBe(2);
  expect(cards[0].getAttribute("data-agent")).toBe("w1:p2");
  expect(cards[0].querySelector(".pinmark")).not.toBeNull();
  await w.happyDOM.abort(); w.close();
});

test("Agent-Menü: Anheften schickt pinned true an den Server", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  (d.querySelector("[data-agent-menu]") as any).click();
  const b = [...d.querySelectorAll("#sheetHost [data-act]")].find(x => x.textContent === "Anheften") as any;
  expect(b).not.toBeUndefined();
  calls.length = 0;
  b.click();
  await new Promise(r => setTimeout(r, 50));
  expect(calls.find(c => c.p === "/api/agents/w1:p2/pin")).toEqual({ m: "PUT", p: "/api/agents/w1:p2/pin", body: { pinned: true } });
  await w.happyDOM.abort(); w.close();
});

test("Bildpfade in eigenen Nachrichten erscheinen als [Bild N], nicht als Pfad", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const u = [...d.querySelectorAll(".feed .msg-user")].map(e => e.textContent);
  expect(u).toContain("Schau [Bild 1] und [Bild 2] an");
  await w.happyDOM.abort(); w.close();
});

test("Backspace direkt hinter [Bild N] löscht den ganzen Platzhalter samt Bild", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const ta = d.getElementById("msg") as any;
  ta.value = "Schau [Bild 1] und [Bild 2]";
  ta.setSelectionRange(14, 14);
  const ev = new (w as any).KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  ta.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(ta.value).toBe("Schau und [Bild 2]");
  expect(ta.selectionStart).toBe(6);
  // Normales Zeichen: Backspace bleibt normal
  ta.value = "abc"; ta.setSelectionRange(3, 3);
  const ev2 = new (w as any).KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  ta.dispatchEvent(ev2);
  expect(ev2.defaultPrevented).toBe(false);
  await w.happyDOM.abort(); w.close();
});

test("[Bild N] im Verlauf ist anklickbar und öffnet das Bild groß", async () => {
  const w = await boot();
  const d = w.document;
  (d.querySelector('[data-agent="w1:p2"]') as any).click();
  await new Promise(r => setTimeout(r, 100));
  const b = d.querySelector(".feed .msg-user .imgref") as any;
  expect(b.textContent).toBe("[Bild 1]");
  b.click();
  await new Promise(r => setTimeout(r, 20));
  const img = d.querySelector("#sheetHost .lightbox img") as any;
  expect(img.getAttribute("src")).toBe("/api/image?path=" + encodeURIComponent("/home/alex/bilder/herdr-app-2026-11-20T08-15-14-439Z.png"));
  (d.querySelector("#sheetHost .lightbox") as any).click();
  expect(d.querySelector("#sheetHost .lightbox")).toBeNull();
  await w.happyDOM.abort(); w.close();
});
