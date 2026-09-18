import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamResearch, type ChatMessage, type ConversationSummary, type ResearchDepth } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { gsap } from "gsap";

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
const PAGE_SIZE = 50;

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
  const [pagination, setPagination] = useState<{ page: number; totalMessages: number; hasMore: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const writerRuns = useRef(0);
  // True while the user has scrolled up to read — streaming must not yank
  // the view away from them.
  const stickToBottom = useRef(true);
  // True while older messages are being prepended — suppresses autoscroll
  // and the new-message entrance animation for that update.
  const prepending = useRef(false);

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

  // Follow the newest message only while the user sits at the bottom.
  // Skipped when prepending history; instant (not smooth) while streaming
  // so tokens don't queue janky animations.
  useEffect(() => {
    if (prepending.current) {
      prepending.current = false;
      return;
    }
    if (!stickToBottom.current) return;
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: loading ? "auto" : "smooth" });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" });
    }
  }, [messages, loading]);

  const onThreadScroll = () => {
    const thread = threadRef.current;
    if (!thread) return;
    stickToBottom.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  };

  const changeDepth = (d: ResearchDepth) => {
    setDepth(d);
    localStorage.setItem("researcherit.depth", d);
  };

  // Hero entrance: transforms + opacity only, cleaned up via gsap.context.
  useEffect(() => {
    if (hasMessages) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-anim]", {
        y: 24,
        autoAlpha: 0,
        duration: 0.7,
        ease: "power2.out",
        stagger: 0.08,
      });
    }, rootRef);
    return () => ctx.revert();
  }, [hasMessages]);

  // New-message entrance: only the latest bubble, transforms only.
  useEffect(() => {
    if (prepending.current || messages.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const thread = rootRef.current?.querySelector(".thread");
    const items = thread?.querySelectorAll(".msg");
    const last = items?.[items.length - 1];
    if (last) {
      gsap.fromTo(
        last,
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out", overwrite: true },
      );
    }
  }, [messages.length]);

  const openConversation = async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
      // Page 1 = newest messages; older pages prepend above.
      const { conversation, pagination: pag } = await api.getConversation(id, 1, PAGE_SIZE);
      setMessages(conversation.messages);
      setPagination({ page: pag.page, totalMessages: pag.totalMessages, hasMore: pag.hasMore });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadOlderMessages = async () => {
    if (!activeId || !pagination?.hasMore || loading) return;
    const nextPage = pagination.page + 1;
    try {
      const { conversation, pagination: pag } = await api.getConversation(activeId, nextPage, PAGE_SIZE);
      prepending.current = true;
      setMessages((prev) => [...conversation.messages, ...prev]);
      setPagination({ page: pag.page, totalMessages: pag.totalMessages, hasMore: pag.hasMore });
    } catch (err) {
      prepending.current = false;
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
    setPagination(null);
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

  /** Reconcile optimistic tmp messages with server truth (newest page). */
  const reconcile = async (conversationId: string) => {
    setActiveId(conversationId);
    const { conversation, pagination: pag } = await api.getConversation(conversationId, 1, PAGE_SIZE);
    setMessages(conversation.messages);
    setPagination({ page: pag.page, totalMessages: pag.totalMessages, hasMore: pag.hasMore });
    await refreshList();
    // The LLM-upgraded title lands async — pick it up once it settles.
    window.setTimeout(() => void refreshList(), 12_000);
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
      await reconcile(convoId).catch(() => setMessages((m) => [...m, userMessage, assistantMessage]));
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
    stickToBottom.current = true;
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

  const composer = (
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
  );

  return (
    <div className="agent-layout" ref={rootRef}>
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
        {!hasMessages ? (
          <div className="composer-wrap hero">
            <div className="hero-copy">
              <h2 data-anim>What should I research?</h2>
              <p className="muted" data-anim>Planner → Writer → Editor agents return cited markdown you can keep.</p>
            </div>
            <div data-anim className="hero-composer">
              {composer}
            </div>
            {loading && (
              <div className="progress" role="status" aria-label="Researching">
                <div className="progress-bar" />
                <p className="muted small">{phase ?? "Agents are researching… live tokens appear below."}</p>
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        ) : (
          <>
            <div className="thread" ref={threadRef} onScroll={onThreadScroll}>
              {pagination?.hasMore && (
                <button className="load-more-btn" onClick={loadOlderMessages} disabled={loading}>
                  Load older messages
                </button>
              )}
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
            <div className="composer-wrap docked">
              {loading && (
                <div className="progress" role="status" aria-label="Researching">
                  <div className="progress-bar" />
                  <p className="muted small">{phase ?? "Agents are researching… live tokens appear below."}</p>
                </div>
              )}
              {error && <div className="error">{error}</div>}
              {composer}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
