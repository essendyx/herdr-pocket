import { test, expect } from "bun:test";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { makeVerifier, checkCsrf } from "../server/auth.ts";

const AUD = "a".repeat(64);
const ISS = "https://myteam.cloudflareaccess.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
const verify = makeVerifier({ jwks: createLocalJWKSet({ keys: [jwk] }), aud: AUD, iss: ISS, email: "me@example.com" });

const token = (claims: any = {}, exp = "5m") =>
  new SignJWT({ email: "me@example.com", ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISS).setAudience(claims.aud ?? AUD).setIssuedAt().setExpirationTime(exp).sign(privateKey);
const req = (t?: string) => new Request("http://x/api/state", { headers: t ? { "Cf-Access-Jwt-Assertion": t } : {} });

test("gültiges Token wird angenommen", async () => {
  expect(await verify(req(await token()))).toEqual({ email: "me@example.com" });
});
test("falsche AUD wird abgelehnt", async () => {
  expect(await verify(req(await token({ aud: "b".repeat(64) })))).toBeNull();
});
test("abgelaufenes Token wird abgelehnt", async () => {
  expect(await verify(req(await token({}, "-1m")))).toBeNull();
});
test("fremde E-Mail wird abgelehnt", async () => {
  expect(await verify(req(await token({ email: "x@example.com" })))).toBeNull();
});
test("fehlender Header wird abgelehnt", async () => {
  expect(await verify(req())).toBeNull();
});

const post = (h: Record<string, string>) => new Request("http://x/api/agents/p/prompt", { method: "POST", headers: h });
test("CSRF: richtiger Origin und Header ok, sonst nicht", () => {
  const O = "https://herdr.example.com";
  expect(checkCsrf(post({ Origin: O, "X-Herdr-App": "1" }), O)).toBe(true);
  expect(checkCsrf(post({ Origin: O }), O)).toBe(false);
  expect(checkCsrf(post({ Origin: "https://evil.example", "X-Herdr-App": "1" }), O)).toBe(false);
  expect(checkCsrf(new Request("http://x/api/state"), O)).toBe(true);
  // Entwicklung ohne Origin: nur der Header zählt
  expect(checkCsrf(post({ "X-Herdr-App": "1" }), "")).toBe(true);
  expect(checkCsrf(post({}), "")).toBe(false);
});
