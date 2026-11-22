// Liest Claude-Code-Verläufe (JSONL) und baut daraus Feed, Plan, Kontext und Änderungen.
import { homedir } from "os";
import { join } from "path";
import { browserTool, describeBrowser } from "./browser.ts";

export type FeedItem =
  | { t: "user"; v: string }
  | { t: "compact"; trigger: string; v: string }
  | { t: "text"; v: string }
  | { t: "tool"; k: string; a: string; s: "ok" | "run" | "err" }
  | { t: "diff"; f: string; add: number; del: number; lines: string[] };
export type PlanStep = [string, "done" | "run" | "todo"];
export type SessionInfo = { last: number; pending: string[]; feed: FeedItem[]; plan: PlanStep[]; subs: number; ctx: number; model: string | null; effort: string | null; mode: string | null; changes: FeedItem[]; browserAt: number };

const MAX_DIFF_LINES = 40;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PLAN_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(homedir(), ".claude/projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}

function describe(name: string, input: any): string {
  const bt = browserTool(name);
  if (bt) return describeBrowser(bt, input);
  if (!input || typeof input !== "object") return "";
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? input.query
    ?? Object.values(input).find(x => typeof x === "string") ?? "";
  return String(v).replace(/\s+/g, " ").slice(0, 120);
}

function userText(content: any): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter((c: any) => c?.type === "text").map((c: any) => c.text);
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

// Zusammenfassung nach einer Komprimierung: Einleitung, interne Blöcke und Schlusshinweise weglassen
function compactText(s: string): string {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/^This session is being continued[^\n]*\n?/, "")
    .replace(/\n*If you need specific details from before compaction[\s\S]*$/, "")
    .trim();
}
const isInternal = (s: string) => /^\s*<(system-reminder|command-|local-command|task-notification|bash-)/.test(s);

export function parseTranscript(text: string): SessionInfo {
  const feed: FeedItem[] = [];
  const toolIndex = new Map<string, number>();
  const editTool = new Map<string, string>();
  let plan: PlanStep[] = [];
  const tasks = new Map<string, { title: string; status: string }>();
  let ctx = 0, model: string | null = null, effort: string | null = null, mode: string | null = null;
  const openAgents = new Set<string>();
  let compactTrigger = "";
  let last = 0;
  // Letzter Schritt im Browser (Claude in Chrome), für "nutzt Browser"
  let browserAt = 0;
  // Warteschlange von Claude Code: eingereiht, aber noch nicht aufgenommen (null = ohne Text, z. B. interne Meldungen)
  const queue: (string | null)[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    // Letzte echte Nachricht. Beim Fortsetzen nach einem Neustart schreibt Claude nur System- und Metazeilen, die zählen nicht.
    if (o && o.timestamp && (o.type === "assistant" || (o.type === "user" && !o.isMeta && !o.isCompactSummary && !isInternal(userText(o.message?.content) || "")))) {
      const ts = Date.parse(o.timestamp);
      if (ts > last) last = ts;
    }
    if (!o || typeof o !== "object") continue;

    if (o.type === "queue-operation") {
      const c = typeof o.content === "string" ? o.content : null;
      if (o.operation === "enqueue") queue.push(c);
      else if (o.operation === "dequeue") queue.shift();
      else if (o.operation === "remove") {
        // Entfernt wird mit Text, eingereiht wurde manchmal ohne: dann den ersten Eintrag ohne Text streichen
        let i = c === null ? 0 : queue.indexOf(c);
        if (i < 0) i = queue.indexOf(null);
        if (i >= 0) queue.splice(i, 1);
      }
      continue;
    }
    // Während Claude arbeitet, reiht Claude Code neue Nachrichten ein und reicht sie mitten in der Runde nach.
    // Sie stehen dann nicht als user-Zeile im Verlauf, sondern als Anhang. Nur die vom Menschen zeigen.
    const att = o.type === "attachment" && !o.isSidechain ? o.attachment : null;
    if (att && att.type === "queued_command" && att.commandMode === "prompt" && att.origin?.kind === "human") {
      const t = userText(att.prompt);
      if (t && t.trim() && !isInternal(t)) {
        feed.push({ t: "user", v: t });
        const ts = Date.parse(o.timestamp);
        if (ts > last) last = ts;
      }
      continue;
    }

    if (o.type === "permission-mode") { mode = o.permissionMode ?? mode; continue; }
    if (o.type === "system" && o.subtype === "compact_boundary") { compactTrigger = String(o.compactMetadata?.trigger || ""); continue; }
    if (o.type === "user" && o.isCompactSummary) {
      const c = o.message?.content;
      const raw = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => (x && x.type === "text" ? x.text : "")).join("\n") : "";
      feed.push({ t: "compact", trigger: compactTrigger, v: compactText(raw) });
      compactTrigger = "";
      continue;
    }

    if (o.type === "assistant" && o.message && typeof o.message === "object") {
      if (o.isSidechain) continue;
      model = o.message.model ?? model;
      effort = o.effort ?? effort;
      const u = o.message.usage;
      if (u && typeof u === "object") {
        const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const win = used > 200000 ? 1000000 : 200000;
        ctx = Math.min(100, Math.round((used / win) * 100));
      }
      const content = Array.isArray(o.message.content) ? o.message.content : [];
      for (const c of content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "text" && typeof c.text === "string" && c.text.trim()) feed.push({ t: "text", v: c.text });
        if (c?.type !== "tool_use") continue;
        if (c.name === "TodoWrite" && Array.isArray(c.input?.todos)) {
          plan = c.input.todos.filter((x: any) => x && typeof x === "object").map((x: any) => [String(x.content ?? x.activeForm ?? ""), x.status === "completed" ? "done" : x.status === "in_progress" ? "run" : "todo"]);
        }
        if (c.name === "TaskCreate") tasks.set(c.id, { title: c.input?.subject ?? c.input?.title ?? c.input?.description ?? "", status: "pending" });
        if (c.name === "TaskUpdate" && c.input?.taskId) {
          for (const [k, t] of tasks) if (k === c.input.taskId || t.title === c.input.taskId) t.status = c.input.status ?? t.status;
        }
        if (c.name === "Agent" || c.name === "Task") openAgents.add(c.id);
        if (typeof c.name === "string" && browserTool(c.name)) { const ts = Date.parse(o.timestamp); if (ts > browserAt) browserAt = ts; }
        if (PLAN_TOOLS.has(c.name)) continue;
        toolIndex.set(c.id, feed.length);
        if (EDIT_TOOLS.has(c.name)) editTool.set(c.id, c.name);
        feed.push({ t: "tool", k: c.name, a: describe(c.name, c.input), s: "run" });
      }
      continue;
    }

    if (o.type === "user" && o.message && typeof o.message === "object") {
      if (o.isSidechain) continue;
      const content = o.message.content;
      if (Array.isArray(content) && content.some((c: any) => c?.type === "tool_result")) {
        for (const c of content) {
          if (!c || c.type !== "tool_result") continue;
          openAgents.delete(c.tool_use_id);
          const i = toolIndex.get(c.tool_use_id);
          if (i === undefined) continue;
          const item = feed[i] as any;
          item.s = c.is_error ? "err" : "ok";
          const patch = o.toolUseResult?.structuredPatch;
          if (editTool.has(c.tool_use_id) && Array.isArray(patch) && !c.is_error) {
            const lines: string[] = patch.flatMap((h: any) => (h && Array.isArray(h.lines) ? h.lines : [])).filter((l: any) => typeof l === "string");
            const diff: FeedItem = {
              t: "diff", f: o.toolUseResult.filePath || item.a,
              add: lines.filter(l => l.startsWith("+")).length,
              del: lines.filter(l => l.startsWith("-")).length,
              lines: lines.filter(l => l.startsWith("+") || l.startsWith("-")).slice(0, MAX_DIFF_LINES),
            };
            feed.splice(i + 1, 0, diff);
            for (const [k, v] of toolIndex) if (v > i) toolIndex.set(k, v + 1);
          }
        }
        continue;
      }
      if (o.isMeta) {
        // Claude Code bettet ein eingefügtes Bild als "[Image #N]" ein und nennt den Pfad in einer Meta-Zeile danach
        const srcs = [...(userText(content) || "").matchAll(/\[Image: source: ([^\]\n]+)\]/g)].map(m => m[1].trim());
        const last = feed[feed.length - 1];
        if (srcs.length && last && last.t === "user") last.v = last.v.replace(/\[Image #\d+\]/g, m => srcs.shift() ?? m);
        continue;
      }
      const t = userText(content);
      if (t && t.trim() && !isInternal(t)) feed.push({ t: "user", v: t });
    }
  }

  if (!plan.length && tasks.size) {
    plan = [...tasks.values()].map(t => [t.title, t.status === "completed" ? "done" : t.status === "in_progress" ? "run" : "todo"]);
  }
  const pending = queue.filter((c): c is string => !!c && !!c.trim() && !isInternal(c));
  return { last, pending, feed, plan, subs: openAgents.size, ctx, model, effort, mode, changes: feed.filter(x => x.t === "diff"), browserAt };
}

// Große Verläufe nur ab dem Ende lesen (ab einer Zeilengrenze), damit der Server nicht blockiert
export const MAX_READ = 8 * 1024 * 1024;
export async function readTail(path: string, maxBytes = MAX_READ): Promise<string> {
  const f = Bun.file(path);
  const size = f.size;
  if (size <= maxBytes) return await f.text();
  const t = await f.slice(size - maxBytes, size).text();
  const nl = t.indexOf("\n");
  return nl >= 0 ? t.slice(nl + 1) : "";
}

export async function readSession(cwd: string, sessionId: string): Promise<SessionInfo | null> {
  const p = transcriptPath(cwd, sessionId);
  if (!(await Bun.file(p).exists())) return null;
  try { return parseTranscript(await readTail(p)); } catch { return null; }
}
