// # Encrypted backups setup and status states
//
// Setup keeps the password write-only and names its custody; configured state
// shows a copyable host command plus the unconfirmed runner prerequisite.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import { trpc, type RouterOutput } from "../../../src/lib/trpc/client.js";
import { EncryptedBackupsSection, encryptedBackupStatusErrorMessage } from "../../../src/components/admin/EncryptedBackupsSection.js";

globalThis.React = React;

void test("explains owner-only encrypted backup status errors", async (t) => {
  t.check(encryptedBackupStatusErrorMessage("FORBIDDEN"), "Owner sign-in must be enabled for this box before an owner can configure encrypted backups.");
  t.check(encryptedBackupStatusErrorMessage("INTERNAL_SERVER_ERROR"), "Could not read encrypted backup status.");
});

async function render(status: RouterOutput["admin"]["encryptedBackupStatus"]): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData([["admin", "encryptedBackupStatus"], { type: "query" }], status);
  const client = createTRPCClient<AppRouter>({ links: [() => () => observable(() => () => {})] });
  return renderToStaticMarkup(React.createElement(trpc.Provider, {
    client,
    queryClient,
    children: React.createElement(QueryClientProvider, { client: queryClient, children: React.createElement(EncryptedBackupsSection) }),
  }));
}

void test("shows write-only setup and host-only first run guidance", async (t) => {
  const html = await render({
    boxRoot: "/srv/My Box",
    boxSlug: "my-box",
    installKind: "local",
    configured: false,
    repository: null,
    retention: null,
    schedule: "daily",
    newestVerified: null,
    lastAttempt: null,
    maintenance: null,
  });
  t.check(html, any(String).includes('type="text"'));
  t.check(html, any(String).includes("bbx-secret-value-mask"));
  t.check(html, any(String).includes('autoComplete="off"'));
  t.check(html, any(String).includes("Save a separate copy outside this machine"));
  t.check(html.slice(0, html.indexOf('id="bbx-admin-encrypted-backups-repository"')), any(String).includes("provider credentials must already be available"));
  t.check(html, not(any(String).includes("/srv/My Box")));
  t.check(html, not(any(String).includes("bbx engine backup run")));
});

void test("shows verified and failed run facts separately with a shell-quoted command", async (t) => {
  const html = await render({
    boxRoot: "/srv/My Box",
    boxSlug: "my-box",
    installKind: "local",
    configured: true,
    repository: "s3:bucket/box",
    retention: { daily: 7, weekly: 4, monthly: 12 },
    schedule: "daily",
    newestVerified: { snapshotId: "verified-1", verifiedAt: "2026-10-26T12:00:00.000Z" },
    lastAttempt: { startedAt: "2026-10-26T12:00:00.000Z", completedAt: "2026-10-26T12:01:00.000Z", outcome: "failed", error: "Repository operation failed; check repository access and credentials" },
    maintenance: null,
  });
  t.check(html, any(String).includes("verified-1"));
  t.check(html, any(String).includes("Repository operation failed; check repository access and credentials"));
  t.check(html, any(String).includes("bbx engine backup run &#x27;/srv/My Box&#x27;"));
  t.check(html, any(String).includes("this page cannot confirm that it is active"));
  t.check(html, any(String).includes("already be available to that host"));
  t.check(html, not(any(String).includes("/Applications/Bee Box Desktop.app/Contents/MacOS/BeeBoxMac")));
});

void test("does not mistake missing local run history for an empty repository", async (t) => {
  const html = await render({
    boxRoot: "/srv/My Box",
    boxSlug: "my-box",
    installKind: "local",
    configured: true,
    repository: "s3:bucket/box",
    retention: { daily: 7, weekly: 4, monthly: 12 },
    schedule: "daily",
    newestVerified: null,
    lastAttempt: null,
    maintenance: null,
  });
  t.check(html, any(String).includes("No verified snapshot is recorded on this host yet"));
  t.check(html, any(String).includes("bbx engine backup status &#x27;/srv/My Box&#x27;"));
});

void test("runs as the box service user on unit hosts", async (t) => {
  const html = await render({
    boxRoot: "/var/lib/beebox/My Box/box",
    boxSlug: "my-box",
    installKind: "unit-host",
    configured: true,
    repository: "s3:bucket/box",
    retention: { daily: 7, weekly: 4, monthly: 12 },
    schedule: "daily",
    newestVerified: null,
    lastAttempt: null,
    maintenance: null,
  });
  t.check(html, any(String).includes("sudo -u &#x27;bbx-my-box&#x27; -H bash -c"));
  t.check(html, any(String).includes("source /etc/beebox/box.env"));
  t.check(html, any(String).includes("backup-manual &#x27;/var/lib/beebox/My Box/box&#x27;"));
  t.check(html, not(any(String).includes("/Applications/Bee Box Desktop.app")));
});

void test("copies the command for Mac app and Docker installs", async (t) => {
  for (const [installKind, expected] of [
    ["mac-app", "/Applications/Bee Box Desktop.app/Contents/MacOS/BeeBoxMac&quot; backup run"],
    ["docker", "docker compose exec box bbx engine backup run /data/box"],
  ] as const) {
    const html = await render({
      boxRoot: "/data/box", boxSlug: "box", installKind, configured: true,
      repository: "s3:bucket/box", retention: { daily: 7, weekly: 4, monthly: 12 },
      schedule: "daily", newestVerified: null, lastAttempt: null, maintenance: null,
    });
    t.check(html, any(String).includes(expected));
  }
});
