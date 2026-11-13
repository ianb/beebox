// The app URL the box browser opens box pages at: operator environment only,
// https or loopback http, and a plain reason otherwise.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appBasePath, appOrigin, resolveAppUrl } from "../../../src/core/browser/app-url.js";

function describe(env: NodeJS.ProcessEnv): string {
  const url = resolveAppUrl(env);
  return url.ok ? `${url.base.origin} ${appBasePath(url.base)}` : url.reason;
}

void test("production wins over the dev router; loopback http is allowed, remote http is not", (t) => {
  t.check(
    {
      production: describe({ BBX_PUBLIC_URL: "https://box.example.com/", BBX_DEV_APP_URL: "http://localhost:3210/wt" }),
      dev: describe({ BBX_DEV_APP_URL: "http://localhost:3210/wt/" }),
      remoteHttp: describe({ PUBLIC_URL: "http://box.example.com" }),
      notUrl: describe({ BBX_PUBLIC_URL: "box.example.com" }),
      none: describe({}),
      origin: appOrigin({ BBX_DEV_APP_URL: "http://localhost:3210/wt" }),
    },
    {
      production: "https://box.example.com /",
      dev: "http://localhost:3210 /wt/",
      remoteHttp: "the box browser needs an https public URL (or http on localhost): http://box.example.com",
      notUrl: "the box's public URL is not a URL: box.example.com",
      none: "this box has no public URL, so its browser cannot open the box's pages",
      origin: "http://localhost:3210",
    },
  );
  t.end();
});
