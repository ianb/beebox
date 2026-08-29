# Capture error banner layout

The recovery banner stays in document flow rather than covering device settings.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptureErrorBanner } from "../../src/frontend/src/components/capture/CaptureErrorBanner.js";

globalThis.React = React;
const html = renderToStaticMarkup(React.createElement(CaptureErrorBanner, { message: "Camera failed", onDismiss: () => undefined }));
```

```ts
html.includes("Camera failed") && !html.includes("absolute") && !html.includes("top-14")
=> true
```
