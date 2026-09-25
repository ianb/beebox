# Cloudflare publishing save feedback

The save result stays beside its submit button, where it remains visible after
the long token setup instructions. Failures are announced as alerts; successful
saves are announced as status, including when refreshing the list fails.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionEditor } from "../../src/frontend/src/components/admin/CloudflarePublishConnectionsSection.js";

globalThis.React = React;
function editor(saveError, saveStatus) {
  return renderToStaticMarkup(React.createElement(ConnectionEditor, {
    name: "studio",
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "",
    rotateTarget: null,
    pending: false,
    saveError,
    saveStatus,
    setName: () => {},
    setAccountId: () => {},
    setApiToken: () => {},
    onSubmit: () => {},
    onCancelRotation: () => {},
  }));
}
const failed = editor("Cloudflare did not verify an active token.", null);
const succeeded = editor(null, "Saved “studio”, but the saved connections list could not be refreshed. Reload the page to check it.");
```

```ts
failed.includes('role="alert"') && failed.indexOf('id="bbx-admin-cf-publish-save"') < failed.indexOf("Cloudflare did not verify")
=> true
```

```ts
succeeded.includes('role="status"') && succeeded.indexOf('id="bbx-admin-cf-publish-save"') < succeeded.indexOf("could not be refreshed")
=> true
```
