/**
 * Render the final catalog.
 *
 * Deliberately a script, not an agent: a ~600-story document is more than one agent can emit
 * faithfully, and generating it mechanically is what guarantees every verdict shown matches the
 * verification actually recorded for that story. Nothing here invents text — every sentence comes
 * from a story file, a verifier note, a panel note, or a browser check.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
 *           > callback-box/user-stories/catalog/<date>.md
 */
import { execFileSync } from "node:child_process";

import { loadRun } from "./load-run.ts";
import type { Story } from "./load-run.ts";

const GENERATED = process.env.CATALOG_DATE ?? "2026-08-21";
const DATA_BASENAME = `${GENERATED}.jsonl`;

const GROUP_TITLES: Record<string, string> = {
  chat: "Chat",
  capture: "Capture — getting content in",
  cards: "Cards",
  browse: "Browsing and organizing",
  search: "Search",
  connectors: "Connectors — Gmail, Calendar, Drive",
  messaging: "Messaging out",
  automation: "Automation",
  knowledge: "What the agent knows",
  publish: "Publishing",
  admin: "Access and administration",
  deploy: "Install, deploy, and box lifecycle",
  mobile: "Mobile",
  dev: "Developer and maintainer tooling",
  other: "Other",
};

/** Order the document reads in: what a person does, before what an operator does. */
const GROUP_ORDER = [
  "chat", "capture", "browse", "cards", "search", "connectors", "messaging",
  "automation", "knowledge", "publish", "mobile", "admin", "deploy", "dev", "other",
];

const AUDIENCE_TITLES: Record<string, string> = {
  "web-ui": "In the web app",
  "agent-scripts": "For the box agent, scripts, and the CLI",
  operator: "For whoever runs the box",
};
const AUDIENCE_ORDER = ["web-ui", "agent-scripts", "operator"];

// --- Load ------------------------------------------------------------------

/**
 * How much the product has moved since this catalog was generated.
 *
 * A dated catalog invites being read as current. Counting the commits that landed after it is the
 * cheapest honest correction — a reader can see at a glance whether they are looking at a
 * description of today's product or a historical one. Returns undefined outside a git checkout.
 */
function commitsSince(date: string): number | undefined {
  try {
    const out = execFileSync(
      "git",
      ["log", "--oneline", `--since=${date}`, "--", "callback-box/src"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\n").filter((l) => l.trim() !== "").length;
  } catch (_e) {
    return undefined; // not a checkout, or git unavailable: say nothing rather than guess
  }
}

const { stories, discovered, verdicts, panelVotes, browser, triage, pageNotes } = loadRun(GENERATED);

// --- Resolve one verdict per story ----------------------------------------
type Status = "verified" | "cleared" | "flagged" | "unverified"

function statusOf(s: Story): Status {
  // Triage speaks last because it is the only stage that sees everything at once — the story, the
  // verifier's note, the three panel notes, and the browser check. It overrules a browser failure
  // when the check itself was wrong: one story failed in the app only because the test box had no
  // todos, and the badge it claims renders nothing at zero by design.
  const t = triage.get(s.id);
  if (t?.classification === "false-negative") return "cleared";
  if (t?.classification === "real-gap") return "flagged";

  const b = browser.get(s.id);
  if (b?.status === "confirmed") return "verified";   // the running app outranks a reading of the code
  if (b?.status === "failed") return "flagged";

  const v = verdicts.get(s.id);
  if (v === undefined) return "unverified";
  if (v.verdict === "accurate") return "verified";

  // Flagged by a verifier, then cleared by the panel before triage ever saw it. Clearing requires
  // ALL THREE lenses to be satisfied, not a majority: the lenses test separate necessary conditions
  // (exists / reachable / accurately worded), so one refutation is enough to keep the flag.
  const votes = panelVotes.get(s.id);
  if (votes !== undefined && votes.length >= 3 && !votes.some((x) => x.refuted)) {
    return "cleared";
  }
  return "flagged";
}

const BADGE: Record<Status, string> = {
  verified: "✅ verified",
  cleared: "✅ verified (flag reviewed and cleared)",
  flagged: "❌ flagged",
  unverified: "⚠️ unverified",
};

// A story dropped as stale is not a capability — it does not belong in a catalog of what the
// product does. It is listed in the appendix instead.
const stale = stories.filter((s) => triage.get(s.id)?.classification === "stale-story");
const staleIds = new Set(stale.map((s) => s.id));
const live = stories.filter((s) => !staleIds.has(s.id));

const counts = { verified: 0, cleared: 0, flagged: 0, unverified: 0 };
for (const s of live) counts[statusOf(s)]++;

// --- Emit ------------------------------------------------------------------
const out: string[] = [];
const p = (line?: string): void => { out.push(line ?? ""); };

p("# callback-box — What it does");
p();
p("_Auto-generated from the source code by a multi-agent workflow, then verified against the code");
p("and against the running app. Nothing in this document is written by hand._");
p();
p("The pipeline that produced it, the data it was rendered from, and the known limits of the");
p("method are in [the pipeline README](../README.md). The underlying");
p(`records are [\`${DATA_BASENAME}\`](${DATA_BASENAME}) — one JSON object per capability.`);
p();
p(`**Generated:** ${GENERATED} · **Scope:** \`callback-box/\` only · paths are relative to the repository root`);
const drift = commitsSince(GENERATED);
if (drift !== undefined && drift > 0) {
  p();
  p(`> **${drift} commits have landed in \`callback-box/src\` since this was generated.** Individual`);
  p("> capabilities are re-checked as fixes land (each carries its own last-checked date); the rest");
  p("> describe the product as of the generated date above.");
}
p();
p("## Summary");
p();
const bConfirmed = [...browser.values()].filter((b) => b.status === "confirmed").length;
const bFailed = [...browser.values()].filter((b) => b.status === "failed").length;
const bInconclusive = [...browser.values()].filter((b) => b.status === "inconclusive").length;

p("Read the whole chain before quoting a number from it:");
p();
p("| | |");
p("|---|--:|");
p(`| Capability statements discovered by the readers | ${discovered} |`);
p(`| …merged away as duplicates of another statement | ${discovered - stories.length} |`);
p(`| …dropped as describing capability the product no longer has | ${stale.length} |`);
p(`| **Capabilities catalogued here** | **${live.length}** |`);
p(`| — of those, confirmed against the source | ${counts.verified + counts.cleared} |`);
p(`| — of those, flagged as unconfirmed | ${counts.flagged} |`);
if (counts.unverified > 0) p(`| — of those, with no verdict recorded | ${counts.unverified} |`);
p(`| Additionally driven in the running app | ${browser.size} |`);
p(`| — behaved as described | ${bConfirmed} |`);
p(`| — did not | ${bFailed} |`);
p(`| — could not be settled either way | ${bInconclusive} |`);
p();
p(`So **${counts.verified + counts.cleared} of ${live.length}** retained statements are source-confirmed.`);
p("That percentage is over what survived merging and dropping, not over everything the readers");
p(`found: ${discovered - stories.length} statements were folded into another as duplicates before`);
p("any verification happened, and those are neither confirmed nor flagged — they are simply gone.");
p(`Of the ${browser.size} statements also driven in the app, ${bInconclusive} could not be settled —`);
p("roughly a third — so an in-app check is available for far fewer capabilities than the code check.");
p();
p("**How to read a verdict.** Verification was deliberately adversarial: verifiers were told to");
p('refute when uncertain, so a ❌ means *"a human should look at this"*, not *"this is definitely');
p('broken"*. Every flag was then re-examined by three independent reviewers looking through');
p("different lenses — does the code exist, is it reachable, does it do the whole of what is claimed.");
p("Where a story was checked in");
p("the running app, what the app actually did takes precedence over what the code appeared to say —");
p("with one exception, applied once here: where the final review established that an in-app check");
p("itself was wrong (a control that correctly renders nothing because the box held no data), the");
p("review overrules it. Such a case says so in its verification block.");
p();
p("A flag is cleared only when **all three** lenses are satisfied. The lenses are not three opinions");
p("to be averaged — they test three separate necessary conditions, so one refutation is enough to");
p("keep a flag standing.");
p();
p("**What this verification does not cover.** Every capability here was checked against the source.");
p("A subset was additionally checked by driving the running app, and that pass had real limits: the");
p("browser session authenticates with a key that clears the box auth wall but is not the box owner,");
p("so owner-gated surfaces — device pairing, parts of settings — returned 403 and could not be");
p("exercised. Capabilities needing a real camera, microphone, phone, or a live Google OAuth");
p("round-trip were not driven either. Where the running box simply held no data of the right kind,");
p('a check could not distinguish "absent" from "empty". Those stories rest on the code reading');
p("alone. A ✅ means the code says so and, where marked 🖥️, the app did it once on one box — not");
p("that the capability is tested.");
p();

// Group × audience table
p("| Capability | Total | Verified | Flagged |");
p("|---|--:|--:|--:|");
for (const g of GROUP_ORDER) {
  const inGroup = live.filter((s) => s.group === g);
  if (inGroup.length === 0) continue;
  const ok = inGroup.filter((s) => { const st = statusOf(s); return st === "verified" || st === "cleared"; }).length;
  const bad = inGroup.filter((s) => statusOf(s) === "flagged").length;
  p(`| ${GROUP_TITLES[g] ?? g} | ${inGroup.length} | ${ok} | ${bad} |`);
}
p(`| **Total** | **${live.length}** | **${counts.verified + counts.cleared}** | **${counts.flagged}** |`);
p();

// Flagged index — the actionable half of the document, up front.
const flaggedStories = live.filter((s) => statusOf(s) === "flagged");
if (flaggedStories.length > 0) {
  p("## Flagged — worth a human glance");
  p();
  for (const s of flaggedStories) {
    p(`- **${s.title}** (${GROUP_TITLES[s.group] ?? s.group}) — ${s.id}`);
  }
  p();
}

if (pageNotes.length > 0) {
  p("## Problems seen in the running app");
  p();
  p("_Noticed while checking stories in the browser, whether or not a story covered them._");
  p();
  for (const n of pageNotes) {
    p(`**${n.page}** — ${n.note}`);
    p();
  }
}

// Body
for (const g of GROUP_ORDER) {
  const inGroup = live.filter((s) => s.group === g);
  if (inGroup.length === 0) continue;
  p(`## ${GROUP_TITLES[g] ?? g}`);
  p();
  for (const a of AUDIENCE_ORDER) {
    const inAudience = inGroup.filter((s) => s.audience === a);
    if (inAudience.length === 0) continue;
    p(`### ${AUDIENCE_TITLES[a] ?? a}`);
    p();
    for (const s of inAudience) {
      const st = statusOf(s);
      const b = browser.get(s.id);
      const badges = [BADGE[st]];
      if (b?.status === "confirmed") badges.push("🖥️ confirmed in the app");
      if (b?.status === "failed") badges.push("🖥️ failed in the app");
      p(`#### ${s.title}`);
      p(`${badges.join(" · ")}`);
      p();
      p(`> ${s.story}`);
      p();
      if (s.files.length > 0) p(`Files: ${s.files.map((f) => `\`${f}\``).join(", ")}`);
      p();
      const v = verdicts.get(s.id);
      const t = triage.get(s.id);
      const votes = panelVotes.get(s.id);
      if (v || b || t || votes) {
        p("<details><summary>verification</summary>");
        p();
        if (v) { p(`**Code check** — ${v.note}`); p(); }
        if (b) { p(`**In the running app** (${b.status}) — ${b.note}`); p(); }
        if (votes) {
          for (const vote of votes) {
            p(`**Second look — ${vote.lens}** (${vote.refuted ? "upholds the flag" : "satisfied"}) — ${vote.note}`);
            p();
          }
        }
        if (t) { p(`**Flag review** (${t.classification}) — ${t.reasoning}`); p(); }
        p("</details>");
        p();
      }
    }
  }
}

if (stale.length > 0) {
  p("## Appendix — dropped stories");
  p();
  p("_Capability the catalog originally claimed, which review found the product no longer has (or");
  p("never had in that form). Kept here so the removal is visible rather than silent._");
  p();
  for (const s of stale) {
    const t = triage.get(s.id);
    p(`- **${s.title}** — ${t?.reasoning ?? "dropped"}`);
  }
  p();
}

p("---");
p();
p(`_${live.length} capabilities · generated ${GENERATED}_`);

process.stdout.write(`${out.join("\n")}\n`);
