/**
 * Feed fetcher service — typed interface for fetching RSS/Atom feed XML.
 *
 * Real implementation uses boxFetch(). Fake returns canned feed XML
 * from an in-memory map of URL → response.
 */

// ─── Service interface ───────────────────────────────────────────────────────

export interface FeedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface FeedFetcherService {
  fetch(url: string): Promise<FeedResponse>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createFeedFetcherService(): FeedFetcherService {
  // Lazy import to avoid pulling boxFetch into test bundles
  let boxFetchFn: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | null = null;

  return {
    async fetch(url: string): Promise<FeedResponse> {
      if (!boxFetchFn) {
        const mod = await import("../cli/lib/fetch.js");
        boxFetchFn = mod.boxFetch;
      }
      const res = await boxFetchFn(url);
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
      };
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeFeedEntry {
  url: string;
  xml: string;
  status?: number;
}

export interface FakeFeedFetcherService extends FeedFetcherService {
  feeds: FakeFeedEntry[];
  fetchedUrls: string[];
}

export function createFakeFeedFetcher(
  feeds?: FakeFeedEntry[],
): FakeFeedFetcherService {
  const fake: FakeFeedFetcherService = {
    feeds: [...(feeds ?? [])],
    fetchedUrls: [],

    async fetch(url: string): Promise<FeedResponse> {
      fake.fetchedUrls.push(url);
      const entry = fake.feeds.find((f) => f.url === url);
      if (!entry) {
        return {
          ok: false,
          status: 404,
          text: async () => "Not found",
        };
      }
      const status = entry.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => entry.xml,
      };
    },
  };

  return fake;
}
