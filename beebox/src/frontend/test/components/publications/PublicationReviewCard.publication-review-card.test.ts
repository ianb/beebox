// # Publication card review controls
//
// The publication card renders current publication state from the server-returned
// site record. The card's `pubId` only selects that record; actions use the
// publication id and current candidate revision supplied by the server.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicationReviewCard, type Publication, type Candidate } from "../../../src/components/publications/PublicationReviewCard.js";

globalThis.React = React;
const noop = () => {};

const site: Publication = {
  pubId: "pub-reference-1",
  name: "notes",
  cardPath: "publications/Notes.publication.card",
  duplicateCardPaths: [],
  title: "Notes",
  hostname: "notes.example.workers.dev",
  sharedRoute: null,
  assignedCustomHostname: null,
  customHostnameStatus: null,
  requested: null,
  approved: { tier: "public", status: "disabled", slug: "notes", expiresAt: null },
  activeReleaseId: "a".repeat(64),
  activeFiles: [],
  remoteStatus: { status: "available" },
  pending: null,
  connection: { name: "publishing", status: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "verified", workerDeploy: "verified", accessLive: "verified" } },
};

const markup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site,
  sharedHost: null,
  pending: false,
  pendingAction: null,
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));

const preparedSite: Publication & { pending: Candidate } = {
  ...site,
  approved: { tier: "secret", status: "live", expiresAt: null },
  requested: { kind: "site", hostHandle: "host", tier: "secret", expiresAt: null },
  sharedRoute: null,
  pending: {
    revision: "c".repeat(64),
    releaseId: "b".repeat(64),
    preparedAt: "2026-09-25T12:00:00.000Z",
    requestedScope: { kind: "site", hostHandle: "host", tier: "secret", expiresAt: null },
    preview: [{ path: "release/very-long-generated-filename-that-should-wrap-on-mobile.html", bytes: 2048, sha256: "d".repeat(64) }],
    scan: { total: 0, byKind: {}, skippedBinaries: 0, sample: [] },
  },
};
const preparedMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: preparedSite,
  sharedHost: { hostname: "publish.example.com", connectionName: "publishing", status: "attached" },
  pending: false,
  pendingAction: null,
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));

// An unchanged scope and active release needs no repeated approval. A disabled
// site keeps the enable action for that existing approved release.
const alreadyApprovedSite: Publication = {
  ...preparedSite,
  approved: { tier: "secret", status: "disabled", expiresAt: null },
  activeReleaseId: "b".repeat(64),
  activeFiles: [],
  pending: { ...preparedSite.pending, releaseId: "b".repeat(64), requestedScope: { ...preparedSite.pending.requestedScope } },
};
const alreadyApprovedMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: alreadyApprovedSite,
  sharedHost: null,
  pending: false,
  pendingAction: null,
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));
const destinationChangedSite = {
  ...preparedSite,
  pending: {
    ...preparedSite.pending,
    requestedScope: {
      ...preparedSite.pending.requestedScope,
      sharedHost: { hostname: "publish.example.com", hostHandle: "host", path: "/s/pub-reference-1/" },
    },
  },
};
const destinationChangeMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: destinationChangedSite,
  sharedHost: { hostname: "publish.example.com", connectionName: "publishing", status: "attached" },
  pending: false,
  pendingAction: null,
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));

// While an action runs, every action is disabled to prevent overlapping
// mutations, but only the running action carries the busy state and spinner.
const actionButtonPatterns = {
  prepare: /<button[^>]*id="bbx-publication-prepare-pub-reference-1"[^>]*>[\S\s]*?<\/button>/,
  disable: /<button[^>]*id="bbx-publication-disable-pub-reference-1"[^>]*>[\S\s]*?<\/button>/,
};
function actionButton(rendered: string, action: keyof typeof actionButtonPatterns) {
  return rendered.match(actionButtonPatterns[action])?.[0] ?? "";
}
const SPINNER = '<svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
const BUTTON_BASE = "inline-flex items-center justify-center font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";
/** A disabled action button, with the spinner and `aria-busy` only on the running action. */
function disabledButton(parts: { action: "prepare" | "disable"; busy: boolean }): string {
  const tone = parts.action === "prepare" ? "bg-warm-200 text-warm-800 hover:bg-warm-300" : "bg-danger text-white hover:bg-danger-dark";
  const label = parts.action === "prepare" ? "Prepare update for review" : "Disable site";
  return `<button id="bbx-publication-${parts.action}-pub-reference-1" type="button" disabled=""${parts.busy ? ' aria-busy="true"' : ""} class="${BUTTON_BASE} ${tone} rounded px-4 py-2 text-base gap-1.5">${parts.busy ? SPINNER : ""}<span>${label}</span></button>`;
}

// The rendered cards are whole pages of generated markup, so these checks stay
// narrow: a fragment that must appear, must not appear, or must appear once.
// Splitting on the fragment gives two pieces when it appears once.
const has = (text: string) => any(String).includes(text);
const once = [any(String), any(String)];

const liveSite: Publication = { ...site, approved: { ...site.approved!, status: "live" } };
const preparingMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: liveSite,
  sharedHost: null,
  pending: true,
  pendingAction: "prepare",
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));
const disablingMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: liveSite,
  sharedHost: null,
  pending: true,
  pendingAction: "disable",
  onPrepare: noop,
  onApprove: noop,
  onEnable: noop,
  onDisable: noop,
}));

// The disabled serving state exposes the enable action and preserves the audience
// boundary explanation. No candidate means there is no approval action.
void test("The disabled serving state exposes the enable action and preserves the audien...", async (t) => {
  // doctest:L49
  t.check(markup, has("disabled"));
  t.check(markup, has("Enable site"));
  t.check(markup, has("Audience changes always need your approval."));
  t.check(markup, not(any(String).includes("Current release")));
  t.check(markup, not(any(String).includes("a".repeat(64))));
  t.check(markup, not(any(String).includes("Approve audience and publish")));
});

// Prepared review keeps the file list and inspection actions, with no active or
// candidate content hashes exposed in the primary view.
void test("Prepared review keeps the file list and inspection actions, with no active or...", async (t) => {
  // doctest:L89
  t.check(preparedMarkup, has("Potential sensitive content"));
  t.check(preparedMarkup, has("Scanned for known secrets: no matches"));
  t.check(preparedMarkup, not(any(String).includes("Files:")));
  t.check(preparedMarkup, not(any(String).includes("Automated checks scan")));
  t.check(preparedMarkup.split("Anyone with the link can view this without signing in"), once);
  t.check(preparedMarkup, has("Anyone with the link can view this without signing in. It is unlisted, not private to named people."));
  t.check(preparedMarkup, has("release/very-long-generated-filename-that-should-wrap-on-mobile.html"));
  t.check(preparedMarkup, has("Prepare a new candidate here"));
  t.check(preparedMarkup, has("Prepare update for review"));
  t.check(preparedMarkup, has("Publish prepared update"));
  t.check(preparedMarkup, has("/s/pub-reference-1/"));
  t.check(preparedMarkup, not(any(String).includes("a".repeat(64))));
  t.check(preparedMarkup, not(any(String).includes("b".repeat(64))));
  t.check(preparedMarkup, not(any(String).includes("c".repeat(64))));
});

void test("line 148", async (t) => {
  // doctest:L149
  t.check(alreadyApprovedMarkup, has("Enable site"));
  t.check(alreadyApprovedMarkup, not(any(String).includes("Approve audience and publish")));
  t.check(alreadyApprovedMarkup, not(any(String).includes("Publish prepared update")));
  t.check(destinationChangeMarkup, has("Approve destination and publish"));
});

void test("line 185", async (t) => {
  // doctest:L186
  t.check(actionButton(preparingMarkup, "prepare"), disabledButton({ action: "prepare", busy: true }));
  t.check(actionButton(preparingMarkup, "disable"), disabledButton({ action: "disable", busy: false }));
  t.check(actionButton(disablingMarkup, "disable"), disabledButton({ action: "disable", busy: true }));
  t.check(actionButton(disablingMarkup, "prepare"), disabledButton({ action: "prepare", busy: false }));
});
