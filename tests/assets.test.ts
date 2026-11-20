import { test, expect } from "bun:test";
import { versionAssets } from "../server/assets.ts";

test("hängt an CSS und Skripte eine Version an, damit das Handy keine alte Fassung aus dem Cache nimmt", () => {
  const html = '<link rel="stylesheet" href="/app.css"><script defer src="/api.js"></script><script defer src="/app.js"></script>';
  const out = versionAssets(html, { "/app.css": "a1", "/api.js": "b2", "/app.js": "c3" });
  expect(out).toBe('<link rel="stylesheet" href="/app.css?v=a1"><script defer src="/api.js?v=b2"></script><script defer src="/app.js?v=c3"></script>');
});
