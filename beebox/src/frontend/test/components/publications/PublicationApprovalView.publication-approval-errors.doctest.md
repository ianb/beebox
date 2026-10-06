# Publication approval mutation errors

Failed approval can mean the server candidate changed since the card loaded.
Keep the mutation error visible and refresh the server-owned publication list
so the card presents the current candidate and revision for a retry.

```ts setup
import { handlePublicationMutationError } from "../../../src/components/publications/PublicationApprovalView.js";

const notices: Array<{ message: string; needsSignIn: boolean }> = [];
let refreshed = false;
```

```ts
await handlePublicationMutationError(
  {
    error: { message: "The publication candidate changed. Review the latest candidate before approving it.", data: { code: "BAD_REQUEST" } },
    setNotice: (notice) => notices.push(notice),
    refreshList: async () => { refreshed = true; },
  },
);
JSON.stringify(notices)
=> [{"message":"The publication candidate changed. Review the latest candidate before approving it.","needsSignIn":false}]

refreshed
=> true
```

A card whose publication the server has not seen yet points at the command
that prepares it from that card.

```ts
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicationNotPrepared } from "../../../src/components/publications/PublicationApprovalView.js";

globalThis.React = React;
const notPrepared = renderToStaticMarkup(React.createElement(PublicationNotPrepared, { cardPath: "sites/Garden Notes.publication.card" }));
notPrepared.includes("Not prepared yet.")
  && notPrepared.includes("<code")
  && notPrepared.includes("bbx pub prepare sites/Garden Notes.publication.card</code>")
=> true
```
