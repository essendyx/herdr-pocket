// Web Push: VAPID-Schlüssel, Abos und Regeln, wann eine Nachricht rausgeht.
import webpush from "web-push";
import { readJson, writeJson, STATE_DIR, type Settings } from "./store.ts";
import type { Status } from "./model.ts";

export type Payload = { title: string; body: string; pane: string };
type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
type Sender = (sub: Sub, data: string) => Promise<unknown>;

// Ruhezeit 22:00 bis 7:00: dann nur noch Freigaben
export function shouldNotify(to: Status, s: Settings, now: Date): boolean {
  if (to === "blocked") return !!s.notify.blocked;
  if (to !== "done" && to !== "working") return false;
  if (!s.notify[to]) return false;
  const h = now.getHours();
  return !(s.quiet && (h >= 22 || h < 7));
}

export class PushHub {
  private subs: Sub[];
  constructor(private dir = STATE_DIR, private send: Sender = (sub, data) => webpush.sendNotification(sub, data, { TTL: 3600 })) {
    this.subs = readJson<Sub[]>("push-subs.json", [], dir);
  }
  count() { return this.subs.length; }
  subscribe(sub: Sub) {
    if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Ungültiges Abo");
    this.subs = this.subs.filter(s => s.endpoint !== sub.endpoint).concat([{ endpoint: sub.endpoint, keys: sub.keys }]);
    writeJson("push-subs.json", this.subs, this.dir);
  }
  async notifyAll(p: Payload) {
    const data = JSON.stringify(p);
    const gone: string[] = [];
    await Promise.all(this.subs.map(s => this.send(s, data).catch((e: any) => {
      if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint);
      else console.error("Push fehlgeschlagen:", e?.statusCode || e?.message);
    })));
    if (gone.length) {
      this.subs = this.subs.filter(s => !gone.includes(s.endpoint));
      writeJson("push-subs.json", this.subs, this.dir);
    }
  }
}

const PUSH_TEXT: Record<string, string> = { blocked: "wartet auf dich", done: "ist fertig", working: "arbeitet" };
// Nur Projekt und Status, nie Sitzungstitel oder Befehle
export function pushPayload(a: { id: string; project: string }, to: Status): Payload {
  return { title: `${a.project} ${PUSH_TEXT[to] || to}`, body: to === "blocked" ? "Freigabe nötig" : "", pane: a.id };
}

// VAPID-Schlüssel einmal erzeugen und behalten
// subject: https-Adresse der App (oder mailto:), Pflicht für Web Push
export function setupVapid(subject: string): string {
  let k = readJson<{ publicKey: string; privateKey: string } | null>("vapid.json", null);
  if (!k) { k = webpush.generateVAPIDKeys(); writeJson("vapid.json", k); }
  webpush.setVapidDetails(subject, k.publicKey, k.privateKey);
  return k.publicKey;
}
