// Angeheftete Agents: Schlüssel ist die Claude-Sitzung (bleibt über Neustarts gleich), sonst die Pane.
type Pinnable = { id: string; sessionId: string | null };
const MAX = 200;

export const pinKey = (a: Pinnable): string => a.sessionId || a.id;

export function setPin(list: string[], key: string, on: boolean): string[] {
  const rest = list.filter(k => k !== key);
  return on ? rest.concat(key).slice(-MAX) : rest;
}

export const isPinned = (list: string[], a: Pinnable): boolean => list.includes(a.sessionId || "") || list.includes(a.id);
