/** The package ships no types; this is the one export `webpage-readable.ts` uses. */
declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export const tables: TurndownService.Plugin;
}
