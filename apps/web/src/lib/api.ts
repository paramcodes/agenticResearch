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
  sendMessage: (id: string, content: string, depth: ResearchDepth = "standard") =>
    request<{ userMessage: ChatMessage; assistantMessage: ChatMessage; meta?: ResearchMeta }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, depth }),
    }),
  research: (topic: string, conversationId?: string, depth: ResearchDepth = "standard") =>
    request<{ conversationId: string; userMessage: ChatMessage; assistantMessage: ChatMessage; meta?: ResearchMeta }>("/api/agent/research", {
      method: "POST",
      body: JSON.stringify({ topic, conversationId, depth }),
    }),
};

export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchMeta {
  verdict: string;
  revisionCount: number;
  offline: boolean;
}

export interface StreamCallbacks {
  onNode?: (node: string, detail?: string) => void;
  onToken?: (token: string) => void;
  onConversationId?: (id: string) => void;
  signal?: AbortSignal;
}

export interface StreamResult {
  conversationId: string;
  markdown: string;
  meta: ResearchMeta;
}

/** Live research over /ws with token streaming. Rejects on socket errors or
 *  server-side failure so callers can fall back to the HTTP endpoints. */
export function streamResearch(
  topic: string,
  conversationId: string | null,
  depth: ResearchDepth,
  cb: StreamCallbacks = {},
): Promise<StreamResult> {
  const token = getToken();
  if (!token) return Promise.reject(new Error("Not authenticated"));
  // API_URL set (prod) → ws(s):// the api host. Empty (vite dev, where both
  // /api and /ws are proxied) → same-origin ws.
  const wsBase = API_URL
    ? API_URL.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(err);
      }
    };
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    const timeout = window.setTimeout(() => fail(new Error("Research timed out (120s)") ), 120_000);
    let markdown = "";
    let activeId: string | null = conversationId;
    let meta: ResearchMeta = { verdict: "", revisionCount: 0, offline: false };

    if (cb.signal) {
      cb.signal.addEventListener("abort", () => fail(new Error("Cancelled")), { once: true });
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "research", topic, conversationId, depth }));
    };
    ws.onerror = () => fail(new Error("Realtime connection failed"));
    ws.onclose = (e) => {
      if (!settled && !e.wasClean) fail(new Error("Realtime connection closed"));
      else if (!settled) fail(new Error("Research ended without a result"));
    };
    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === "token" && typeof msg.token === "string") {
        if (typeof msg.conversationId === "string") cb.onConversationId?.(msg.conversationId);
        markdown += msg.token;
        cb.onToken?.(msg.token);
      } else if (msg.type === "node" && typeof msg.node === "string") {
        if (typeof msg.conversationId === "string") cb.onConversationId?.(msg.conversationId);
        cb.onNode?.(msg.node, typeof msg.detail === "string" ? msg.detail : undefined);
      } else if (msg.type === "result") {
        activeId = typeof msg.conversationId === "string" ? msg.conversationId : activeId;
        if (typeof msg.markdown === "string") markdown = msg.markdown;
        meta = {
          verdict: typeof msg.verdict === "string" ? msg.verdict : "",
          revisionCount: typeof msg.revisionCount === "number" ? msg.revisionCount : 0,
          offline: msg.offline === true,
        };
        settled = true;
        window.clearTimeout(timeout);
        ws.close();
        if (!activeId) reject(new Error("Research ended without a conversation"));
        else resolve({ conversationId: activeId, markdown, meta });
      } else if (msg.type === "error") {
        fail(new Error(typeof msg.error === "string" ? msg.error : "Research failed"));
      }
    };
  });
}
