// Verbindung zum herdr-App-Server: fetch-Hilfen und WebSocket mit Neuverbindung.
(function () {
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function req(method, path, body, isForm) {
  const headers = { "X-Herdr-App": "1" };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(path, { method, headers, body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin", redirect: "manual" });
  } catch (_) {
    throw new ApiError(0, "Keine Verbindung zum Server");
  }
  // Cloudflare Access leitet nach Ablauf auf den Login um (redirect manual: opaqueredirect bzw. 3xx)
  if (res.type === "opaqueredirect" || res.status === 401 || (res.status >= 300 && res.status < 400)) {
    window.HerdrApi.authLost();
    throw new ApiError(401, "Anmeldung abgelaufen");
  }
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    // HTML mit 2xx ist die Login-Seite, HTML mit 5xx eine Fehlerseite von Cloudflare
    if (res.ok) { window.HerdrApi.authLost(); throw new ApiError(401, "Anmeldung abgelaufen"); }
    throw new ApiError(res.status, "Server nicht erreichbar (" + res.status + ")");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Fehler " + res.status);
  return data;
}

const get = path => req("GET", path);
const post = (path, body = {}) => req("POST", path, body);
const put = (path, body = {}) => req("PUT", path, body);
const del = path => req("DELETE", path);
const upload = (path, form) => req("POST", path, form, true);

// WebSocket mit Backoff 1, 2, 4, 8, höchstens 15 s
function connect(onMessage, onState) {
  let ws, delay = 1000, stopped = false, fails = 0;
  const open = () => {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { delay = 1000; fails = 0; onState(true); };
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = () => {
      onState(false);
      // Mehrfach gescheitert: per normaler Anfrage prüfen, ob die Anmeldung abgelaufen ist
      if (++fails >= 2) get("/api/settings").catch(() => {});
      if (!stopped) setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ws && ws.readyState > 1) { delay = 1000; open(); }
  });
  return { close() { stopped = true; ws && ws.close(); } };
}
  window.HerdrApi = { ApiError, get, post, put, del, upload, connect, authLost: () => location.reload() };
})();
