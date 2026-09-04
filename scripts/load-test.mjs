#!/usr/bin/env node

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const count = Number(args.get("players") ?? 100);
const durationSeconds = Number(args.get("duration") ?? 30);
const staggerMs = Number(args.get("stagger-ms") ?? 5);
const url = args.get("url") ?? process.env.LOAD_TEST_URL ?? "ws://127.0.0.1:4000/ws";
const protocolVersion = 26;
const clientVersion = "load-test";
const accountsFile = args.get("accounts");

if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("--players must be between 1 and 10000");
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("--duration must be positive");

let credentials = [];
if (accountsFile) {
  try {
    credentials = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(accountsFile, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Accounts file not found: ${accountsFile}. Create it first with: npm run create-load-test-accounts -- --players=${count}`);
    }
    throw error;
  }
}
if (accountsFile && (!Array.isArray(credentials) || credentials.length < count)) {
  throw new Error(`The accounts file must contain at least ${count} entries`);
}

const bots = [];
const stats = { opened: 0, welcomed: 0, rejected: 0, moveRejected: 0, closed: 0, errors: 0, sentMoves: 0, received: 0, receivedMoves: 0, receivedPlayerJoins: 0, receivedPlayerLeaves: 0, pongs: 0, maxLatencyMs: 0, latencySamples: [] };

function botConfig(index) {
  if (accountsFile) {
    const entry = credentials[index];
    if (!entry.sessionToken || !entry.characterId) throw new Error(`Account ${index} needs sessionToken and characterId`);
    return { session_token: entry.sessionToken, character_id: entry.characterId };
  }
  return { character_name: `LoadBot${letters(index)}` };
}

function connectBot(index) {
  const config = botConfig(index);
  const bot = { index, socket: new WebSocket(url), open: false, welcomed: false, position: null, sequence: 0, nextMoveAt: 0, lastPing: 0 };
  bots.push(bot);
  bot.socket.addEventListener("open", () => {
    stats.opened += 1;
    bot.open = true;
    bot.socket.send(JSON.stringify({ type: "hello", protocol_version: protocolVersion, client_version: clientVersion, ...config }));
  });
  bot.socket.addEventListener("message", (event) => {
    stats.received += 1;
    let message;
    try { message = JSON.parse(event.data); } catch { stats.errors += 1; return; }
    if (message.type === "welcome") {
      stats.welcomed += 1;
      bot.welcomed = true;
      bot.id = message.player.id;
      bot.position = message.player.position;
      bot.nextMoveAt = Date.now() + 1_000 + Math.random() * 1_000;
    } else if (message.type === "error") {
      stats.rejected += 1;
    } else if (message.type === "player_moved") {
      stats.receivedMoves += 1;
      if (message.player_id === botId(bot)) bot.position = message.position;
    } else if (message.type === "move_rejected") {
      stats.moveRejected += 1;
      if (message.player_id === botId(bot)) bot.position = message.position;
    } else if (message.type === "player_joined") {
      stats.receivedPlayerJoins += 1;
    } else if (message.type === "player_left") {
      stats.receivedPlayerLeaves += 1;
    } else if (message.type === "pong") {
      stats.pongs += 1;
      const latency = Date.now() - bot.lastPing;
      if (bot.lastPing) {
        stats.maxLatencyMs = Math.max(stats.maxLatencyMs, latency);
        stats.latencySamples.push(latency);
      }
    }
  });
  bot.socket.addEventListener("error", () => { stats.errors += 1; });
  bot.socket.addEventListener("close", () => { stats.closed += 1; bot.open = false; });
}

function botId(bot) {
  return bot.id ?? null;
}

function letters(number) {
  let value = "";
  do {
    value = String.fromCharCode(65 + (number % 26)) + value;
    number = Math.floor(number / 26) - 1;
  } while (number >= 0);
  return value;
}

function sendMove(bot, now) {
  if (!bot.open || !bot.welcomed || !bot.position || now < bot.nextMoveAt) return;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dy] = directions[Math.floor(Math.random() * directions.length)];
  const target = { x: bot.position.x + dx, y: bot.position.y + dy, z: bot.position.z };
  bot.sequence += 1;
  bot.socket.send(JSON.stringify({ type: "move_request", sequence: bot.sequence, position: target }));
  stats.sentMoves += 1;
  bot.position = target;
  bot.nextMoveAt = now + 165 + Math.random() * 35;
}

console.log(`Starting load test: ${count} players, ${durationSeconds}s, ${url}`);
if (!accountsFile) console.log("Mode: anonymous (server must run without DATABASE_URL)");
else console.log(`Mode: authenticated (${accountsFile})`);

for (let index = 0; index < count; index += 1) {
  connectBot(index);
  if (staggerMs > 0) await new Promise((resolve) => setTimeout(resolve, staggerMs));
}

const movementTimer = setInterval(() => {
  const now = Date.now();
  for (const bot of bots) sendMove(bot, now);
}, 25);
const pingTimer = setInterval(() => {
  const now = Date.now();
  for (const bot of bots) {
    if (!bot.open) continue;
    bot.lastPing = now;
    bot.socket.send(JSON.stringify({ type: "ping", sent_at: now }));
  }
}, 3_000);

await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
clearInterval(movementTimer);
clearInterval(pingTimer);
for (const bot of bots) bot.socket.close();
await new Promise((resolve) => setTimeout(resolve, 500));

const sortedLatency = [...stats.latencySamples].sort((a, b) => a - b);
const percentile = (value) => sortedLatency.length ? sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * value))] : 0;
console.log("Load test finished. Summary:");
const { latencySamples: _latencySamples, ...summary } = stats;
console.log(JSON.stringify({ ...summary, latencySamples: sortedLatency.length, latency: { p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: stats.maxLatencyMs } }, null, 2));
if (stats.welcomed !== count) process.exitCode = 1;
