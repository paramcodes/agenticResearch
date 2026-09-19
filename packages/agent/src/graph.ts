import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
  type CompiledStateGraph,
} from "@langchain/langgraph";
import { hasLlmKey, invokeLlm } from "./llm.js";
import { buildSourcesBlock, searchTopic, type CitedSource } from "./search.js";

// ---------------------------------------------------------------------------
// State — flows node to node inside the graph (spec 02). Redis is only the
// checkpointer: it snapshots this state after each node so a run can resume
// by thread_id instead of starting over.
// ---------------------------------------------------------------------------

const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  depth: Annotation<string>,
  sources: Annotation<CitedSource[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  sourcesBlock: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  searchNote: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  offline: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  plan: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  draft: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  editorFeedback: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  revisionCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  verdict: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  finalPost: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

type State = typeof ResearchState.State;

export function maxRevisions(): number {
  const n = Number(process.env.MAX_REVISIONS ?? 2);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

const DEPTH_SCOPE: Record<string, string> = {
  quick: "Keep it tight: a focused brief, shorter sections.",
  standard: "A full-length piece with balanced coverage.",
  deep: "Be comprehensive: more sections, more nuance, longer analysis.",
};

// ---------------------------------------------------------------------------
// Prompts (from spec 02)
// ---------------------------------------------------------------------------

function plannerPrompt(topic: string, sourcesBlock: string, note: string): string {
  return [
    "You're working on planning a blog article ",
    `about the topic: ${topic}.`,
    "You collect information that helps the ",
    "audience learn something ",
    "and make informed decisions. ",
    "Your work is the basis for ",
    "the Content Writer to write an article on this topic.",
    "You are given a numbered list of search results (title, url, snippet) below.",
    "Ground every factual claim in your plan in one of these sources, and mark",
    "which source number supports it, like [2]. Do not invent facts or sources",
    "that are not in the list.",
    "",
    "Produce:",
    "1. The latest relevant trends, key players, and noteworthy points on the topic.",
    "2. The target audience and their likely interests/pain points.",
    "3. A detailed outline: introduction, key points (each tagged with a [n]",
    "   source), and a call to action.",
    "4. 5-8 SEO keywords.",
    "",
    "Search results:",
    sourcesBlock,
    note ? `\nResearch note: ${note}` : "",
  ].join("\n");
}

function writerPrompt(
  topic: string,
  plan: string,
  sourcesBlock: string,
  editorFeedback: string,
  depth: string,
): string {
  const revisionNote = editorFeedback
    ? `\nEditor feedback to address in this revision:\n${editorFeedback}`
    : "";
  return [
    "You're working on a writing ",
    `a new opinion piece about the topic: ${topic}. `,
    "You base your writing on the work of ",
    "the Content Planner, who provides an outline,numbered sources ",
    "and relevant context about the topic. ",
    "You follow the main objectives and ",
    "direction of the outline, ",
    "as provide by the Content Planner. ",
    "You also provide objective and impartial insights ",
    "and back them up with Planner's sources, keeping the same [n] markers inline ",
    "provide by the Content Planner. ",
    "You acknowledge in your opinion piece ",
    "when your statements are opinions ",
    "as opposed to objective statements.",
    "",
    "Requirements:",
    "- Sections/subtitles are engaging and clearly named.",
    "- Structure: engaging introduction, insightful body, summarizing conclusion.",
    "- Each section: 2-3 paragraphs.",
    "- Naturally incorporate the SEO keywords from the plan.",
    '- End with a numbered "Sources" list mapping each [n] to its title and URL.',
    "- Output valid markdown only.",
    `- Scope: ${DEPTH_SCOPE[depth] ?? DEPTH_SCOPE.standard}`,
    "",
    "Content plan:",
    plan,
    "",
    "Sources (for the closing Sources list):",
    sourcesBlock,
    revisionNote,
  ].join("\n");
}

function editorPrompt(draft: string): string {
  return [
    "You are an editor who receives a blog post ",
    "from the Content Writer. ",
    "Your goal is to review the blog post ",
    "to ensure that it follows journalistic best practices,",
    "provides balanced viewpoints ",
    "when providing opinions or assertions, ",
    "and also avoids major controversial topics ",
    "or opinions when possible.",
    "",
    "- Keeps every [n] citation marker intact and matched to a real source in",
    "  the closing Sources list (do not remove citations while editing).",
    "- Is clean, well-structured markdown, 2-3 paragraphs per section.",
    "",
    "If the draft is publication-ready, lightly proofread it (grammar, voice)",
    "and respond with:",
    "VERDICT: approved",
    "---",
    "<the final polished markdown>",
    "",
    "If it needs real revision (not just typos), respond with:",
    "VERDICT: revise",
    "---",
    "<specific, actionable feedback for the writer>",
    "",
    "Draft:",
    draft,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Offline templates (no OPENAI_API_KEY): deterministic, honestly labelled.
// The offline editor revises exactly once so the Writer→Editor→Writer loop
// is exercised even without an LLM.
// ---------------------------------------------------------------------------

function offlinePlan(topic: string, sourcesBlock: string): string {
  return [
    `# Content plan: ${topic}`,
    "",
    "> Offline plan (no OPENAI_API_KEY). Built from the topic + placeholder sources.",
    "",
    "## Trends, players, noteworthy points",
    `- Core developments around the topic [1], with competing approaches compared [2].`,
    `- Noteworthy trade-offs practitioners mention [3].`,
    "",
    "## Audience",
    "Curious practitioners evaluating the topic; pain points: hype vs reality, cost/effort trade-offs.",
    "",
    "## Outline",
    "1. Introduction — why this matters now [1].",
    "2. Key point A — what changed [1][2].",
    "3. Key point B — trade-offs and limits [2][3].",
    "4. Opinion — where this goes next (opinion, not fact).",
    "5. Call to action — what to try first.",
    "",
    "## SEO keywords",
    `${topic}, guide, trends, comparison, best practices, outlook`,
    "",
    "## Sources used",
    sourcesBlock,
  ].join("\n");
}

function offlineDraft(topic: string, plan: string, sources: CitedSource[], feedback: string): string {
  const list = sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n");
  return [
    `# ${topic}`,
    "",
    "> Offline draft (no OPENAI_API_KEY). Opinion sections are marked as opinion.",
    "",
    "## Why this matters now",
    "",
    `Interest in ${topic} keeps growing as practitioners compare approaches [1]. In my opinion, the most underrated factor is how quickly the trade-offs shift once real constraints appear [2]. Objectively, the documented options differ mostly on cost, maturity, and effort [1][2].`,
    "",
    `A second angle worth weighing is operational reality: what looks elegant in a demo can be brittle in production [3]. That is an opinion informed by the sources above, not a measured fact.`,
    "",
    "## What to do about it",
    "",
    `Start with the smallest variant that can fail safely, then expand [2][3]. My opinion: teams over-invest in tooling before they understand the problem shape — a simpler baseline usually teaches more [3].`,
    "",
    `Budget explicitly for the unglamorous parts (evaluation, rollback, docs) [1][3]. Objectively, those are where efforts most often stall.`,
    "",
    "## Bottom line",
    "",
    `Learn the landscape [1], respect the trade-offs [2][3], and in my opinion, prefer reversible decisions while the space is still moving.`,
    feedback ? `\n> Revision applied per editor feedback: “${feedback.split("\n")[0]}”` : "",
    "",
    "## Sources",
    "",
    list,
    "",
    `<!-- plan digest: ${plan.split("\n").length} lines -->`,
  ].join("\n");
}

const OFFLINE_FEEDBACK =
  "Good structure, but the middle section needs one more concrete trade-off example with its [n] citation kept inline. Keep all citation markers intact.";

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

async function plannerNode(state: State): Promise<Partial<State>> {
  const outcome = await searchTopic(state.topic, state.depth);
  const note = outcome.note ?? (outcome.offline ? "Live search disabled (no SERPER_API_KEY); using labelled placeholder sources." : "");
  if (hasLlmKey()) {
    const plan = await invokeLlm(
      "You are a Content Planner. Follow the brief exactly; output the plan as markdown.",
      plannerPrompt(state.topic, outcome.sourcesBlock, note),
      { maxTokens: 8192 },
    );
    return {
      sources: outcome.sources,
      sourcesBlock: outcome.sourcesBlock,
      searchNote: note,
      offline: outcome.offline,
      plan,
    };
  }
  return {
    sources: outcome.sources,
    sourcesBlock: outcome.sourcesBlock,
    searchNote: note,
    offline: true,
    plan: offlinePlan(state.topic, outcome.sourcesBlock),
  };
}

async function writerNode(
  state: State,
  opts: { onToken?: (t: string) => void } = {},
): Promise<Partial<State>> {
  if (hasLlmKey()) {
    const draft = await invokeLlm(
      "You are a Content Writer. Output valid markdown only.",
      writerPrompt(state.topic, state.plan, state.sourcesBlock, state.editorFeedback, state.depth),
      { onToken: opts.onToken, maxTokens: 16384, maxContinuations: 2 },
    );
    return { draft };
  }
  return {
    draft: offlineDraft(state.topic, state.plan, state.sources, state.editorFeedback),
  };
}

function parseEditorVerdict(text: string): { verdict: "approved" | "revise"; body: string } {
  const m = text.match(/VERDICT:\s*(approved|revise)/i);
  const verdict = m?.[1]?.toLowerCase() === "revise" ? "revise" : "approved";
  const parts = text.split(/---/);
  const body = (parts.length > 1 ? parts.slice(1).join("---") : text.replace(/VERDICT:\s*(approved|revise)/i, "")).trim();
  return { verdict, body: body || "(no feedback provided)" };
}

async function editorNode(
  state: State,
  opts: { onToken?: (t: string) => void } = {},
): Promise<Partial<State>> {
  if (hasLlmKey()) {
    const raw = await invokeLlm(
      "You are an Editor. Reply with VERDICT, ---, then the markdown or the feedback.",
      editorPrompt(state.draft),
      { onToken: opts.onToken, maxTokens: 16384, maxContinuations: 2 },
    );
    const { verdict, body } = parseEditorVerdict(raw);
    const revisionCount = state.revisionCount + (verdict === "revise" ? 1 : 0);
    // Cap reached on a revise → publish the latest draft rather than looping.
    if (verdict === "revise" && revisionCount >= maxRevisions()) {
      return { verdict: "revise (capped)", revisionCount, editorFeedback: body, finalPost: state.draft };
    }
    if (verdict === "revise") {
      return { verdict, revisionCount, editorFeedback: body };
    }
    return { verdict: "approved", revisionCount, finalPost: body };
  }
  // Offline: exactly one revise round-trip, then approve.
  if (state.revisionCount < 1) {
    return { verdict: "revise", revisionCount: 1, editorFeedback: OFFLINE_FEEDBACK };
  }
  return { verdict: "approved", revisionCount: state.revisionCount, finalPost: state.draft };
}

function routeAfterEditor(state: State): "writer" | typeof END {
  // Spec routing: revise && count < MAX → writer, else end.
  if (state.verdict === "revise" && state.revisionCount < maxRevisions()) return "writer";
  return END;
}

// ---------------------------------------------------------------------------
// Compilation + checkpointer (Redis with MemorySaver fallback)
// ---------------------------------------------------------------------------

interface Compiled {
  graph: CompiledStateGraph<State, Partial<State>, string>;
  checkpointerKind: "redis" | "memory";
}

let cached: Promise<Compiled> | null = null;

async function getCompiled(): Promise<Compiled> {
  if (!cached) cached = compileOnce();
  return cached;
}

export type { Compiled };
export { getCompiled };

/** Test hook: drop the cached graph so env changes (e.g. MAX_REVISIONS,
 *  REDIS_URL) take effect between runs. */
export function resetGraphCache(): void {
  cached = null;
}

async function resolveCheckpointer(): Promise<{ saver: BaseCheckpointSaver; kind: "redis" | "memory" }> {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    try {
      const { RedisSaver } = await import("@langchain/langgraph-checkpoint-redis");
      const saver = await RedisSaver.fromUrl(url);
      patchDeltaStorage(saver);
      return { saver, kind: "redis" };
    } catch (err) {
      console.warn("[agent] Redis checkpointer unavailable, using MemorySaver:", (err as Error).message);
    }
  }
  const { MemorySaver } = await import("@langchain/langgraph");
  return { saver: new MemorySaver(), kind: "memory" };
}

/**
 * checkpoint-redis@0.0.3 stores delta-only `channel_values` per checkpoint
 * (only channels in `newVersions`) but reads a single checkpoint back
 * without merging its parents — so `getState` after a multi-node run
 * returns just the last node's channels (e.g. finalPost without draft).
 * MemorySaver stores full snapshots, which is what Pregel's resume path
 * expects. Passing `newVersions: undefined` hits the saver's own
 * backward-compat branch that keeps full `channel_values`, making Redis
 * behave identically. Revisit when upgrading to the langchain v1 line
 * (checkpoint-redis 1.x implements parent-chain reads properly).
 */
function patchDeltaStorage(saver: BaseCheckpointSaver): void {
  const rawPut = saver.put.bind(saver);
  // Explicit undefined (not {}) → saver's backward-compat branch keeps full
  // channel_values. Cast needed: the 0.0.3 types require the 4th arg.
  const KEEP_ALL = undefined as unknown as Parameters<typeof rawPut>[3];
  saver.put = (config, checkpoint, metadata) =>
    rawPut(config, checkpoint, metadata, KEEP_ALL);
}

async function compileOnce(): Promise<Compiled> {
  const { saver, kind } = await resolveCheckpointer();
  const graph = new StateGraph(ResearchState)
    .addNode("planner", plannerNode)
    .addNode("writer", (state: State) => writerNode(state, { onToken: currentTokenSink() }))
    .addNode("editor", (state: State) => editorNode(state, { onToken: currentTokenSink() }))
    .addEdge(START, "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", "editor")
    .addConditionalEdges("editor", routeAfterEditor, { writer: "writer", [END]: END })
    .compile({ checkpointer: saver });
  return { graph, checkpointerKind: kind };
}

// Token sink: streaming runs set this around invoke so node code (which has
// no stream plumbing) can forward LLM tokens. Single-flight per process is
// fine because the api awaits each run before starting the next.
let tokenSink: ((t: string) => void) | null = null;
export function setTokenSink(fn: ((t: string) => void) | null): void {
  tokenSink = fn;
}
function currentTokenSink(): ((t: string) => void) | undefined {
  return tokenSink ?? undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResearchThread {
  threadId: string;
  checkpointerKind: "redis" | "memory";
}

export function newThreadId(conversationId?: string): string {
  const run = Math.random().toString(36).slice(2, 10);
  return conversationId ? `conv:${conversationId}:${run}` : `anon:${run}`;
}

export async function getResearchState(threadId: string): Promise<State | null> {
  const { graph } = await getCompiled();
  try {
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    if (!snapshot || Object.keys(snapshot.values ?? {}).length === 0) return null;
    return snapshot.values as State;
  } catch {
    return null;
  }
}

export { buildSourcesBlock };
export type { CitedSource };
