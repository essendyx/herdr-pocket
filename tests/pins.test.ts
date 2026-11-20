import { test, expect } from "bun:test";
import { pinKey, setPin, isPinned } from "../server/pins.ts";

test("pinKey nimmt die Sitzung, sonst die Pane", () => {
  expect(pinKey({ id: "w1:p1", sessionId: "s1" })).toBe("s1");
  expect(pinKey({ id: "w1:p1", sessionId: null })).toBe("w1:p1");
});

test("setPin heftet an und löst, ohne Doppelte", () => {
  let l = setPin([], "s1", true);
  l = setPin(l, "s1", true);
  expect(l).toEqual(["s1"]);
  expect(isPinned(l, { id: "w1:p1", sessionId: "s1" })).toBe(true);
  expect(setPin(l, "s1", false)).toEqual([]);
});

test("Angeheftet bleibt auch, wenn die Pane-ID wechselt, aber die Sitzung gleich ist", () => {
  expect(isPinned(["s1"], { id: "w9:p4", sessionId: "s1" })).toBe(true);
});

test("Liste ist begrenzt, älteste fallen raus", () => {
  let l: string[] = [];
  for (let i = 0; i < 205; i++) l = setPin(l, "k" + i, true);
  expect(l.length).toBe(200);
  expect(l[0]).toBe("k5");
});
