import { test, expect, afterEach } from "bun:test";
import { call, HerdrError } from "../server/herdr.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";

let servers: any[] = [];
afterEach(() => { servers.forEach(s => s.stop(true)); servers = []; });

function fakeSocket(reply: (req: any) => any | null): string {
  const path = join(tmpdir(), `herdr-test-${Math.random().toString(36).slice(2)}.sock`);
  try { rmSync(path); } catch {}
  servers.push(Bun.listen({
    unix: path,
    socket: {
      data(sock, buf) {
        const req = JSON.parse(buf.toString().trim());
        const r = reply(req);
        if (r !== null) { sock.write(JSON.stringify({ id: req.id, ...r }) + "\n"); sock.end(); }
      },
    },
  }));
  return path;
}

test("call liefert result", async () => {
  const s = fakeSocket(req => ({ result: { type: "pong", method: req.method } }));
  const r: any = await call("ping", {}, { socket: s });
  expect(r.type).toBe("pong");
  expect(r.method).toBe("ping");
});

test("call wirft HerdrError mit code aus error", async () => {
  const s = fakeSocket(() => ({ error: { code: "agent_blocked", message: "x" } }));
  const e: any = await call("agent.prompt", {}, { socket: s }).catch(e => e);
  expect(e).toBeInstanceOf(HerdrError);
  expect(e.code).toBe("agent_blocked");
});

test("call wirft timeout, wenn keine Antwort kommt", async () => {
  const s = fakeSocket(() => null);
  const e: any = await call("ping", {}, { socket: s, timeoutMs: 200 }).catch(e => e);
  expect(e.code).toBe("timeout");
});

test("call wirft unavailable, wenn der Socket fehlt", async () => {
  const e: any = await call("ping", {}, { socket: "/tmp/gibt-es-nicht.sock" }).catch(e => e);
  expect(e.code).toBe("unavailable");
});
