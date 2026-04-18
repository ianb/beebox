/**
 * Shared types for the news brief view components.
 */

export interface Expando {
  id?: string;
  title: string;
  text: string;
}

export interface Query {
  id?: string;
  prompt: string;
  text?: string;
}

export interface Excerpt {
  source: string;
  link?: string;
  text: string;
}

export interface Section {
  id?: string;
  heading?: string;
  link?: string;
  via?: string;
  text?: string;
  expandos: Expando[];
  queries: Query[];
  excerpts: Excerpt[];
}

export interface SourceRef {
  path: string;
  title: string;
  usage?: "primary" | "supporting" | "mentioned";
}

export interface NewsBriefData {
  title: string;
  date: string;
  byline: string;
  content: {
    format: "markdown";
    text: string;
    sections: Section[];
    expandos: Expando[];
    queries: Query[];
    excerpts: Excerpt[];
  };
  sources: SourceRef[];
}

export interface GuideReaction {
  id: string;
  sentiment: "positive" | "negative" | "neutral";
  text: string;
}

export interface BriefReaction {
  id: string;
  experimentRef?: string;
  text: string;
}
