/**
 * Capture relay service — typed interface for the capture session client.
 *
 * Real implementation delegates to callback-dropbox/client CaptureClient.
 * Fake maintains in-memory sessions.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CaptureSession {
  id: string;
  status: string;
  createdAt: string;
}

export interface CaptureManifest {
  sessionId: string;
  files: Array<{ name: string; type: string; size: number }>;
  metadata?: Record<string, unknown>;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface CaptureRelayService {
  listSessions(opts?: { status?: string }): Promise<CaptureSession[]>;
  getManifest(sessionId: string): Promise<CaptureManifest>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createCaptureRelayService(clientOpts: {
  url: string;
  apiKey: string;
}): CaptureRelayService {
  let _client: { listSessions: (opts?: { status?: string }) => Promise<CaptureSession[]>; getManifest: (id: string) => Promise<CaptureManifest> } | null = null;

  async function getClient() {
    if (!_client) {
      const { CaptureClient } = await import("callback-dropbox/client");
      _client = new CaptureClient(clientOpts) as unknown as typeof _client;
    }
    return _client!;
  }

  return {
    async listSessions(opts) {
      const client = await getClient();
      return client.listSessions(opts);
    },

    async getManifest(sessionId) {
      const client = await getClient();
      return client.getManifest(sessionId);
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeCaptureRelayOptions {
  sessions?: CaptureSession[];
  manifests?: Record<string, CaptureManifest>;
}

export interface FakeCaptureRelayService extends CaptureRelayService {
  sessions: CaptureSession[];
  manifests: Record<string, CaptureManifest>;
}

export function createFakeCaptureRelay(
  opts?: FakeCaptureRelayOptions,
): FakeCaptureRelayService {
  const fake: FakeCaptureRelayService = {
    sessions: [...(opts?.sessions ?? [])],
    manifests: { ...(opts?.manifests ?? {}) },

    async listSessions(listOpts) {
      if (listOpts?.status) {
        return fake.sessions.filter((s) => s.status === listOpts.status);
      }
      return fake.sessions;
    },

    async getManifest(sessionId) {
      const manifest = fake.manifests[sessionId];
      if (!manifest) throw new Error(`Session ${sessionId} not found`);
      return manifest;
    },
  };

  return fake;
}
