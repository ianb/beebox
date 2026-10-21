// # Publications without a card
//
// Admin lists publications that no card in the box describes, so the owner can
// stop one that is still serving. A publication with duplicate cards is not an
// orphan: its cards report the conflict. The list renders nothing when every
// publication has a card.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrphanPublicationList } from "../../../../src/components/admin/CloudflarePublishConnectionsSection/OrphanPublications.js";

globalThis.React = React;
type Site = Parameters<typeof OrphanPublicationList>[0]["sites"][number];
function site(fields: { pubId: string; title: string; cardPath: string | null; duplicateCardPaths: string[]; status: "live" | "disabled" }): Site {
  return {
    pubId: fields.pubId,
    name: fields.pubId,
    title: fields.title,
    cardPath: fields.cardPath,
    duplicateCardPaths: fields.duplicateCardPaths,
    hostname: `${fields.pubId}.example.workers.dev`,
    sharedRoute: null,
    assignedCustomHostname: null,
    customHostnameStatus: null,
    requested: null,
    activeReleaseId: null,
    activeFiles: [],
    pending: null,
    approved: { tier: "public", status: fields.status, slug: fields.pubId, expiresAt: null },
    remoteStatus: { status: "available" },
    connection: { name: "publishing", status: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "verified", workerDeploy: "verified", accessLive: "verified" } },
  };
}
const noop = () => {};
function render(sites: Site[], error: string | null) {
  return renderToStaticMarkup(React.createElement(OrphanPublicationList, {
    sites,
    disablingPubId: null,
    error,
    onDisable: noop,
  }));
}
const liveOrphan = site({ pubId: "pub-live", title: "Garden Notes", cardPath: null, duplicateCardPaths: [], status: "live" });
const disabledOrphan = site({ pubId: "pub-off", title: "Old Recipes", cardPath: null, duplicateCardPaths: [], status: "disabled" });
const carded = site({ pubId: "pub-card", title: "Carded Site", cardPath: "sites/Carded.publication.card", duplicateCardPaths: [], status: "live" });
const duplicated = site({ pubId: "pub-dup", title: "Twin Site", cardPath: null, duplicateCardPaths: ["a/Twin.publication.card", "b/Twin.publication.card"], status: "live" });
const markup = render([liveOrphan, disabledOrphan, carded, duplicated], "Disable failed: connection revoked");

// Only orphans appear; only the live one offers Disable; the mutation error is shown.
void test("Only orphans appear; only the live one offers Disable; the mutation error is...", async (t) => {
  t.check(markup, "<div class=\"flex flex-col gap-2\"><div class=\"flex flex-col gap-1\"><h3 class=\"text-sm font-semibold text-warm-900\">Publications without a card</h3><p class=\"text-sm text-warm-700\">No card in this box describes these publications. Disable any that should stop serving.</p></div><div role=\"alert\"><p class=\"text-sm text-danger-dark\">Disable failed: connection revoked</p></div><article class=\"p-4 bg-white text-warm-900 border border-warm-300 rounded-lg\"><div class=\"flex gap-2 items-center justify-between flex-wrap\"><div class=\"flex flex-col gap-1\"><span class=\"text-warm-900 text-base font-medium\">Garden Notes</span><span class=\"text-warm-900 text-sm\">Serving state: <span class=\"inline-block rounded font-medium bg-success-100 text-success-dark text-xs px-2 py-0.5\">live</span></span></div><button id=\"bbx-admin-orphan-publication-disable-pub-live\" type=\"button\" class=\"inline-flex items-center justify-center font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed bg-warm-200 text-warm-800 hover:bg-warm-300 rounded px-4 py-2 text-base gap-1.5\"><span>Disable</span></button></div></article><article class=\"p-4 bg-white text-warm-900 border border-warm-300 rounded-lg\"><div class=\"flex gap-2 items-center justify-between flex-wrap\"><div class=\"flex flex-col gap-1\"><span class=\"text-warm-900 text-base font-medium\">Old Recipes</span><span class=\"text-warm-900 text-sm\">Serving state: <span class=\"inline-block rounded font-medium bg-accent-100 text-accent-dark text-xs px-2 py-0.5\">disabled</span></span></div></div></article></div>");
  t.check(render([carded, duplicated], null), "");
});
