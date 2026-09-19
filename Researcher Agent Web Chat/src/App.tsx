import { useState, useRef, useEffect } from "react";

/* ─── Types ─────────────────────────────────────────────── */

type StepKind = "thinking" | "searching" | "reading" | "synthesizing" | "done";
type StepStatus = "done" | "active" | "pending";

interface ReasoningStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  status: StepStatus;
}

interface Source {
  id: number;
  title: string;
  domain: string;
  excerpt: string;
  date: string;
}

type AgentStatus = "thinking" | "searching" | "reading" | "synthesizing" | "done";

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  status?: AgentStatus;
  steps?: ReasoningStep[];
  sources?: Source[];
  stepsOpen?: boolean;
  sourcesOpen?: boolean;
}

interface Session {
  id: string;
  title: string;
  date: string;
  count: number;
}

/* ─── Static data ───────────────────────────────────────── */

const SESSIONS: Session[] = [
  { id: "s1", title: "mRNA vaccine mechanisms", date: "Today", count: 6 },
  { id: "s2", title: "Quantum error correction thresholds", date: "Yesterday", count: 4 },
  { id: "s3", title: "Cambrian explosion timing", date: "Sep 17", count: 9 },
  { id: "s4", title: "CRISPR off-target effects", date: "Sep 14", count: 5 },
  { id: "s5", title: "Dark matter candidate survey", date: "Sep 12", count: 11 },
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: "m0",
    role: "user",
    content:
      "What are the latest findings on the neurological basis of decision-making under uncertainty, and how do they relate to predictive coding frameworks?",
  },
  {
    id: "m1",
    role: "agent",
    status: "done",
    stepsOpen: false,
    sourcesOpen: false,
    content: `Decision-making under uncertainty is now understood primarily through the lens of **predictive coding** — a Bayesian framework in which the brain generates predictions and continuously refines them based on precision-weighted prediction errors. <span class="citation-ref">1</span>

**Prefrontal-subcortical circuits encode uncertainty directly.** Orbitofrontal and anterior cingulate cortex represent full probability distributions over outcomes, not merely expected values. Recordings in non-human primates show ACC neurons firing in proportion to reward-distribution entropy. <span class="citation-ref">2</span>

**Dopamine implements precision-weighted prediction error.** Rather than raw RPE, dopamine neurons appear to signal the inverse-variance-weighted error, reconciling longstanding conflicts across reinforcement-learning and Bayesian accounts. <span class="citation-ref">3</span>

**Norepinephrine modulates the explore-exploit trade-off.** Locus coeruleus activity predicts transitions from exploitation to exploration — consistent with its role in signaling unexpected uncertainty, distinct from the cholinergic system's handling of expected uncertainty. <span class="citation-ref">4</span>

These findings converge: prefrontal cortex holds prior precision, dopamine relays precision-weighted errors to update beliefs, and norepinephrine signals when the generative model itself requires revision. Open debates center on whether these circuits implement exact Bayesian inference or an efficient approximation.`,
    steps: [
      { id: "st1", kind: "thinking", label: "Query decomposition", detail: "Identified two sub-questions: neural circuits for uncertainty encoding; relationship to predictive coding.", status: "done" },
      { id: "st2", kind: "searching", label: "Literature search", detail: "Queried PubMed and Semantic Scholar — ACC, OFC uncertainty encoding 2020–2024. Retrieved 18 candidate papers.", status: "done" },
      { id: "st3", kind: "reading", label: "Source reading", detail: "Extracted relevant sections from top 8 papers; focused on dopamine RPE, norepinephrine uncertainty, and hierarchical Bayes.", status: "done" },
      { id: "st4", kind: "synthesizing", label: "Synthesis", detail: "Cross-referenced convergent findings; built structured answer with inline citations.", status: "done" },
    ],
    sources: [
      { id: 1, title: "Predictive coding as a framework for decision-making under uncertainty", domain: "nature.com", excerpt: "We review evidence that prefrontal circuits represent full probability distributions, with implications for Bayesian brain theories...", date: "2023" },
      { id: 2, title: "Anterior cingulate cortex encodes entropy of reward distributions", domain: "cell.com", excerpt: "Single-unit recordings during probabilistic reward tasks reveal ACC neurons represent distributional uncertainty rather than expected value alone...", date: "2024" },
      { id: 3, title: "Dopamine signals precision-weighted prediction error", domain: "neuron.org", excerpt: "A model combining dopamine RPE with precision weighting reconciles conflicting findings across species and paradigms...", date: "2023" },
      { id: 4, title: "Locus coeruleus and the explore-exploit trade-off", domain: "pnas.org", excerpt: "LC-NE activity predicts transitions to exploratory strategies, consistent with its role in unexpected uncertainty signaling...", date: "2022" },
    ],
  },
];

/* ─── Step color map (Cursor AI timeline palette) ──────── */

const STEP_COLORS: Record<StepKind, { bg: string; text: string; dot: string }> = {
  thinking:     { bg: "rgba(223,168,143,0.18)", text: "#8a5240", dot: "#dfa88f" },
  searching:    { bg: "rgba(159,201,162,0.18)", text: "#2e6b38", dot: "#9fc9a2" },
  reading:      { bg: "rgba(159,187,224,0.18)", text: "#2a527a", dot: "#9fbbe0" },
  synthesizing: { bg: "rgba(192,168,221,0.18)", text: "#5a3a7a", dot: "#c0a8dd" },
  done:         { bg: "rgba(38,37,30,0.05)",    text: "rgba(38,37,30,0.45)", dot: "rgba(38,37,30,0.3)" },
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  thinking:     "Reasoning",
  searching:    "Searching",
  reading:      "Reading sources",
  synthesizing: "Synthesizing",
  done:         "Complete",
};

/* ─── Small components ──────────────────────────────────── */

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1 items-center">
      {[0,1,2].map(i => (
        <span
          key={i}
          className="thinking-dot inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: "#dfa88f", animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  const kindMap: Record<AgentStatus, StepKind> = {
    thinking: "thinking", searching: "searching", reading: "reading",
    synthesizing: "synthesizing", done: "done",
  };
  const col = STEP_COLORS[kindMap[status]];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        fontFamily: "var(--font-display)",
        letterSpacing: "0.02em",
        background: col.bg,
        color: col.text,
      }}
    >
      {status !== "done" && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: col.dot }}
        />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function StepRow({ step }: { step: ReasoningStep }) {
  const col = STEP_COLORS[step.kind];
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center">
        {step.status === "done" ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.5" stroke={col.dot} strokeWidth="1" fill={col.bg} />
            <path d="M4.5 7l2 2 3-3" stroke={col.dot} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : step.status === "active" ? (
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: col.dot }} />
        ) : (
          <span className="w-2 h-2 rounded-full" style={{ background: "rgba(38,37,30,0.12)" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className="text-[13px] font-medium"
          style={{ fontFamily: "var(--font-display)", color: col.text }}
        >
          {step.label}
        </span>
        <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: "rgba(38,37,30,0.5)", fontFamily: "var(--font-body)" }}>
          {step.detail}
        </p>
      </div>
    </div>
  );
}

function DisclosureButton({
  open, onToggle, label,
}: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 group transition-colors"
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 12,
        letterSpacing: "0.01em",
        color: "rgba(38,37,30,0.45)",
      }}
    >
      <svg
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}
      >
        <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="group-hover:text-foreground transition-colors">{label}</span>
    </button>
  );
}

function SourceCard({ source }: { source: Source }) {
  return (
    <div
      className="source-card rounded-lg p-3.5 cursor-default"
      style={{
        background: "var(--muted)",
        border: "1px solid rgba(38,37,30,0.1)",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[11px] font-medium"
          style={{ fontFamily: "var(--font-mono)", color: "#f54e00" }}
        >
          [{source.id}]
        </span>
        <div className="flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(38,37,30,0.4)" }}>
          <span>{source.domain}</span>
          <span style={{ color: "rgba(38,37,30,0.2)" }}>·</span>
          <span>{source.date}</span>
        </div>
      </div>
      <p
        className="text-[13px] font-medium leading-snug mb-1"
        style={{ fontFamily: "var(--font-display)", color: "var(--foreground)", letterSpacing: "-0.01em" }}
      >
        {source.title}
      </p>
      <p
        className="text-[12px] leading-relaxed line-clamp-2"
        style={{ fontFamily: "var(--font-body)", color: "rgba(38,37,30,0.5)" }}
      >
        {source.excerpt}
      </p>
    </div>
  );
}

function AgentBubble({
  msg,
  onToggleSteps,
  onToggleSources,
}: {
  msg: Message;
  onToggleSteps: () => void;
  onToggleSources: () => void;
}) {
  return (
    <div className="fade-up space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-5 h-5 rounded-sm flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(38,37,30,0.08)", border: "1px solid rgba(38,37,30,0.12)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="2" fill="#26251e" opacity="0.7" />
            <circle cx="5" cy="5" r="4.5" stroke="#26251e" strokeWidth="0.8" opacity="0.2" />
          </svg>
        </div>
        <span
          className="text-[12px] font-medium tracking-wide"
          style={{ fontFamily: "var(--font-display)", color: "rgba(38,37,30,0.5)", letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 11 }}
        >
          Researcher
        </span>
        {msg.status && <StatusPill status={msg.status} />}
      </div>

      {/* Reasoning trace */}
      {msg.steps && msg.steps.length > 0 && (
        <div>
          <DisclosureButton
            open={!!msg.stepsOpen}
            onToggle={onToggleSteps}
            label={`${msg.stepsOpen ? "Hide" : "View"} reasoning trace · ${msg.steps.length} steps`}
          />
          {msg.stepsOpen && (
            <div
              className="mt-2 pl-3"
              style={{ borderLeft: "1.5px solid rgba(38,37,30,0.1)" }}
            >
              {msg.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      {msg.status === "thinking" || msg.status === "searching" || msg.status === "reading" ? (
        <div className="flex items-center gap-2" style={{ color: "rgba(38,37,30,0.45)", fontFamily: "var(--font-body)", fontSize: 14 }}>
          <ThinkingDots />
          <span style={{ fontSize: 13 }}>{STATUS_LABELS[msg.status!]}…</span>
        </div>
      ) : (
        <div
          className="text-[15px] leading-[1.65] space-y-3"
          style={{ fontFamily: "var(--font-body)", color: "var(--foreground)", fontFeatureSettings: '"cswh"' }}
          dangerouslySetInnerHTML={{ __html: formatBody(msg.content) }}
        />
      )}

      {/* Sources */}
      {msg.sources && msg.sources.length > 0 && (
        <div className="pt-1">
          <DisclosureButton
            open={!!msg.sourcesOpen}
            onToggle={onToggleSources}
            label={`${msg.sourcesOpen ? "Hide" : "Show"} ${msg.sources.length} sources`}
          />
          {msg.sourcesOpen && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {msg.sources.map((s) => <SourceCard key={s.id} source={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ───────────────────────────────────────────── */

function formatBody(text: string): string {
  return text
    .replace(
      /\*\*(.+?)\*\*/g,
      '<strong style="font-weight:600;font-family:var(--font-display);letter-spacing:-0.01em;color:#26251e">$1</strong>'
    )
    .replace(/\n\n/g, '</p><p style="margin-top:0.75em">')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

const DEPTH_OPTIONS = ["Quick", "Standard", "Deep", "Exhaustive"] as const;
type Depth = (typeof DEPTH_OPTIONS)[number];

/* ─── Main App ──────────────────────────────────────────── */

export default function App() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [depth, setDepth] = useState<Depth>("Standard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSession, setActiveSession] = useState("current");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleSteps = (id: string) =>
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, stepsOpen: !m.stepsOpen } : m));

  const toggleSources = (id: string) =>
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, sourcesOpen: !m.sourcesOpen } : m));

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { id: `u${Date.now()}`, role: "user", content: input.trim() };
    const agentId = `a${Date.now() + 1}`;
    const agentMsg: Message = { id: agentId, role: "agent", status: "thinking", content: "", steps: [] };
    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setInput("");
    setIsLoading(true);

    const patch = (partial: Partial<Message>) =>
      setMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, ...partial } : m));

    setTimeout(() => patch({
      status: "searching",
      steps: [
        { id: "st1", kind: "thinking", label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" },
        { id: "st2", kind: "searching", label: "Literature search", detail: "Querying academic databases…", status: "active" },
      ],
    }), 1200);

    setTimeout(() => patch({
      status: "reading",
      steps: [
        { id: "st1", kind: "thinking", label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" },
        { id: "st2", kind: "searching", label: "Literature search", detail: "Retrieved 14 candidate papers.", status: "done" },
        { id: "st3", kind: "reading", label: "Source reading", detail: "Extracting relevant passages from top 6 papers…", status: "active" },
      ],
    }), 2800);

    setTimeout(() => patch({
      status: "synthesizing",
      steps: [
        { id: "st1", kind: "thinking", label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" },
        { id: "st2", kind: "searching", label: "Literature search", detail: "Retrieved 14 candidate papers.", status: "done" },
        { id: "st3", kind: "reading", label: "Source reading", detail: "Extracted relevant passages from 6 papers.", status: "done" },
        { id: "st4", kind: "synthesizing", label: "Synthesis", detail: "Building structured response with inline citations…", status: "active" },
      ],
    }), 4500);

    setTimeout(() => {
      patch({
        status: "done",
        stepsOpen: false,
        sourcesOpen: false,
        content: `This is an active area of research with several converging lines of evidence. Current literature points toward a framework that integrates experimental findings from multiple paradigms and levels of analysis. <span class="citation-ref">1</span>

**The core insight** emerging from recent work is that the phenomenon you're asking about operates through mechanisms that are more distributed and context-dependent than earlier single-site accounts suggested.

Controlled studies have isolated individual variables while maintaining ecological validity, producing results that have replicated across independent laboratories and diverse populations. <span class="citation-ref">2</span> This replication record strengthens confidence in the underlying mechanistic account.

**Open questions** include the precise directionality of causal relationships and the degree to which findings generalize across developmental stages and clinical populations. Longitudinal designs and natural experiments will likely be required to resolve these debates definitively. <span class="citation-ref">3</span>`,
        steps: [
          { id: "st1", kind: "thinking", label: "Query decomposition", detail: "Parsed the question into researchable components.", status: "done" },
          { id: "st2", kind: "searching", label: "Literature search", detail: "Retrieved 14 candidate papers.", status: "done" },
          { id: "st3", kind: "reading", label: "Source reading", detail: "Extracted relevant passages from 6 papers.", status: "done" },
          { id: "st4", kind: "synthesizing", label: "Synthesis", detail: "Built structured response with inline citations.", status: "done" },
        ],
        sources: [
          { id: 1, title: "Mechanisms and models in contemporary research", domain: "nature.com", excerpt: "A comprehensive review of experimental evidence and computational frameworks underlying the phenomenon...", date: "2024" },
          { id: 2, title: "Replication across populations and laboratories", domain: "science.org", excerpt: "Findings were consistent across N=1,200 participants from three independent cohorts using pre-registered protocols...", date: "2023" },
          { id: 3, title: "Causal inference and longitudinal design", domain: "pnas.org", excerpt: "We argue cross-sectional studies are insufficient to resolve directionality; natural experiments offer a path forward...", date: "2024" },
        ],
      });
      setIsLoading(false);
    }, 6500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)", color: "var(--foreground)" }}>

      {/* ── Sidebar ─────────────────────────────── */}
      <aside
        className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200"
        style={{
          width: sidebarOpen ? 260 : 0,
          borderRight: "1px solid rgba(38,37,30,0.1)",
          background: "#ebeae5",
        }}
      >
        {/* Wordmark */}
        <div
          className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(38,37,30,0.08)" }}
        >
          <div
            className="w-5 h-5 rounded-sm flex items-center justify-center"
            style={{ background: "#26251e" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="2.5" fill="white" opacity="0.9" />
              <circle cx="5" cy="5" r="4.5" stroke="white" strokeWidth="0.7" opacity="0.3" />
            </svg>
          </div>
          <span
            className="text-[13px] font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "#26251e", letterSpacing: "-0.02em" }}
          >
            Researcher
          </span>
        </div>

        {/* New session */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <button
            onClick={() => setActiveSession("current")}
            className="w-full flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              fontFamily: "var(--font-display)",
              background: "#f2f1ed",
              border: "1px solid rgba(38,37,30,0.12)",
              color: "#26251e",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#cf2d56")}
            onMouseLeave={e => (e.currentTarget.style.color = "#26251e")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            New research session
          </button>
        </div>

        {/* Label */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ fontFamily: "var(--font-display)", color: "rgba(38,37,30,0.35)", letterSpacing: "0.12em" }}
          >
            Recent
          </span>
        </div>

        {/* Sessions list */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          <button
            onClick={() => setActiveSession("current")}
            className="session-btn w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-colors"
            style={{
              background: activeSession === "current" ? "rgba(38,37,30,0.07)" : "transparent",
              border: "1px solid transparent",
              ...(activeSession === "current" ? { borderColor: "rgba(38,37,30,0.1)" } : {}),
            }}
          >
            <p className="text-[13px] font-medium truncate" style={{ fontFamily: "var(--font-display)", color: "#26251e", letterSpacing: "-0.01em" }}>
              Predictive coding & decision-making
            </p>
            <p className="text-[11px] mt-0.5" style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.4)" }}>
              Active session
            </p>
          </button>

          {SESSIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className="session-btn w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-colors"
              style={{
                background: activeSession === s.id ? "rgba(38,37,30,0.07)" : "transparent",
                border: "1px solid transparent",
                ...(activeSession === s.id ? { borderColor: "rgba(38,37,30,0.1)" } : {}),
              }}
            >
              <p className="text-[13px] font-medium truncate" style={{ fontFamily: "var(--font-display)", color: "#26251e", letterSpacing: "-0.01em" }}>
                {s.title}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(38,37,30,0.4)" }}>
                <span>{s.date}</span>
                <span style={{ color: "rgba(38,37,30,0.2)" }}>·</span>
                <span>{s.count} msgs</span>
              </div>
            </button>
          ))}
        </nav>

        {/* User */}
        <div
          className="px-4 py-3 flex items-center gap-3 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(38,37,30,0.08)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
            style={{ background: "#26251e", color: "#f2f1ed", fontFamily: "var(--font-display)" }}
          >
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ fontFamily: "var(--font-display)", color: "#26251e", letterSpacing: "-0.01em" }}>
              Dr. A. Researcher
            </p>
            <p className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.4)" }}>
              Pro plan
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar */}
        <header
          className="flex items-center gap-3 px-5 h-12 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(38,37,30,0.1)", background: "var(--background)" }}
        >
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors flex-shrink-0"
            style={{ color: "rgba(38,37,30,0.45)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(38,37,30,0.06)"; e.currentTarget.style.color = "#26251e"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(38,37,30,0.45)"; }}
          >
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
              <rect x="0" y="0" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="0" y="5.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="0" y="10.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          </button>

          <h1
            className="flex-1 min-w-0 text-[14px] font-medium truncate"
            style={{ fontFamily: "var(--font-display)", color: "#26251e", letterSpacing: "-0.02em" }}
          >
            Predictive coding & decision-making under uncertainty
          </h1>

          {/* Depth selector */}
          <div
            className="flex items-center rounded-full p-0.5 gap-0.5 flex-shrink-0"
            style={{ background: "rgba(38,37,30,0.06)", border: "1px solid rgba(38,37,30,0.1)" }}
          >
            {DEPTH_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className="depth-option px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                style={{
                  fontFamily: "var(--font-display)",
                  letterSpacing: "0.01em",
                  background: depth === d ? "#26251e" : "transparent",
                  color: depth === d ? "#f2f1ed" : "rgba(38,37,30,0.5)",
                }}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Share */}
          <button
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors flex-shrink-0"
            style={{
              fontFamily: "var(--font-display)",
              background: "#ebeae5",
              border: "1px solid rgba(38,37,30,0.12)",
              color: "#26251e",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#cf2d56")}
            onMouseLeave={e => (e.currentTarget.style.color = "#26251e")}
          >
            Export
          </button>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto" style={{ background: "var(--background)" }}>
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="fade-up flex justify-end">
                  <div
                    className="max-w-lg rounded-xl px-4 py-3 text-[15px] leading-[1.6]"
                    style={{
                      fontFamily: "var(--font-body)",
                      fontFeatureSettings: '"cswh"',
                      background: "#ebeae5",
                      border: "1px solid rgba(38,37,30,0.1)",
                      color: "#26251e",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ) : (
                <AgentBubble
                  key={msg.id}
                  msg={msg}
                  onToggleSteps={() => toggleSteps(msg.id)}
                  onToggleSources={() => toggleSources(msg.id)}
                />
              )
            )}

            {/* Progress bar while loading */}
            {isLoading && (
              <div className="h-px rounded-full overflow-hidden" style={{ background: "rgba(38,37,30,0.08)" }}>
                <div className="h-full rounded-full progress-animate" style={{ background: "rgba(38,37,30,0.25)" }} />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* Input */}
        <footer
          className="px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(38,37,30,0.1)", background: "var(--background)" }}
        >
          <div className="max-w-2xl mx-auto">
            <div
              className="rounded-xl transition-shadow"
              style={{
                background: "#ebeae5",
                border: "1px solid rgba(38,37,30,0.12)",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a research question…"
                rows={3}
                disabled={isLoading}
                className="w-full bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed resize-none disabled:opacity-50"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "#26251e",
                }}
              />

              <div className="flex items-center justify-between px-3.5 pb-3">
                {/* Left controls */}
                <div className="flex items-center gap-3">
                  <span
                    className="text-[11px]"
                    style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.35)" }}
                  >
                    {depth} depth
                  </span>
                  <span style={{ color: "rgba(38,37,30,0.15)", fontSize: 12 }}>·</span>
                  <button
                    className="text-[11px] transition-colors"
                    style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.35)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#26251e")}
                    onMouseLeave={e => (e.currentTarget.style.color = "rgba(38,37,30,0.35)")}
                  >
                    + Attach context
                  </button>
                </div>

                {/* Submit */}
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px]"
                    style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.25)" }}
                  >
                    ↵ submit
                  </span>
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || isLoading}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ background: "#26251e", color: "#f2f1ed" }}
                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#f54e00"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#26251e"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 9.5L9.5 6 2.5 2.5V5.5l4.5.5-4.5.5V9.5z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <p
              className="text-center mt-2 text-[11px]"
              style={{ fontFamily: "var(--font-mono)", color: "rgba(38,37,30,0.25)" }}
            >
              Sources retrieved from academic databases · verify findings independently
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
