// Liest Claude-Code-Verläufe (JSONL) und baut daraus Feed, Plan, Kontext und Änderungen.
import { homedir } from "os";
import { join } from "path";

export type FeedItem =
  | { t: "user"; v: string }
  | { t: "text"; v: string }
  | { t: "tool"; k: string; a: string; s: "ok" | "run" | "err" }
  | { t: "diff"; f: string; add: number; del: number; lines: string[] };
export type PlanStep = [string, "done" | "run" | "todo"];
export type SessionInfo = { feed: FeedItem[]; plan: PlanStep[]; subs: number; ctx: number; model: string | null; effort: string | null; mode: string | null; changes: FeedItem[] };

const MAX_DIFF_LINES = 40;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PLAN_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(homedir(), ".claude/projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}

function describe(name: string, input: any): string {
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

const isInternal = (s: string) => /^\s*<(system-reminder|command-|local-command|task-notification|bash-)/.test(s);

export function parseTranscript(text: string): SessionInfo {
  const feed: FeedItem[] = [];
  const toolIndex = new Map<string, number>();
  const editTool = new Map<string, string>();
  let plan: PlanStep[] = [];
  const tasks = new Map<string, { title: string; status: string }>();
  let ctx = 0, model: string | null = null, effort: string | null = null, mode: string | null = null;
  const openAgents = new Set<string>();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object") continue;

    if (o.type === "permission-mode") { mode = o.permissionMode ?? mode; continue; }

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
      if (o.isMeta) continue;
      const t = userText(content);
      if (t && t.trim() && !isInternal(t)) feed.push({ t: "user", v: t });
    }
  }

  if (!plan.length && tasks.size) {
    plan = [...tasks.values()].map(t => [t.title, t.status === "completed" ? "done" : t.status === "in_progress" ? "run" : "todo"]);
  }
  return { feed, plan, subs: openAgents.size, ctx, model, effort, mode, changes: feed.filter(x => x.t === "diff") };
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
