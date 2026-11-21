// Token-Verbrauch einer Sitzung und was er zu API-Listenpreisen kosten würde.
// Mit Abo zahlt man das nicht, die Zahl zeigt nur, wie teuer die Arbeit über die API wäre.
import { readdirSync } from "fs";
import { join } from "path";

export type Price = { in: number; out: number; cr: number }; // US-Dollar pro Million Tokens

// Listenpreise (Stand 2026-11). Cache-Schreiben kostet 1,25x Input (5 Minuten) bzw. 2x (1 Stunde).
const PRICES: [string, Price][] = [
  ["fable-5-2", { in: 8, out: 40, cr: 0.2 }], ["mythos-5-2", { in: 8, out: 40, cr: 0.2 }],
  ["fable-5-1", { in: 10, out: 50, cr: 0.25 }], ["mythos-5-1", { in: 10, out: 50, cr: 0.25 }],
  ["fable-5", { in: 10, out: 50, cr: 1 }], ["mythos-5", { in: 10, out: 50, cr: 1 }],
  ["opus-5-5", { in: 4, out: 20, cr: 0.2 }],
  ["opus-5", { in: 5, out: 25, cr: 0.5 }], ["opus-4-8", { in: 5, out: 25, cr: 0.5 }], ["opus-4-7", { in: 5, out: 25, cr: 0.5 }],
  ["opus-4-6", { in: 5, out: 25, cr: 0.5 }], ["opus-4-5", { in: 5, out: 25, cr: 0.5 }],
  ["opus-4-1", { in: 15, out: 75, cr: 1.5 }], ["opus-4", { in: 15, out: 75, cr: 1.5 }],
  ["sonnet-5-5", { in: 2, out: 10, cr: 0.1 }], ["sonnet-5", { in: 2, out: 10, cr: 0.2 }],
  ["sonnet-4-6", { in: 3, out: 15, cr: 0.3 }], ["sonnet-4-5", { in: 3, out: 15, cr: 0.3 }], ["sonnet-4", { in: 3, out: 15, cr: 0.3 }],
  ["haiku-5-5", { in: 0.1, out: 0.5, cr: 0.01 }], ["haiku-4-5", { in: 1, out: 5, cr: 0.1 }], ["haiku-3-5", { in: 0.8, out: 4, cr: 0.08 }],
];
// Längster Name zuerst, damit "opus-5-5" nicht als "opus-5" gilt
const ORDERED = [...PRICES].sort((a, b) => b[0].length - a[0].length);

export function priceOf(model: string): Price | null {
  const m = String(model || "").toLowerCase();
  for (const [k, p] of ORDERED) if (m.includes(k) && !new RegExp(k + "-\\d(?!\\d{3})").test(m)) return p;
  return null;
}

const n = (x: any) => (typeof x === "number" && isFinite(x) ? x : 0);

export function messageCost(model: string, u: any): number | null {
  let p = priceOf(model);
  if (!p || !u) return null;
  const cin = n(u.input_tokens), out = n(u.output_tokens), cr = n(u.cache_read_input_tokens), cw = n(u.cache_creation_input_tokens);
  // Haiku 5.5 kostet bei langen Anfragen (über 100K Tokens) das Fünffache
  if (/haiku-5-5/.test(model) && cin + cr + cw > 100_000) p = { in: p.in * 5, out: p.out * 5, cr: p.cr * 5 };
  const w1h = n(u.cache_creation?.ephemeral_1h_input_tokens);
  const w5m = u.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : cw;
  const usd = (cin * p.in + out * p.out + cr * p.cr + w5m * p.in * 1.25 + w1h * p.in * 2) / 1e6;
  return u.speed === "fast" ? usd * 2 : usd;
}

type Msg = { model: string; sub: boolean; in: number; out: number; cr: number; cw: number; cost: number | null };
type Scan = { offset: number; rest: string; msgs: Map<string, Msg> };
const scans = new Map<string, Scan>();

// Nur das Neue seit dem letzten Mal lesen; eine angefangene letzte Zeile bleibt liegen, bis sie fertig ist
async function scanFile(path: string, sub: boolean): Promise<Map<string, Msg>> {
  let s = scans.get(path);
  const f = Bun.file(path);
  const size = f.size;
  if (!s || size < s.offset) { s = { offset: 0, rest: "", msgs: new Map() }; scans.set(path, s); }
  if (size > s.offset) {
    const text = s.rest + (await f.slice(s.offset, size).text());
    s.offset = size;
    const nl = text.lastIndexOf("\n");
    s.rest = nl >= 0 ? text.slice(nl + 1) : text;
    for (const l of (nl >= 0 ? text.slice(0, nl) : "").split("\n")) {
      if (!l.includes('"usage"') || !l.includes('"assistant"')) continue;
      let o: any;
      try { o = JSON.parse(l); } catch { continue; }
      const m = o?.message;
      if (o?.type !== "assistant" || !m?.usage || !m.id || !priceOf(m.model)) continue;
      const u = m.usage;
      // Mehrere Zeilen je Antwort: die letzte hat den endgültigen Stand
      s.msgs.set(m.id, { model: m.model, sub, in: n(u.input_tokens), out: n(u.output_tokens), cr: n(u.cache_read_input_tokens), cw: n(u.cache_creation_input_tokens), cost: messageCost(m.model, u) });
    }
  }
  return s.msgs;
}

export type ModelUsage = { model: string; in: number; out: number; cr: number; cw: number; cost: number };
export type SessionUsage = { in: number; out: number; cr: number; cw: number; cost: number; msgs: number; subMsgs: number; models: ModelUsage[] };

export async function sessionUsage(transcript: string, subagentDir?: string): Promise<SessionUsage> {
  const files: [string, boolean][] = [[transcript, false]];
  if (subagentDir) {
    try { for (const f of readdirSync(subagentDir).sort()) if (f.endsWith(".jsonl")) files.push([join(subagentDir, f), true]); } catch {}
  }
  const tot: SessionUsage = { in: 0, out: 0, cr: 0, cw: 0, cost: 0, msgs: 0, subMsgs: 0, models: [] };
  const by = new Map<string, ModelUsage>();
  for (const [p, sub] of files) {
    let msgs: Map<string, Msg>;
    try { msgs = await scanFile(p, sub); } catch { continue; }
    for (const m of msgs.values()) {
      tot.in += m.in; tot.out += m.out; tot.cr += m.cr; tot.cw += m.cw; tot.cost += m.cost || 0;
      if (m.sub) tot.subMsgs++; else tot.msgs++;
      const b = by.get(m.model) || { model: m.model, in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
      b.in += m.in; b.out += m.out; b.cr += m.cr; b.cw += m.cw; b.cost += m.cost || 0;
      by.set(m.model, b);
    }
  }
  tot.models = [...by.values()];
  return tot;
}
