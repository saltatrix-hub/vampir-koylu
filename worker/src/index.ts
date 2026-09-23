import { DurableObject } from "cloudflare:workers";

type Role = "vampire" | "villager" | "doctor" | "hunter" | "mayor";
type Player = { id: string; name: string; connected: boolean; role?: Role };
type RoomState = { code: string; hostId: string; hostToken: string; status: "lobby" | "roles"; players: Player[]; counts?: Record<Role, number> };

const allowedOrigins = new Set(["https://vampirkoylu.alperensenel.com", "http://127.0.0.1:4173", "http://localhost:4173"]);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://vampirkoylu.alperensenel.com",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});
const json = (data: unknown, status = 200, origin: string | null = null) => Response.json(data, { status, headers: cors(origin) });
const cleanName = (value: unknown) => String(value ?? "").trim().slice(0, 18);
const makeCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
};
const shuffle = <T>(items: T[]) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const bytes = crypto.getRandomValues(new Uint32Array(1));
    const swapIndex = bytes[0] % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, origin);
    if (request.method === "POST" && url.pathname === "/rooms") {
      const body: { name?: string } = await request.json<{ name?: string }>().catch(() => ({}));
      const name = cleanName(body.name);
      if (name.length < 2) return json({ error: "Geçerli bir oyuncu adı gerekli." }, 400, origin);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = makeCode(), room = env.ROOMS.getByName(code), result = await room.createRoom(code, name);
        if (result.ok) return json(result, 201, origin);
      }
      return json({ error: "Oda kodu üretilemedi. Tekrar dene." }, 503, origin);
    }
    const match = url.pathname.match(/^\/ws\/([A-Z0-9]{6})$/);
    if (request.method === "GET" && match) return env.ROOMS.getByName(match[1]).fetch(request);
    return json({ error: "Bulunamadı." }, 404, origin);
  },
} satisfies ExportedHandler<Env>;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)");
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private read(): RoomState | null {
    const row = this.ctx.storage.sql.exec<{ json: string }>("SELECT json FROM room_state WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.json) as RoomState : null;
  }

  private write(state: RoomState): void {
    this.ctx.storage.sql.exec("INSERT INTO room_state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json", JSON.stringify(state));
  }

  async createRoom(code: string, hostName: string): Promise<{ ok: boolean; code?: string; clientId?: string; hostToken?: string }> {
    if (this.read()) return { ok: false };
    const clientId = crypto.randomUUID(), hostToken = crypto.randomUUID();
    this.write({ code, hostId: clientId, hostToken, status: "lobby", players: [{ id: clientId, name: hostName, connected: false }] });
    return { ok: true, code, clientId, hostToken };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket gerekli", { status: 426 });
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins.has(origin)) return new Response("İzin verilmeyen kaynak", { status: 403 });
    const state = this.read();
    if (!state) return new Response("Oda bulunamadı", { status: 404 });
    const url = new URL(request.url), clientId = url.searchParams.get("clientId") ?? "", name = cleanName(url.searchParams.get("name")), hostToken = url.searchParams.get("hostToken");
    if (!clientId || name.length < 2) return new Response("Eksik oyuncu bilgisi", { status: 400 });
    let player = state.players.find(item => item.id === clientId);
    if (!player) {
      if (state.status !== "lobby") return new Response("Oyun başladı", { status: 409 });
      if (state.players.length >= 20) return new Response("Oda dolu", { status: 409 });
      if (state.players.some(item => item.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) return new Response("Bu isim kullanımda", { status: 409 });
      player = { id: clientId, name, connected: true };
      state.players.push(player);
    } else {
      if (player.id === state.hostId && hostToken !== state.hostToken) return new Response("Kurucu anahtarı geçersiz", { status: 403 });
      player.connected = true;
    }
    this.write(state);
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ clientId });
    this.broadcast(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 4096) return;
    const attachment = socket.deserializeAttachment() as { clientId?: string } | null, state = this.read();
    if (!state || !attachment?.clientId) return;
    const sender = state.players.find(player => player.id === attachment.clientId);
    if (!sender) return;
    let data: { type?: string; counts?: Partial<Record<Role, number>> };
    try { data = JSON.parse(message) as typeof data; } catch { return; }
    if (data.type === "start_game" && sender.id === state.hostId && state.status === "lobby") {
      const roles: Role[] = ["vampire", "villager", "doctor", "hunter", "mayor"];
      const counts = Object.fromEntries(roles.map(role => [role, Math.max(0, Math.min(10, Math.floor(Number(data.counts?.[role] ?? 0))))])) as Record<Role, number>;
      if (counts.vampire < 1 || Object.values(counts).reduce((sum, count) => sum + count, 0) !== state.players.length) {
        socket.send(JSON.stringify({ type: "error", message: "Rol sayıları oyuncu sayısıyla eşleşmiyor." }));
        return;
      }
      const deck = shuffle(roles.flatMap(role => Array<Role>(counts[role]).fill(role)));
      state.players.forEach((player, index) => { player.role = deck[index]; });
      state.counts = counts; state.status = "roles";
      this.write(state); this.broadcast(state);
    }
    if (data.type === "reset" && sender.id === state.hostId) {
      state.status = "lobby"; state.counts = undefined; state.players.forEach(player => { delete player.role; });
      this.write(state); this.broadcast(state);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as { clientId?: string } | null, state = this.read();
    if (!state || !attachment?.clientId) return;
    const player = state.players.find(item => item.id === attachment.clientId);
    if (player) { player.connected = false; this.write(state); this.broadcast(state); }
  }

  private broadcast(state: RoomState): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { clientId?: string } | null;
      const you = state.players.find(player => player.id === attachment?.clientId);
      if (!you) continue;
      const payload = { type: "state", room: { code: state.code, status: state.status, players: state.players.map(player => ({ id: player.id, name: player.name, connected: player.connected })), counts: state.counts }, you: { id: you.id, name: you.name, role: you.role, isHost: you.id === state.hostId } };
      try { socket.send(JSON.stringify(payload)); } catch { /* disconnected sockets are cleaned up by the runtime */ }
    }
  }
}
