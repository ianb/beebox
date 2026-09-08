/**
 * What a set of open documents are called, and what marks stand for them.
 *
 * A surface that lists cards it has not loaded — the sidecar's tab strip is the
 * one this was built for — has only paths. It used to carry a label captured
 * when the tab opened, which meant renaming a card left its tab saying the old
 * thing while the card body below it updated
 * (`issues/bugs/2026-09-05-sidecar-tab-label-never-updates.md`), and it meant a
 * pinned tab restored from storage had never seen a title at all.
 *
 * So identity is read, not remembered: one batched `files.summarize` for the
 * paths on screen, invalidated when any of them changes on disk. The bus
 * subscription is the same one `FileView` uses; the difference is that this
 * hook watches a *set* of paths rather than one.
 */

import { useCallback, useMemo, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useBusSubscription, type RealtimeEvent } from "./useBusSubscription";
import { busEventData } from "../lib/bus-events";
import { boxRelativePath } from "@shared/box-path";
import type { CardSymbolData } from "@shared/card-symbol";
import type { ThemeChoice } from "@shared/card-theme";

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
  // Skip the very first connect: the query already ran on mount, so a resync
  // there is a redundant fetch.
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const fileChange = busEventData(event, "file-change");
      if (!fileChange) return;
      const changed = boxRelativePath(fileChange.path);
      if (!key.some((path) => boxRelativePath(path) === changed)) return;
      resync();
    }, [key, resync]),
    // `file-change` events are transient and never replayed, so a retitle that
    // landed while the socket was down would leave the tab saying the old thing
    // — the very bug this hook exists to fix. Same belt as `FileView`'s.
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      resync();
    }, [resync]),
  });

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
