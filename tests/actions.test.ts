import { test, expect } from "bun:test";
import { Actions, ActionError, footerMode } from "../server/actions.ts";
import type { Snapshot } from "../server/model.ts";

const bash = await Bun.file(import.meta.dir + "/fixtures/screens/screen-bash.txt").text();
const idle = await Bun.file(import.meta.dir + "/fixtures/screens/screen-idle.txt").text();

function fake(screen: () => string, extra: Record<string, (p: any) => any> = {}) {
  const calls: { m: string; p: any }[] = [];
  const fn = async (m: string, p: any) => {
    calls.push({ m, p });
    if (extra[m]) return extra[m](p);
    if (m === "agent.read" || m === "pane.read") return { read: { text: screen() } };
    return {};
  };
  return { calls, fn };
}
const snap = (status: string): Snapshot => ({
  ok: true, spaces: [], shells: [],
  agents: [{ id: "w1:p1", ws: "w1", tab: "w1:t1", project: "x", cwd: "/home/alex/src/x", title: "t", status: status as any, sessionId: "sid-1", since: 0 }],
});

test("answer mit passendem Hash sendet die Option", async () => {
  const { calls, fn } = fake(() => bash);
  const a = new Actions(fn as any, () => snap("blocked"));
  const { parseDialog } = await import("../server/prompt.ts");
  await a.answer("w1:p1", parseDialog(bash)!.hash, 2);
  expect(calls.at(-1)).toEqual({ m: "pane.send_keys", p: { pane_id: "w1:p1", keys: ["2"] } });
});

test("answer mit veraltetem Hash: 409 und nichts gesendet", async () => {
  const { calls, fn } = fake(() => bash);
  const a = new Actions(fn as any, () => snap("blocked"));
  const e: any = await a.answer("w1:p1", "0000000000000000", 1).catch(e => e);
  expect(e).toBeInstanceOf(ActionError);
  expect(e.status).toBe(409);
  expect(calls.some(c => c.m === "pane.send_keys")).toBe(false);
});

test("answer ohne Dialog: 409", async () => {
  const { fn } = fake(() => idle);
  const e: any = await new Actions(fn as any, () => snap("idle")).answer("w1:p1", "abc", 1).catch(e => e);
  expect(e.status).toBe(409);
});

test("sendKeys lehnt unbekannte Tasten ab", async () => {
  const { calls, fn } = fake(() => idle);
  const e: any = await new Actions(fn as any, () => snap("idle")).sendKeys("w1:p1", ["rm"]).catch(e => e);
  expect(e.status).toBe(400);
  expect(calls.length).toBe(0);
});

test("setConfig bei working: 409", async () => {
  const { fn } = fake(() => idle);
  const e: any = await new Actions(fn as any, () => snap("working")).setConfig("w1:p1", { mode: "auto" }).catch(e => e);
  expect(e.status).toBe(409);
});

test("footerMode erkennt die vier Modi", () => {
  expect(footerMode("  ⏸ manual mode on · ? for shortcuts")).toBe("default");
  expect(footerMode("  ⏵⏵ accept edits on (shift+tab to cycle)")).toBe("acceptEdits");
  expect(footerMode("  ⏸ plan mode on (shift+tab to cycle)")).toBe("plan");
  expect(footerMode("  ⏵⏵ auto mode on (shift+tab to cycle)")).toBe("auto");
});

test("setConfig mode drückt shift+tab bis der Fuß passt", async () => {
  const seq = ["⏸ manual mode on", "⏵⏵ accept edits on", "⏸ plan mode on", "⏵⏵ auto mode on"];
  let i = 0;
  const { calls, fn } = fake(() => seq[i % 4], { "pane.send_keys": () => { i++; return {}; } });
  await new Actions(fn as any, () => snap("idle"), 0).setConfig("w1:p1", { mode: "plan" });
  expect(calls.filter(c => c.m === "pane.send_keys").length).toBe(2);
});

test("startAgent legt Tab an und startet claude mit Name und Argumenten", async () => {
  const { calls, fn } = fake(() => idle, {
    "tab.create": () => ({ tab: { tab_id: "w1:t9" } }),
    "pane.list": () => ({ panes: [{ pane_id: "w1:p9", tab_id: "w1:t9" }] }),
  });
  const pane = await new Actions(fn as any, () => snap("idle")).startAgent({ ws: "w1", cwd: "/home/alex/src/x", mode: "auto", model: "sonnet", effort: "high" });
  expect(pane).toBe("w1:p9");
  const iTab = calls.findIndex(c => c.m === "tab.create");
  const start = calls.find(c => c.m === "agent.start")!;
  expect(iTab).toBeLessThan(calls.indexOf(start));
  expect(start.p.pane_id).toBe("w1:p9");
  expect(typeof start.p.name).toBe("string");
  expect(start.p.args).toEqual(["--permission-mode", "auto", "--model", "sonnet", "--effort", "high"]);
});

test("Start wird wiederholt, solange die Shell noch nicht bereit ist", async () => {
  const { HerdrError } = await import("../server/herdr.ts");
  let n = 0;
  const { calls, fn } = fake(() => idle, {
    "agent.start": () => { if (++n < 3) throw new HerdrError("invalid_request", "agent target pane w1:p1 is not an available shell"); return {}; },
  });
  await new Actions(fn as any, () => snap("idle"), 0).claudeHere("w1:p1", { mode: "auto" });
  expect(calls.filter(c => c.m === "agent.start").length).toBe(3);
});

test("startAgent mit shell legt nur den Tab an, ohne claude", async () => {
  const { calls, fn } = fake(() => idle, {
    "tab.create": () => ({ tab: { tab_id: "w1:t9" } }),
    "pane.list": () => ({ panes: [{ pane_id: "w1:p9", tab_id: "w1:t9" }] }),
  });
  const pane = await new Actions(fn as any, () => snap("idle")).startAgent({ ws: "w1", cwd: "/home/alex/src/x", shell: true } as any);
  expect(pane).toBe("w1:p9");
  expect(calls.some(c => c.m === "agent.start")).toBe(false);
});

test("sendKeys lehnt Ziffern ab (Freigaben nur über answer)", async () => {
  const { fn } = fake(() => idle);
  const e: any = await new Actions(fn as any, () => snap("idle")).sendKeys("w1:p1", ["1"]).catch(e => e);
  expect(e.status).toBe(400);
});

test("answer mit esc bricht den Dialog nach Hash-Prüfung ab", async () => {
  const { calls, fn } = fake(() => bash);
  const { parseDialog } = await import("../server/prompt.ts");
  await new Actions(fn as any, () => snap("blocked")).answer("w1:p1", parseDialog(bash)!.hash, "esc");
  expect(calls.at(-1)).toEqual({ m: "pane.send_keys", p: { pane_id: "w1:p1", keys: ["esc"] } });
});

test("claudeHere prüft Modus, Modell und Effort", async () => {
  const { calls, fn } = fake(() => idle);
  const e: any = await new Actions(fn as any, () => snap("idle"), 0).claudeHere("w1:p1", { mode: "bypassPermissions" as any, model: "opus", effort: "high" }).catch(e => e);
  expect(e.status).toBe(400);
  expect(calls.some(c => c.m === "agent.start")).toBe(false);
});

const question = await Bun.file(import.meta.dir + "/fixtures/screens/screen-question.txt").text();

test("answerText: wählt die Freitext-Option, tippt den Text und schickt ihn ab", async () => {
  const { calls, fn } = fake(() => question);
  const { parseDialog } = await import("../server/prompt.ts");
  await new Actions(fn as any, () => snap("blocked"), 0).answerText("w1:p1", parseDialog(question)!.hash, "lieber lila");
  const sent = calls.filter(c => c.m === "pane.send_keys" || c.m === "pane.send_input");
  expect(sent).toEqual([
    { m: "pane.send_keys", p: { pane_id: "w1:p1", keys: ["4"] } },
    { m: "pane.send_input", p: { pane_id: "w1:p1", text: "lieber lila", keys: ["enter"] } },
  ]);
});

test("answerText bei einer Freigabe ohne Freitext: 400, nichts gesendet", async () => {
  const { calls, fn } = fake(() => bash);
  const { parseDialog } = await import("../server/prompt.ts");
  const e: any = await new Actions(fn as any, () => snap("blocked"), 0).answerText("w1:p1", parseDialog(bash)!.hash, "x").catch(e => e);
  expect(e.status).toBe(400);
  expect(calls.some(c => c.m === "pane.send_keys" || c.m === "pane.send_input")).toBe(false);
});

const tipScreen = await Bun.file(import.meta.dir + "/fixtures/screens/screen-tip.txt").text();

test("tipKey sendet die Ziffer nur, wenn der Tipp mit dieser Taste auf dem Bildschirm steht", async () => {
  const { calls, fn } = fake(() => tipScreen);
  await new Actions(fn as any, () => snap("idle"), 0).tipKey("w1:p1", "2");
  expect(calls.at(-1)).toEqual({ m: "pane.send_keys", p: { pane_id: "w1:p1", keys: ["2"] } });
  const e: any = await new Actions(fn as any, () => snap("idle"), 0).tipKey("w1:p1", "7").catch(e => e);
  expect(e.status).toBe(400);
});

test("tipKey 'Understood': kein Enter hinterher", async () => {
  const explained = await Bun.file(import.meta.dir + "/fixtures/screens/screen-tip-explained.txt").text();
  const { calls, fn } = fake(() => explained);
  await new Actions(fn as any, () => snap("idle"), 0).tipKey("w1:p1", "1");
  expect(calls.filter(c => c.m === "pane.send_keys").map(c => c.p.keys[0])).toEqual(["1"]);
});

test("tipKey ohne Tipp oder bei offener Freigabe: 409, nichts gesendet", async () => {
  for (const [scr, st] of [[idle, "idle"], [bash + "\n" + tipScreen, "blocked"]] as const) {
    const { calls, fn } = fake(() => scr);
    const e: any = await new Actions(fn as any, () => snap(st), 0).tipKey("w1:p1", "1").catch(e => e);
    expect(e.status).toBe(409);
    expect(calls.some(c => c.m === "pane.send_keys")).toBe(false);
  }
});

function startFake() {
  return fake(() => idle, {
    "tab.create": () => ({ tab: { tab_id: "w1:t9" } }),
    "pane.list": () => ({ panes: [{ pane_id: "w1:p9", tab_id: "w1:t9" }] }),
    "agent.start": () => ({}),
  });
}

test("startAgent mit Codex: herdr-Art codex, keine Claude-Optionen", async () => {
  const { calls, fn } = startFake();
  await new Actions(fn as any, () => snap("idle"), 0).startAgent({ ws: "w1", cwd: "/home/alex/src/x", agent: "codex" } as any);
  const s = calls.find(c => c.m === "agent.start")!;
  expect(s.p.kind).toBe("codex");
  expect(s.p.args).toEqual([]);
});

test("startAgent mit lokaler KI: herdr-Art opencode", async () => {
  const { calls, fn } = startFake();
  await new Actions(fn as any, () => snap("idle"), 0).startAgent({ ws: "w1", cwd: "/home/alex/src/x", agent: "opencode" } as any);
  expect(calls.find(c => c.m === "agent.start")!.p.kind).toBe("opencode");
});

test("startAgent mit unbekannter Art: 400", async () => {
  const { fn } = startFake();
  const e: any = await new Actions(fn as any, () => snap("idle"), 0).startAgent({ cwd: "/x", agent: "bash" } as any).catch(e => e);
  expect(e.status).toBe(400);
});

test("sendPrompt an Codex oder opencode tippt den Text ins Eingabefeld und drückt Enter", async () => {
  const { calls, fn } = fake(() => idle);
  const s = snap("idle"); s.agents[0].kind = "opencode";
  await new Actions(fn as any, () => s, 0).sendPrompt("w1:p1", "Hallo");
  // Enter getrennt: sonst schluckt opencodes Befehlsmenü das Enter bei "/exit"
  expect(calls.slice(-2)).toEqual([{ m: "pane.send_input", p: { pane_id: "w1:p1", text: "Hallo" } }, { m: "pane.send_keys", p: { pane_id: "w1:p1", keys: ["enter"] } }]);
});

test("sendPrompt an Claude bleibt bei agent.prompt", async () => {
  const { calls, fn } = fake(() => idle);
  const s = snap("idle"); s.agents[0].kind = "claude";
  await new Actions(fn as any, () => s, 0).sendPrompt("w1:p1", "Hallo");
  expect(calls.at(-1)).toEqual({ m: "agent.prompt", p: { target: "w1:p1", text: "Hallo" } });
});

test("endAgent bei opencode schickt /exit über das Eingabefeld", async () => {
  const { calls, fn } = fake(() => idle, { "pane.get": () => ({ pane: { agent: null } }), "pane.close": () => ({}) });
  const s = snap("idle"); s.agents[0].kind = "opencode";
  await new Actions(fn as any, () => s, 0).endAgent("w1:p1", false);
  expect(calls.find(c => c.m === "pane.send_input")!.p).toEqual({ pane_id: "w1:p1", text: "/exit" });
  expect(calls.some(c => c.m === "agent.prompt")).toBe(false);
});

test("Ordner-Vertrauen beantworten: mit Pfeiltasten zur Option, dann Enter", async () => {
  const trust = await Bun.file(import.meta.dir + "/fixtures/screens/screen-trust.txt").text();
  const { parseDialog } = await import("../server/prompt.ts");
  const { calls, fn } = fake(() => trust);
  await new Actions(fn as any, () => snap("blocked")).answer("w1:p1", parseDialog(trust)!.hash, 2);
  expect(calls.filter(c => c.m === "pane.send_keys").map(c => c.p.keys)).toEqual([["down", "enter"]]);
});

test("MCP-Anmeldung: eingefügte Adresse wird getippt und abgeschickt, auch wenn der Agent 'arbeitet'", async () => {
  const auth = await Bun.file(import.meta.dir + "/fixtures/screens/screen-mcp-auth.txt").text();
  const { calls, fn } = fake(() => auth);
  await new Actions(fn as any, () => snap("working")).authPaste("w1:p1", " http://localhost:53561/callback?code=1&state=2 \n");
  expect(calls.filter(c => c.m === "pane.send_input").map(c => c.p)).toEqual([{ pane_id: "w1:p1", text: "http://localhost:53561/callback?code=1&state=2", keys: ["enter"] }]);
});

test("MCP-Anmeldung: ohne Anmeldebildschirm wird nichts getippt", async () => {
  const { calls, fn } = fake(() => idle);
  await expect(new Actions(fn as any, () => snap("working")).authPaste("w1:p1", "http://x")).rejects.toBeInstanceOf(ActionError);
  expect(calls.some(c => c.m === "pane.send_input")).toBe(false);
});

const usage = await Bun.file(import.meta.dir + "/fixtures/screens/screen-usage.txt").text();
const mcpAuth = await Bun.file(import.meta.dir + "/fixtures/screens/screen-mcp-auth.txt").text();

test("sendPrompt: offenes Menü, Anmeldung oder Frage im Terminal blockt, nichts wird getippt", async () => {
  for (const [screen, text] of [[usage, "Menü"], [mcpAuth, "Anmeldung"], [bash, "Frage"]] as const) {
    const { calls, fn } = fake(() => screen);
    const s = snap("idle"); s.agents[0].kind = "claude";
    const e: any = await new Actions(fn as any, () => s, 0).sendPrompt("w1:p1", "Hallo").catch(e => e);
    expect(e).toBeInstanceOf(ActionError);
    expect(e.status).toBe(409);
    expect(e.message).toContain(text);
    expect(calls.some(c => c.m === "agent.prompt" || c.m === "pane.send_input")).toBe(false);
  }
});

test("startAgent: Startauftrag landet in der Warteschlange, wenn das Terminal blockt (z. B. Ordner-Vertrauen)", async () => {
  const trust = await Bun.file(import.meta.dir + "/fixtures/screens/screen-trust.txt").text();
  const { fn } = fake(() => trust, { "tab.create": () => ({ tab: { tab_id: "w1:t9" } }), "pane.list": () => ({ panes: [{ pane_id: "w1:p9", tab_id: "w1:t9" }] }) });
  const sn = snap("blocked"); sn.agents[0].id = "w1:p9"; sn.agents[0].kind = "claude";
  const a = new Actions(fn as any, () => sn, 0);
  const pending: [string, string][] = [];
  a.onPending = (p, t) => pending.push([p, t]);
  const pane = await a.startAgent({ ws: "w1", cwd: "/home/alex/src/x", mode: "auto", model: "opus", effort: "high", prompt: "Los geht's" } as any);
  expect(pane).toBe("w1:p9");
  expect(pending).toEqual([["w1:p9", "Los geht's"]]);
});
