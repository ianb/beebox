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

function orphanRows(html: string) {
  return Array.from(html.matchAll(/<article\b[^>]*>(.*?)<\/article>/g), ([, row]) => ({
    title: /text-base font-medium">([^<]+)<\/span>/.exec(row ?? "")?.[1] ?? null,
    state: /Serving state: <span[^>]*>([^<]+)<\/span>/.exec(row ?? "")?.[1] ?? null,
    action: /<button[^>]*><span>([^<]+)<\/span><\/button>/.exec(row ?? "")?.[1] ?? null,
  }));
}

// Only orphans appear; only the live one offers Disable; the mutation error is shown.
void test("Only orphans appear; only the live one offers Disable; the mutation error is...", async (t) => {
  t.check({ alert: /<div role="alert"><p[^>]*>([^<]+)<\/p><\/div>/.exec(markup)?.[1] ?? null, rows: orphanRows(markup) }, {
    alert: "Disable failed: connection revoked",
    rows: [
      { title: "Garden Notes", state: "live", action: "Disable" },
      { title: "Old Recipes", state: "disabled", action: null },
    ],
  });
  t.check(render([carded, duplicated], null), "");
});
