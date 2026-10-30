/**
 * What a set of open documents are called, and what marks stand for them.
 *
 * A surface that lists cards it has not loaded — the sidecar's tab strip is the
 * one this was built for — has only paths. It used to carry a label captured
 * when the tab opened, which meant renaming a card left its tab saying the old
 * thing while the card body below it updated
 * (`issues/closed/bugs/2026-09-05-sidecar-tab-label-never-updates.md`), and it meant a
 * pinned tab restored from storage had never seen a title at all.
 *
 * So identity is read, not remembered: one batched `files.summarize` for the
 * paths on screen, invalidated when any of them changes on disk. The bus
 * subscription matches paths the way `FileView`'s does; the difference is that this
 * hook watches a *set* of paths rather than one.
 */

import { useCallback, useMemo } from "react";
import { trpc } from "../lib/trpc/client";
import { useLiveRefresh } from "./useLiveRefresh";
import type { RealtimeEvent } from "./useBusSubscription";
import { fileChangeAt } from "../lib/live-refresh";
import type { CardSymbolData } from "@shared/card-symbol";
import type { ThemeChoice } from "@shared/card-theme/core";

export interface CardIdentity {
  title: string;
  symbol: CardSymbolData | null;
  type?: string;
  cardTheme?: ThemeChoice;
}

export function useCardIdentities(paths: string[]): Map<string, CardIdentity> {
  // Sorted and de-duplicated so the query key is stable under reordering — the
  // strip reorders on every pin, and a pin must not refetch every identity.
  const key = useMemo(() => [...new Set(paths)].toSorted(), [paths]);
  const utils = trpc.useUtils();
  const query = trpc.files.summarize.useQuery({ paths: key }, { enabled: key.length > 0 });

  const resync = useCallback(() => {
    void utils.files.summarize.invalidate({ paths: key });
  }, [key, utils]);
  // A change to any listed path (or a rename of a directory holding one), and
  // a reconnect: a retitle that landed while the socket was down would leave
  // the tab saying the old thing, the bug this hook exists to fix.
  const when = useMemo(() => {
    const matchers = key.map(fileChangeAt);
    return (event: RealtimeEvent) => matchers.some((matches) => matches(event));
  }, [key]);
  useLiveRefresh({ when, refresh: resync });

  return useMemo(() => {
    const out = new Map<string, CardIdentity>();
    for (const summary of query.data ?? []) {
      if (summary === null) continue;
      out.set(summary.path, {
        title: summary.title,
        symbol: summary.symbol ?? null,
        ...(summary.type === undefined ? {} : { type: summary.type }),
        ...(summary.cardTheme === undefined ? {} : { cardTheme: summary.cardTheme }),
      });
    }
    return out;
  }, [query.data]);
}
