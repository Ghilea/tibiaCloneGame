const { E2E_TOKEN, E2E_CHARACTER, E2E_SIGIL } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER || !E2E_SIGIL) {
  throw new Error("E2E_TOKEN, E2E_CHARACTER, and E2E_SIGIL are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
let damaged = false;
let inventoryChanged = false;
let combatEffectConfirmed = false;

const timeout = setTimeout(() => {
  console.error("E2E timeout", { damaged, inventoryChanged, combatEffectConfirmed });
  process.exit(1);
}, 8_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: "e2e",
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "welcome") {
    const target = message.creatures.find(
      (creature) => creature.position.x === 17 && creature.position.y === 8,
    );
    const sigil = message.inventory.find((item) => item.instanceId === E2E_SIGIL);
    if (!target || sigil?.charges !== 2) {
      throw new Error("The E2E target or two-charge sigil is missing");
    }
    socket.send(JSON.stringify({
      type: "use_item",
      instance_id: sigil.instanceId,
      target_id: target.id,
    }));
  }
  if (message.type === "creature_damaged" && message.damage === 12) {
    damaged = true;
  }
  if (message.type === "combat_effect"
      && message.source_id === E2E_CHARACTER
      && message.effect_id === "ember_rune"
      && message.damage === 12
      && message.cooldown_ms === 800) {
    combatEffectConfirmed = true;
  }
  if (message.type === "inventory_changed") {
    const sigil = message.inventory.find((item) => item.instanceId === E2E_SIGIL);
    if (sigil?.charges === 1) inventoryChanged = true;
  }
  if (damaged && inventoryChanged && combatEffectConfirmed) {
    clearTimeout(timeout);
    console.log("E2E_OK damage=12 health=8 charges=1");
    socket.close();
  }
});

socket.addEventListener("close", () => {
  if (damaged && inventoryChanged && combatEffectConfirmed) process.exit(0);
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error);
  process.exit(1);
});
