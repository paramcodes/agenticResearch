import { hasLlmKey } from "./llm.js";
import { getCompiled, newThreadId, setTokenSink } from "./graph.js";
import type { ResearchInput, ResearchResult, StreamEvent } from "./index.js";

type UpdateChunk = Record<string, Record<string, unknown>>;

function chunkText(text: string, size = 160): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + w).length > size && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur += w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Drive one run: node status → token chunks → final result. Live LLM tokens
 *  arrive via callback; offline drafts are chunked when the writer update
 *  lands so both modes stream progressively. */
export async function* getStream(parsed: ResearchInput): AsyncGenerator<StreamEvent> {
  const { graph, checkpointerKind } = await getCompiled();
  const threadId = newThreadId(parsed.conversationId);
  const live = hasLlmKey();
  const ranAt = new Date().toISOString();

  yield { type: "status", node: "starting", detail: `checkpointer=${checkpointerKind} mode=${live ? "live" : "offline"}` };

  const tokenQueue: string[] = [];
  let wake: (() => void) | null = null;
  setTokenSink((t) => {
    tokenQueue.push(t);
    wake?.();
    wake = null;
  });

  const stream = await graph.stream(
    { topic: parsed.topic, depth: parsed.depth },
    { configurable: { thread_id: threadId } },
  );
  const it = stream[Symbol.asyncIterator]();
  let pendingUpdate: Promise<IteratorResult<UpdateChunk>> | null = null;
  let updatesDone = false;

  function* drainTokens(): Generator<StreamEvent> {
    while (tokenQueue.length) {
      yield { type: "token", token: tokenQueue.shift() as string };
    }
  }

  try {
    while (!updatesDone || tokenQueue.length) {
      pendingUpdate ??= it.next() as Promise<IteratorResult<UpdateChunk>>;
      const tokenWait = new Promise<"token">((resolve) => {
        if (tokenQueue.length) resolve("token");
        else wake = () => resolve("token");
      });
      const winner = await Promise.race([
        pendingUpdate.then((r) => ({ kind: "update" as const, r })),
        tokenWait.then(() => ({ kind: "token" as const })),
      ]);
      if (winner.kind === "token") {
        yield* drainTokens();
        continue;
      }
      pendingUpdate = null;
      const { value, done } = winner.r;
      if (done) {
        updatesDone = true;
        continue;
      }
      const chunk = (value ?? {}) as UpdateChunk;
      for (const [node, update] of Object.entries(chunk)) {
        if (node === "__start__" || node === "__end__") continue;
        const detail =
          node === "editor" && typeof update?.verdict === "string"
            ? String(update.verdict)
            : node === "writer" && typeof update?.draft === "string"
              ? `${(update.draft as string).length} chars`
              : undefined;
        yield { type: "status", node, detail };
        // Offline drafts arrive whole — chunk them so the UI still streams.
        if (!live && node === "writer" && typeof update?.draft === "string") {
          for (const piece of chunkText(update.draft as string)) {
            yield { type: "token", token: piece };
          }
        }
      }
    }
  } finally {
    setTokenSink(null);
    await it.return?.();
  }
  yield* drainTokens();

  const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
  const v = (snapshot.values ?? {}) as Record<string, unknown>;
  const sources = Array.isArray(v.sources)
    ? (v.sources as Array<{ url?: string }>)
        .map((s) => s.url)
        .filter((u): u is string => Boolean(u))
    : [];
  const markdown =
    (typeof v.finalPost === "string" && v.finalPost) ||
    (typeof v.draft === "string" && v.draft) ||
    "";
  const result: ResearchResult = {
    markdown,
    sources,
    topic: parsed.topic,
    ranAt,
    revisionCount: typeof v.revisionCount === "number" ? v.revisionCount : 0,
    verdict: typeof v.verdict === "string" ? v.verdict : "",
    offline: v.offline === true,
    threadId,
    checkpointerKind,
  };
  yield { type: "result", result };
}
