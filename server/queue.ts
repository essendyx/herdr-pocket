// Nachrichten, die warten, bis der Agent seinen Zug beendet hat. Einträge haben stabile IDs.
import { readFileSync, writeFileSync, chmodSync } from "fs";
import type { Status } from "./model.ts";

export type QueueEntry = { id: string; text: string };

export class PromptQueue {
  private q: Record<string, QueueEntry[]> = {};
  constructor(private file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(raw || {})) {
        if (Array.isArray(v)) this.q[k] = v.filter((e: any) => e && typeof e.text === "string").map((e: any) => ({ id: String(e.id || crypto.randomUUID()), text: e.text }));
      }
    } catch { this.q = {}; }
  }
  private save() {
    for (const k of Object.keys(this.q)) if (!this.q[k].length) delete this.q[k];
    writeFileSync(this.file, JSON.stringify(this.q), { mode: 0o600 });
    try { chmodSync(this.file, 0o600); } catch {}
  }
  list(pane: string): QueueEntry[] { return [...(this.q[pane] || [])]; }
  push(pane: string, text: string): QueueEntry {
    const e = { id: crypto.randomUUID(), text };
    (this.q[pane] ||= []).push(e);
    this.save();
    return e;
  }
  take(pane: string, id: string): QueueEntry | null {
    const l = this.q[pane] || [];
    const i = l.findIndex(e => e.id === id);
    if (i < 0) return null;
    const [e] = l.splice(i, 1);
    this.save();
    return e;
  }
  drop(pane: string, id: string): boolean { return this.take(pane, id) !== null; }
  // Nicht zugestellte Nachricht wieder vorne einreihen
  restore(pane: string, e: QueueEntry) { (this.q[pane] ||= []).unshift(e); this.save(); }
  onStatus(pane: string, to: Status): QueueEntry | null {
    if (to !== "idle" && to !== "done") return null;
    const l = this.q[pane];
    if (!l?.length) return null;
    const e = l.shift()!;
    this.save();
    return e;
  }
}
