// # notificationSent: which sends a latch may record
//
// A sweep that latches a notification (the question nudge and alert) records it
// only when it went out or could never go anywhere. The rule reads the
// delivery details the channel code writes (`notification/intent.ts`):
// `present`, `no-audience`, or `unconfigured` for a skip. See
// docs/implemented-plans/on-demand-job-triggers.md, Track A.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { notificationSent, type NotifyResult } from "../../src/core/notify-boxholder.js";
import type { Delivery } from "../../src/core/notification/intent.js";

function result(deliveries: Delivery[]): NotifyResult {
  return { id: "n1", deliveries, shown: false };
}

void test("Each delivery outcome, sent or not", async (t) => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => warnings.push(line);
  t.teardown(() => {
    console.warn = warn;
  });

  // A channel that sent, or a skip because the person is looking at it, reached
  // someone. Every skip `no-audience` means nobody is paired: a retry cannot help.
  // A `failed` delivery, or an `unconfigured` skip (the keys are missing in the
  // sending process), with nothing reached is not sent. An unknown skip detail
  // is warned about and not sent.
  t.check(
    {
      sent: notificationSent(result([{ channel: "apns", status: "sent" }])),
      present: notificationSent(result([{ channel: "web-push", status: "skipped", detail: "present" }])),
      noAudience: notificationSent(result([
        { channel: "apns", status: "skipped", detail: "no-audience" },
        { channel: "web-push", status: "skipped", detail: "no-audience" },
      ])),
      unconfigured: notificationSent(result([
        { channel: "apns", status: "skipped", detail: "no-audience" },
        { channel: "web-push", status: "skipped", detail: "unconfigured" },
      ])),
      failed: notificationSent(result([{ channel: "web-push", status: "failed", detail: "boom" }])),
      sentBesideFailed: notificationSent(result([
        { channel: "apns", status: "sent" },
        { channel: "web-push", status: "failed", detail: "boom" },
      ])),
      unknown: notificationSent(result([{ channel: "apns", status: "skipped", detail: "muted" }])),
      warnings,
    },
    {
      sent: true,
      present: true,
      noAudience: true,
      unconfigured: false,
      failed: false,
      sentBesideFailed: true,
      unknown: false,
      warnings: ["[notify-boxholder] unknown skip detail on apns: muted; treated as not sent"],
    },
  );
});
