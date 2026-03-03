/**
 * Dropbox relay service — typed interface for the Cloudflare Worker relay.
 *
 * Used by pairing routes (createChannel, generatePairingCode) and
 * the dropbox connector (poll, deleteMessage).
 *
 * Real implementation delegates to callback-dropbox/client.
 * Fake maintains in-memory message queues.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChannelCredentials {
  channelId: string;
  apiKey: string;
  channelKey: string;
}

export interface PairingResult {
  code: string;
  expiresAt: string;
}

export interface RelayMessage {
  id: string;
  type: string;
  data: unknown;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface DropboxRelayService {
  createChannel(workerUrl: string): Promise<ChannelCredentials>;
  generatePairingCode(opts: {
    workerUrl: string;
    apiKey: string;
    channelId: string;
    channelKey: string;
  }): Promise<PairingResult>;
  poll(opts?: { since?: string }): Promise<RelayMessage[]>;
  deleteMessage(id: string): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createDropboxRelayService(clientOpts: {
  url: string;
  apiKey: string;
  channelKey: string;
}): DropboxRelayService {
  // Lazy import to avoid pulling in callback-dropbox at module level
  let _client: { poll: (opts?: { since?: string }) => Promise<RelayMessage[]>; deleteMessage: (id: string) => Promise<void> } | null = null;

  async function getClient() {
    if (!_client) {
      const { DropboxClient } = await import("callback-dropbox/client");
      _client = new DropboxClient(clientOpts) as unknown as typeof _client;
    }
    return _client!;
  }

  return {
    async createChannel(workerUrl) {
      const { createChannel } = await import("callback-dropbox/client");
      return createChannel(workerUrl) as Promise<ChannelCredentials>;
    },

    async generatePairingCode(opts) {
      const { generatePairingCode } = await import("callback-dropbox/client");
      return generatePairingCode(opts) as Promise<PairingResult>;
    },

    async poll(opts) {
      const client = await getClient();
      return client.poll(opts) as Promise<RelayMessage[]>;
    },

    async deleteMessage(id) {
      const client = await getClient();
      await client.deleteMessage(id);
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeDropboxRelayOptions {
  messages?: RelayMessage[];
}

export interface FakeDropboxRelayService extends DropboxRelayService {
  messages: RelayMessage[];
  deleted: string[];
  channels: ChannelCredentials[];
  pairingCodes: PairingResult[];
}

export function createFakeDropboxRelay(
  opts?: FakeDropboxRelayOptions,
): FakeDropboxRelayService {
  let nextChannelId = 1;

  const fake: FakeDropboxRelayService = {
    messages: [...(opts?.messages ?? [])],
    deleted: [],
    channels: [],
    pairingCodes: [],

    async createChannel(_workerUrl) {
      const creds: ChannelCredentials = {
        channelId: `ch-${nextChannelId++}`,
        apiKey: "fake-api-key",
        channelKey: "fake-channel-key",
      };
      fake.channels.push(creds);
      return creds;
    },

    async generatePairingCode(_opts) {
      const result: PairingResult = {
        code: "123456",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
      fake.pairingCodes.push(result);
      return result;
    },

    async poll() {
      const drained = fake.messages.splice(0);
      return drained;
    },

    async deleteMessage(id) {
      fake.deleted.push(id);
    },
  };

  return fake;
}
