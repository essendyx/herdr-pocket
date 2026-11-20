// Fragt herdr regelmäßig ab und meldet Änderungen und Statuswechsel.
import { call as herdrCall } from "./herdr.ts";
import { buildSnapshot, EMPTY, type Snapshot, type Status, type Agent } from "./model.ts";

type CallFn = (method: string, params: object) => Promise<any>;

export class Poller extends EventTarget {
  snapshot: Snapshot = EMPTY;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private last = "";

  constructor(private callFn: CallFn = herdrCall) { super(); }

  start(intervalMs = 1000) {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      let next: Snapshot;
      try {
        const [p, w] = await Promise.all([this.callFn("pane.list", {}), this.callFn("workspace.list", {})]);
        next = buildSnapshot(p.panes || [], w.workspaces || [], this.snapshot.ok ? this.snapshot : undefined);
      } catch {
        next = { ...this.snapshot, ok: false, error: "herdr nicht erreichbar" };
      }
      if (next.ok && this.snapshot.ok) {
        const before = new Map(this.snapshot.agents.map(a => [a.id, a.status]));
        for (const a of next.agents) {
          const from = before.get(a.id);
          if (from && from !== a.status) this.emitStatus(a, from, a.status);
        }
      }
      this.snapshot = next;
      const key = JSON.stringify(next, (k, v) => (k === "since" ? undefined : v));
      if (key !== this.last) {
        this.last = key;
        this.dispatchEvent(new CustomEvent("snapshot", { detail: next }));
      }
    } finally {
      this.busy = false;
    }
  }

  private emitStatus(agent: Agent, from: Status, to: Status) {
    this.dispatchEvent(new CustomEvent("status", { detail: { agent, from, to } }));
  }
}
