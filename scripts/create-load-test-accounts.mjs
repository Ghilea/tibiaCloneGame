#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const count = Number(args.get("players") ?? 100);
const output = args.get("output") ?? "load-test-accounts.json";
const apiUrl = (args.get("api") ?? process.env.LOAD_TEST_API_URL ?? "http://127.0.0.1:4000/api").replace(/\/$/, "");
const password = args.get("password") ?? "LoadTestPassword2026!";
const suffix = Date.now().toString(36);
const characterTag = randomLetters(6);

if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("--players must be between 1 and 10000");
if (password.length < 10) throw new Error("--password must contain at least 10 characters");

async function request(path, init) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.message ?? "request failed"}`);
  return body;
}

const accounts = [];
console.log(`Creating ${count} load-test accounts through ${apiUrl}`);
for (let index = 0; index < count; index += 1) {
  const username = `loadtest_${suffix}_${index}`.slice(0, 24);
  const characterName = `Load${characterTag}${letters(index)}`.slice(0, 20);
  const auth = await request("/auth/register", { method: "POST", body: { username, password } });
  const character = await request("/characters", { method: "POST", token: auth.sessionToken, body: { name: characterName } });
  accounts.push({ sessionToken: auth.sessionToken, characterId: character.id });
  if ((index + 1) % 25 === 0 || index + 1 === count) console.log(`${index + 1}/${count}`);
}

await writeFile(output, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
console.log(`Wrote ${output}`);

function letters(number) {
  let value = "";
  do {
    value = String.fromCharCode(65 + (number % 26)) + value;
    number = Math.floor(number / 26) - 1;
  } while (number >= 0);
  return value;
}

function randomLetters(length) {
  return Array.from({ length }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}
