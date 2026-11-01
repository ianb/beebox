/**
 * bbx refs - What refers to a card, and which block of it.
 *
 *   bbx refs <card>[#anchor] [--json]
 *
 * Uses the scan `bbx mv` and `bbx rm` use, so a relative ref counts the way it
 * resolves. Refs into the card's attach folder count, as they do for trash.
 */

import { Command } from "commander";
import * as path from "node:path";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { pathExistsStrict } from "../../lib/file-exists.js";
import { findInboundCardRefs, type InboundCardRef } from "../../core/find-inbound-card-refs.js";
import { errorMessage } from "../../shared/error-guards.js";
import { resolveCliTargetPath } from "../lib/cli-target-path.js";

/** A bad argument; the message says what to give instead. */
class RefsError extends Error {
  override name = "RefsError";
  constructor(what: { readonly detail: string }) {
    super(what.detail);
  }
}

/** The referrers that name `anchor`, each reduced to those refs. Without an anchor, all of them. */
export function referrersNaming(referrers: readonly InboundCardRef[], anchor: string | undefined): InboundCardRef[] {
  if (anchor === undefined) return [...referrers];
  return referrers.flatMap((referrer) => {
    const fragments = referrer.fragments.filter((fragment) => fragment === anchor);
    return fragments.length === 0 ? [] : [{ path: referrer.path, refs: fragments.length, fragments }];
  });
}

export function formatReferrer({ path: referrer, refs, fragments }: InboundCardRef): string {
  const noun = refs === 1 ? "ref" : "refs";
  const named = fragments.length === 0 ? "" : `: ${fragments.map((fragment) => `#${fragment}`).join(", ")}`;
  return `${referrer}  (${String(refs)} ${noun}${named})`;
}

async function run(target: string, options: { json?: boolean }): Promise<void> {
  const boxRoot = await requireBoxRoot();
  const hash = target.indexOf("#");
  const raw = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? undefined : target.slice(hash + 1);
  if (anchor === "") throw new RefsError({ detail: `Empty anchor in ${target}` });
  const abs = resolveCliTargetPath({ boxRoot, raw, relativeTo: boxRoot });
  const card = path.relative(boxRoot, abs);
  if (!(await pathExistsStrict(abs, { followLinks: false }))) throw new RefsError({ detail: `No such card: ${card}` });
  const { referrers, errors } = await findInboundCardRefs({ boxRoot, cardPath: card });
  const named = referrersNaming(referrers, anchor);
  if (options.json === true) {
    console.log(JSON.stringify({ card, ...(anchor === undefined ? {} : { anchor }), referrers: named, errors }, null, 2));
    return;
  }
  for (const error of errors) console.error(`Warning: reference scan incomplete: ${error}`);
  if (named.length === 0) {
    console.log(`Nothing refers to ${card}${anchor === undefined ? "" : `#${anchor}`}.`);
    return;
  }
  for (const referrer of named) console.log(formatReferrer(referrer));
}

export const refsCommand = new Command("refs")
  .description("List the cards and files that refer to a card, and which #anchors they name")
  .argument("<card>", "Card path, with #anchor to list only refs that name that block")
  .option("--json", "Print { card, anchor?, referrers: [{ path, refs, fragments }], errors }")
  .addHelpText("after", `
One line per referrer: path  (2 refs: #a, #b). A ref with no #fragment counts but lists none.
Anchors are headings (their slug or {% #id %}) and paragraphs ending in {% #id %}.
`)
  .action(async (target: string, options: { json?: boolean }) => {
    try {
      await run(target, options);
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
