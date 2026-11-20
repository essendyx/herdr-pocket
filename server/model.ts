// Zustand aus pane.list und workspace.list: Agents, Shells, Spaces.
import { basename } from "path";

export type Status = "blocked" | "working" | "done" | "idle";
// kind: Programm laut herdr (claude, codex, opencode ...)
export type Agent = { id: string; kind: string; ws: string; tab: string; project: string; cwd: string; title: string; status: Status; sessionId: string | null; since: number };
export type Shell = { id: string; ws: string; cwd: string; title: string };
export type Space = { id: string; label: string; number: number };
export type Snapshot = { ok: boolean; error?: string; agents: Agent[]; shells: Shell[]; spaces: Space[] };

export const EMPTY: Snapshot = { ok: false, error: "noch keine Daten", agents: [], shells: [], spaces: [] };

const STATUSES = new Set(["blocked", "working", "done", "idle"]);
const toStatus = (s: string): Status => (STATUSES.has(s) ? (s as Status) : "idle");

export function buildSnapshot(panes: any[], workspaces: any[], prev?: Snapshot, now = Date.now()): Snapshot {
  const prevById = new Map((prev?.agents || []).map(a => [a.id, a]));
  const agents: Agent[] = [];
  const shells: Shell[] = [];
  for (const p of panes) {
    const cwd = p.foreground_cwd || p.cwd || "";
    const title = p.terminal_title_stripped || p.terminal_title || "";
    if (p.agent) {
      const status = toStatus(p.agent_status);
      const old = prevById.get(p.pane_id);
      agents.push({
        id: p.pane_id, kind: String(p.agent), ws: p.workspace_id, tab: p.tab_id, project: basename(cwd), cwd, title, status,
        sessionId: p.agent_session?.value || null,
        since: old && old.status === status ? old.since : now,
      });
    } else {
      shells.push({ id: p.pane_id, ws: p.workspace_id, cwd, title });
    }
  }
  const spaces = workspaces.map(w => ({ id: w.workspace_id, label: w.label || `Space ${w.number}`, number: w.number }));
  return { ok: true, agents, shells, spaces };
}
