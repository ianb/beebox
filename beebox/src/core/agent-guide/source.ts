/**
 * PROVENANCE — the guide's pointer for the two citation tags. Names
 * `{% quote %}` and `{% source %}`, says when each applies, and sends the
 * agent to `box-docs/provenance.md` for the mechanics (`usage`, composition,
 * anchoring, `retrieved`, transcription fixes). The rule against paraphrase
 * or fabrication inside `{% quote %}` is THE_LAW_OF_QUOTING, not restated here.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";
import { section } from "./sections.js";

export function sourceSection(): string {
  return `## ${section("PROVENANCE")} — \`{% quote %}\` and \`{% source %}\`

\`{% quote %}\` holds a person's exact words: the user's with no attributes, a third party's with \`from="…"\` naming them (${section("THE_LAW_OF_QUOTING")}). \`{% source %}\` wraps content derived from another card, file, or page (a summary, an inference, an extracted name): \`ref\` names the card or file it came from (\`href\` for an external URL), and \`usage\` says how you derived it. Before writing either tag beyond that basic form, read \`${BOX_PACKAGE_DOCS}/provenance.md\`: it covers \`usage\` wording, composing the two tags, anchoring a span, \`retrieved\` dates for web pages, when to skip the tag, and why you never write the \`[→ …]\` form you see in compiled context.`;
}
