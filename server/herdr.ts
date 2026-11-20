// Client für den herdr-Socket: pro Aufruf eine Verbindung, eine JSON-Zeile hin, eine zurück.
import { homedir } from "os";
import { join } from "path";

export class HerdrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const DEFAULT_SOCKET = process.env.HERDR_SOCKET || join(homedir(), ".config/herdr/herdr.sock");
let seq = 0;

export function call<T = any>(method: string, params: object, opts: { socket?: string; timeoutMs?: number } = {}): Promise<T> {
  const path = opts.socket || DEFAULT_SOCKET;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const id = `app:${++seq}`;
  return new Promise<T>((resolve, reject) => {
    let buf = "";
    let done = false;
    let sock: any = null;
    const finish = (err: HerdrError | null, value?: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock?.end(); } catch {}
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(new HerdrError("timeout", `herdr antwortet nicht (${method})`)), timeoutMs);
    Bun.connect({
      unix: path,
      socket: {
        open(s) { sock = s; s.write(JSON.stringify({ id, method, params }) + "\n"); },
        data(_s, chunk) {
          buf += chunk.toString();
          const nl = buf.indexOf("\n");
          if (nl < 0) return;
          let msg: any;
          try { msg = JSON.parse(buf.slice(0, nl)); } catch { return finish(new HerdrError("bad_response", "Antwort ist kein JSON")); }
          if (msg.error) finish(new HerdrError(msg.error.code || "error", msg.error.message || "Fehler"));
          else finish(null, msg.result);
        },
        close() { finish(new HerdrError("closed", "Verbindung ohne Antwort geschlossen")); },
        error(_s, e) { finish(new HerdrError("unavailable", String(e))); },
        connectError(_s, e) { finish(new HerdrError("unavailable", String(e))); },
      },
    }).catch(e => finish(new HerdrError("unavailable", String(e))));
  });
}
