/**
 * PrintBriefView - Print-friendly rendering of a news brief.
 *
 * No sidebar, no header, no feedback controls. Expandos are shown expanded.
 * Links are rendered as footnotes. Designed to look like a newspaper/newsletter.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NewsBriefData, Section, Excerpt, Expando } from "./types";
import { trpc } from "../../lib/trpc";

/**
 * Collects all links from the brief for footnote rendering.
 */
function collectFootnotes(brief: NewsBriefData): Array<{ label: string; url: string }> {
  const footnotes: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();

  function add(label: string, url: string) {
    if (url && !seen.has(url)) {
      seen.add(url);
      footnotes.push({ label, url });
    }
  }

  for (const section of brief.content.sections) {
    if (section.link) add(section.heading ?? "Source", section.link);
    for (const excerpt of section.excerpts) {
      if (excerpt.link) add(excerpt.source, excerpt.link);
    }
  }
  for (const excerpt of brief.content.excerpts) {
    if (excerpt.link) add(excerpt.source, excerpt.link);
  }

  return footnotes;
}

function getFootnoteNumber(footnotes: Array<{ url: string }>, url: string): number {
  return footnotes.findIndex((f) => f.url === url) + 1;
}

function PrintExcerpt({
  excerpt,
  footnotes,
}: {
  excerpt: Excerpt;
  footnotes: Array<{ label: string; url: string }>;
}) {
  const num = excerpt.link ? getFootnoteNumber(footnotes, excerpt.link) : null;
  return (
    <div className="print-excerpt">
      <p className="print-excerpt-text">{excerpt.text}</p>
      <p className="print-excerpt-source">
        — {excerpt.source}
        {num != null && <sup className="print-footnote-ref">[{num}]</sup>}
      </p>
    </div>
  );
}

function PrintExpando({ expando }: { expando: Expando }) {
  return (
    <div className="print-expando">
      <h3 className="print-expando-title">{expando.title}</h3>
      <div className="print-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{expando.text}</ReactMarkdown>
      </div>
    </div>
  );
}

function PrintSection({
  section,
  footnotes,
}: {
  section: Section;
  footnotes: Array<{ label: string; url: string }>;
}) {
  const num = section.link ? getFootnoteNumber(footnotes, section.link) : null;
  return (
    <div className="print-section">
      {section.heading ? (
        <h2 className="print-section-heading">
          {section.heading}
          {num != null && <sup className="print-footnote-ref">[{num}]</sup>}
        </h2>
      ) : null}
      {section.text ? (
        <div className="print-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.text}</ReactMarkdown>
        </div>
      ) : null}
      {section.excerpts.map((excerpt, i) => (
        <PrintExcerpt key={i} excerpt={excerpt} footnotes={footnotes} />
      ))}
      {section.expandos.map((expando, i) => (
        <PrintExpando key={expando.id ?? i} expando={expando} />
      ))}
    </div>
  );
}

export function PrintBriefView() {
  const { boxSlug, _splat: briefPath } = useParams({ strict: false });
  const [largePrint, setLargePrint] = useState(
    new URLSearchParams(window.location.search).get("large") === "1"
  );

  const briefQuery = trpc.briefs.get.useQuery(
    { path: briefPath! },
    { enabled: !!briefPath }
  );

  const brief = briefQuery.data?.brief as NewsBriefData | undefined;

  useEffect(() => {
    if (!brief) return;
    // Append T00:00 to avoid UTC parsing of date-only strings
    const dateStr = new Date(brief.date + "T00:00").toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    document.title = `News Brief — ${dateStr}`;
  }, [brief]);

  if (!briefPath) return <div className="print-error">No brief path</div>;
  if (briefQuery.isLoading) return <div className="print-loading">Loading...</div>;
  if (briefQuery.error) return <div className="print-error">Error: {briefQuery.error.message}</div>;
  if (!brief) return null;

  const interactiveUrl = `/${boxSlug}/news/${briefPath}`;

  const footnotes = collectFootnotes(brief);
  const dateStr = new Date(brief.date + "T00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Short date for the print footer (e.g. "Feb 23, 2026")
  const shortDate = new Date(brief.date + "T00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
    <style>{`@page { @bottom-left { content: "News Brief — ${shortDate}"; font-family: Georgia, "Times New Roman", Times, serif; font-size: 9pt; color: #999; } }`}</style>
    <nav className="print-nav">
      <Link to={href(interactiveUrl)}>&larr; Back to interactive view</Link>
      <span style={{ float: "right" }}>
        <button
          onClick={() => setLargePrint(!largePrint)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 13, textDecoration: "underline" }}
        >
          {largePrint ? "Standard type" : "Large type"}
        </button>
      </span>
    </nav>
    <div className={`print-brief${largePrint ? " large-print" : ""}`}>
      {/* Masthead */}
      <header className="print-masthead">
        <div className="print-masthead-rule" />
        <h1 className="print-masthead-title">News Brief</h1>
        <time className="print-masthead-date">{dateStr}</time>
        <div className="print-masthead-rule" />
      </header>

      {/* Headline */}
      <div className="print-headline">
        <h1 className="print-headline-text">{brief.title}</h1>
        {brief.byline ? <p className="print-headline-byline">{brief.byline}</p> : null}
      </div>

      {/* Intro text */}
      {brief.content.text ? (
        <div className="print-intro print-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content.text}</ReactMarkdown>
        </div>
      ) : null}

      {/* Sections */}
      {brief.content.sections.map((section, i) => (
        <PrintSection key={section.id ?? i} section={section} footnotes={footnotes} />
      ))}

      {/* Top-level excerpts */}
      {brief.content.excerpts.map((excerpt, i) => (
        <PrintExcerpt key={i} excerpt={excerpt} footnotes={footnotes} />
      ))}

      {/* Top-level expandos */}
      {brief.content.expandos.map((expando, i) => (
        <PrintExpando key={expando.id ?? i} expando={expando} />
      ))}

      {/* Footnotes */}
      {footnotes.length > 0 ? (
        <div className="print-footnotes">
          <div className="print-footnotes-rule" />
          <h3 className="print-footnotes-title">Sources</h3>
          <ol className="print-footnotes-list">
            {footnotes.map((fn, i) => (
              <li key={i} className="print-footnote-item">
                <span className="print-footnote-num">[{i + 1}]</span>{" "}
                <span className="print-footnote-label">{fn.label}</span>{" "}
                <span className="print-footnote-url">{fn.url}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="print-end-mark">— end —</div>
    </div>
    </>
  );
}
