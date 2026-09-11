// Cards are the site's native source format. `site/cards/` holds callback-box
// card files — YAML frontmatter + markdown body, with the TYPE carried by the
// filename (`Name.<type>.card`, no `type:` field) — in exactly the shape a box
// authors them, so a page can move box → repo as a verbatim file copy.
//
// Two types live here: `site-page` (one built page each) and `site-aside` (the
// registry `{% aside ref="…" /%}` resolves against). This module owns only the
// enumeration; the schemas live with the code that consumes them (pages in
// render.ts, asides in asides.ts).

import fs from "node:fs/promises";
import path from "node:path";

export const PAGE_SUFFIX = ".site-page.card";
export const ASIDE_SUFFIX = ".site-aside.card";
export const DOC_SUFFIX = ".doc.card";

/** A card file that failed the directory's fail-closed enumeration rules. */
export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardError";
  }
}

export interface CardFile {
  /** Absolute path on disk. */
  abs: string;
  /** Basename with the `.<type>.card` suffix removed — the page slug / aside ref. */
  slug: string;
  /** site/-relative posix path, used in error messages. */
  file: string;
}

export interface CardFiles {
  pages: CardFile[];
  asides: CardFile[];
}

function cardFile(params: { dir: string; name: string; suffix: string; siteDir: string }): CardFile {
  const abs = path.join(params.dir, params.name);
  return {
    abs,
    slug: params.name.slice(0, -params.suffix.length),
    file: path.relative(params.siteDir, abs).split(path.sep).join("/"),
  };
}

/**
 * Enumerate `cards/`, sorted and split by type. Fail-closed by design: a card
 * of a type the site does not build, or a stray non-card file, is a named hard
 * error rather than a silently ignored file — the alternative is a page an
 * author believes is published and isn't.
 */
export async function listCardFiles(params: { cardsDir: string; siteDir: string }): Promise<CardFiles> {
  const { cardsDir, siteDir } = params;
  const entries = await fs.readdir(cardsDir, { recursive: true, withFileTypes: true });
  const out: CardFiles = { pages: [], asides: [] };
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const name = path.relative(cardsDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    if (name.split("/").some((part) => part.startsWith("."))) continue;
    const rel = `cards/${name}`;
    if (entry.isDirectory() && entry.name.endsWith(".attach")) continue;
    if (!entry.isFile()) throw new CardError(`${rel} is not a card or an attachment directory`);
    if (entry.name.endsWith(PAGE_SUFFIX) || entry.name.endsWith(DOC_SUFFIX)) {
      const suffix = entry.name.endsWith(DOC_SUFFIX) ? DOC_SUFFIX : PAGE_SUFFIX;
      out.pages.push(cardFile({ dir: cardsDir, name, suffix, siteDir }));
    } else if (entry.name.endsWith(ASIDE_SUFFIX)) {
      out.asides.push(cardFile({ dir: cardsDir, name, suffix: ASIDE_SUFFIX, siteDir }));
    } else {
      throw new CardError(
        `${rel} is not a card type the site builds (expected *${PAGE_SUFFIX}, *${DOC_SUFFIX} or *${ASIDE_SUFFIX})`,
      );
    }
  }
  return out;
}
