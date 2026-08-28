const { E2E_TOKEN, E2E_CHARACTER } = process.env;
if (!E2E_TOKEN || !E2E_CHARACTER) throw new Error("E2E_TOKEN and E2E_CHARACTER are required");

let stage = "learn";
let inventoryConfirmed = false;
let spellsConfirmed = false;
const timeout = setTimeout(() => fail("E2E spell trainer timeout"), 10_000);

function connect() {
  const socket = new WebSocket("ws://127.0.0.1:4000/ws");
  socket.addEventListener("open", () => socket.send(JSON.stringify({
    type: "hello",
    protocol_version: 10,
    client_version: `spell-trainer-e2e-${stage}`,
    session_token: E2E_TOKEN,
    character_id: E2E_CHARACTER,
  })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error") fail(`Server error ${message.code}: ${message.message}`);
    if (message.type === "welcome" && stage === "learn") {
      const trainer = message.npcs.find((npc) => npc.id === "seraphine_arcanist");
      const spell = message.spells.find((definition) => definition.id === "ember_bolt");
      if (trainer?.service !== "spell_trainer" || !trainer.spellIds.includes("ember_bolt") || spell?.manaCost !== 18 || totalGold(message.inventory) !== 20) {
        fail(`Unexpected spell trainer welcome: ${JSON.stringify({ trainer, spell, gold: totalGold(message.inventory) })}`);
      }
      socket.send(JSON.stringify({ type: "learn_spell", npc_id: trainer.id, spell_id: spell.id }));
    } else if (message.type === "inventory_changed" && stage === "learn") {
      inventoryConfirmed = totalGold(message.inventory) === 5;
      reconnectWhenConfirmed(socket);
    } else if (message.type === "spells_changed" && stage === "learn") {
      spellsConfirmed = message.learned_spell_ids.includes("ember_bolt");
      reconnectWhenConfirmed(socket);
    } else if (message.type === "welcome" && stage === "reconnect") {
      if (!message.learned_spell_ids.includes("ember_bolt") || totalGold(message.inventory) !== 5) fail("Learned spell or payment did not persist");
      clearTimeout(timeout);
      console.log("E2E_OK trainer=Seraphine spell=ember_bolt gold=5 persisted=true");
      socket.close();
    }
  });
  socket.addEventListener("error", () => fail("WebSocket connection failed"));
}

function reconnectWhenConfirmed(socket) {
  if (!inventoryConfirmed || !spellsConfirmed) return;
  stage = "reconnect";
  socket.addEventListener("close", connect, { once: true });
  socket.close();
}

function totalGold(inventory) {
  return inventory.filter((item) => item.definitionId === "gold_coin").reduce((sum, item) => sum + item.quantity, 0);
}

function fail(message) {
  clearTimeout(timeout);
  console.error(message);
  process.exit(1);
}

connect();
