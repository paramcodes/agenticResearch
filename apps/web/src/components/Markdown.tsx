import ReactMarkdown from "react-markdown";

interface Source {
  number: number;
  title: string;
  url: string;
}

/** Split off a trailing Sources section. Takes everything after the last
 *  `## Sources`-style heading so multi-line lists are never truncated. */
function splitSources(content: string): { main: string; rest: string } | null {
  const re = /^#{1,4}\s*sources(?:\s*used)?\s*$/gim;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) last = m;
  if (!last || last.index === undefined) return null;
  return {
    main: content.slice(0, last.index).trimEnd(),
    rest: content.slice(last.index + last[0].length).trim(),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Parse one line of the sources block. Handles:
 *  `1. [title](url)`, `- [title](url)`, `[title](url)`,
 *  `[1] title — url`, `1. title - https://…`, bare `https://…` lines. */
function parseSourceLine(line: string, fallbackNumber: number): Source | null {
  const trimmed = line.trim().replace(/^(\d+[.)]|[-*•])\s*/, "");
  if (!trimmed) return null;
  const mdLink = trimmed.match(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/);
  if (mdLink?.[2]) {
    return {
      number: fallbackNumber,
      title: (mdLink[1] || hostOf(mdLink[2])).trim(),
      url: mdLink[2].trim(),
    };
  }
  const bare = trimmed.match(/(https?:\/\/[^\s)]+)/);
  if (bare?.[1]) {
    const url = bare[1].replace(/[.,;:!?]+$/, "");
    const title = trimmed
      .replace(url, "")
      .replace(/^\[\d+\]\s*/, "")
      .replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, "")
      .trim();
    return { number: fallbackNumber, title: title || hostOf(url), url };
  }
  return null;
}

function extractSources(content: string): { mainContent: string; sources: Source[] } {
  const split = splitSources(content);
  if (!split) return { mainContent: content, sources: [] };

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const line of split.rest.split("\n")) {
    const parsed = parseSourceLine(line, sources.length + 1);
    if (parsed && !seen.has(parsed.url)) {
      seen.add(parsed.url);
      sources.push({ ...parsed, number: sources.length + 1 });
    }
  }

  // Nothing parseable → keep the original untouched so no content is lost.
  if (sources.length === 0) return { mainContent: content, sources: [] };
  return { mainContent: split.main, sources };
}

export function getSources(content: string): Source[] {
  return extractSources(content).sources;
}

export function Markdown({ content, className = "markdown" }: { content: string; className?: string }) {
  const { mainContent, sources } = extractSources(content);
  // Turn bare [n] markers into chip links (only when they resolve to a
  // parsed source; code-like `arr[1]` is left alone by the lookbehind).
  const withCites = sources.length > 0
    ? mainContent.replace(/(^|[\s([])\[(\d+)\](?![\]()])/gm, (m, pre, n) =>
        Number(n) <= sources.length ? `${pre}[${n}](#cite-${n})` : m,
      )
    : mainContent;

  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          a: ({ href, children }) =>
            href?.startsWith("#cite-") ? (
              <sup className="citation-ref ri-cite">{children}</sup>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {withCites}
      </ReactMarkdown>
      {sources.length > 0 && (
        <div className="sources-section">
          <h4>Sources</h4>
          <ul className="sources-list">
            {sources.map((source) => (
              <li key={`${source.number}-${source.url}`} className="source-item">
                <span className="source-number">[{source.number}]</span>
                <span className="source-text">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-link">
                    {source.title}
                  </a>
                  <span className="source-host">{hostOf(source.url)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
