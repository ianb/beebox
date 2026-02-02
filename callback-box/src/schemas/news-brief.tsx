/**
 * News brief card schema - a curated narrative digest of news.
 *
 * Unlike a simple summary, a brief is a personal publication with:
 * - A title and byline
 * - Narrative structure (not just a list)
 * - Expandable sections for deeper content
 * - Interactive elements like queries
 * - References to source articles
 *
 * The agent creates briefs that tell a story, not just filter content.
 */

import { element, serialize, type ElementNode } from "cardworks";
import { z } from "zod";

/**
 * Edition title - the headline for this brief.
 */
export const BriefTitle = element("title", {
  text: z.string(),
});

/**
 * Edition date - when this brief was created.
 */
export const BriefDate = element("date", {
  /** ISO date (YYYY-MM-DD) */
  text: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Edition byline - a brief description/teaser.
 */
export const BriefByline = element("byline", {
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
 * Excerpt element - a direct quote from a source article.
 *
 * Use excerpts to let the original author's voice come through,
 * especially for memorable phrasing or key technical explanations.
 * The reader hasn't read the article, so excerpts provide texture.
 *
 * Example:
 * ```xml
 * <excerpt source="Article Title" link="https://example.com/article">
 *   "The protection routine performed I/O operations with the dongle
 *   but always returned the same hardcoded constant."
 * </excerpt>
 * ```
 */
export const Excerpt = element("excerpt", {
  attrs: {
    /** Title of the source being quoted */
    source: z.string(),
    /** Optional link to the source */
    link: z.string().url().optional(),
  },
  /** The quoted text */
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
    /** Link to the primary source article for this section */
    link: z.string().url().optional(),
    /** Feed/source name (e.g., "Hacker News") */
    via: z.string().optional(),
  },
  /** Can contain markdown, expandos, queries, excerpts */
  children: z.array(z.union([Expando, Query, Excerpt])).optional(),
  /** Markdown text content */
  text: z.string().optional(),
});

/**
 * Main content element - the body of the brief.
 *
 * Contains markdown with embedded structural elements.
 * The content is the narrative the agent has crafted.
 */
export const BriefContent = element("content", {
  attrs: {
    format: z.literal("markdown").default("markdown"),
  },
  /** Can contain sections, expandos, queries, excerpts inline */
  children: z.array(z.union([Section, Expando, Query, Excerpt])).optional(),
  /** Top-level markdown content */
  text: z.string().optional(),
});

/**
 * Source reference - links to a news-item card used in this brief.
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
 * Reference to an interest from the guide that influenced this brief.
 */
export const InterestRef = element("interest", {
  attrs: {
    /** How this interest was applied */
    application: z.enum(["featured", "included", "tested"]).optional(),
  },
  /** The interest topic from the guide */
  text: z.string(),
});

/**
 * Reference to an experiment being tested in this brief.
 */
export const ExperimentRef = element("experiment-ref", {
  attrs: {
    /** ID of the experiment in the guide */
    id: z.string(),
  },
  /** Brief note on how the experiment was applied */
  text: z.string().optional(),
});

/**
 * A hypothesis being tested in this brief.
 * These are specific testable claims that feedback can confirm or deny.
 */
export const BriefHypothesis = element("hypothesis", {
  attrs: {
    /** Unique ID for referencing in feedback */
    id: z.string(),
    /** Related experiment ID if any */
    "experiment-ref": z.string().optional(),
  },
  /** The hypothesis statement */
  text: z.string(),
});

/**
 * Curation metadata - how the guide influenced this brief.
 *
 * This enables learning from feedback by tracking what decisions
 * were made and why, so we can update the guide based on results.
 *
 * Example:
 * ```xml
 * <curation guide-version="2026-02-01T10:00:00Z">
 *   <interest application="featured">AI safety</interest>
 *   <interest application="tested">retro computing</interest>
 *   <experiment-ref id="exp-retro">Testing if retro content is engaging</experiment-ref>
 *   <hypothesis id="h1" experiment-ref="exp-retro">
 *     User will engage with Amiga Unix content as a change of pace
 *   </hypothesis>
 *   <hypothesis id="h2">
 *     Technical depth on AI security will be appreciated
 *   </hypothesis>
 *   <rationale>
 *     Combined AI security (high-confidence interest) with retro computing
 *     (hypothesis to test) as an experiment in tonal contrast.
 *   </rationale>
 * </curation>
 * ```
 */
export const Curation = element("curation", {
  attrs: {
    /** Timestamp of the guide version used */
    "guide-version": z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(
    z.union([
      InterestRef,
      ExperimentRef,
      BriefHypothesis,
      /** Explanation of editorial decisions */
      element("rationale", { text: z.string() }),
    ])
  ).optional(),
});

/**
 * News brief card schema.
 *
 * Curation comes first because it guides the content - the editorial
 * decisions should be made before writing begins.
 *
 * Example:
 * ```xml
 * <news-brief>
 *   <curation guide-version="2026-02-01T10:00:00Z">
 *     <interest application="featured">AI safety</interest>
 *     <hypothesis id="h1">Technical depth will resonate</hypothesis>
 *     <rationale>Focusing on security themes that connect multiple stories</rationale>
 *   </curation>
 *
 *   <title>The AI Winter That Wasn't</title>
 *   <date>2024-02-01</date>
 *   <byline>Recent developments suggest the opposite of a slowdown</byline>
 *
 *   <content format="markdown">
 * The past week has been remarkable for AI developments...
 *
 * <section id="s1" heading="The Big Three">
 * First, OpenAI announced...
 * <expando title="Technical deep-dive" id="exp1">...</expando>
 * </section>
 *
 * <query id="q1" prompt="Which interests you most?">
 * Your answer will help focus future coverage.
 * </query>
 *   </content>
 *
 *   <sources>
 *     <source path="store/archive/news/Article.news-item.card" usage="primary">Article Title</source>
 *   </sources>
 * </news-brief>
 * ```
 */
export const NewsBriefSchema = element("news-brief", {
  children: z.array(
    z.union([
      Curation,
      BriefTitle,
      BriefDate,
      BriefByline,
      BriefContent,
      Sources,
    ])
  ),
});

export type NewsBrief = z.infer<typeof NewsBriefSchema>;

/**
 * Parsed news brief with typed accessors.
 */
/**
 * Parsed excerpt structure.
 */
export interface ParsedExcerpt {
  source: string;
  link: string | undefined;
  text: string;
}

export interface ParsedNewsBrief {
  title: string;
  date: string;
  byline: string;
  content: {
    format: "markdown";
    text: string;
    sections: Array<{
      id: string | undefined;
      heading: string | undefined;
      link: string | undefined;
      via: string | undefined;
      text: string | undefined;
      expandos: Array<{ id: string | undefined; title: string; text: string }>;
      queries: Array<{ id: string | undefined; prompt: string; text: string | undefined }>;
      excerpts: Array<ParsedExcerpt>;
    }>;
    expandos: Array<{ id: string | undefined; title: string; text: string }>;
    queries: Array<{ id: string | undefined; prompt: string; text: string | undefined }>;
    excerpts: Array<ParsedExcerpt>;
  };
  sources: Array<{
    path: string;
    title: string;
    usage: "primary" | "supporting" | "mentioned" | undefined;
  }>;
  curation: {
    guideVersion: string | undefined;
    interests: Array<{
      topic: string;
      application: "featured" | "included" | "tested" | undefined;
    }>;
    experimentRefs: Array<{
      id: string;
      note: string | undefined;
    }>;
    hypotheses: Array<{
      id: string;
      experimentRef: string | undefined;
      text: string;
    }>;
    rationale: string | undefined;
  } | undefined;
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
 * Parse a news brief element into a typed structure.
 */
export function parseNewsBrief(brief: NewsBrief): ParsedNewsBrief {
  const children = brief.children as ElementNode[];

  const titleEl = getChild(children, "title");
  const dateEl = getChild(children, "date");
  const bylineEl = getChild(children, "byline");
  const contentEl = getChild(children, "content");
  const sourcesEl = getChild(children, "sources");

  // Helper to parse excerpts
  const parseExcerpts = (children: ElementNode[]): ParsedExcerpt[] =>
    getChildren(children, "excerpt").map((e) => ({
      source: e.attrs.source as string,
      link: e.attrs.link as string | undefined,
      text: e.text ?? "",
    }));

  // Parse content structure
  const contentChildren = (contentEl?.children ?? []) as ElementNode[];
  const sections = getChildren(contentChildren, "section").map((s) => {
    const sectionChildren = (s.children ?? []) as ElementNode[];
    return {
      id: s.attrs.id as string | undefined,
      heading: s.attrs.heading as string | undefined,
      link: s.attrs.link as string | undefined,
      via: s.attrs.via as string | undefined,
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
      excerpts: parseExcerpts(sectionChildren),
    };
  });

  // Top-level expandos, queries, and excerpts (not in sections)
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
  const topExcerpts = parseExcerpts(contentChildren);

  // Parse sources
  const sourceChildren = (sourcesEl?.children ?? []) as ElementNode[];
  const sources = sourceChildren.map((s) => ({
    path: s.attrs.path as string,
    title: s.text ?? "",
    usage: s.attrs.usage as "primary" | "supporting" | "mentioned" | undefined,
  }));

  // Parse curation
  const curationEl = getChild(children, "curation");
  let curation: ParsedNewsBrief["curation"] = undefined;
  if (curationEl) {
    const curationChildren = (curationEl.children ?? []) as ElementNode[];
    const interests = getChildren(curationChildren, "interest").map((i) => ({
      topic: i.text ?? "",
      application: i.attrs.application as "featured" | "included" | "tested" | undefined,
    }));
    const experimentRefs = getChildren(curationChildren, "experiment-ref").map((e) => ({
      id: e.attrs.id as string,
      note: e.text,
    }));
    const hypotheses = getChildren(curationChildren, "hypothesis").map((h) => ({
      id: h.attrs.id as string,
      experimentRef: h.attrs["experiment-ref"] as string | undefined,
      text: h.text ?? "",
    }));
    const rationaleEl = getChild(curationChildren, "rationale");
    curation = {
      guideVersion: curationEl.attrs["guide-version"] as string | undefined,
      interests,
      experimentRefs,
      hypotheses,
      rationale: rationaleEl?.text,
    };
  }

  return {
    title: titleEl?.text ?? "Untitled",
    date: dateEl?.text ?? new Date().toISOString().slice(0, 10),
    byline: bylineEl?.text ?? "",
    content: {
      format: "markdown",
      text: contentEl?.text ?? "",
      sections,
      expandos: topExpandos,
      queries: topQueries,
      excerpts: topExcerpts,
    },
    sources,
    curation,
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
 * Generate the card filename for an brief.
 */
export function briefFilename(date: string, title: string): string {
  const slug = slugify(title).replace(/-/g, "_");
  const safeTitle = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `${date}_${safeTitle}.news-brief.card`;
}

/**
 * Template options for creating a news brief.
 */
export interface NewsBriefOptions {
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
 * Template for creating a news brief card.
 */
export function createNewsBriefTemplate(options: NewsBriefOptions): string {
  const sources = (options.sources ?? []).map((s) => (
    <source path={s.path} usage={s.usage}>
      {s.title}
    </source>
  ));

  const brief = (
    <news-brief>
      <title>{options.title}</title>
      <date>{options.date}</date>
      <byline>{options.byline}</byline>
      <content format="markdown">{options.content}</content>
      {sources.length > 0 && <sources>{sources}</sources>}
    </news-brief>
  );

  return serialize(brief as ElementNode) + "\n";
}
