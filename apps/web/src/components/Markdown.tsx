import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

/** Strip markdown emphasis the model sometimes leaves inside link titles. */
function cleanTitle(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\*(.+)\*$/, "$1")
    .replace(/^_(.+)_$/, "$1")
    .trim();
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
      title: cleanTitle(mdLink[1] || hostOf(mdLink[2])),
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
    return { number: fallbackNumber, title: cleanTitle(title) || hostOf(url), url };
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

/** Renders a ```mermaid fence as SVG (lazy-loaded mermaid, strict mode).
 *  Partial code mid-stream usually fails to parse — shows a placeholder
 *  until the fence completes, and the raw code if parsing still fails. */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    setSvg(null);
    setFailed(false);
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, code);
        if (live.current) setSvg(svg);
      } catch {
        if (live.current) setFailed(true);
      }
    })();
    return () => {
      live.current = false;
    };
  }, [code]);
  if (failed)
    return (
      <pre>
        <code className="language-mermaid">{code}</code>
      </pre>
    );
  if (!svg) return <div className="mermaid-loading">Rendering chart…</div>;
  // SVG comes from our own mermaid render of model output with securityLevel
  // strict (no clickable/script payloads) — same trust as the markdown itself.
  return <div className="mermaid-chart" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function codeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  return "";
}

export function Markdown({
  content,
  className = "markdown",
  showSources = true,
}: {
  content: string;
  className?: string;
  /** The Agent page renders its own source cards — it hides this section. */
  showSources?: boolean;
}) {
  const { mainContent, sources } = extractSources(content);
  // Bare [n] markers become chips linking down to the source cards
  // (`#ri-source-n`). Converted unconditionally so chips appear mid-stream
  // too; cards render once the trailing Sources section completes.
  // Code-like `arr[1]` is left alone by the leading-char guard.
  const withCites = mainContent.replace(
    /(^|[\s([])\[(\d+)\](?![\]()])/gm,
    (m, pre, n) => `${pre}[${n}](#ri-source-${n})`,
  );

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith("#ri-source-") ? (
              <a className="citation-ref ri-cite" href={href}>
                {children}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          code: ({ className, children }) =>
            /\blanguage-mermaid\b/.test(className ?? "") ? (
              <MermaidBlock code={codeText(children).replace(/\n$/, "")} />
            ) : (
              <code className={className}>{children}</code>
            ),
        }}
      >
        {withCites}
      </ReactMarkdown>
      {showSources && sources.length > 0 && (
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
