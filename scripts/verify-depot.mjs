const { E2E_TOKEN, E2E_CHARACTER } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER) {
  throw new Error("E2E_TOKEN and E2E_CHARACTER are required");
}

let stage = "deposit";
let itemId;
let inventoryMoved = false;
let depotMoved = false;
const timeout = setTimeout(() => {
  console.error("E2E depot timeout", { stage, itemId, inventoryMoved, depotMoved });
  process.exit(1);
}, 12_000);

connect();

function connect() {
  const socket = new WebSocket("ws://127.0.0.1:4000/ws");
  socket.addEventListener("open", () => socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: `depot-e2e-${stage}`,
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  })));
  socket.addEventListener("message", (event) => handle(socket, JSON.parse(event.data)));
  socket.addEventListener("error", (error) => {
    console.error("WebSocket error", error);
    process.exit(1);
  });
}

function handle(socket, message) {
  if (message.type === "welcome") {
    const aldren = message.npcs.find((npc) => npc.id === "aldren_vaultkeeper" && npc.service === "depot");
    if (!aldren) throw new Error("Greyhaven vaultkeeper is missing");
    if (stage === "deposit") {
      const backpack = message.inventory.find((item) => item.definitionId === "field_backpack");
      if (!backpack) throw new Error("Field Backpack is missing from inventory");
      itemId = backpack.instanceId;
      socket.send(JSON.stringify({ type: "move_request", sequence: 1, position: { x: 9, y: 9, z: 7 } }));
    } else {
      const stored = message.depot.find((item) => item.instanceId === itemId);
      if (!stored || message.inventory.some((item) => item.instanceId === itemId)) {
        throw new Error("Deposited item did not survive reconnect");
      }
      socket.send(JSON.stringify({ type: "withdraw_item", npc_id: aldren.id, instance_id: itemId }));
    }
  }
  if (stage === "deposit" && message.type === "player_moved" && message.player_id === E2E_CHARACTER) {
    if (message.sequence === 1) {
      setTimeout(() => socket.send(JSON.stringify({ type: "move_request", sequence: 2, position: { x: 8, y: 8, z: 7 } })), 120);
    } else if (message.sequence === 2) {
      socket.send(JSON.stringify({ type: "deposit_item", npc_id: "aldren_vaultkeeper", instance_id: itemId }));
    }
  }
  if (message.type === "inventory_changed") {
    inventoryMoved = stage === "deposit"
      ? !message.inventory.some((item) => item.instanceId === itemId)
      : message.inventory.some((item) => item.instanceId === itemId);
  }
  if (message.type === "depot_changed") {
    depotMoved = stage === "deposit"
      ? message.depot.some((item) => item.instanceId === itemId)
      : !message.depot.some((item) => item.instanceId === itemId);
  }
  if (inventoryMoved && depotMoved) {
    socket.close();
    if (stage === "deposit") {
      stage = "withdraw";
      inventoryMoved = false;
      depotMoved = false;
      setTimeout(connect, 300);
    } else {
      clearTimeout(timeout);
      console.log(`E2E_OK depot item=${itemId} reconnect=verified`);
    }
  }
  if (message.type === "error") {
    throw new Error(`Server error ${message.code}: ${message.message}`);
  }
}
