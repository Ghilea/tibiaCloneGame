const { E2E_TOKEN, E2E_CHARACTER } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER) {
  throw new Error("E2E_TOKEN and E2E_CHARACTER are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
let targetId;
let shot = false;
let inventoryChanged = false;
let skillChanged = false;
let attackTimer;
const timeout = setTimeout(() => {
  console.error("E2E ranger timeout", { shot, inventoryChanged, skillChanged });
  process.exit(1);
}, 8_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: "ranger-e2e",
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "welcome") {
    const bow = message.inventory.find((item) => item.definitionId === "ashwood_bow");
    const arrows = message.inventory.find((item) => item.definitionId === "rough_arrow");
    targetId = message.creatures.find((creature) => creature.position.x === 17 && creature.position.y === 8)?.id;
    if (message.player.vocation !== "ranger" || message.player.distanceSkill !== 12
        || bow?.equippedSlot !== "weapon" || arrows?.quantity !== 100 || !targetId) {
      throw new Error("Ranger profile, starter kit, or target is missing");
    }
    if (message.player.position.x === 10) {
      socket.send(JSON.stringify({ type: "move_request", sequence: 1, position: { x: 11, y: 8, z: 7 } }));
    }
    attackTimer = setInterval(() => {
      socket.send(JSON.stringify({ type: "attack_request", target_id: targetId }));
    }, 200);
  }
  if (message.type === "combat_effect" && message.source_id === E2E_CHARACTER
      && message.effect_id === "rough_arrow" && message.damage === 10 && message.cooldown_ms === 750) {
    shot = true;
  }
  if (message.type === "inventory_changed") {
    inventoryChanged = message.inventory.find((item) => item.definitionId === "rough_arrow")?.quantity === 99;
  }
  if (message.type === "player_stats_changed" && message.player_id === E2E_CHARACTER) {
    skillChanged = message.distance_skill === 12 && message.distance_tries === 2;
  }
  if (shot && inventoryChanged && skillChanged) {
    clearTimeout(timeout);
    clearInterval(attackTimer);
    console.log("E2E_OK ranger damage=10 arrows=99 distance=12+2");
    socket.close();
  }
  if (message.type === "error") console.error("Server error", message.code, message.message);
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error);
  process.exit(1);
});
