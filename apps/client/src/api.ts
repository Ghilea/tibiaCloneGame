export type CharacterSummary = {
  id: string;
  name: string;
  vocation: string;
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

export async function createCharacter(token: string, name: string, vocation: string) {
  return request<CharacterSummary>("/characters", { method: "POST", body: JSON.stringify({ name, vocation }) }, token);
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
  return response.json() as Promise<T>;
}
