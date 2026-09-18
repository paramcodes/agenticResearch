import { z } from "zod";
import {
  getResearchState,
  maxRevisions,
  newThreadId,
  resetGraphCache,
} from "./graph.js";

export const ResearchInputSchema = z.object({
  topic: z.string().min(1, "topic is required").max(2000),
  conversationId: z.string().optional(),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

export type ResearchInput = z.infer<typeof ResearchInputSchema>;

export interface ResearchResult {
  markdown: string;
  sources: string[];
  topic: string;
  ranAt: string;
  revisionCount: number;
  verdict: string;
  offline: boolean;
  threadId: string;
  checkpointerKind: "redis" | "memory";
}

export type StreamEvent =
  | { type: "status"; node: string; detail?: string }
  | { type: "token"; token: string }
  | { type: "result"; result: ResearchResult };

export { getResearchState, maxRevisions, newThreadId, resetGraphCache };
export { buildSourcesBlock, type CitedSource } from "./graph.js";

/**
 * Planner → Writer → Editor graph (spec 02) with Redis checkpointer.
 *
 * - Live path (GROQ_API_KEY/OPENAI_API_KEY + SERPER_API_KEY): real search + LLM nodes.
 * - Offline path (no keys): deterministic labelled templates; the editor
 *   still revises exactly once so the loop is exercised without an LLM.
 * - thread_id (`conv:<id>:<run>` per invocation) scopes checkpoints so runs
 *   never bleed into each other; reuse a thread_id via getResearchState to
 *   inspect/resume a previous run.
 */
export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  let final: ResearchResult | null = null;
  for await (const event of streamResearch(input)) {
    if (event.type === "result") final = event.result;
  }
  if (!final) throw new Error("Research stream ended without a result");
  return final;
}

/** Async generator over the run: coarse node status, LLM token chunks
 *  (live mode) or draft chunks (offline mode), then the final result. */
export async function* streamResearch(input: ResearchInput): AsyncGenerator<StreamEvent> {
  const parsed = ResearchInputSchema.parse(input);
  const { getStream } = await import("./runner.js");
  yield* getStream(parsed);
}

export const agentInfo = {
  name: "@repo/agent",
  graph: "planner-writer-editor-v1",
  streaming: true,
  maxRevisions: 2,
  note: "Set GROQ_API_KEY (or OPENAI_API_KEY) + SERPER_API_KEY for live runs; otherwise deterministic offline templates.",
};
