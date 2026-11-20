// Abo-Verbrauch (5 Stunden, Woche). Kommt aus usage.json, die bin/usage-statusline.sh als Statuszeile von Claude Code schreibt.
export type Window = { pct: number; resetsAt: number } | null;
export type Usage = { at: number; five: Window; week: Window };

function win(w: any, nowSec: number): Window {
  if (!w || typeof w.used_percentage !== "number" || !isFinite(w.used_percentage)) return null;
  const r = typeof w.resets_at === "number" ? w.resets_at : 0;
  if (r && r <= nowSec) return null;
  return { pct: Math.round(Math.max(0, Math.min(100, w.used_percentage))), resetsAt: r * 1000 };
}

export function usageView(raw: any, nowSec = Date.now() / 1000): Usage | null {
  const rl = raw?.rate_limits;
  if (!rl) return null;
  const five = win(rl.five_hour, nowSec), week = win(rl.seven_day, nowSec);
  if (!five && !week) return null;
  return { at: (Number(raw.at) || 0) * 1000, five, week };
}
