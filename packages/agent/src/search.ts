export interface CitedSource {
  title: string;
  url: string;
  snippet: string;
}

const DEPTH_RESULTS: Record<string, { maxResults: number; searchDepth: "basic" | "advanced" }> = {
  quick: { maxResults: 3, searchDepth: "basic" },
  standard: { maxResults: 5, searchDepth: "advanced" },
  deep: { maxResults: 8, searchDepth: "advanced" },
};

function depthConfig(depth: string) {
  return DEPTH_RESULTS[depth] ?? DEPTH_RESULTS.standard!;
}

/** Offline stand-ins. URLs use .invalid so they can never be mistaken for
 *  real citations — the writer labels the run as offline. */
function mockSources(topic: string, maxResults: number): CitedSource[] {
  const short = topic.trim().slice(0, 80) || "this topic";
  const angles = [
    "latest trends and key developments",
    "key players and noteworthy analysis",
    "practical guidance and trade-offs",
    "background and context",
    "data points and comparisons",
    "expert commentary",
    "risks and open questions",
    "outlook and next steps",
  ];
  return Array.from({ length: maxResults }, (_, i) => ({
    title: `Offline reference ${i + 1}: ${angles[i % angles.length]!} (set SERPER_API_KEY for live research)`,
    url: `https://example.invalid/offline-${i + 1}`,
    snippet: `Placeholder snippet ${i + 1} about ${short}. Live search is disabled, so the plan and draft are built from the topic alone.`,
  }));
}

export function buildSourcesBlock(sources: CitedSource[]): string {
  return sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n    ${s.snippet}`)
    .join("\n");
}

export interface SearchOutcome {
  sources: CitedSource[];
  sourcesBlock: string;
  offline: boolean;
  note?: string;
}

/**
 * Serper API research. No key → clearly-labelled offline mocks (never fake
 * citations). Key present but request fails → honest empty result with a note
 * so the planner writes around the gap instead of inventing sources.
 */
export async function searchTopic(topic: string, depth: string): Promise<SearchOutcome> {
  const { maxResults, searchDepth } = depthConfig(depth);
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) {
    const sources = mockSources(topic, maxResults);
    return { sources, sourcesBlock: buildSourcesBlock(sources), offline: true };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          q: topic,
          num: maxResults,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Serper API responded ${res.status}`);
      const data = (await res.json()) as {
        organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      };
      const sources: CitedSource[] = (data.organic ?? [])
        .filter((r) => r.link && r.title)
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title as string,
          url: r.link as string,
          snippet: (r.snippet ?? "").slice(0, 300),
        }));
      return { sources, sourcesBlock: buildSourcesBlock(sources), offline: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const note = `Live search failed (${(err as Error).message}); writing from the topic without web sources.`;
    return { sources: [], sourcesBlock: "_No search results available._", offline: false, note };
  }
}
