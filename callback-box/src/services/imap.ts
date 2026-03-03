/**
 * IMAP service — typed interface for fetching email via IMAP.
 *
 * Real implementation wraps imapflow for Gmail IMAP access.
 * Fake maintains in-memory messages for testing.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImapEnvelope {
  messageId: string;
  from?: Array<{ address?: string; name?: string }>;
  to?: Array<{ address?: string; name?: string }>;
  cc?: Array<{ address?: string; name?: string }>;
  subject?: string;
  date?: Date;
}

export interface ImapMessage {
  uid: number;
  envelope: ImapEnvelope;
  source?: Buffer;
  labels?: Set<string>;
  threadId?: string;
}

export interface ImapSearchOptions {
  /** Gmail raw search (X-GM-RAW), e.g. "label:inbox after:2024-03-01" */
  gmraw?: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface ImapService {
  /** Connect to the IMAP server. */
  connect(): Promise<void>;

  /** Acquire a lock on a mailbox. Returns a release function. */
  getMailboxLock(mailbox: string): Promise<{ release: () => void }>;

  /** Search for message UIDs matching criteria. */
  search(criteria: ImapSearchOptions): Promise<number[]>;

  /** Fetch messages by UID. Returns an async iterable of messages. */
  fetch(uids: number[]): AsyncIterable<ImapMessage>;

  /** Disconnect from the server. */
  logout(): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createImapService(opts: {
  host: string;
  port: number;
  user: string;
  pass: string;
}): ImapService {
  // Lazy import to avoid pulling in imapflow at module level
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let _client: InstanceType<typeof import("imapflow").ImapFlow> | null = null;

  async function getClient() {
    if (!_client) {
      const { ImapFlow } = await import("imapflow");
      _client = new ImapFlow({
        host: opts.host,
        port: opts.port,
        secure: true,
        auth: { user: opts.user, pass: opts.pass },
        logger: false,
      });
      _client.on("error", () => {
        // Prevent unhandled errors from crashing the process
      });
    }
    return _client;
  }

  return {
    async connect() {
      const client = await getClient();
      await client.connect();
    },

    async getMailboxLock(mailbox) {
      const client = await getClient();
      const lock = await client.getMailboxLock(mailbox);
      return { release: () => lock.release() };
    },

    async search(criteria) {
      const client = await getClient();
      const searchCriteria: Record<string, unknown> = {};
      if (criteria.gmraw) searchCriteria.gmraw = criteria.gmraw;
      const result = await client.search(searchCriteria, { uid: true });
      return (result ?? []) as number[];
    },

    async *fetch(uids) {
      const client = await getClient();
      for await (const msg of client.fetch(uids, {
        uid: true,
        envelope: true,
        source: true,
        labels: true,
        threadId: true,
      }, { uid: true })) {
        yield msg as unknown as ImapMessage;
      }
    },

    async logout() {
      if (_client) {
        try {
          await _client.logout();
        } catch {
          // Connection may already be closed
        }
        _client = null;
      }
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeImapOptions {
  messages?: ImapMessage[];
}

export interface FakeImapService extends ImapService {
  messages: ImapMessage[];
  connected: boolean;
  lockedMailbox: string | null;
}

export function createFakeImap(
  opts?: FakeImapOptions,
): FakeImapService {
  const fake: FakeImapService = {
    messages: [...(opts?.messages ?? [])],
    connected: false,
    lockedMailbox: null,

    async connect() {
      fake.connected = true;
    },

    async getMailboxLock(mailbox) {
      fake.lockedMailbox = mailbox;
      return {
        release() {
          fake.lockedMailbox = null;
        },
      };
    },

    async search(_criteria) {
      return fake.messages.map((m) => m.uid);
    },

    async *fetch(uids) {
      for (const msg of fake.messages) {
        if (uids.includes(msg.uid)) {
          yield msg;
        }
      }
    },

    async logout() {
      fake.connected = false;
    },
  };

  return fake;
}
