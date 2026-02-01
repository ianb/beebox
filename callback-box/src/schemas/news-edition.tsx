/**
 * News edition card schema - a curated narrative digest of news.
 *
 * Unlike a simple summary, an edition is a publication with:
 * - A title and byline
 * - Narrative structure (not just a list)
 * - Expandable sections for deeper content
 * - Interactive elements like queries
 * - References to source articles
 *
 * The agent creates editions that tell a story, not just filter content.
 */

import { element, serialize, type ElementNode } from "cardworks";
import { z } from "zod";

/**
 * Valid edition statuses.
 */
export const NewsEditionStatus = z.enum(["draft", "published", "archived"]);
export type NewsEditionStatus = z.infer<typeof NewsEditionStatus>;

/**
 * Edition title - the headline for this edition.
 */
export const EditionTitle = element("title", {
  text: z.string(),
});

/**
 * Edition date - when this edition was created.
 */
export const EditionDate = element("date", {
  /** ISO date (YYYY-MM-DD) */
  text: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Edition byline - a brief description/teaser.
 */
export const EditionByline = element("byline", {
  text: z.string(),
});

/**
 * Expando element - collapsible content for deeper exploration.
 *
 * The agent uses these to offer more detail without cluttering
 * the main narrative. User can expand to see more.
 *
 * Example:
 * ```xml
 * <expando title="Technical details" id="exp1">
 *   The implementation uses a novel approach where...
 *
 *   > "We found that by combining X with Y, we achieved Z"
 *   > — Lead researcher
 * </expando>
 * ```
 */
export const Expando = element("expando", {
  attrs: {
    /** Title shown when collapsed */
    title: z.string(),
    /** Optional ID for feedback targeting */
    id: z.string().optional(),
    /** Whether to start expanded (default: false) */
    expanded: z.boolean().optional(),
  },
  /** Markdown content shown when expanded */
  text: z.string(),
});

/**
 * Query element - prompts for user input/reflection.
 *
 * These are optional elements the agent can include to invite
 * user engagement. The agent learns when these are useful
 * based on whether users respond.
 *
 * Example:
 * ```xml
 * <query id="q1" prompt="What aspects interest you most?">
 *   This could lead to deeper exploration of specific areas.
 * </query>
 * ```
 */
export const Query = element("query", {
  attrs: {
    /** The question/prompt to show */
    prompt: z.string(),
    /** Optional ID for tracking */
    id: z.string().optional(),
  },
  /** Optional helper text explaining the query */
  text: z.string().optional(),
});

/**
 * Section element - major structural division.
 *
 * Sections group related content and can have their own
 * ID for paragraph-level feedback.
 *
 * Example:
 * ```xml
 * <section id="s1" heading="AI Developments">
 *   This week saw major announcements in...
 *
 *   <expando title="More on GPT-5">...</expando>
 * </section>
 * ```
 */
export const Section = element("section", {
  attrs: {
    /** Section heading */
    heading: z.string().optional(),
    /** ID for feedback targeting */
    id: z.string().optional(),
  },
  /** Can contain markdown, expandos, queries */
  children: z.array(z.union([Expando, Query])).optional(),
  /** Markdown text content */
  text: z.string().optional(),
});

/**
 * Main content element - the body of the edition.
 *
 * Contains markdown with embedded structural elements.
 * The content is the narrative the agent has crafted.
 */
export const EditionContent = element("content", {
  attrs: {
    format: z.literal("markdown").default("markdown"),
  },
  /** Can contain sections, expandos, queries inline */
  children: z.array(z.union([Section, Expando, Query])).optional(),
  /** Top-level markdown content */
  text: z.string().optional(),
});

/**
 * Source reference - links to a news-item card used in this edition.
 */
export const SourceRef = element("source", {
  attrs: {
    /** Path to the source news-item card */
    path: z.string(),
    /** How prominently this source was used */
    usage: z.enum(["primary", "supporting", "mentioned"]).optional(),
  },
  /** Title of the referenced article */
  text: z.string(),
});

/**
 * Sources container - all source references.
 */
export const Sources = element("sources", {
  children: z.array(SourceRef),
});

/**
 * News edition card schema.
 *
 * Example:
 * ```xml
 * <news-edition status="published">
 *   <title>The AI Winter That Wasn't</title>
 *   <date>2024-02-01</date>
 *   <byline>Recent developments suggest the opposite of a slowdown</byline>
 *
 *   <content format="markdown">
 * The past week has been remarkable for AI developments, with three
 * major announcements that together paint a picture of acceleration.
 *
 * <section id="s1" heading="The Big Three">
 *
 * First, OpenAI announced...
 *
 * <expando title="Technical deep-dive" id="exp1">
 * The architecture changes include...
 *
 * > "This represents a fundamental shift" — Sam Altman
 * </expando>
 *
 * </section>
 *
 * <query id="q1" prompt="Which of these developments interests you most?">
 * Your answer will help me focus future coverage.
 * </query>
 *   </content>
 *
 *   <sources>
 *     <source path="box/inbox/news/OpenAI_Announcement.news-item.card" usage="primary">OpenAI's Major Announcement</source>
 *     <source path="box/inbox/news/Google_Response.news-item.card" usage="supporting">Google's Response</source>
 *   </sources>
 * </news-edition>
 * ```
 */
export const NewsEditionSchema = element("news-edition", {
  attrs: {
    status: NewsEditionStatus.default("draft"),
  },
  children: z.array(
    z.union([
      EditionTitle,
      EditionDate,
      EditionByline,
      EditionContent,
      Sources,
    ])
  ),
});

export type NewsEdition = z.infer<typeof NewsEditionSchema>;

/**
 * Parsed news edition with typed accessors.
 */
export interface ParsedNewsEdition {
  status: NewsEditionStatus;
  title: string;
  date: string;
  byline: string;
  content: {
    format: "markdown";
    text: string;
    sections: Array<{
      id: string | undefined;
      heading: string | undefined;
      text: string | undefined;
      expandos: Array<{ id: string | undefined; title: string; text: string }>;
      queries: Array<{ id: string | undefined; prompt: string; text: string | undefined }>;
    }>;
    expandos: Array<{ id: string | undefined; title: string; text: string }>;
    queries: Array<{ id: string | undefined; prompt: string; text: string | undefined }>;
  };
  sources: Array<{
    path: string;
    title: string;
    usage: "primary" | "supporting" | "mentioned" | undefined;
  }>;
}

/**
 * Helper to extract child element by tag name.
 */
function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

/**
 * Helper to extract all children by tag name.
 */
function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

/**
 * Parse a news edition element into a typed structure.
 */
export function parseNewsEdition(edition: NewsEdition): ParsedNewsEdition {
  const children = edition.children as ElementNode[];

  const titleEl = getChild(children, "title");
  const dateEl = getChild(children, "date");
  const bylineEl = getChild(children, "byline");
  const contentEl = getChild(children, "content");
  const sourcesEl = getChild(children, "sources");

  // Parse content structure
  const contentChildren = (contentEl?.children ?? []) as ElementNode[];
  const sections = getChildren(contentChildren, "section").map((s) => {
    const sectionChildren = (s.children ?? []) as ElementNode[];
    return {
      id: s.attrs.id as string | undefined,
      heading: s.attrs.heading as string | undefined,
      text: s.text,
      expandos: getChildren(sectionChildren, "expando").map((e) => ({
        id: e.attrs.id as string | undefined,
        title: e.attrs.title as string,
        text: e.text ?? "",
      })),
      queries: getChildren(sectionChildren, "query").map((q) => ({
        id: q.attrs.id as string | undefined,
        prompt: q.attrs.prompt as string,
        text: q.text,
      })),
    };
  });

  // Top-level expandos and queries (not in sections)
  const topExpandos = getChildren(contentChildren, "expando").map((e) => ({
    id: e.attrs.id as string | undefined,
    title: e.attrs.title as string,
    text: e.text ?? "",
  }));
  const topQueries = getChildren(contentChildren, "query").map((q) => ({
    id: q.attrs.id as string | undefined,
    prompt: q.attrs.prompt as string,
    text: q.text,
  }));

  // Parse sources
  const sourceChildren = (sourcesEl?.children ?? []) as ElementNode[];
  const sources = sourceChildren.map((s) => ({
    path: s.attrs.path as string,
    title: s.text ?? "",
    usage: s.attrs.usage as "primary" | "supporting" | "mentioned" | undefined,
  }));

  return {
    status: edition.attrs.status as NewsEditionStatus,
    title: titleEl?.text ?? "Untitled",
    date: dateEl?.text ?? new Date().toISOString().slice(0, 10),
    byline: bylineEl?.text ?? "",
    content: {
      format: "markdown",
      text: contentEl?.text ?? "",
      sections,
      expandos: topExpandos,
      queries: topQueries,
    },
    sources,
  };
}

/**
 * Generate a slug from a title for URL use.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "");
}

/**
 * Generate the card filename for an edition.
 */
export function editionFilename(date: string, title: string): string {
  const slug = slugify(title).replace(/-/g, "_");
  const safeTitle = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `${date}_${safeTitle}.news-edition.card`;
}

/**
 * Template options for creating a news edition.
 */
export interface NewsEditionOptions {
  status?: NewsEditionStatus;
  title: string;
  date: string;
  byline: string;
  content: string;
  sources?: Array<{
    path: string;
    title: string;
    usage?: "primary" | "supporting" | "mentioned";
  }>;
}

/**
 * Template for creating a news edition card.
 */
export function createNewsEditionTemplate(options: NewsEditionOptions): string {
  const sources = (options.sources ?? []).map((s) => (
    <source path={s.path} usage={s.usage}>
      {s.title}
    </source>
  ));

  const edition = (
    <news-edition status={options.status ?? "draft"}>
      <title>{options.title}</title>
      <date>{options.date}</date>
      <byline>{options.byline}</byline>
      <content format="markdown">{options.content}</content>
      {sources.length > 0 && <sources>{sources}</sources>}
    </news-edition>
  );

  return serialize(edition as ElementNode) + "\n";
}
