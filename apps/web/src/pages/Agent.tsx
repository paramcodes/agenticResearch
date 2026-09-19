import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, streamResearch, type ChatMessage, type ConversationSummary, type ResearchDepth, type ResearchMeta } from "../lib/api";
import { Markdown, getSources } from "../components/Markdown";
import { useAuth } from "../lib/auth";

/* ── Types (ported from the Figma "Researcher" design) ── */

type StepKind = "thinking" | "searching" | "reading" | "synthesizing" | "done";
type AgentStatus = "thinking" | "searching" | "reading" | "synthesizing" | "done";

interface ReasoningStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
}

const STEP_STYLE: Record<StepKind, { bg: string; text: string; dot: string }> = {
  thinking: { bg: "rgba(223,168,143,0.18)", text: "#8a5240", dot: "#dfa88f" },
  searching: { bg: "rgba(159,201,162,0.18)", text: "#2e6b38", dot: "#9fc9a2" },
  reading: { bg: "rgba(159,187,224,0.18)", text: "#2a527a", dot: "#9fbbe0" },
  synthesizing: { bg: "rgba(192,168,221,0.18)", text: "#5a3a7a", dot: "#c0a8dd" },
  done: { bg: "rgba(38,37,30,0.05)", text: "rgba(38,37,30,0.45)", dot: "rgba(38,37,30,0.3)" },
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  thinking: "Reasoning",
  searching: "Searching",
  reading: "Reading sources",
  synthesizing: "Synthesizing",
  done: "Complete",
};

const tmpId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();
const PAGE_SIZE = 50;

/** Finished reasoning steps for runs without live node frames (plain HTTP
 *  path, e.g. on serverless where /ws is unavailable). The stages really ran
 *  server-side — meta carries the verdict/revision count to prove it — so a
 *  collapsed trace persists instead of vanishing with the live indicator. */
function stepsFromMeta(meta: ResearchMeta | undefined, depth: ResearchDepth): ReasoningStep[] {
  const m = meta ?? { verdict: "", revisionCount: 0, offline: false };
  const synth = m.revisionCount > 1 ? `Synthesis (revision ${m.revisionCount})` : "Synthesis";
  return [
    { id: "s-think", kind: "thinking", label: "Query decomposition", detail: `Parsed the question (${depth} depth).`, status: "done" },
    { id: "s-search", kind: "searching", label: "Literature search", detail: m.offline ? "Offline sources (no search key)." : "Retrieved candidate sources.", status: "done" },
    { id: "s-write", kind: "synthesizing", label: synth, detail: "Built structured response with inline citations.", status: "done" },
    { id: "s-edit", kind: "reading", label: "Editorial review", detail: m.verdict ? `Verdict: ${m.verdict}` : "Reviewed the draft.", status: "done" },
  ];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function relDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (t: Date) => t.getFullYear() * 1000 + t.getMonth() * 40 + t.getDate();
  if (day(d) === day(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day(d) === day(y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── Small components ── */

function StatusPill({ status }: { status: AgentStatus }) {
  const col = STEP_STYLE[status];
  return (
    <span className="ri-pill" style={{ background: col.bg, color: col.text }}>
      {status !== "done" && <span className="ri-pulse" style={{ background: col.dot }} />}
      {STATUS_LABELS[status]}
    </span>
  );
}

function StepRow({ step }: { step: ReasoningStep }) {
  const col = STEP_STYLE[step.kind];
  return (
    <div className="ri-step">
      <div className="ri-step-icon">
        {step.status === "done" ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.5" stroke={col.dot} strokeWidth="1" fill={col.bg} />
            <path d="M4.5 7l2 2 3-3" stroke={col.dot} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : step.status === "active" ? (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.dot, animation: "ri-pulse 1.4s ease-in-out infinite" }} />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(38,37,30,0.12)" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="ri-step-label" style={{ color: col.text }}>{step.label}</span>
        <p className="ri-step-detail">{step.detail}</p>
      </div>
    </div>
  );
}

function Disclosure({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={onToggle} className={`ri-disclosure${open ? " open" : ""}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/* ── Main ── */

const DEPTHS: ResearchDepth[] = ["quick", "standard", "deep"];
const DEPTH_LABEL: Record<ResearchDepth, string> = { quick: "Quick", standard: "Standard", deep: "Deep" };

export function Agent() {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>(
    () => (localStorage.getItem("researcherit.depth") as ResearchDepth) || "standard",
  );
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<AgentStatus | null>(null);
  const [liveSteps, setLiveSteps] = useState<ReasoningStep[]>([]);
  const [traces, setTraces] = useState<Record<string, ReasoningStep[]>>({});
  const [panels, setPanels] = useState<Record<string, { steps?: boolean; sources?: boolean }>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pagination, setPagination] = useState<{ page: number; totalMessages: number; hasMore: boolean } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const writerRuns = useRef(0);
  // Mirror of liveSteps for async continuations: runStream/reconcile close
  // over stale renders, so they must read the ref, not the state.
  const liveStepsRef = useRef<ReasoningStep[]>([]);
  const setLive = (
    updater: ReasoningStep[] | ((prev: ReasoningStep[]) => ReasoningStep[]),
  ) => {
    setLiveSteps((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      liveStepsRef.current = next;
      return next;
    });
  };

  const activeConvo = conversations.find((c) => c.id === activeId) ?? null;

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

  // When a new exchange starts, put its question at the top of the view so
  // reading begins there — the view never chases the streaming bottom.
  const scrollToNewExchange = () => {
    requestAnimationFrame(() => {
      const thread = threadRef.current;
      const items = thread?.querySelectorAll(".ri-user-msg");
      const last = items?.[items.length - 1] as HTMLElement | undefined;
      if (thread && last) {
        const top =
          last.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
        thread.scrollTo({ top: Math.max(top - 16, 0), behavior: "smooth" });
      }
    });
  };

  const changeDepth = (d: ResearchDepth) => {
    setDepth(d);
    localStorage.setItem("researcherit.depth", d);
  };

  const togglePanel = (id: string, which: "steps" | "sources") =>
    setPanels((p) => ({ ...p, [id]: { ...p[id], [which]: !p[id]?.[which] } }));

  const openConversation = async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
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
      setMessages((prev) => [...conversation.messages, ...prev]);
      setPagination({ page: pag.page, totalMessages: pag.totalMessages, hasMore: pag.hasMore });
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
    setLiveStatus(null);
    setLive([]);
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

  const exportMd = () => {
    if (!activeId || messages.length === 0) return;
    const lines = [`# ${activeConvo?.title ?? "Research"}\n`];
    for (const m of messages) {
      lines.push(m.role === "user" ? `**You:** ${m.content}\n` : `${m.content}\n`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `research-${activeId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Reconcile optimistic tmp messages with server truth (newest page). */
  const reconcile = async (conversationId: string, fallbackSteps?: ReasoningStep[]) => {
    setActiveId(conversationId);
    const live = liveStepsRef.current;
    const finished = (live.length > 0 ? live : (fallbackSteps ?? [])).map((s) => ({ ...s, status: "done" as const }));
    const { conversation, pagination: pag } = await api.getConversation(conversationId, 1, PAGE_SIZE);
    setMessages(conversation.messages);
    setPagination({ page: pag.page, totalMessages: pag.totalMessages, hasMore: pag.hasMore });
    if (finished.length > 0) {
      const lastAsst = [...conversation.messages].reverse().find((m) => m.role === "assistant");
      if (lastAsst) setTraces((t) => ({ ...t, [lastAsst.id]: finished }));
    }
    setLive([]);
    setLiveStatus(null);
    await refreshList();
    window.setTimeout(() => void refreshList(), 12_000);
  };

  const runStream = async (content: string, convoId: string | null, asstTmpId: string) => {
    writerRuns.current = 0;
    let sawFrames = false;
    let seenId: string | null = convoId;
    const res = await streamResearch(content, convoId, depth, {
      onNode: (node, detail) => {
        sawFrames = true;
        if (node === "writer") writerRuns.current += 1;
        if (node === "planner") {
          setLiveStatus("searching");
          setLive([
            { id: "s-think", kind: "thinking", label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" },
            { id: "s-search", kind: "searching", label: "Literature search", detail: detail || "Querying live sources…", status: "active" },
          ]);
        } else if (node === "writer") {
          setLiveStatus("synthesizing");
          setLive((prev) => {
            const base = prev.length > 0 ? prev : [
              { id: "s-think", kind: "thinking" as const, label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" as const },
              { id: "s-search", kind: "searching" as const, label: "Literature search", detail: "Retrieved candidate sources.", status: "done" as const },
            ];
            return [
              ...base.filter((s) => s.id !== "s-write"),
              { id: "s-write", kind: "synthesizing", label: writerRuns.current > 1 ? `Synthesis (revision ${writerRuns.current})` : "Synthesis", detail: detail ? `Drafting… ${detail}` : "Building structured response with inline citations…", status: "active" },
            ];
          });
        } else if (node === "editor") {
          setLiveStatus("reading");
          setLive((prev) => [
            ...prev.map((s) => ({ ...s, status: "done" as const })),
            { id: "s-edit", kind: "reading", label: "Editorial review", detail: detail ? `Verdict: ${detail}` : "Reviewing the draft…", status: "active" },
          ]);
        }
      },
      onToken: (t) => {
        sawFrames = true;
        setLiveStatus((s) => (s === "synthesizing" ? s : "synthesizing"));
        setMessages((m) => m.map((x) => (x.id === asstTmpId ? { ...x, content: x.content + t } : x)));
      },
      onConversationId: (id) => {
        seenId = id;
      },
    }).catch(async (err) => {
      if (sawFrames && seenId) {
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
      const { userMessage, assistantMessage, meta } = await api.sendMessage(convoId, content, depth);
      try {
        await reconcile(convoId, stepsFromMeta(meta, depth));
      } catch {
        setMessages((m) => [...m, userMessage, assistantMessage]);
        setTraces((t) => ({ ...t, [assistantMessage.id]: stepsFromMeta(meta, depth) }));
      }
    } else {
      const res = await api.research(content, undefined, depth);
      setActiveId(res.conversationId);
      setMessages([res.userMessage, res.assistantMessage]);
      setTraces((t) => ({ ...t, [res.assistantMessage.id]: stepsFromMeta(res.meta, depth) }));
    }
    await refreshList();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = topic.trim();
    if (!content || loading) return;
    setError(null);
    setLoading(true);
    setLiveStatus("thinking");
    setLive([
      { id: "s-think", kind: "thinking", label: "Query decomposition", detail: "Parsing the question…", status: "active" },
    ]);
    const userTmp: ChatMessage = { id: tmpId("tmp-u"), role: "user", content, createdAt: nowIso() };
    const asstTmp: ChatMessage = { id: tmpId("tmp-a"), role: "assistant", content: "", createdAt: nowIso() };
    setMessages((m) => [...m, userTmp, asstTmp]);
    scrollToNewExchange();
    try {
      await runStream(content, activeId, asstTmp.id);
      setTopic("");
    } catch {
      setMessages((m) => m.filter((x) => x.id !== userTmp.id && x.id !== asstTmp.id));
      setLive([]);
      setLiveStatus(null);
      try {
        await runHttp(content, activeId);
        setTopic("");
      } catch (err) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async (msg: ChatMessage) => {
    const content = editDraft.trim();
    if (!content || loading || !activeId) return;
    setLoading(true);
    setError(null);
    setLiveStatus("thinking");
    setLive([
      { id: "s-think", kind: "thinking", label: "Query decomposition", detail: "Parsing the revised question…", status: "active" },
    ]);
    const convoId = activeId;
    const userTmp: ChatMessage = { id: tmpId("tmp-u"), role: "user", content, createdAt: nowIso() };
    const asstTmp: ChatMessage = { id: tmpId("tmp-a"), role: "assistant", content: "", createdAt: nowIso() };
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      const head = idx >= 0 ? prev.slice(0, idx) : prev;
      return [...head, userTmp, asstTmp];
    });
    scrollToNewExchange();
    setEditingId(null);
    setEditDraft("");
    try {
      await runStream(content, convoId, asstTmp.id);
    } catch {
      setMessages((m) => m.filter((x) => x.id !== userTmp.id && x.id !== asstTmp.id));
      setLive([]);
      setLiveStatus(null);
      try {
        const { userMessage, assistantMessage, meta } = await api.sendMessage(convoId, content, depth);
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msg.id);
          const head = idx >= 0 ? prev.slice(0, idx) : prev;
          return [...head, userMessage, assistantMessage];
        });
        setTraces((t) => ({ ...t, [assistantMessage.id]: stepsFromMeta(meta, depth) }));
        await refreshList();
      } catch (err) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const renderAssistant = (m: ChatMessage, isLive: boolean) => {
    const steps = isLive ? liveSteps : (traces[m.id] ?? []);
    const stepsOpen = isLive ? true : !!panels[m.id]?.steps;
    const sources = getSources(m.content);
    const sourcesOpen = !!panels[m.id]?.sources;
    const status: AgentStatus | null = isLive ? (liveStatus ?? "thinking") : steps.length > 0 ? "done" : null;
    const showThinking = isLive && !m.content;

    return (
      <div className="ri-fade">
        <div className="ri-agent-head">
          <span className="ri-agent-mark">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="2" fill="#26251e" opacity="0.7" />
              <circle cx="5" cy="5" r="4.5" stroke="#26251e" strokeWidth="0.8" opacity="0.2" />
            </svg>
          </span>
          <span className="ri-agent-name">Researcher</span>
          {status && <StatusPill status={status} />}
        </div>

        {steps.length > 0 && (
          <div className="ri-trace">
            <Disclosure
              open={stepsOpen}
              onToggle={() => togglePanel(m.id, "steps")}
              label={`${stepsOpen ? "Hide" : "View"} reasoning trace · ${steps.length} steps`}
            />
            {stepsOpen && (
              <div className="ri-steps">
                {steps.map((s) => <StepRow key={s.id} step={s} />)}
              </div>
            )}
          </div>
        )}

        {showThinking ? (
          <div className="ri-thinking">
            <span className="ri-dots"><span /><span /><span /></span>
            <span>{STATUS_LABELS[liveStatus ?? "thinking"]}…</span>
          </div>
        ) : m.content ? (
          <div className="ri-body">
            <Markdown content={m.content} className="ri-body" showSources={false} />
          </div>
        ) : null}

        {sources.length > 0 && m.content && (
          <div className="ri-sources">
            <Disclosure
              open={sourcesOpen}
              onToggle={() => togglePanel(m.id, "sources")}
              label={`${sourcesOpen ? "Hide" : "Show"} ${sources.length} sources`}
            />
            {sourcesOpen && (
              <div className="ri-cards">
                {sources.map((s) => (
                  <a key={`${s.number}-${s.url}`} id={`ri-source-${s.number}`} className="ri-card" href={s.url} target="_blank" rel="noopener noreferrer">
                    <div className="ri-card-top">
                      <span className="ri-card-n">[{s.number}]</span>
                      <span className="ri-card-domain">{hostOf(s.url)}</span>
                    </div>
                    <p className="ri-card-title">{s.title}</p>
                    <p className="ri-card-url">{s.url}</p>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ri">
      <aside className={`ri-sidebar${sidebarOpen ? "" : " closed"}`}>
        <Link to="/" className="ri-wordmark" style={{ textDecoration: "none" }} title="Home">
          <span className="ri-mark">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="2.5" fill="white" opacity="0.9" />
              <circle cx="5" cy="5" r="4.5" stroke="white" strokeWidth="0.7" opacity="0.3" />
            </svg>
          </span>
          <span>Researcher</span>
        </Link>
        <button className="ri-new" onClick={newChat}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          New research session
        </button>
        <div className="ri-label">Recent</div>
        <nav className="ri-sessions">
          {conversations.map((c) => (
            <div key={c.id} className={`ri-session${c.id === activeId ? " active" : ""}`} role="button" tabIndex={0}
              onClick={() => openConversation(c.id)}
              onKeyDown={(e) => { if (e.key === "Enter") void openConversation(c.id); }}>
              <div className="ri-session-row">
                <p className="ri-session-title" title={c.title}>{c.title}</p>
                <button
                  className="ri-del" aria-label="Delete conversation"
                  onClick={(e) => { e.stopPropagation(); void removeConversation(c.id); }}
                >✕</button>
              </div>
              <p className="ri-session-meta">{relDate(c.updatedAt)} · {c.messageCount} msgs</p>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="ri-session-meta" style={{ padding: "4px 12px" }}>No sessions yet.</p>
          )}
        </nav>
        <div className="ri-user">
          <span className="ri-avatar">{(user?.name || user?.email || "R").slice(0, 1).toUpperCase()}</span>
          <Link to="/profile" className="ri-user-info" style={{ textDecoration: "none", color: "inherit" }} title="Profile">
            <p className="ri-user-name">{user?.name || "Researcher"}</p>
            <p className="ri-user-plan">{user?.email || ""}</p>
          </Link>
          <button className="ri-logout" onClick={() => void logout()} title="Log out" aria-label="Log out">⏻</button>
        </div>
      </aside>

      <div className="ri-main">
        <header className="ri-topbar">
          <button className="ri-burger" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle history">
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
              <rect x="0" y="0" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="0" y="5.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="0" y="10.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          </button>
          <h1 className="ri-doc-title">{activeConvo?.title ?? "New research"}</h1>
          <div className="ri-depth">
            {DEPTHS.map((d) => (
              <button key={d} onClick={() => changeDepth(d)} className={depth === d ? "on" : ""} disabled={loading}>
                {DEPTH_LABEL[d]}
              </button>
            ))}
          </div>
          <button className="ri-export" onClick={exportMd} disabled={!activeId || messages.length === 0}>
            Export
          </button>
        </header>

        <main className="ri-thread" ref={threadRef}>
          <div className="ri-thread-inner">
            {messages.length === 0 && !loading && (
              <div className="ri-empty">
                <h2>What should I research?</h2>
                <p>Planner → Writer → Editor agents return cited markdown you can keep.</p>
              </div>
            )}
            {pagination?.hasMore && (
              <button className="ri-load" onClick={loadOlderMessages} disabled={loading}>
                Load older messages
              </button>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ri-fade ri-user-msg">
                  <div className="ri-user-bubble">
                    {editingId === m.id ? (
                      <div className="ri-edit-box">
                        <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} />
                        <div className="ri-edit-actions">
                          <button className="ri-btn ri-btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                          <button className="ri-btn ri-btn-primary" disabled={loading} onClick={() => saveEdit(m)}>Re-run</button>
                        </div>
                      </div>
                    ) : (
                      <div className="ri-user-card">
                        <p>{m.content}</p>
                        <button
                          className="ri-edit-link"
                          onClick={() => { setEditingId(m.id); setEditDraft(m.content); }}
                        >
                          Edit
                        </button>
                        <div style={{ clear: "both" }} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={m.id}>{renderAssistant(m, m.id.startsWith("tmp-a") && loading)}</div>
              ),
            )}
            {loading && (
              <div className="ri-progress"><div /></div>
            )}
            {error && <div className="ri-error">{error}</div>}
          </div>
        </main>

        <footer className="ri-footer">
          <div className="ri-footer-inner">
            <form
              className="ri-composer"
              onSubmit={submit}
            >
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a research question…"
                rows={3}
                disabled={loading}
                aria-label="Research topic"
              />
              <div className="ri-composer-bar">
                <span className="ri-composer-hint">{DEPTH_LABEL[depth]} depth</span>
                <span className="ri-send-row">
                  <span className="ri-key-hint">↵ submit</span>
                  <button className="ri-send" type="submit" disabled={loading || !topic.trim()} aria-label="Send">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 9.5L9.5 6 2.5 2.5V5.5l4.5.5-4.5.5V9.5z" fill="currentColor" />
                    </svg>
                  </button>
                </span>
              </div>
            </form>
            <p className="ri-disclaimer">Sources retrieved from live search · verify findings independently</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
