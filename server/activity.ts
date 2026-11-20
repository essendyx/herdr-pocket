// Verlauf der Statuswechsel (letzte 500), für den Tab Aktivität.
import { readJson, writeJson } from "./store.ts";
import type { Status } from "./model.ts";

export type Entry = { t: string; s: Status | "end"; pane: string; project: string; w: string; d: string };
const MAX = 500;
const FILE = "activity.json";

export const LABEL: Record<string, string> = { blocked: "Wartet auf Freigabe", done: "Fertig", working: "Arbeitet", idle: "Bereit", end: "Beendet" };

export class Activity {
  private list: Entry[] = readJson<Entry[]>(FILE, []);
  add(e: Omit<Entry, "t"> & { t?: string }): Entry {
    const entry = { t: e.t || new Date().toISOString(), ...e } as Entry;
    this.list.unshift(entry);
    if (this.list.length > MAX) this.list.length = MAX;
    writeJson(FILE, this.list);
    return entry;
  }
  recent(n = 200): Entry[] { return this.list.slice(0, n); }
}
