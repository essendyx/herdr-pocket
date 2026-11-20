import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, ConfigError } from "../server/config.ts";

const home = "/home/alex";
const dir = mkdtempSync(join(tmpdir(), "cfg-"));
writeFileSync(join(dir, "aud"), "  abc123\n");

test("Cloudflare Access: Origin, Team, Mail und AUD aus Datei", () => {
  const c = loadConfig({ HERDR_APP_ORIGIN: "https://herdr.example.com/", CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com", CF_ACCESS_AUD_FILE: join(dir, "aud"), HERDR_APP_EMAIL: "Me@Example.com" }, home);
  expect(c.origin).toBe("https://herdr.example.com");
  expect(c.auth).toEqual({ kind: "cloudflare", issuer: "https://myteam.cloudflareaccess.com", aud: "abc123", email: "me@example.com" });
  expect(c.imageDir).toBe("/home/alex/.config/herdr-app/images");
});

test("AUD direkt und eigener Bilderordner", () => {
  const c = loadConfig({ HERDR_APP_ORIGIN: "https://h.example.com", CF_ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com", CF_ACCESS_AUD: "x", HERDR_APP_EMAIL: "a@b.c", HERDR_APP_IMAGE_DIR: "/data/img" }, home);
  expect(c.auth).toMatchObject({ issuer: "https://t.cloudflareaccess.com", aud: "x" });
  expect(c.imageDir).toBe("/data/img");
});

test("Ohne Anmeldung nur ausdrücklich", () => {
  expect(() => loadConfig({ HERDR_APP_ORIGIN: "https://h.example.com" }, home)).toThrow(ConfigError);
  expect(loadConfig({ HERDR_APP_ORIGIN: "http://10.0.0.5:7683", HERDR_APP_AUTH: "none" }, home).auth).toEqual({ kind: "none" });
});

test("Origin ist Pflicht, unvollständiges Cloudflare wird abgelehnt", () => {
  expect(() => loadConfig({ HERDR_APP_AUTH: "none" }, home)).toThrow(ConfigError);
  expect(() => loadConfig({ HERDR_APP_ORIGIN: "https://h.example.com", CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com" }, home)).toThrow(/HERDR_APP_EMAIL|CF_ACCESS_AUD/);
});

test("Entwicklung: localhost, keine Anmeldung", () => {
  const c = loadConfig({}, home, true);
  expect(c.auth).toEqual({ kind: "none" });
  expect(c.origin).toBe("");
});
