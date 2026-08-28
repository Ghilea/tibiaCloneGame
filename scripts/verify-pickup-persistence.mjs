const { E2E_TOKEN, E2E_CHARACTER, E2E_ITEM } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER || !E2E_ITEM) {
  throw new Error("E2E_TOKEN, E2E_CHARACTER, and E2E_ITEM are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
const timeout = setTimeout(() => {
  console.error("E2E pickup persistence timeout");
  process.exit(1);
}, 8_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: "pickup-persistence-e2e",
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "welcome") {
    const groundItem = message.ground_items.find((entry) => entry.item.instanceId === E2E_ITEM);
    if (!groundItem) throw new Error("Expected test item on the ground");
    socket.send(JSON.stringify({ type: "pickup_item", instance_id: E2E_ITEM }));
  }
  if (message.type === "inventory_changed") {
    const pickedUp = message.inventory.find((item) => item.instanceId === E2E_ITEM);
    if (pickedUp?.definitionId === "blank_rune") {
      clearTimeout(timeout);
      console.log(`E2E_OK pickup item=${E2E_ITEM}`);
      socket.close();
    }
  }
  if (message.type === "error") {
    throw new Error(`Server error ${message.code}: ${message.message}`);
  }
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error);
  process.exit(1);
});
