const { E2E_TOKEN, E2E_CHARACTER } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER) {
  throw new Error("E2E_TOKEN and E2E_CHARACTER are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
let produced = false;
let trained = false;
const timeout = setTimeout(() => {
  console.error("E2E fletching timeout", { produced, trained });
  process.exit(1);
}, 8_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: "fletching-e2e",
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "welcome") {
    const fiber = message.inventory.find((item) => item.definitionId === "mire_fiber");
    const recipe = message.rune_recipes.find((entry) => entry.id === "fletch_rough_arrows");
    if (fiber?.quantity !== 1 || recipe?.outputQuantity !== 10 || recipe?.craftKind !== "fletching") {
      throw new Error("Fletching material or production recipe is missing");
    }
    socket.send(JSON.stringify({ type: "start_rune_crafting", recipe_id: recipe.id, quantity: 1 }));
  }
  if (message.type === "inventory_changed") {
    produced = !message.inventory.some((item) => item.definitionId === "mire_fiber")
      && message.inventory.find((item) => item.definitionId === "rough_arrow")?.quantity === 10;
  }
  if (message.type === "player_stats_changed" && message.player_id === E2E_CHARACTER) {
    trained = message.fletching_skill === 0 && message.fletching_tries === 1;
  }
  if (produced && trained) {
    clearTimeout(timeout);
    console.log("E2E_OK fletching fiber=0 arrows=10 skill=0+1");
    socket.close();
  }
  if (message.type === "error") console.error("Server error", message.code, message.message);
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error);
  process.exit(1);
});
