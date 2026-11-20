// Steuerbefehle an herdr. Alles, was in einen Agent oder eine Shell schreibt, läuft hier durch.
import { parseTip } from "./tip.ts";
import { call as herdrCall, HerdrError } from "./herdr.ts";
import { parseDialog, denyOption, type Dialog } from "./prompt.ts";
import type { Snapshot, Agent } from "./model.ts";

type CallFn = (method: string, params: object, opts?: object) => Promise<any>;
export type Mode = "default" | "acceptEdits" | "plan" | "auto";
export type Cfg = { mode?: Mode; model?: string; effort?: string };

export class ActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Ziffern fehlen bewusst: Freigaben laufen nur über answer() mit Hash-Prüfung
export const KEYS = new Set(["enter", "esc", "tab", "shift+tab", "up", "down", "ctrl+c", "ctrl+d"]);
export const AGENT_KINDS = new Set(["claude", "codex", "opencode"]);
export const MODELS = new Set(["opus", "sonnet", "haiku", "fable"]);
export const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
export const MODES: Mode[] = ["default", "acceptEdits", "plan", "auto"];

export function footerMode(screen: string): Mode | null {
  const lines = screen.split("\n").filter(l => /mode on|accept edits on/.test(l));
  const l = lines[lines.length - 1];
  if (!l) return null;
  if (/accept edits on/.test(l)) return "acceptEdits";
  if (/plan mode on/.test(l)) return "plan";
  if (/auto mode on/.test(l)) return "auto";
  if (/manual mode on/.test(l)) return "default";
  return null;
}

export class Actions {
  constructor(private callFn: CallFn = herdrCall, private snapshot: () => Snapshot, private waitMs = 400) {}

  private agent(pane: string): Agent {
    const a = this.snapshot().agents.find(x => x.id === pane);
    if (!a) throw new ActionError(404, "Agent nicht gefunden");
    return a;
  }
  private sleep(ms: number) { return ms ? Bun.sleep(ms) : Promise.resolve(); }
  private async screen(pane: string): Promise<string> {
    const r = await this.callFn("pane.read", { pane_id: pane, source: "visible" });
    return r?.read?.text ?? "";
  }
  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch(e => {
      if (e instanceof ActionError) throw e;
      if (e instanceof HerdrError && e.code === "agent_blocked") throw new ActionError(409, "Agent wartet auf Freigabe");
      if (e instanceof HerdrError) throw new ActionError(502, `herdr: ${e.message}`);
      throw e;
    });
  }

  async dialog(pane: string): Promise<(Dialog & { deny: number }) | null> {
    const d = parseDialog(await this.screen(pane));
    return d ? { ...d, deny: denyOption(d) } : null;
  }

  sendPrompt(pane: string, text: string) {
    if (!text.trim()) throw new ActionError(400, "Leere Nachricht");
    // herdr nimmt agent.prompt bei opencode nicht an ("not an active named agent"): bei Nicht-Claude direkt tippen
    const a = this.snapshot().agents.find(x => x.id === pane);
    if (a && a.kind && a.kind !== "claude") return this.wrap((async () => {
      await this.callFn("pane.send_input", { pane_id: pane, text });
      await this.sleep(this.waitMs ? 300 : 0);
      await this.callFn("pane.send_keys", { pane_id: pane, keys: ["enter"] });
    })());
    return this.wrap(this.callFn("agent.prompt", { target: pane, text }));
  }

  async sendKeys(pane: string, keys: string[]) {
    if (!keys.length || keys.some(k => !KEYS.has(k))) throw new ActionError(400, "Taste nicht erlaubt");
    return this.wrap(this.callFn("pane.send_keys", { pane_id: pane, keys }));
  }

  sendShellLine(pane: string, text: string) {
    return this.wrap(this.callFn("pane.send_input", { pane_id: pane, text, keys: ["enter"] }));
  }

  // Freigabe-Schutz: nur antworten, wenn noch derselbe Dialog offen ist
  async answer(pane: string, hash: string, option: number | "esc") {
    return this.wrap((async () => {
      const d = parseDialog(await this.screen(pane));
      if (!d || d.hash !== hash) throw new ActionError(409, "Dialog hat sich geändert");
      if (option === "esc") { await this.callFn("pane.send_keys", { pane_id: pane, keys: ["esc"] }); return; }
      if (!Number.isInteger(option) || option < 1 || option > d.options.length) throw new ActionError(400, "Option gibt es nicht");
      await this.callFn("pane.send_keys", { pane_id: pane, keys: [String(option)] });
    })());
  }

  // Eigene Antwort auf eine Auswahlfrage: Option "Type something." wählen, Text tippen, abschicken
  async answerText(pane: string, hash: string, text: string) {
    return this.wrap((async () => {
      const d = parseDialog(await this.screen(pane));
      if (!d || d.hash !== hash) throw new ActionError(409, "Dialog hat sich geändert");
      if (d.kind !== "question" || !d.freeText) throw new ActionError(400, "Diese Frage erlaubt keinen eigenen Text");
      const t = String(text || "").replace(/\s*\n\s*/g, " ").trim();
      if (!t) throw new ActionError(400, "Text fehlt");
      await this.callFn("pane.send_keys", { pane_id: pane, keys: [String(d.freeText)] });
      await this.sleep(this.waitMs);
      await this.callFn("pane.send_input", { pane_id: pane, text: t, keys: ["enter"] });
    })());
  }

  // Tipp des Plugins "You should know" beantworten: Ziffer nur, wenn genau dieser Tipp mit dieser Taste dasteht
  async tipKey(pane: string, key: string) {
    return this.wrap((async () => {
      const screen = await this.screen(pane);
      if (parseDialog(screen)) throw new ActionError(409, "Erst die offene Frage beantworten");
      const t = parseTip(screen);
      if (!t) throw new ActionError(409, "Tipp ist nicht mehr da");
      const opt = t.options.find(o => o.key === key);
      if (!opt) throw new ActionError(400, "Option gibt es nicht");
      await this.callFn("pane.send_keys", { pane_id: pane, keys: [key] });
      // "Chat in main session" legt die Notiz nur ins Eingabefeld: warten, bis sie dort steht, dann abschicken
      if (/^Chat in main session$/i.test(opt.label)) {
        for (let i = 0; i < 10; i++) {
          await this.sleep(this.waitMs ? 300 : 0);
          if (/^❯ Here is a note offered by a side agent/m.test(await this.screen(pane))) {
            await this.callFn("pane.send_keys", { pane_id: pane, keys: ["enter"] });
            return;
          }
        }
        throw new ActionError(504, "Notiz kam nicht im Eingabefeld an");
      }
    })());
  }

  async setConfig(pane: string, cfg: Cfg) {
    const a = this.agent(pane);
    if (a.kind && a.kind !== "claude") throw new ActionError(400, "Modus, Modell und Effort gibt es nur bei Claude");
    if (a.status === "working" || a.status === "blocked") throw new ActionError(409, "Geht nur, wenn der Agent nicht arbeitet");
    if (cfg.model && !MODELS.has(cfg.model)) throw new ActionError(400, "Unbekanntes Modell");
    if (cfg.effort && !EFFORTS.has(cfg.effort)) throw new ActionError(400, "Unbekannter Effort");
    if (cfg.mode && !MODES.includes(cfg.mode)) throw new ActionError(400, "Unbekannter Modus");
    return this.wrap((async () => {
      if (cfg.model || cfg.effort) {
        // Sitzungsbezogen neu starten. /model und /effort würden den globalen Standard überschreiben.
        if (!a.sessionId) throw new ActionError(409, "Sitzung unbekannt");
        const mode = cfg.mode || footerMode(await this.screen(pane)) || "default";
        await this.exitAgent(pane);
        await this.startIn(pane, a.cwd, ["--resume", a.sessionId, ...this.args({ mode, model: cfg.model, effort: cfg.effort })]);
        return;
      }
      if (cfg.mode) {
        for (let i = 0; i < 5; i++) {
          if (footerMode(await this.screen(pane)) === cfg.mode) return;
          await this.callFn("pane.send_keys", { pane_id: pane, keys: ["shift+tab"] });
          await this.sleep(this.waitMs);
        }
        if (footerMode(await this.screen(pane)) !== cfg.mode) throw new ActionError(500, "Modus ließ sich nicht setzen");
      }
    })());
  }

  private args(c: Cfg): string[] {
    const out: string[] = [];
    if (c.mode) out.push("--permission-mode", c.mode);
    if (c.model) out.push("--model", c.model);
    if (c.effort) out.push("--effort", c.effort);
    return out;
  }

  private async startIn(pane: string, _cwd: string, args: string[], kind = "claude") {
    // Nach /exit meldet herdr den Agent schon als weg, bevor die Shell bereit ist: kurz warten und erneut versuchen
    for (let i = 0; ; i++) {
      try {
        await this.callFn("agent.start", { name: `app-${Date.now().toString(36)}`, kind, pane_id: pane, args, timeout_ms: 60000 }, { timeoutMs: 70000 });
        return;
      } catch (e) {
        if (e instanceof HerdrError && e.code === "agent_not_ready") return;
        const notReady = e instanceof HerdrError && /not an available shell/.test(e.message);
        if (!notReady || i >= 9) throw e;
        await this.sleep(this.waitMs || 0);
        await this.sleep(this.waitMs ? 300 : 0);
      }
    }
  }

  private async exitAgent(pane: string) {
    await this.sendPrompt(pane, "/exit");
    for (let i = 0; i < 40; i++) {
      await this.sleep(250);
      const p = await this.callFn("pane.get", { pane_id: pane }).catch(() => null);
      if (!p || !(p.pane?.agent)) return;
    }
    throw new ActionError(504, "Agent hat sich nicht beendet");
  }

  // agent: claude (Standard), codex (ChatGPT-Abo) oder opencode (lokale KI über LiteLLM). Modus, Modell, Effort nur bei claude.
  async startAgent(o: { ws?: string; newSpace?: string; cwd: string; mode?: Mode; model?: string; effort?: string; prompt?: string; shell?: boolean; agent?: string }): Promise<string> {
    if (!o.cwd) throw new ActionError(400, "Projektordner fehlt");
    const kind = o.agent || "claude";
    if (!o.shell && !AGENT_KINDS.has(kind)) throw new ActionError(400, "Unbekannter Agent");
    if (!o.shell && kind === "claude" && (!MODELS.has(o.model!) || !EFFORTS.has(o.effort!) || !MODES.includes(o.mode!))) throw new ActionError(400, "Ungültige Einstellungen");
    return this.wrap((async () => {
      let ws = o.ws;
      let tabId: string | undefined;
      if (o.newSpace) {
        const w = await this.callFn("workspace.create", { cwd: o.cwd, label: o.newSpace, focus: false });
        ws = w.workspace.workspace_id;
        tabId = w.tab?.tab_id;
      } else {
        const t = await this.callFn("tab.create", { cwd: o.cwd, workspace_id: ws ?? null, focus: false });
        tabId = t.tab?.tab_id;
      }
      const panes = await this.callFn("pane.list", {});
      const pane = panes.panes.find((p: any) => p.tab_id === tabId)?.pane_id;
      if (!pane) throw new ActionError(500, "Neues Fenster nicht gefunden");
      if (o.shell) return pane;
      await this.startIn(pane, o.cwd, kind === "claude" ? this.args(o) : [], kind);
      if (o.prompt?.trim()) {
        for (let i = 0; i < 40; i++) {
          await this.sleep(500);
          const a = this.snapshot().agents.find(x => x.id === pane);
          if (a && (a.status === "idle" || a.status === "done")) break;
        }
        await this.sendPrompt(pane, o.prompt);
      }
      return pane;
    })());
  }

  async endAgent(pane: string, keepShell: boolean) {
    const a = this.agent(pane);
    await this.wrap(this.exitAgent(pane));
    if (!keepShell) await this.wrap(this.callFn("pane.close", { pane_id: pane }));
    return { cwd: a.cwd, sessionId: a.sessionId, pane: keepShell ? pane : null, ws: a.ws };
  }

  async resume(info: { cwd: string; sessionId: string | null; pane: string | null; ws: string }) {
    if (!info.sessionId) throw new ActionError(409, "Sitzung unbekannt");
    const args = ["--resume", info.sessionId];
    if (info.pane) return this.wrap(this.startIn(info.pane, info.cwd, args).then(() => info.pane!));
    return this.wrap((async () => {
      const t = await this.callFn("tab.create", { cwd: info.cwd, workspace_id: info.ws, focus: false });
      const panes = await this.callFn("pane.list", {});
      const pane = panes.panes.find((p: any) => p.tab_id === t.tab?.tab_id)?.pane_id;
      if (!pane) throw new ActionError(500, "Neues Fenster nicht gefunden");
      await this.startIn(pane, info.cwd, args);
      return pane;
    })());
  }

  claudeHere(pane: string, cfg: Cfg) {
    if ((cfg.mode && !MODES.includes(cfg.mode)) || (cfg.model && !MODELS.has(cfg.model)) || (cfg.effort && !EFFORTS.has(cfg.effort))) {
      return Promise.reject(new ActionError(400, "Ungültige Einstellungen"));
    }
    return this.wrap(this.startIn(pane, "", this.args(cfg)));
  }
  closePane(pane: string) { return this.wrap(this.callFn("pane.close", { pane_id: pane })); }
  closeSpace(ws: string) { return this.wrap(this.callFn("workspace.close", { workspace_id: ws })); }
}
