const api = "https://vampir-koylu-rooms.aurelian-studio.workers.dev";
const response = await fetch(`${api}/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://vampirkoylu.alperensenel.com" },
  body: JSON.stringify({ name: "Kurucu Test" }),
});
if (!response.ok) throw new Error(`Oda oluşturma başarısız: ${response.status}`);
const room = await response.json();

function connect({ clientId, name, hostToken = "" }) {
  const query = new URLSearchParams({ clientId, name });
  if (hostToken) query.set("hostToken", hostToken);
  const socket = new WebSocket(`${api.replace("https", "wss")}/ws/${room.code}?${query}`);
  const messages = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(event.data)));
  return { socket, messages };
}

const waitFor = async (client, predicate, timeout = 7000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const match = client.messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Canlı oda mesajı zaman aşımına uğradı.");
};

const host = connect({ clientId: room.clientId, name: "Kurucu Test", hostToken: room.hostToken });
await waitFor(host, message => message.type === "state" && message.room.players.length === 1);
const guest = connect({ clientId: crypto.randomUUID(), name: "Misafir Test" });
await waitFor(host, message => message.type === "state" && message.room.players.length === 2);
await waitFor(guest, message => message.type === "state" && message.room.players.length === 2);
host.socket.send(JSON.stringify({ type: "start_game", counts: { vampire: 1, villager: 1, doctor: 0, hunter: 0, mayor: 0 } }));
const hostGame = await waitFor(host, message => message.type === "state" && message.room.status === "roles");
const guestGame = await waitFor(guest, message => message.type === "state" && message.room.status === "roles");
if (!hostGame.you.role || !guestGame.you.role || hostGame.you.role === guestGame.you.role) throw new Error("Özel roller beklenen biçimde dağıtılmadı.");
if (hostGame.room.players.some(player => "role" in player)) throw new Error("Gizli rol ortak oda durumuna sızdı.");
console.log(JSON.stringify({ ok: true, code: room.code, players: hostGame.room.players.length, privateRoles: true }));
host.socket.close(1000);guest.socket.close(1000);
