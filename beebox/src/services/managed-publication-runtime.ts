import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PrepareResult } from "../publish/prepare.js";
import { preparePublication } from "../publish/prepare.js";
import type {
  CloudflarePublishBinding,
  CloudflarePublishConnectionSummary,
} from "../core/secrets/cloudflare-publish.js";
import {
  getCloudflarePublishBinding,
  listCloudflarePublishBindings,
  listCloudflarePublishConnections,
  markCloudflarePublishCapability,
  reserveCloudflarePublishBinding,
  resolveCloudflarePublishCredential,
} from "../core/secrets/cloudflare-publish.js";
import { getBoxTime } from "../lib/time.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import type { CloudflareProvisioningClient, ProvisioningConfig } from "./cloudflare-provisioning.js";
import { createCloudflareProvisioningClient } from "./cloudflare-provisioning.js";
import type { PublicationWorkerDeployer } from "./cloudflare-worker-deployer.js";
import { createCloudflareWorkerDeployer } from "./cloudflare-worker-deployer.js";
import type { PublishRemoteStore, R2PublishStoreConfig } from "./publish-remote-store.js";
import { createR2PublishStore } from "./publish-remote-store.js";

export interface ManagedPublicationRuntime {
  prepare(args: { boxRoot: string; name: string }, deps: { ownerEmail: string | null }): Promise<PrepareResult>;
  resolveCredential(args: Parameters<typeof resolveCloudflarePublishCredential>[0]): ReturnType<typeof resolveCloudflarePublishCredential>;
  getBinding: typeof getCloudflarePublishBinding;
  reserveBinding(args: Parameters<typeof reserveCloudflarePublishBinding>[0]): Promise<CloudflarePublishBinding>;
  listBindings: typeof listCloudflarePublishBindings;
  listConnections: () => Promise<CloudflarePublishConnectionSummary[]>;
  markCapability: typeof markCloudflarePublishCapability;
  createStore(config: R2PublishStoreConfig): PublishRemoteStore;
  createProvisioning(config: ProvisioningConfig): CloudflareProvisioningClient;
  createWorkerDeployer(config: ProvisioningConfig): PublicationWorkerDeployer;
  workerBundle(): Promise<Uint8Array>;
  now(boxRoot: string): Date;
  newHostHandle(): string;
  newBucketName(): string;
}

export const defaultManagedPublicationRuntime: ManagedPublicationRuntime = {
  prepare: preparePublication,
  resolveCredential: resolveCloudflarePublishCredential,
  getBinding: getCloudflarePublishBinding,
  reserveBinding: reserveCloudflarePublishBinding,
  listBindings: listCloudflarePublishBindings,
  listConnections: listCloudflarePublishConnections,
  markCapability: markCloudflarePublishCapability,
  createStore: createR2PublishStore,
  createProvisioning: createCloudflareProvisioningClient,
  createWorkerDeployer: createCloudflareWorkerDeployer,
  async workerBundle() { return readFile(path.join(PACKAGE_ROOT, "dist", "pub-worker.js")); },
  now: (boxRoot) => getBoxTime(boxRoot),
  newHostHandle: () => `bbx-${randomBytes(16).toString("hex")}`,
  newBucketName: () => `bbx-pub-${randomBytes(12).toString("hex")}`,
};
