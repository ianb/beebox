/**
 * Article fetcher service — typed interface for fetching web articles
 * and converting them to markdown.
 *
 * Real implementation uses boxFetch() + HTML extraction + Turndown.
 * Fake returns canned markdown from an in-memory map of URL → response.
 */

// ─── Service interface ───────────────────────────────────────────────────────

export interface ArticleFetchResult {
  /** Article content converted to markdown. */
  markdown: string;
  /** Final URL after redirects (may differ from original). */
  finalUrl: string;
}

export interface ArticleFetcherService {
  /**
   * Fetch a URL, extract main content, and convert to markdown.
   * Throws on HTTP errors or timeouts.
   */
  fetch(url: string, timeout?: number): Promise<ArticleFetchResult>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/**
 * Create the real article fetcher that does HTTP fetch → HTML extraction → markdown.
 *
 * Lazily imports dependencies to avoid pulling them into test bundles.
 */
export function createArticleFetcherService(): ArticleFetcherService {
  // Lazy imports
  let fetchArticleFn: ((url: string, timeout: number) => Promise<ArticleFetchResult>) | null = null;

  return {
    async fetch(url: string, timeout = 30000): Promise<ArticleFetchResult> {
      if (!fetchArticleFn) {
        const mod = await import("../core/commands/fetch-news.js");
        fetchArticleFn = mod.fetchArticle;
      }
      return fetchArticleFn(url, timeout);
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeArticleEntry {
  /** URL pattern — exact match or prefix match if ends with `*`. */
  url: string;
  /** Markdown content to return. */
  markdown: string;
  /** Final URL (defaults to the request URL). */
  finalUrl?: string;
  /** HTTP status code to simulate (non-2xx throws). */
  status?: number;
}

export interface FakeArticleFetcherService extends ArticleFetcherService {
  /** Pre-loaded article responses. */
  articles: FakeArticleEntry[];
  /** URLs that were fetched (in order). */
  fetchedUrls: string[];
}

export function createFakeArticleFetcher(
  articles?: FakeArticleEntry[],
): FakeArticleFetcherService {
  const fake: FakeArticleFetcherService = {
    articles: [...(articles ?? [])],
    fetchedUrls: [],

    async fetch(url: string): Promise<ArticleFetchResult> {
      fake.fetchedUrls.push(url);

      const entry = fake.articles.find((a) => {
        if (a.url.endsWith("*")) {
          return url.startsWith(a.url.slice(0, -1));
        }
        return a.url === url;
      });

      if (!entry) {
        const error = new Error("HTTP 404: Not Found");
        (error as Error & { statusCode?: number }).statusCode = 404;
        throw error;
      }

      const status = entry.status ?? 200;
      if (status < 200 || status >= 300) {
        const error = new Error(`HTTP ${status}`);
        (error as Error & { statusCode?: number }).statusCode = status;
        throw error;
      }

      return {
        markdown: entry.markdown,
        finalUrl: entry.finalUrl ?? url,
      };
    },
  };

  return fake;
}
