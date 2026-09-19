import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

class TokenForwarder extends BaseCallbackHandler {
  name = "token-forwarder";

  constructor(private readonly forward: (token: string) => void) {
    super();
  }

  async handleLLMNewToken(token: string): Promise<void> {
    try {
      this.forward(token);
    } catch {
      // never let a streaming sink break the run
    }
  }
}

/** Model wiring. Returns null when no key is configured → nodes fall back to
 *  deterministic offline templates (see graph.ts), so the pipeline, revise
 *  loop, checkpointer and streaming all stay testable without LLM access. */
export function getModelName(): string {
  return process.env.RESEARCH_MODEL?.trim() || "gpt-4o-mini";
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export async function invokeLlm(
  systemPrompt: string,
  userPrompt: string,
  opts: { onToken?: (token: string) => void; maxTokens?: number; maxContinuations?: number } = {},
): Promise<string> {
  const { ChatOpenAI } = await import("@langchain/openai");
  const handlers: BaseCallbackHandler[] = [];
  if (opts.onToken) {
    handlers.push(new TokenForwarder(opts.onToken));
  }
  const apiKey = process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const build = () =>
    new ChatOpenAI({
      modelName: getModelName(),
      openAIApiKey: apiKey,
      configuration: process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : undefined,
      temperature: 0.7,
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      callbacks: handlers,
    });
  const { HumanMessage, SystemMessage, AIMessage } = await import("@langchain/core/messages");

  const read = (res: { content: unknown }) =>
    typeof res.content === "string"
      ? res.content
      : (res.content as Array<string | { text?: string }>)
          .map((p) => (typeof p === "string" ? p : "text" in p ? (p.text ?? "") : ""))
          .join("");
  const truncated = (res: { response_metadata?: unknown }) =>
    (res.response_metadata as { finish_reason?: string } | undefined)?.finish_reason === "length";

  let model = build();
  let res = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
  let full = read(res);

  // Providers (Groq defaults gpt-oss-20b to 2048 output tokens) cut long
  // articles mid-sentence with finish_reason=length. Continue where the
  // previous call left off instead of shipping a truncated article.
  let continuations = 0;
  while (truncated(res) && continuations < (opts.maxContinuations ?? 0)) {
    continuations += 1;
    model = build();
    res = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
      new AIMessage(full),
      new HumanMessage("Continue exactly where you left off — mid-sentence if needed. Do not repeat anything."),
    ]);
    full += read(res);
  }
  return full;
}
