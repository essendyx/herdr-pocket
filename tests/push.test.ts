import { test, expect } from "bun:test";
import { shouldNotify, PushHub } from "../server/push.ts";
import { tmpdir } from "os";
import { join } from "path";

const at = (h: number, m = 0) => new Date(2026, 10, 19, h, m);
const S = (o: any = {}) => ({ notify: { blocked: true, done: true, working: false, ...o.notify }, quiet: o.quiet ?? true });

test("Freigaben kommen auch in der Ruhezeit", () => {
  expect(shouldNotify("blocked", S(), at(23, 30))).toBe(true);
});
test("Fertig kommt in der Ruhezeit nicht", () => {
  expect(shouldNotify("done", S(), at(23, 30))).toBe(false);
  expect(shouldNotify("done", S(), at(6, 59))).toBe(false);
});
test("Fertig kommt tagsüber, auch ohne Ruhezeit nachts", () => {
  expect(shouldNotify("done", S(), at(14))).toBe(true);
  expect(shouldNotify("done", S({ quiet: false }), at(23, 30))).toBe(true);
});
test("Arbeitet ist aus, wenn abgeschaltet; idle nie", () => {
  expect(shouldNotify("working", S(), at(14))).toBe(false);
  expect(shouldNotify("idle", S(), at(14))).toBe(false);
  expect(shouldNotify("blocked", S({ notify: { blocked: false } }), at(14))).toBe(false);
});

test("abgelaufenes Abo (410) wird entfernt, andere bleiben", async () => {
  const dir = join(tmpdir(), "push-" + Math.random().toString(36).slice(2));
  const sent: string[] = [];
  const hub = new PushHub(dir, async (sub: any) => {
    sent.push(sub.endpoint);
    if (sub.endpoint.endsWith("/alt")) { const e: any = new Error("gone"); e.statusCode = 410; throw e; }
  });
  hub.subscribe({ endpoint: "https://push.example/alt", keys: { p256dh: "x", auth: "y" } });
  hub.subscribe({ endpoint: "https://push.example/neu", keys: { p256dh: "x", auth: "y" } });
  hub.subscribe({ endpoint: "https://push.example/neu", keys: { p256dh: "x", auth: "y" } });
  await hub.notifyAll({ title: "t", body: "b", pane: "w1:p1" });
  expect(sent.length).toBe(2);
  expect(hub.count()).toBe(1);
  expect(new PushHub(dir, async () => {}).count()).toBe(1);
});

test("Push-Text enthält Projekt und Status, nicht den Sitzungstitel", async () => {
  const { pushPayload } = await import("../server/push.ts");
  const p = pushPayload({ id: "w1:p1", project: "idlegame", title: "rm -rf geheim" } as any, "blocked");
  expect(p.title).toBe("idlegame wartet auf dich");
  expect(JSON.stringify(p)).not.toContain("geheim");
  expect(p.pane).toBe("w1:p1");
});
