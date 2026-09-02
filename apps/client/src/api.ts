export type CharacterSummary = {
  id: string;
  name: string;
  outfit: import("./protocol").CharacterOutfit;
  level: number;
  position: { x: number; y: number; z: number };
};

type AuthResponse = { sessionToken: string; accountId: string };

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000/api";

export class ApiFailure extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export async function authenticate(mode: "login" | "register", username: string, password: string) {
  return request<AuthResponse>(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ username, password }) });
}

export async function listCharacters(token: string) {
  return request<{ characters: CharacterSummary[] }>("/characters", {}, token);
}

export async function createCharacter(token: string, name: string) {
  return request<CharacterSummary>("/characters", { method: "POST", body: JSON.stringify({ name }) }, token);
}

export async function deleteCharacter(token: string, characterId: string) {
  return request<void>(`/characters/${encodeURIComponent(characterId)}`, { method: "DELETE" }, token);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: "network_error", message: `HTTP ${response.status}` }));
    throw new ApiFailure(body.code ?? "request_failed", body.message ?? "The request failed", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
