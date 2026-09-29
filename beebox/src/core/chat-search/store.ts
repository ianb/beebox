/**
 * The chat-transcript search index's store: one instance of the generic
 * index-store factory (`search/store/index-store.ts`) with the chat index's
 * filenames and schema. Disposable cache in `.beebox/`, never a source of
 * truth — same contract as the card index.
 */

import type { Orama } from "@orama/orama";
import { createIndexStore } from "../search/store/index-store.js";
import { chatOramaSchema } from "./schema.js";

export type ChatSearchIndex = Orama<typeof chatOramaSchema>;

export const chatSearchStore = createIndexStore(
  {
    indexFilename: "chat-search-index.json",
    manifestFilename: "chat-search-manifest.json",
    lockFilename: "chat-search.lock",
    label: "chat-search",
  },
  chatOramaSchema,
);
