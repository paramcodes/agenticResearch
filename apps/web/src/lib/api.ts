export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";

const TOKEN_KEY = "researcherit.token";
const REFRESH_TOKEN_KEY = "researcherit.refreshToken";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}
export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
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

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("No refresh token available");

  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    // Refresh token is invalid or expired
    setToken(null);
    setRefreshToken(null);
    throw new Error("Session expired. Please login again.");
  }

  const data = await res.json() as { user: PublicUser; token: string; refreshToken: string };
  setToken(data.token);
  setRefreshToken(data.refreshToken);
  return data.token;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let token = getToken();

  const makeRequest = async (accessToken: string | null) => {
    return await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(opts.headers || {}),
      },
    });
  };

  let res = await makeRequest(token);

  // Handle 401 errors with token refresh
  if (res.status === 401 && token) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        isRefreshing = false;
        onTokenRefreshed(newToken);
        token = newToken;
      } catch (err) {
        isRefreshing = false;
        throw err;
      }
    } else {
      // Wait for the ongoing refresh to complete
      await new Promise((resolve) => {
        subscribeTokenRefresh((newToken: string) => {
          token = newToken;
          resolve(null);
        });
      });
    }
    // Retry the request with the new token
    res = await makeRequest(token);
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  register: (b: { name: string; email: string; username?: string; password: string }) =>
    request<{ user: PublicUser; token: string; refreshToken: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { identifier: string; password: string }) =>
    request<{ user: PublicUser; token: string; refreshToken: string }>("/api/auth/login", { method: "POST", body: JSON.stringify(b) }),
  google: (credential: string) =>
    request<{ user: PublicUser; token: string; refreshToken: string }>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
  me: () => request<{ user: PublicUser }>("/api/auth/me"),
  updateProfile: (b: { name?: string; email?: string; username?: string | null }) =>
    request<{ user: PublicUser }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(b) }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(b) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  listConversations: () => request<{ conversations: ConversationSummary[] }>("/api/conversations"),
  getConversation: (id: string, page?: number, limit?: number) => {
    const qs = new URLSearchParams();
    if (page) qs.set("page", String(page));
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    return request<{
      conversation: { id: string; title: string; status: string; messages: ChatMessage[]; createdAt: string; updatedAt: string };
      pagination: { page: number; limit: number; totalMessages: number; totalPages: number; hasMore: boolean };
    }>(`/api/conversations/${id}${suffix}`);
  },
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
