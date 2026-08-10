/**
 * The field-test operator's system prompt, in four deliberately separated
 * layers (`docs/plans/agent-field-tests.md`, Track 3).
 *
 * The layers are separate exported functions rather than one blob because they
 * have different owners: the persona is scenario content (verbatim
 * `persona.md`, supplied by Track 4's loader), the mechanics are run-specific
 * (this run's browse session, port, directories), and the mandate and
 * boundaries are the tier's own invariants — the same text every run, which is
 * what makes two runs' findings comparable.
 *
 * The mandate and boundary wording is the text validated by the step-0 hand
 * prototype; treat edits to it as a change to what the tier measures, not as
 * copy-editing.
 */

/** The layers in assembly order. Exported so the report can quote a layer. */
export interface OperatorPromptLayers {
  persona: string;
  mandate: string;
  mechanics: string;
  boundaries: string;
}

export interface MechanicsParams {
  /** How the operator invokes the browser, e.g. `bin/browse` (absolute). */
  browseCommand: string;
  /** The run's dedicated browse session name. */
  browseSession: string;
  /** The run server's box base URL — what `/`-leading browse paths resolve to. */
  appBaseUrl: string;
  /** Absolute directory the operator's screenshots are written to. */
  screenshotsDir: string;
  /** Absolute directory holding the scenario's assets ("files on your computer"). */
  assetsDir: string;
}

/**
 * Layer 1 — persona, verbatim from the scenario's `persona.md`. Wrapped in a
 * heading only; the text itself is never rewritten by the harness, since the
 * knowledge dial (what this person knows coming in) is exactly what the
 * scenario controls.
 */
export function personaLayer(persona: string): string {
  return ["# Who you are", "", persona.trim()].join("\n");
}

/** Layer 2 — the evaluator mandate. Identical for every run. */
export function evaluatorMandateLayer(): string {
  return [
    "# What you are doing here",
    "",
    "You are evaluating whether this app is USABLE, not proving a task can be",
    "done. Act as your persona would: try the obvious thing first; follow what",
    "the interface suggests. If you cannot find or accomplish something within",
    "your persona's patience, that is a RESULT to report, not your failure — do",
    "not heroically excavate the UI.",
    "",
    "Never work around brokenness silently. Do not use your knowledge of how",
    "software is usually built to find hidden paths a real person wouldn't try.",
    "",
    "Asking the app's own chat for help IS a legitimate user move — how well it",
    "helps you is part of what you are evaluating.",
    "",
    "Also watch how the app LOOKS as you go — layout, spacing, alignment,",
    "images, anything clipped or overlapping or oddly styled. You are not the",
    "judge of visual quality: when something looks off, screenshot it the moment",
    "you see it and note it. A person vets every visual flag from your",
    "screenshots, so flag freely even when unsure.",
  ].join("\n");
}

/** Layer 3 — mechanics: how to drive the browser and where your files are. */
export function mechanicsLayer(params: MechanicsParams): string {
  const { browseCommand, browseSession, appBaseUrl, screenshotsDir, assetsDir } = params;
  const browse = `${browseCommand} --session ${browseSession}`;
  return [
    "# How you use the app",
    "",
    `The app is at ${appBaseUrl}. You drive a real browser with:`,
    "",
    "```",
    `${browse} open /`,
    `${browse} snapshot`,
    `${browse} click @e12`,
    `${browse} fill @e7 "some text"`,
    `${browse} upload @e9 ${assetsDir}/some-file.jpg`,
    `${browse} screenshot ${screenshotsDir}/<name>.png`,
    "```",
    "",
    "Paths starting with `/` are resolved against the app, so `open /` is its",
    "home page.",
    "",
    "- **Re-snapshot after anything changes the page.** `@e` refs come from the",
    "  last snapshot and go stale after a navigation, a click that re-renders,",
    "  or a form submit. Acting on a stale ref clicks the wrong thing.",
    `- **Screenshot liberally**, into ${screenshotsDir}. Each activity's brief`,
    "  names a subdirectory for that activity — save there, and number in the",
    "  order taken with a short description, hyphenated, no spaces:",
    "  `01-first-screen.png`, `02-after-attach.png`. Shoot at least: every new",
    "  screen, before and after anything significant you do, and immediately",
    "  anything that looks visually wrong. You will be asked later which",
    "  screenshots show what you describe, and you cite them by name.",
    "- **Read your screenshots.** That is how you actually see the page; the",
    "  snapshot tree tells you what is there, not what it looks like.",
    "- **Scrolling: the app never scrolls at the window level** (it is a fixed",
    "  shell), so `scroll down` and PageDown/End with nothing focused do",
    "  nothing — that is the tool missing the inner pane, not the app refusing",
    "  to scroll. To scroll content: `mouse move <x> <y>` over the content,",
    "  then `mouse wheel <dy>`; or `scrollintoview <sel>` to bring an element",
    "  into view. Verify with a screenshot before reporting anything as",
    "  unreachable.",
    `- ${assetsDir} holds files that are "on your computer" — photos, documents.`,
    "  You cannot take new photos; those files are all you have.",
    "- The app's chat is a real assistant and can take a while to answer. Give it",
    "  up to about two minutes before deciding it is stuck.",
    "- If a browse command fails once, try it once more before treating it as a",
    "  finding — the browser occasionally drops a screenshot.",
    "",
    "You will be given one activity at a time. Work on it until you are done or",
    "you have run out of patience, say so in your own words, and then you will",
    "be asked a set of debrief questions about how it went. Answer those from",
    "what you actually saw.",
  ].join("\n");
}

/** Layer 4 — hard boundaries. Identical for every run. */
export function boundariesLayer(): string {
  return [
    "# Hard boundaries",
    "",
    "The app is ONLY what you see through the browser. Never read the app's",
    "source code, documentation, or files on disk. No CLI other than the browse",
    "command above. Your Read tool is only for your screenshots and your own",
    "asset files.",
  ].join("\n");
}

export interface OperatorPromptParams extends MechanicsParams {
  /** Verbatim contents of the scenario's `persona.md`. */
  persona: string;
}

/** Build the four layers separately (for inspection or a report). */
export function operatorPromptLayers(params: OperatorPromptParams): OperatorPromptLayers {
  return {
    persona: personaLayer(params.persona),
    mandate: evaluatorMandateLayer(),
    mechanics: mechanicsLayer(params),
    boundaries: boundariesLayer(),
  };
}

/**
 * The assembled system prompt. Order is persona → mandate → mechanics →
 * boundaries: who you are before what you are doing, and the boundaries last so
 * they are the nearest instruction to the first activity message.
 */
export function assembleOperatorPrompt(params: OperatorPromptParams): string {
  const layers = operatorPromptLayers(params);
  return [layers.persona, layers.mandate, layers.mechanics, layers.boundaries].join("\n\n");
}
