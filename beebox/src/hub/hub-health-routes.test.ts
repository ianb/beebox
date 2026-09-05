import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { diskHealthFromBytes } from "./disk-health.js";
import { staticEndpointProvider } from "./endpoints.js";
import { registerHealthRoutes } from "./hub-health-routes.js";

const previousDiagKey = process.env.BBX_DIAG_API_KEY;

before(() => {
  process.env.BBX_DIAG_API_KEY = "test-key";
});

after(() => {
  if (previousDiagKey === undefined) delete process.env.BBX_DIAG_API_KEY;
  else process.env.BBX_DIAG_API_KEY = previousDiagKey;
});

async function injectHealth(freeBytes: number): Promise<{ statusCode: number; body: string }> {
  const app = Fastify();
  registerHealthRoutes(app, {
    endpoints: staticEndpointProvider([]),
    getHealth: () => ({ status: "ok", boxes: [] }),
    getDiskHealth: () => diskHealthFromBytes(freeBytes, 75 * 1024 ** 3),
  });
  const response = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { authorization: "Bearer test-key" },
  });
  await app.close();
  return response;
}

void test("hub healthz includes disk free and returns 503 below the threshold", async () => {
  const healthy = await injectHealth(20 * 1024 ** 3);
  assert.equal(healthy.statusCode, 200);
  assert.deepEqual(JSON.parse(healthy.body), {
    status: "ok",
    boxes: [],
    disk: {
      freeBytes: 20 * 1024 ** 3,
      freeGiB: 20,
      thresholdBytes: 7.5 * 1024 ** 3,
      thresholdGiB: 7.5,
      status: "ok",
    },
  });

  const low = await injectHealth(7.5 * 1024 ** 3 - 1);
  assert.equal(low.statusCode, 503);
  assert.match(low.body, /"status":"unhealthy"/);
  assert.match(low.body, /"thresholdGiB":7.5/);
  assert.match(low.body, /"status":"low"/);
});
