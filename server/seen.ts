// "Gesehen" für fertige Agents, auf dem Server gespeichert, damit es auf allen Geräten gilt.
// Marke ist die letzte Aktivität im Verlauf: übersteht Neustarts, neue Arbeit macht den Agent wieder ungesehen.
import { pinKey } from "./pins.ts";

type Seeable = { id: string; sessionId: string | null; status: string; since: number; lastActive?: number | null };
const MAX = 200;

export const seenMark = (a: Seeable): number => a.lastActive || a.since;

export function markSeen(map: Record<string, number>, a: Seeable): Record<string, number> {
  const key = pinKey(a), rest = { ...map };
  delete rest[key];
  rest[key] = seenMark(a);
  const keys = Object.keys(rest);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete rest[k];
  return rest;
}

export const isSeen = (map: Record<string, number>, a: Seeable): boolean => {
  if (a.status !== "done") return false;
  const v = map[a.sessionId || ""] ?? map[a.id];
  return v != null && v >= seenMark(a);
};
