import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamResearch, type ChatMessage, type ConversationSummary, type ResearchDepth } from "../lib/api";
import { Markdown } from "../components/Markdown";

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11.5 21 3l-8.5 18-2.3-7.2L3 11.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.2 13.8 21 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const tmpId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();

function phaseText(node: string, writerRuns: number): string {
  switch (node) {
    case "starting":
      return "Starting agents…";
    case "planner":
      return "Planning from live sources…";
    case "writer":
      return writerRuns > 1 ? `Revising draft (pass ${writerRuns})…` : "Writing…";
    case "editor":
      return "Editing…";
    default:
      return "Researching…";
  }
}

export function Agent() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>(
    () => (localStorage.getItem("researcherit.depth") as ResearchDepth) || "standard",
  );
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const writerRuns = useRef(0);

  const hasMessages = messages.length > 0;

  const refreshList = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      setConversations(conversations);
    } catch {
      // sidebar stays as-is on transient errors
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const changeDepth = (d: ResearchDepth) => {
    setDepth(d);
    localStorage.setItem("researcherit.depth", d);
  };

  const openConversation = async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
      const { conversation } = await api.getConversation(id);
      setMessages(conversation.messages);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setTopic("");
    setError(null);
    setEditingId(null);
    setPhase(null);
  };

  const removeConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      if (activeId === id) newChat();
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Reconcile optimistic tmp messages with server truth. */
  const reconcile = async (conversationId: string) => {
    setActiveId(conversationId);
    const { conversation } = await api.getConversation(conversationId);
    setMessages(conversation.messages);
    await refreshList();
  };

  /**
   * Primary path: stream tokens over /ws into a live assistant bubble.
   * Throws only when nothing was produced (connection-level failure) so the
   * caller can fall back to HTTP. Mid-stream failures reconcile instead —
   * the server already persisted the user message.
   */
  const runStream = async (content: string, convoId: string | null, asstTmpId: string) => {
    writerRuns.current = 0;
    let sawFrames = false;
    let seenId: string | null = convoId;
    const res = await streamResearch(content, convoId, depth, {
      onNode: (node) => {
        sawFrames = true;
        if (node === "writer") writerRuns.current += 1;
        setPhase(phaseText(node, writerRuns.current));
      },
      onToken: (t) => {
        sawFrames = true;
        setPhase(null);
        setMessages((m) => m.map((x) => (x.id === asstTmpId ? { ...x, content: x.content + t } : x)));
      },
      onConversationId: (id) => {
        seenId = id;
      },
    }).catch(async (err) => {
      if (sawFrames && seenId) {
        // Server got the request; show what persisted instead of duplicating.
        await reconcile(seenId).catch(() => undefined);
        throw new Error(`${(err as Error).message} — kept what the server saved.`);
      }
      throw err;
    });
    await reconcile(res.conversationId);
    return res;
  };

  /** Fallback path: plain HTTP request/response (also the offline safety net). */
  const runHttp = async (content: string, convoId: string | null) => {
    if (convoId) {
      const { userMessage, assistantMessage } = await api.sendMessage(convoId, content, depth);
      setMessages((m) => [...m, userMessage, assistantMessage]);
    } else {
      const res = await api.research(content, undefined, depth);
      setActiveId(res.conversationId);
      setMessages([res.userMessage, res.assistantMessage]);
    }
    await refreshList();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = topic.trim();
    if (!content || loading) return;
    setError(null);
    setLoading(true);
    setPhase("Starting agents…");
    const userTmp: ChatMessage = { id: tmpId("tmp-u"), role: "user", content, createdAt: nowIso() };
    const asstTmp: ChatMessage = { id: tmpId("tmp-a"), role: "assistant", content: "", createdAt: nowIso() };
    setMessages((m) => [...m, userTmp, asstTmp]);
    try {
      await runStream(content, activeId, asstTmp.id);
      setTopic("");
    } catch {
      // Streaming unavailable → drop the optimistic bubbles, use HTTP once.
      setMessages((m) => m.filter((x) => x.id !== userTmp.id && x.id !== asstTmp.id));
      try {
        await runHttp(content, activeId);
        setTopic("");
      } catch (err) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
      setPhase(null);
    }
  };

  const saveEdit = async (msg: ChatMessage) => {
    const content = editDraft.trim();
    if (!content || loading || !activeId) return;
    setLoading(true);
    setError(null);
    setPhase("Starting agents…");
    const convoId = activeId;
    const userTmp: ChatMessage = { id: tmpId("tmp-u"), role: "user", content, createdAt: nowIso() };
    const asstTmp: ChatMessage = { id: tmpId("tmp-a"), role: "assistant", content: "", createdAt: nowIso() };
    // Replace the edited message in place; everything after it belonged to
    // the old prompt.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      const head = idx >= 0 ? prev.slice(0, idx) : prev;
      return [...head, userTmp, asstTmp];
    });
    setEditingId(null);
    setEditDraft("");
    try {
      await runStream(content, convoId, asstTmp.id);
    } catch {
      setMessages((m) => m.filter((x) => x.id !== userTmp.id && x.id !== asstTmp.id));
      try {
        const { userMessage, assistantMessage } = await api.sendMessage(convoId, content, depth);
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msg.id);
          const head = idx >= 0 ? prev.slice(0, idx) : prev;
          return [...head, userMessage, assistantMessage];
        });
        await refreshList();
      } catch (err) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
      setPhase(null);
    }
  };

  return (
    <div className="agent-layout">
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-head">
          {sidebarOpen && (
            <>
              <button className="btn btn-primary btn-sm" onClick={newChat}>
                + New research
              </button>
              <button className="icon-btn" onClick={() => setSidebarOpen(false)} aria-label="Minimize history">
                ◀
              </button>
            </>
          )}
          {!sidebarOpen && (
            <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open history">
              ▶
            </button>
          )}
        </div>
        {sidebarOpen && (
          <ul className="history">
            {conversations.map((c) => (
              <li key={c.id} className={c.id === activeId ? "active" : ""}>
                <button className="history-title" onClick={() => openConversation(c.id)} title={c.title}>
                  {c.title}
                </button>
                <button className="history-del" onClick={() => removeConversation(c.id)} aria-label="Delete conversation">
                  ✕
                </button>
              </li>
            ))}
            {conversations.length === 0 && <li className="muted small">No conversations yet.</li>}
          </ul>
        )}
      </aside>

      <main className="chat">
        <div className={`composer-wrap ${hasMessages ? "docked" : "hero"}`}>
          {!hasMessages && (
            <div className="hero-copy">
              <h2>What should I research?</h2>
              <p className="muted">Planner → Writer → Editor agents return cited markdown you can keep.</p>
            </div>
          )}
          <form className="composer" onSubmit={submit}>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Solid-state batteries: state of the art in 2026"
              aria-label="Research topic"
              disabled={loading}
            />
            <select
              className="depth-select"
              value={depth}
              onChange={(e) => changeDepth(e.target.value as ResearchDepth)}
              aria-label="Research depth"
              disabled={loading}
              title="Research depth: sources + length"
            >
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </select>
            <button className="send-btn" type="submit" disabled={loading || !topic.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </form>
          {loading && (
            <div className="progress" role="status" aria-label="Researching">
              <div className="progress-bar" />
              <p className="muted small">{phase ?? "Agents are researching… live tokens appear below."}</p>
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </div>

        {hasMessages && (
          <div className="thread">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg msg-user">
                  {editingId === m.id ? (
                    <div className="edit-box">
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} />
                      <div className="edit-actions">
                        <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => saveEdit(m)}>
                          Re-run
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{m.content}</p>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditDraft(m.content);
                        }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div key={m.id} className="msg msg-assistant">
                  {m.content ? (
                    <Markdown content={m.content} />
                  ) : (
                    <p className="muted small">Agents are writing…</p>
                  )}
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </main>
    </div>
  );
}
