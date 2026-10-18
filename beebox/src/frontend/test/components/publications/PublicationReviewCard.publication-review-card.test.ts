// # Publication card review controls
//
// The publication card renders current publication state from the server-returned
// site record. The card's `pubId` only selects that record; actions use the
// publication id and current candidate revision supplied by the server.

import { test } from "tap";
import "agent-doctest/tap";
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
  await t.checkText(
    markup.includes("disabled")
      && markup.includes("Enable site")
      && markup.includes("Audience changes always need your approval.")
      && !markup.includes("Current release")
      && !markup.includes("a".repeat(64))
      && !markup.includes("Approve audience and publish"),
    "true",
  );
});

// Prepared review keeps the file list and inspection actions, with no active or
// candidate content hashes exposed in the primary view.
void test("Prepared review keeps the file list and inspection actions, with no active or...", async (t) => {
  // doctest:L89
  await t.checkText(
    preparedMarkup.includes("Potential sensitive content")
      && preparedMarkup.includes("Scanned for known secrets: no matches")
      && !preparedMarkup.includes("Files:")
      && !preparedMarkup.includes("Automated checks scan")
      && (preparedMarkup.match(/Anyone with the link can view this without signing in/g) ?? []).length === 1
      && preparedMarkup.includes("Anyone with the link can view this without signing in. It is unlisted, not private to named people.")
      && preparedMarkup.includes("release/very-long-generated-filename-that-should-wrap-on-mobile.html")
      && preparedMarkup.includes("Prepare a new candidate here")
      && preparedMarkup.includes("Prepare update for review")
      && preparedMarkup.includes("Publish prepared update")
      && preparedMarkup.includes("/s/pub-reference-1/")
      && !preparedMarkup.includes("a".repeat(64))
      && !preparedMarkup.includes("b".repeat(64))
      && !preparedMarkup.includes("c".repeat(64)),
    "true",
  );
});

void test("line 148", async (t) => {
  // doctest:L149
  await t.checkText(
    alreadyApprovedMarkup.includes("Enable site")
      && !alreadyApprovedMarkup.includes("Approve audience and publish")
      && !alreadyApprovedMarkup.includes("Publish prepared update")
      && destinationChangeMarkup.includes("Approve destination and publish"),
    "true",
  );
});

void test("line 185", async (t) => {
  // doctest:L186
  await t.checkText(
    actionButton(preparingMarkup, "prepare").includes('aria-busy="true"')
      && actionButton(preparingMarkup, "disable").includes('aria-busy="true"') === false
      && actionButton(preparingMarkup, "disable").includes("disabled")
      && actionButton(disablingMarkup, "disable").includes('aria-busy="true"')
      && actionButton(disablingMarkup, "prepare").includes('aria-busy="true"') === false
      && actionButton(disablingMarkup, "prepare").includes("disabled"),
    "true",
  );
});
