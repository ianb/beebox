# Plan Engineering Review — card themes

Review target: [Card themes](card-themes.md). This review concerns a draft plan,
not implemented behavior. Direct boxholder decisions recorded in the plan are
the review authority.

Independent review: Claude Fable, read-only, completed successfully on
2026-09-07. The primary agent checked and adjudicated its five findings below.
The reviewer confirmed the source citations it opened and found the built-in-only
authoring proposal explicitly labeled as a reviewable scope choice.

## What already exists

The planning pass verified FileView's separate surface modes, Markdoc quote
components, global schema fields, the Tailwind 3 build, and the on-demand inbound
reference scanner. These are reused with the changes specified in the plan.

## Prior art (external) — verified

The primary agent checked the official Tailwind 3 content/preprocessing and
Markdoc validation documentation linked in the plan. The read-only cross-model
reviewer has no browser tool and is not credited with independent web research.

## Stated preferences this plan trades against

Independent themes, three distinct starting treatments, optional chrome,
Properties with alternate views, selectable quote layering, and a lasting test1
tour. The initial implementation location is a proposed scope boundary, not a
settled human decision. Stack meaning and Properties contents require review.

## Could this be simpler? (verified)

The plan's simple alternative is a page CSS skin. Source confirms multiple
existing shells and quote components, so a page-only skin cannot satisfy the
multi-surface request. A runtime theme-code loader is not needed to ship three
engine-registered themes; that deferral remains subject to the boxholder's scope
decision.

## Failure modes

The primary pass and cross-model review identified that the existing
inbound reference scanner logs read errors without returning them, and that
the operational box-config loader collapses parse errors to empty config.
The revised plan specifies a typed config-read result with legacy wrapper
behavior preserved, and an additive error channel for inbound-reference results.
Properties must not call a partial scan complete.

## Agent-flow / user-flow edge cases

The plan distinguishes catalog names from refs, atomic theme choices from
inherited stocks, verbatim quotes from ordinary blockquotes, and card selection
from chrome and conversation selection. Knowledge audits are planned, not run.

## Findings

### Location rules and type preference

**Location in plan:** Track B, choice precedence.
**Citation:** "First matching box path rule" precedes both type layers.
**Issue:** The reviewer called path rules unrequested and noted that a broad
location rule overrides a functional card type's plain preference.
**Why it matters:** A deliberate type preference can lose to a broad rule.
**Suggested action:** The reviewer proposed removing rules or lowering priority.
**Traces to preference:** Type-specific treatment and general agent-controlled
styling must both remain understandable (principles 1/12).
**Adjudication:** Reject removal: location rules were part of the originating
brief, omitted from the review prompt's condensed authority summary. The plan
now records that requirement explicitly. Accept the precedence concern as a
product choice: show this collision in the tour and settle ordering before B.
The plan retains first-rule-wins as its proposal rather than adding specificity
machinery. This is a human decision, not a defect to hide through a new constraint.

### Frameless embed inheritance

**Location in plan:** Track C, surface policy.
**Citation:** Initial wording said embeds received context "where useful".
**Issue:** That conflicted with the blanket rule that nested cards reset themes.
**Why it matters:** A plain figure embedded in a Post-it could inherit yellow
or become a separate white block, depending on the implementer's interpretation.
**Suggested action:** Define the mode boundary explicitly.
**Traces to preference:** Shared structure must preserve existing embed behavior
(principles 8/10).
**Adjudication:** Accepted. Frameless embeds inherit and do not resolve their
subject's theme. Independently surfaced cards resolve and reset. A top-level
frameless render without an enclosing theme uses plain context.

### Minimal Properties should not wait for full metadata inventory

**Location in plan:** Tracks B/C/D and implementation order.
**Citation:** Initial D gated "Properties implementation" on the content review.
**Issue:** Alternate views on the back are already requested; new raw `theme`
frontmatter would also appear on the front until later renderer work.
**Why it matters:** The known back behavior is delayed by an unrelated content
decision, and configuration competes with card content in early theme examples.
**Suggested action:** Build a minimal back with the host, and exclude only the
new theme field from the default frontmatter table.
**Traces to preference:** Preferred view is the normal experience; alternate
views belong on the back.
**Adjudication:** Accepted. C includes alternate views, preferred-view reset,
and resolved theme/origin. A's inventory review governs additional properties
and relocation of existing fields. Commit chunks remain a single shipping unit.

### Config failure must not look like absent configuration

**Location in plan:** Track B, validation and config loading.
**Citation:** `src/core/box/config.ts:281-285` logs parse/read failure and
returns `{}`.
**Issue:** A consumer cannot tell an unreadable file from an absent setting.
**Why it matters:** A typo could silently restyle the box to plain.
**Suggested action:** Add an explicit config-read result and preserve behavior
for existing consumers.
**Traces to preference:** Visible failures and actual state (principles 4/13).
**Adjudication:** Accepted; also found during the primary pass. The plan now
specifies this exact seam, with invalid JSON and recovery tests. It does not
expand validation of unrelated operational fields.

### Plain chrome versus current chrome

**Location in plan:** Track C, optional chrome and rollout.
**Citation:** Initial wording promised "base/plain chrome" without defining it.
**Issue:** A new plain shell could restyle every unconfigured box on deployment.
**Why it matters:** That contradicts the proposed opt-in rollout.
**Suggested action:** Define base/plain chrome as the current shell appearance.
**Traces to preference:** Optional chrome, restrained theming, explicit rollout.
**Adjudication:** Accepted. Base/plain preserves current chrome; paper adds the
new opt-in chrome treatment. Card themes do not change chrome by navigation.

## NOT in scope (verified)

No implementation changes in this work unit. The plan defers chat message
layers, native composer styling, production stacks, and box-local theme code
loading. It does not authorize production-box restyling.

## Things I checked and found clean

The plan preserves existing view selection, quote attribution and reference
resolution; separates theme selection from view registration; and names the
Tailwind 3 limitation rather than promising box-source CSS compilation.
All template sections are present. Final `pnpm --dir beebox doc-check` passed;
whitespace and private-source marker checks passed for both documents.
No runtime tests or visual tour
were run: those verify implementation, which this work unit does not create.

## Implementation review

Claude Opus reviewed the working implementation against the authorized scope.
The resolver, path matcher, atomic choices, YAML preservation, quote semantics,
and scoped embed design checked out. The following integration findings were
accepted and corrected:

- A sticky-note box default now uses plain chrome quietly. Only an explicit
  unsupported chrome selection reports an error.
- Chat card headers retain their path and open-in-new-tab control.
- Companion card hosts retain the flex layout required by fill-height views.
- Incomplete referrer scans remain visible in trash confirmation and CLI output.
- Links outside card surfaces retain a concrete pen color.
- Box-agent documentation includes the actual presentation config shape and
  location-rule authoring, rather than precedence prose alone.

Additional corrections from the review: stock CSS selectors include their
owning theme, catalog quote defaults drive the material host, and the gallery
installer uses decoded module paths and an explicit destination. A separate
owner-path audit found and corrected preferred-view reset on the `/views/`
route. Verification evidence is recorded in the plan after the final checks.

### Preview physicality follow-up

The follow-up review checked the preview frame, material layering, and responsive
scroll chain. It confirmed the height/overflow and foreground stacking behavior.
Its Close-control test locator and print-pseudo-element findings were already
corrected while review ran. The remaining finding was applied: the preview desk
uses a neutral background for plain cards, with the warm desk selected only by
the direct paper/sticky-note card surface. Classic scrollbars reserve equal
space on both sides. Existing overlay focus containment/restoration limitations
were not introduced by this correction.
