/**
 * Keeps the compose editor and the card on disk in step
 * (`docs/plans/composition-editor.md`, Track 5): autosave after a pause in
 * typing, Save with a commit, merge of the agent's changes, and the save
 * state the toolbar shows. Writes and reads run one at a time in order, so
 * only one write is ever in flight. The tRPC client, the editor, and the
 * timers are passed in, so this runs without a browser in tests.
 */
import { errorMessage } from "@shared/error-guards";
import { normalizeComposition } from "@shared/composition/text";
import { diffToChanges, mergeComposition, type MergeConflict, type TextChange } from "@shared/composition/merge";

export type ReadResult = { text: string; regionHash: string } | { problem: string };
export type WriteResult =
  | { status: "written"; regionHash: string; commit: string | null; commitWarning: string | null }
  | { status: "conflict"; text: string; regionHash: string };

export interface SyncClient {
  read: () => Promise<ReadResult>;
  write: (input: { baseRegionHash: string; text: string; commit: boolean }) => Promise<WriteResult>;
}

export interface SyncEditor {
  text: () => string;
  /** Apply the agent's merged change without touching undo history; show the conflicts. */
  applyRemote: (remote: { changes: TextChange[]; conflicts: MergeConflict[] }) => void;
}

/** Runs `fn` after `ms`; the returned function cancels it. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved-disk" }
  | { kind: "saved" }
  | { kind: "not-saved"; error: string }
  /** A read of the agent's changes failed; `retrying` is false once the retries ran out. */
  | { kind: "not-synced"; error: string; retrying: boolean }
  | { kind: "commit-failed"; message: string }
  | { kind: "removed"; problem: string };

export function saveStateText(state: SaveState): string {
  switch (state.kind) {
    case "idle": return "";
    case "saving": return "Saving…";
    case "saved-disk": return "Saved to disk";
    case "saved": return "Saved";
    case "not-saved": return `Not saved: ${state.error}, retrying`;
    case "not-synced": return state.retrying ? `Not synced: ${state.error}, retrying` : `Not synced: ${state.error}`;
    case "commit-failed": return state.message;
    case "removed":
      return state.problem === "none"
        ? "The composition was removed from this card"
        : `The composition can no longer be edited (${state.problem})`;
  }
}

export interface SyncOptions {
  client: SyncClient;
  editor: SyncEditor;
  schedule: Schedule;
  onState: (state: SaveState) => void;
  /** The region as read when compose opened; the editor shows it normalized. */
  initial: { text: string; regionHash: string };
  autosaveMs: number;
  retryMs: number;
}

/** A write that keeps meeting newer agent text gives up after this many merges and retries later. */
const MAX_MERGES = 3;
/** A failed read retries after `retryMs`, doubling, this many times; then the next file-change or reconnect tries again. */
const MAX_READ_RETRIES = 5;
/** Writes the unmount flush tries before it gives up (the page's leave warning stays on). */
const DISPOSE_ATTEMPTS = 4;

export class CompositionSync {
  /** The disk text the editor last agreed with (normalized), the merge base. */
  private base: string;
  private syncedHash: string;
  /** The disk text as last read or written; the editor is dirty when it differs. */
  private lastSent: string;
  private cancelTimer: (() => void) | null = null;
  private cancelReadRetry: (() => void) | null = null;
  private lane: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private syncQueued = false;
  private stopped = false;
  private disposed = false;
  private state: SaveState = { kind: "idle" };

  constructor(private readonly opts: SyncOptions) {
    this.base = normalizeComposition(opts.initial.text);
    this.syncedHash = opts.initial.regionHash;
    this.lastSent = opts.initial.text;
    // Normalizing changed the text: write the unwrapped form back.
    if (this.base !== this.lastSent) this.schedule(opts.autosaveMs);
  }

  /** The person typed. */
  localChanged(): void {
    this.schedule(this.opts.autosaveMs);
  }

  /** A `file-change` for the card arrived (or the socket reconnected). */
  remoteChanged(): void {
    this.cancelReadRetry?.();
    this.cancelReadRetry = null;
    this.readRemote(0);
  }

  private readRemote(attempt: number): void {
    if (this.stopped || this.syncQueued) return;
    this.syncQueued = true;
    void this.enqueue(async () => {
      this.syncQueued = false;
      if (this.stopped) return;
      let read: ReadResult;
      try {
        read = await this.opts.client.read();
      } catch (e) {
        console.warn("Compose: reading the composition failed:", e);
        const retrying = attempt < MAX_READ_RETRIES && !this.disposed;
        this.setState({ kind: "not-synced", error: errorMessage(e), retrying });
        if (retrying) {
          this.cancelReadRetry = this.opts.schedule(() => {
            this.cancelReadRetry = null;
            this.readRemote(attempt + 1);
          }, this.opts.retryMs * 2 ** attempt);
        }
        return;
      }
      if ("problem" in read) this.remove(read.problem);
      else if (read.regionHash !== this.syncedHash) this.absorb(read);
      if (this.state.kind === "not-synced") this.setState({ kind: this.opts.editor.text() === this.lastSent ? "saved-disk" : "idle" });
    });
  }

  /** Save: write the on-screen text and commit it. */
  save(): Promise<boolean> {
    this.clearTimer();
    return this.enqueue(() => this.write(true));
  }

  /** Exit Compose: write what is unsaved, then report whether the editor may close. */
  async close(): Promise<boolean> {
    this.clearTimer();
    return await this.enqueue(() => this.write(false)) || this.stopped;
  }

  /** Resolves once the reads and writes queued so far have finished. */
  async settled(): Promise<void> {
    await this.lane;
  }

  /** A write is waiting, running, or failed: leaving the page would lose text. */
  hasUnsaved(): boolean {
    return !this.stopped && (this.cancelTimer !== null || this.queued > 0 || this.state.kind === "not-saved");
  }

  /**
   * The session ended without Done (the card view unmounted, or the app
   * navigated away): write what is unsaved, retrying a few times. Resolves
   * with the error when it never got through.
   */
  async dispose(): Promise<{ ok: true } | { ok: false; error: string }> {
    this.disposed = true;
    this.clearTimer();
    this.cancelReadRetry?.();
    this.cancelReadRetry = null;
    for (let attempt = 1; ; attempt += 1) {
      if (await this.enqueue(() => this.write(false)) || this.stopped) return { ok: true };
      if (attempt >= DISPOSE_ATTEMPTS) return { ok: false, error: this.state.kind === "not-saved" ? this.state.error : "the write failed" };
      await new Promise<void>((resolve) => this.opts.schedule(resolve, this.opts.retryMs));
    }
  }

  private setState(state: SaveState): void {
    this.state = state;
    this.opts.onState(state);
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private schedule(ms: number): void {
    if (this.stopped || this.disposed) return;
    this.clearTimer();
    this.cancelTimer = this.opts.schedule(() => {
      this.cancelTimer = null;
      void this.enqueue(() => this.write(false));
    }, ms);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const run = this.lane.then(fn).finally(() => {
      this.queued -= 1;
    });
    this.lane = run.catch((e: unknown) => {
      console.error("Compose: sync step failed:", e);
    });
    return run;
  }

  private remove(problem: string): void {
    this.stopped = true;
    this.clearTimer();
    this.setState({ kind: "removed", problem });
  }

  /** Merge the disk's region into the editor and take it as the new base. */
  private absorb(remote: { text: string; regionHash: string }): void {
    const theirs = normalizeComposition(remote.text);
    const local = this.opts.editor.text();
    const { merged, conflicts } = mergeComposition(this.base, { local, remote: theirs });
    this.opts.editor.applyRemote({ changes: diffToChanges(local, merged), conflicts });
    // The disk now holds text the last commit does not: no longer "Saved".
    if (this.state.kind === "saved") this.setState({ kind: "saved-disk" });
    this.base = theirs;
    this.syncedHash = remote.regionHash;
    this.lastSent = remote.text;
    if (this.opts.editor.text() !== this.lastSent) this.schedule(this.opts.autosaveMs);
  }

  private async write(commit: boolean): Promise<boolean> {
    if (this.stopped) return false;
    if (!commit && this.opts.editor.text() === this.lastSent) return true;
    for (let merges = 0; merges <= MAX_MERGES; merges += 1) {
      const text = this.opts.editor.text();
      this.setState({ kind: "saving" });
      let result: WriteResult;
      try {
        result = await this.opts.client.write({ baseRegionHash: this.syncedHash, text, commit });
      } catch (e) {
        this.setState({ kind: "not-saved", error: errorMessage(e) });
        this.schedule(this.opts.retryMs);
        return false;
      }
      if (result.status === "conflict") {
        this.absorb(result);
        continue;
      }
      // The server keeps the closing tag on its own line, so its region has no final newline.
      this.base = text.replace(/\n$/, "");
      this.syncedHash = result.regionHash;
      this.lastSent = text;
      if (result.commitWarning !== null) this.setState({ kind: "commit-failed", message: result.commitWarning });
      else this.setState({ kind: commit ? "saved" : "saved-disk" });
      return true;
    }
    this.setState({ kind: "not-saved", error: "the card kept changing" });
    this.schedule(this.opts.retryMs);
    return false;
  }
}
