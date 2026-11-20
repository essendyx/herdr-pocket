import { test, expect } from "bun:test";
import { parseTranscript, transcriptPath, readSession } from "../server/transcript.ts";

const text = await Bun.file(import.meta.dir + "/fixtures/transcript.jsonl").text();

test("Feed hat die erwartete Reihenfolge, Meta-Nachrichten fehlen", () => {
  const s = parseTranscript(text);
  expect(s.feed.map(x => x.t)).toEqual(["user", "text", "tool", "tool", "diff", "tool", "tool"]);
  expect((s.feed[0] as any).v).toBe("Setz bitte Prio 1 um.");
});

test("Werkzeugstatus: ok, err und run ohne Ergebnis", () => {
  const tools = parseTranscript(text).feed.filter(x => x.t === "tool") as any[];
  expect(tools.find(t => t.k === "Read").s).toBe("ok");
  expect(tools.find(t => t.k === "Read").a).toBe("/home/alex/src/idlegame/docs/bericht.md");
  expect(tools.find(t => t.k === "Bash").s).toBe("err");
  expect(tools.find(t => t.k === "Bash").a).toBe("npm test -- offline");
  expect(tools.find(t => t.k === "Agent").s).toBe("run");
});

test("Edit mit structuredPatch wird diff mit Zählern", () => {
  const d = parseTranscript(text).feed.find(x => x.t === "diff") as any;
  expect(d.f).toBe("/home/alex/src/idlegame/src/offline.ts");
  expect(d.add).toBe(2);
  expect(d.del).toBe(1);
  expect(d.lines).toContain("+  return 1;");
});

test("Plan, Subagents, Kontext, Modell, Effort, Modus", () => {
  const s = parseTranscript(text);
  expect(s.plan).toEqual([["Offline-Fortschritt", "done"], ["Tutorial", "run"], ["Sounds", "todo"]]);
  expect(s.subs).toBe(1);
  expect(s.ctx).toBe(60);
  expect(s.model).toBe("claude-opus-5-5");
  expect(s.effort).toBe("high");
  expect(s.mode).toBe("auto");
  expect(s.changes.length).toBe(1);
});

test("leerer Verlauf", () => {
  const s = parseTranscript("");
  expect(s.feed).toEqual([]);
  expect(s.ctx).toBe(0);
});

test("transcriptPath ersetzt Sonderzeichen durch Minus", () => {
  expect(transcriptPath("/home/alex/src/herdr_mobileview", "abc").endsWith("/.claude/projects/-home-alex-src-herdr-mobileview/abc.jsonl")).toBe(true);
});

test("readSession liefert null, wenn die Datei fehlt", async () => {
  expect(await readSession("/gibt/es/nicht", "x")).toBeNull();
});

test("gültiges JSON mit fremder Form wirft nicht", () => {
  const weird = [
    JSON.stringify({ type: "assistant", message: { content: 5, usage: null } }),
    JSON.stringify({ type: "assistant", message: { content: [null, { type: "tool_use", id: "x", name: "TodoWrite", input: { todos: [null, { content: "a", status: "pending" }] } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: null }] } }),
    JSON.stringify({ type: "user", message: { content: [null, { type: "tool_result", tool_use_id: "e1" }] }, toolUseResult: { structuredPatch: [null, { lines: null }] } }),
    JSON.stringify({ type: "user", message: null }),
    JSON.stringify(null),
    JSON.stringify(42),
  ].join("\n");
  expect(() => parseTranscript(weird)).not.toThrow();
});

test("readTail liest nur das Ende ab einer Zeilengrenze", async () => {
  const { readTail } = await import("../server/transcript.ts");
  const f = require("os").tmpdir() + "/tail-" + Math.random().toString(36).slice(2) + ".jsonl";
  await Bun.write(f, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ n: i })).join("\n") + "\n");
  const t = await readTail(f, 200);
  expect(t.length).toBeLessThanOrEqual(200);
  const first = t.split("\n")[0];
  expect(() => JSON.parse(first)).not.toThrow();
  expect(t.trim().endsWith('{"n":999}')).toBe(true);
});
