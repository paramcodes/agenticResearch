import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChatMessage, type ConversationSummary } from "../lib/api";
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

export function Agent() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = topic.trim();
    if (!content || loading) return;
    setError(null);
    setLoading(true);
    try {
      if (activeId) {
        const { userMessage, assistantMessage } = await api.sendMessage(activeId, content);
        setMessages((m) => [...m, userMessage, assistantMessage]);
      } else {
        const res = await api.research(content);
        setActiveId(res.conversationId);
        setMessages([res.userMessage, res.assistantMessage]);
      }
      setTopic("");
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async (msg: ChatMessage) => {
    const content = editDraft.trim();
    if (!content || loading || !activeId) return;
    setLoading(true);
    setError(null);
    try {
      const { userMessage, assistantMessage } = await api.sendMessage(activeId, content);
      // Replace the edited user message in place, drop everything after it
      // (it belonged to the old prompt), then append the fresh answer.
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        const head = idx >= 0 ? prev.slice(0, idx) : prev;
        return [...head, userMessage, assistantMessage];
      });
      setEditingId(null);
      setEditDraft("");
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
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
              <p className="muted">Ask anything — the agents return markdown you can keep.</p>
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
            <button className="send-btn" type="submit" disabled={loading || !topic.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </form>
          {loading && (
            <div className="progress" role="status" aria-label="Researching">
              <div className="progress-bar" />
              <p className="muted small">Agents are researching… this takes a few seconds.</p>
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
                  <Markdown content={m.content} />
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
