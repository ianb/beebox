# Publications without a card

Admin lists publications that no card in the box describes, so the owner can
stop one that is still serving. A publication with duplicate cards is not an
orphan: its cards report the conflict. The list renders nothing when every
publication has a card.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrphanPublicationList } from "../../../../src/components/admin/CloudflarePublishConnectionsSection/OrphanPublications.js";

globalThis.React = React;
type Site = Parameters<typeof OrphanPublicationList>[0]["sites"][number];
function site(fields: { pubId: string; title: string; cardPath: string | null; duplicateCardPaths: string[]; status: "live" | "disabled" }) {
  return {
    pubId: fields.pubId,
    name: fields.pubId,
    title: fields.title,
    cardPath: fields.cardPath,
    duplicateCardPaths: fields.duplicateCardPaths,
    approved: { tier: "public", status: fields.status, slug: fields.pubId, expiresAt: null },
    remoteStatus: { status: "available" },
  } as Site;
}
function render(sites: Site[], error: string | null) {
  return renderToStaticMarkup(React.createElement(OrphanPublicationList, {
    sites,
    disablingPubId: null,
    error,
    onDisable: () => undefined,
  }));
}
const liveOrphan = site({ pubId: "pub-live", title: "Garden Notes", cardPath: null, duplicateCardPaths: [], status: "live" });
const disabledOrphan = site({ pubId: "pub-off", title: "Old Recipes", cardPath: null, duplicateCardPaths: [], status: "disabled" });
const carded = site({ pubId: "pub-card", title: "Carded Site", cardPath: "sites/Carded.publication.card", duplicateCardPaths: [], status: "live" });
const duplicated = site({ pubId: "pub-dup", title: "Twin Site", cardPath: null, duplicateCardPaths: ["a/Twin.publication.card", "b/Twin.publication.card"], status: "live" });
const markup = render([liveOrphan, disabledOrphan, carded, duplicated], "Disable failed: connection revoked");
```

Only orphans appear; only the live one offers Disable; the mutation error is shown.

```ts
markup.includes("Publications without a card")
  && markup.includes("Garden Notes")
  && markup.includes("Old Recipes")
  && !markup.includes("Carded Site")
  && !markup.includes("Twin Site")
=> true

markup.includes('id="bbx-admin-orphan-publication-disable-pub-live"')
  && !markup.includes("bbx-admin-orphan-publication-disable-pub-off")
  && markup.includes("Disable failed: connection revoked")
=> true

render([carded, duplicated], null).length
=> 0
```
