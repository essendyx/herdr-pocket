import { test, expect } from "bun:test";
import { join } from "path";
const WEB = join(import.meta.dir, "../web");

test("index.html verweist auf ein Favicon, und die Dateien gibt es", async () => {
  const html = await Bun.file(join(WEB, "index.html")).text();
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
  expect(await Bun.file(join(WEB, "favicon.svg")).text()).toContain("<svg");
  // ICO-Kopf: reserviert 0, Typ 1, mindestens ein Bild
  const ico = new Uint8Array(await Bun.file(join(WEB, "favicon.ico")).arrayBuffer());
  expect([...ico.slice(0, 4)]).toEqual([0, 0, 1, 0]);
  expect(ico[4]).toBeGreaterThan(0);
});
