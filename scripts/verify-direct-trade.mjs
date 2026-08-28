const required = ["E2E_TOKEN", "E2E_PLAYER_A", "E2E_PLAYER_B", "E2E_ITEM_A", "E2E_ITEM_B"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const token = process.env.E2E_TOKEN;
const playerA = process.env.E2E_PLAYER_A;
const playerB = process.env.E2E_PLAYER_B;
const itemA = process.env.E2E_ITEM_A;
const itemB = process.env.E2E_ITEM_B;
const sockets = new Map();
const welcomed = new Set();
const offered = new Set();
const confirmed = new Set();
const received = new Set();
const completed = new Set();
let requestSent = false;

const timeout = setTimeout(() => {
  console.error("Trade E2E timeout", { welcomed: [...welcomed], offered: [...offered], confirmed: [...confirmed], received: [...received], completed: [...completed] });
  process.exit(1);
}, 10_000);

function send(playerId, message) {
  sockets.get(playerId).send(JSON.stringify(message));
}

function connect(playerId) {
  const socket = new WebSocket("ws://127.0.0.1:4000/ws");
  sockets.set(playerId, socket);
  socket.addEventListener("open", () => send(playerId, { type: "hello", protocol_version: 10, client_version: "trade-e2e", session_token: token, character_id: playerId }));
  socket.addEventListener("message", (event) => handle(playerId, JSON.parse(event.data)));
  socket.addEventListener("error", (error) => { console.error("WebSocket error", playerId, error); process.exit(1); });
}

function handle(playerId, message) {
  if (message.type === "welcome") {
    welcomed.add(playerId);
    if (welcomed.size === 2 && !requestSent) {
      requestSent = true;
      send(playerA, { type: "request_trade", target_id: playerB });
    }
  }
  if (message.type === "trade_requested" && playerId === playerB) {
    send(playerB, { type: "respond_trade", trade_id: message.trade_id, accept: true });
  }
  if (message.type === "trade_state" && message.status === "active") {
    const ownItem = playerId === playerA ? itemA : itemB;
    const theirItem = playerId === playerA ? itemB : itemA;
    if (!offered.has(playerId)) {
      offered.add(playerId);
      send(playerId, { type: "set_trade_offer", trade_id: message.trade_id, item_ids: [ownItem] });
      return;
    }
    const hasOwn = message.your_offer.some((item) => item.instanceId === ownItem);
    const hasTheirs = message.their_offer.some((item) => item.instanceId === theirItem);
    if (hasOwn && hasTheirs && !confirmed.has(playerId)) {
      confirmed.add(playerId);
      send(playerId, { type: "confirm_trade", trade_id: message.trade_id });
    }
  }
  if (message.type === "inventory_changed") {
    const expected = playerId === playerA ? itemB : itemA;
    if (message.inventory.some((item) => item.instanceId === expected)) received.add(playerId);
  }
  if (message.type === "trade_closed" && message.reason === "completed") completed.add(playerId);
  if (received.size === 2 && completed.size === 2) {
    clearTimeout(timeout);
    console.log("TRADE_E2E_OK both inventories updated and trade completed");
    for (const socket of sockets.values()) socket.close();
    setTimeout(() => process.exit(0), 100);
  }
  if (message.type === "error") {
    console.error("Trade E2E server error", playerId, message);
    process.exit(1);
  }
}

connect(playerA);
connect(playerB);
