import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PrepareResult } from "../../publish/prepare/core/prepare-publication.js";
import { preparePublication } from "../../publish/prepare/core/prepare-publication.js";
import type {
  CloudflarePublishBinding,
  CloudflarePublishBoxHost,
  CloudflarePublishConnectionSummary,
} from "../../core/secrets/cloudflare-publish.js";
import {
  attachCloudflarePublishBoxHost,
  getCloudflarePublishBoxHost,
  getCloudflarePublishBinding,
  listCloudflarePublishBindings,
  listCloudflarePublishConnections,
  markCloudflarePublishCapability,
  reserveCloudflarePublishBoxHost,
  reserveCloudflarePublishBinding,
  resolveCloudflarePublishCredential,
} from "../../core/secrets/cloudflare-publish.js";
import { getBoxTime } from "../../lib/time.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import type { CloudflareProvisioningClient, ProvisioningConfig } from "../cloudflare-provisioning/core.js";
import { createCloudflareProvisioningClient } from "../cloudflare-provisioning/core.js";
import type { PublicationWorkerDeployer } from "./worker-deployer.js";
import { createCloudflareWorkerDeployer } from "./worker-deployer.js";
import type { PublishRemoteStore, R2PublishStoreConfig } from "../publish-remote-store.js";
import { createR2PublishStore } from "../publish-remote-store.js";

export interface ManagedPublicationRuntime {
  prepare(args: { boxRoot: string; card: string }, deps: { ownerEmail: string | null }): Promise<PrepareResult>;
  resolveCredential(args: Parameters<typeof resolveCloudflarePublishCredential>[0]): ReturnType<typeof resolveCloudflarePublishCredential>;
  getBinding: typeof getCloudflarePublishBinding;
  reserveBinding(args: Parameters<typeof reserveCloudflarePublishBinding>[0]): Promise<CloudflarePublishBinding>;
  listBindings: typeof listCloudflarePublishBindings;
  getBoxHost: typeof getCloudflarePublishBoxHost;
  reserveBoxHost(args: Parameters<typeof reserveCloudflarePublishBoxHost>[0]): Promise<CloudflarePublishBoxHost>;
  attachBoxHost: typeof attachCloudflarePublishBoxHost;
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
  getBoxHost: getCloudflarePublishBoxHost,
  reserveBoxHost: reserveCloudflarePublishBoxHost,
  attachBoxHost: attachCloudflarePublishBoxHost,
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
