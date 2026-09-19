import { hasLlmKey, invokeLlm } from "./llm.js";

/** Heuristic sidebar title: strip question scaffolding, keep key terms.
 *  Used synchronously at conversation creation so the sidebar never waits
 *  on the LLM; `generateConversationTitle` upgrades it when possible. */
export function heuristicTitle(topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  if (!t) return "New research";
  const cleaned = t
    .replace(/^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)\s+(is|are|do|does|did|you|we|they|it|he|she)\s+/gi, "")
    .replace(/^(tell me about|explain|describe|discuss|analyze|research|investigate|explore)\s+/gi, "")
    .replace(/[?!.,;:]$/, "")
    .trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
  const keyTerms = words.slice(0, 6).join(" ");
  if (keyTerms.length > 60) return `${keyTerms.slice(0, 60)}…`;
  return keyTerms || t.slice(0, 60) || "New research";
}

function sanitizeTitle(raw: string, fallback: string): string {
  const oneLine = raw
    .split("\n")[0]!
    .trim()
    .replace(/^["'“”]+|["'“”.,;:!?]+$/g, "")
    .replace(/^(title\s*:\s*)/i, "")
    .trim();
  if (!oneLine || oneLine.length < 2) return fallback;
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}

/** LLM-generated sidebar title. Falls back to `heuristicTitle` when no LLM
 *  key is configured or the call fails — titles must never break the run. */
export async function generateConversationTitle(topic: string): Promise<string> {
  const fallback = heuristicTitle(topic);
  if (!hasLlmKey()) return fallback;
  try {
    const raw = await invokeLlm(
      "You write short chat-sidebar titles. Reply with the title only: 3-6 words, no quotes, no trailing punctuation.",
      `Write a sidebar title for a research chat about: ${topic.trim().slice(0, 500)}`,
      { maxTokens: 64 },
    );
    return sanitizeTitle(raw, fallback);
  } catch {
    return fallback;
  }
}
