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
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function invokeLlm(
  systemPrompt: string,
  userPrompt: string,
  opts: { onToken?: (token: string) => void } = {},
): Promise<string> {
  const { ChatOpenAI } = await import("@langchain/openai");
  const handlers: BaseCallbackHandler[] = [];
  if (opts.onToken) {
    handlers.push(new TokenForwarder(opts.onToken));
  }
  const model = new ChatOpenAI({
    modelName: getModelName(),
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
    temperature: 0.7,
    callbacks: handlers,
  });
  const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
  const res = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
  return typeof res.content === "string"
    ? res.content
    : res.content
        .map((p) => (typeof p === "string" ? p : "text" in p ? p.text : ""))
        .join("");
}
