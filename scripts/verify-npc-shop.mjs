const { E2E_TOKEN, E2E_CHARACTER } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER) {
  throw new Error("E2E_TOKEN and E2E_CHARACTER are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
const timeout = setTimeout(() => {
  console.error("E2E NPC shop timeout");
  process.exit(1);
}, 8_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: "npc-shop-e2e",
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "welcome") {
    const mara = message.npcs.find((npc) => npc.id === "mara_quartermaster");
    const arrowOffer = mara?.offers.find((offer) => offer.id === "rough_arrows");
    const gold = total(message.inventory, "gold_coin");
    if (mara?.position.x !== 9 || mara?.position.y !== 8 || arrowOffer?.quantity !== 10 || arrowOffer?.price !== 3 || gold !== 5) {
      throw new Error(`Unexpected NPC shop welcome state: ${JSON.stringify({ mara, gold })}`);
    }
    socket.send(JSON.stringify({
      type: "buy_from_npc",
      npc_id: mara.id,
      offer_id: arrowOffer.id,
      quantity: 1,
    }));
  }
  if (message.type === "inventory_changed") {
    const gold = total(message.inventory, "gold_coin");
    const arrows = total(message.inventory, "rough_arrow");
    if (gold === 2 && arrows === 10) {
      clearTimeout(timeout);
      console.log("E2E_OK npc=Mara gold=2 rough_arrows=10");
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

function total(inventory, definitionId) {
  return inventory
    .filter((item) => item.definitionId === definitionId)
    .reduce((sum, item) => sum + item.quantity, 0);
}
