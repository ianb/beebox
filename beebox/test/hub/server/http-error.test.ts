// # Hub raw-route error sanitization
//
// The hub owns public auth routes in production, so unexpected failures must be
// logged server-side while their response remains generic.

import { test } from "tap";
import "agent-doctest/tap";
import Fastify from "fastify";
import { registerHubErrorHandler } from "../../../src/hub/server/http-error.js";

void test("line 11", async (t) => {
  t.teardown(async () => {
    try {
      await app.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L12
  const app = Fastify({ logger: false });
  registerHubErrorHandler(app);
  app.get("/explode", async () => {
    throw new Error("credential store failed at /srv/callback/.bbx-auth.json");
  });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  const response = await app.inject({ method: "GET", url: "/explode" });
  console.error = originalError;
  t.check({ status: response.statusCode, body: response.json(), logged: logged.length }, {
    status: 500,
    body: {
      error: "Internal server error",
    },
    logged: 1,
  });
});
