import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { priceOf, messageCost, sessionUsage } from "../server/cost.ts";

const usage = (o: any) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...o });
const line = (id: string, model: string, u: any, extra: any = {}) => JSON.stringify({ type: "assistant", message: { id, model, usage: usage(u), content: [] }, ...extra }) + "\n";

test("Preise: Modell-IDs mit Zusätzen werden erkannt, das längste passende Modell gewinnt", () => {
  expect(priceOf("claude-opus-5-5")).toEqual({ in: 4, out: 20, cr: 0.2 });
  expect(priceOf("claude-opus-5")).toEqual({ in: 5, out: 25, cr: 0.5 });
  expect(priceOf("claude-sonnet-5-5[1m]")).toEqual({ in: 2, out: 10, cr: 0.1 });
  expect(priceOf("claude-haiku-4-5-20251001")).toEqual({ in: 1, out: 5, cr: 0.1 });
  expect(priceOf("<synthetic>")).toBeNull();
  expect(priceOf("gpt-5")).toBeNull();
});

test("Kosten einer Antwort: Input, Output, Cache-Lesen, Cache-Schreiben 5 Min und 1 Std, Schnellmodus doppelt", () => {
  const u = usage({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } });
  // 4 + 20 + 0.2 + 4*1.25 + 4*2 = 37.2
  expect(messageCost("claude-opus-5-5", u)).toBeCloseTo(37.2, 6);
  expect(messageCost("claude-opus-5-5", { ...u, speed: "fast" })).toBeCloseTo(74.4, 6);
  // Ohne Aufteilung gilt Cache-Schreiben als 5 Minuten
  expect(messageCost("claude-opus-5-5", usage({ cache_creation_input_tokens: 1_000_000 }))).toBeCloseTo(5, 6);
  expect(messageCost("unbekannt", u)).toBeNull();
});

test("Sitzung: jede Antwort zählt einmal, Subagents zählen mit, neue Zeilen werden nachgelesen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-"));
  const main = join(dir, "s1.jsonl");
  // Claude Code schreibt eine Antwort als mehrere Zeilen mit derselben id
  writeFileSync(main,
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n" +
    line("m1", "claude-opus-5-5", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000 }) +
    line("m1", "claude-opus-5-5", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 }) +
    line("m0", "<synthetic>", { input_tokens: 5, output_tokens: 5 }));
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  writeFileSync(join(dir, "s1", "subagents", "agent-a.jsonl"), line("m9", "claude-haiku-4-5", { input_tokens: 200, output_tokens: 20 }));
  let s = await sessionUsage(main, join(dir, "s1", "subagents"));
  expect(s).toMatchObject({ in: 300, out: 70, cr: 1000, cw: 0, msgs: 1, subMsgs: 1 });
  expect(s.cost).toBeCloseTo((100 * 4 + 50 * 20 + 1000 * 0.2 + 200 * 1 + 20 * 5) / 1e6, 9);
  expect(s.models.map(m => m.model)).toEqual(["claude-opus-5-5", "claude-haiku-4-5"]);
  // Eine halb geschriebene Zeile am Ende wird erst gezählt, wenn sie fertig ist
  const half = line("m2", "claude-opus-5-5", { output_tokens: 1000 });
  appendFileSync(main, half.slice(0, 30));
  s = await sessionUsage(main, join(dir, "s1", "subagents"));
  expect(s.out).toBe(70);
  appendFileSync(main, half.slice(30));
  s = await sessionUsage(main, join(dir, "s1", "subagents"));
  expect(s.out).toBe(1070);
  expect(s.msgs).toBe(2);
});
