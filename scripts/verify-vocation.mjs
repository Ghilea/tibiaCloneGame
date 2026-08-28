const { E2E_TOKEN, E2E_CHARACTER, E2E_VOCATION, E2E_HEALTH, E2E_MANA, E2E_CAPACITY, E2E_EXPECT_CRAFT_DENIED } = process.env;

if (!E2E_TOKEN || !E2E_CHARACTER || !E2E_VOCATION || !E2E_HEALTH || !E2E_MANA || !E2E_CAPACITY) {
  throw new Error("E2E_TOKEN, E2E_CHARACTER, E2E_VOCATION, E2E_HEALTH, E2E_MANA, and E2E_CAPACITY are required");
}

const socket = new WebSocket("ws://127.0.0.1:4000/ws");
const timeout = setTimeout(() => {
  console.error("E2E vocation timeout");
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
    const actual = {
      vocation: message.player.vocation,
      health: message.player.maxHealth,
      mana: message.player.maxMana,
      capacity: message.max_capacity,
    };
    const expected = {
      vocation: E2E_VOCATION,
      health: Number(E2E_HEALTH),
      mana: Number(E2E_MANA),
      capacity: Number(E2E_CAPACITY),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected vocation profile: ${JSON.stringify({ actual, expected })}`);
    }
    if (E2E_EXPECT_CRAFT_DENIED === "1") {
      socket.send(JSON.stringify({ type: "start_rune_crafting", recipe_id: "mark_ember_sigil", quantity: 1 }));
      return;
    }
    finish(actual);
  }
  if (message.type === "error" && message.code === "vocation_cannot_craft_sigils") {
    finish({ vocation: E2E_VOCATION, health: Number(E2E_HEALTH), mana: Number(E2E_MANA), capacity: Number(E2E_CAPACITY) }, " craft=denied");
  }
});

function finish(actual, suffix = "") {
  clearTimeout(timeout);
  console.log(`E2E_OK vocation=${actual.vocation} health=${actual.health} mana=${actual.mana} capacity=${actual.capacity}${suffix}`);
  socket.close();
}

socket.addEventListener("error", (error) => {
  console.error("WebSocket error", error);
  process.exit(1);
});
