export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";

const TOKEN_KEY = "researcherit.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
  provider: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  register: (b: { name: string; email: string; username?: string; password: string }) =>
    request<{ user: PublicUser; token: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { identifier: string; password: string }) =>
    request<{ user: PublicUser; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify(b) }),
  google: (credential: string) =>
    request<{ user: PublicUser; token: string }>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
  me: () => request<{ user: PublicUser }>("/api/auth/me"),
  updateProfile: (b: { name?: string; email?: string; username?: string | null }) =>
    request<{ user: PublicUser }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(b) }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(b) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  listConversations: () => request<{ conversations: ConversationSummary[] }>("/api/conversations"),
  getConversation: (id: string) =>
    request<{ conversation: { id: string; title: string; status: string; messages: ChatMessage[] } }>(`/api/conversations/${id}`),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  sendMessage: (id: string, content: string) =>
    request<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  research: (topic: string, conversationId?: string) =>
    request<{ conversationId: string; userMessage: ChatMessage; assistantMessage: ChatMessage }>("/api/agent/research", {
      method: "POST",
      body: JSON.stringify({ topic, conversationId }),
    }),
};
