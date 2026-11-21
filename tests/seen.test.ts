import { test, expect } from "bun:test";
import { seenMark, markSeen, isSeen } from "../server/seen.ts";

const done = { id: "w1:p1", sessionId: "s1", status: "done", since: 100, lastActive: 5000 };

test("Marke ist die letzte Aktivität, ohne Verlauf der Statuswechsel", () => {
  expect(seenMark(done)).toBe(5000);
  expect(seenMark({ ...done, lastActive: null })).toBe(100);
});

test("Gesehen gilt bis zur nächsten Aktivität, auch nach Neustart (since ändert sich)", () => {
  const m = markSeen({}, done);
  expect(m).toEqual({ s1: 5000 });
  expect(isSeen(m, { ...done, since: 999 })).toBe(true);
  expect(isSeen(m, { ...done, lastActive: 6000 })).toBe(false);
  expect(isSeen(m, { ...done, status: "idle" })).toBe(false);
});

test("Pane-Wechsel mit gleicher Sitzung bleibt gesehen", () => {
  expect(isSeen(markSeen({}, done), { ...done, id: "w9:p4" })).toBe(true);
});

test("Speicher ist begrenzt, älteste Einträge fallen raus", () => {
  let m: Record<string, number> = {};
  for (let i = 0; i < 205; i++) m = markSeen(m, { ...done, sessionId: "k" + i });
  expect(Object.keys(m).length).toBe(200);
  expect("k0" in m).toBe(false);
  expect("k204" in m).toBe(true);
});
