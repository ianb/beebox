/**
 * Print-mode rendering of a news brief. Uses the `print-*` CSS classes
 * defined in index.css (not Tailwind utilities) so the layout holds up
 * when sent to a printer or saved as PDF. Separated from the routing
 * shell (pages/news/PrintBriefView.tsx) so the appearance lives in a
 * component file.
 */

import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { href } from "../../../../lib/routing";
import { Markdown } from "../../../../components/Markdown";
import type { NewsBriefData, Section, Excerpt, Expando } from "./types";

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
        <Markdown>{expando.text}</Markdown>
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
          <Markdown>{section.text}</Markdown>
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

interface PrintBriefRendererProps {
  brief: NewsBriefData;
  largePrint: boolean;
  onToggleLargePrint: () => void;
  interactiveUrl: string;
}

export function PrintBriefRenderer({ brief, largePrint, onToggleLargePrint, interactiveUrl }: PrintBriefRendererProps) {
  useEffect(() => {
    const dateStr = new Date(brief.date + "T00:00").toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    document.title = `News Brief — ${dateStr}`;
  }, [brief]);

  const footnotes = collectFootnotes(brief);
  const dateStr = new Date(brief.date + "T00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
            onClick={onToggleLargePrint}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 13, textDecoration: "underline" }}
          >
            {largePrint ? "Standard type" : "Large type"}
          </button>
        </span>
      </nav>
      <div className={`print-brief${largePrint ? " large-print" : ""}`}>
        <header className="print-masthead">
          <div className="print-masthead-rule" />
          <h1 className="print-masthead-title">News Brief</h1>
          <time className="print-masthead-date">{dateStr}</time>
          <div className="print-masthead-rule" />
        </header>

        <div className="print-headline">
          <h1 className="print-headline-text">{brief.title}</h1>
          {brief.byline ? <p className="print-headline-byline">{brief.byline}</p> : null}
        </div>

        {brief.content.text ? (
          <div className="print-intro print-prose">
            <Markdown>{brief.content.text}</Markdown>
          </div>
        ) : null}

        {brief.content.sections.map((section, i) => (
          <PrintSection key={section.id ?? i} section={section} footnotes={footnotes} />
        ))}

        {brief.content.excerpts.map((excerpt, i) => (
          <PrintExcerpt key={i} excerpt={excerpt} footnotes={footnotes} />
        ))}

        {brief.content.expandos.map((expando, i) => (
          <PrintExpando key={expando.id ?? i} expando={expando} />
        ))}

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
