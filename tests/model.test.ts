import { test, expect } from "bun:test";
import { buildSnapshot } from "../server/model.ts";
import { Poller } from "../server/poller.ts";
import { HerdrError } from "../server/herdr.ts";
import panes from "./fixtures/pane-list.json";
import workspaces from "./fixtures/workspace-list.json";

test("Agents und Shells werden getrennt, project ist der Ordnername", () => {
  const s = buildSnapshot(panes as any[], workspaces as any[], undefined, 1000);
  expect(s.ok).toBe(true);
  expect(s.agents.length).toBe(5);
  expect(s.shells.length).toBe(1);
  expect(s.agents[0].project).toBe("garden-club-site");
  expect(s.agents[0].sessionId).toBe("88b41975-b299-4bd4-b86a-551c9756486e");
  expect(s.shells[0].id).toBe("w8:pE");
  expect(s.spaces.find(x => x.id === "w8")!.label).toBe("Main");
});

test("Status unknown wird idle, since bleibt bei gleichem Status", () => {
  const p = (panes as any[]).map(x => ({ ...x }));
  p[0].agent_status = "unknown";
  const a = buildSnapshot(p, workspaces as any[], undefined, 1000);
  expect(a.agents[0].status).toBe("idle");
  const b = buildSnapshot(p, workspaces as any[], a, 5000);
  expect(b.agents[0].since).toBe(1000);
});

test("Poller meldet genau einen Statuswechsel working nach done", async () => {
  let status = "working";
  const fake = async (m: string) => m === "pane.list"
    ? { panes: [{ ...(panes as any[])[0], agent_status: status }] }
    : { workspaces };
  const p = new Poller(fake as any);
  const events: any[] = [];
  p.addEventListener("status", (e: any) => events.push(e.detail));
  await p.tick();
  status = "done";
  await p.tick();
  await p.tick();
  expect(events.length).toBe(1);
  expect(events[0].from).toBe("working");
  expect(events[0].to).toBe("done");
});

test("herdr nicht erreichbar ergibt ok false, Poller läuft weiter", async () => {
  let fail = true;
  const fake = async (m: string) => {
    if (fail) throw new HerdrError("unavailable", "weg");
    return m === "pane.list" ? { panes } : { workspaces };
  };
  const p = new Poller(fake as any);
  await p.tick();
  expect(p.snapshot.ok).toBe(false);
  expect(p.snapshot.error).toBe("herdr nicht erreichbar");
  fail = false;
  await p.tick();
  expect(p.snapshot.ok).toBe(true);
  expect(p.snapshot.agents.length).toBe(5);
});

test("Art des Agents kommt aus pane.agent (claude, codex, opencode)", () => {
  const p = (panes as any[]).map(x => ({ ...x }));
  p[0].agent = "codex"; p[1].agent = "opencode";
  const s = buildSnapshot(p, workspaces as any[], undefined, 1000);
  expect(s.agents[0].kind).toBe("codex");
  expect(s.agents[1].kind).toBe("opencode");
  expect(s.agents[2].kind).toBe("claude");
});
