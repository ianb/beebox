import { createActor, type ActorRefFrom } from "xstate";
import { chatMachine } from "../../../machines/chatMachine";
import type { ChatEvent, ChatMachineInput } from "../../../machines/chat-types";
import type { ConversationTarget, SendBinding } from "../../../../../shared/chat-composer-binding.js";
import { expectReceipt, settleReceipt } from "../../../input/targets/receipts";
import { getApiBase } from "../../../api-core";
import { StartRecords, ConversationRoutingError, type RoutingStorage } from "./start-records";
import { startAwakeTimeout } from "../../../../../shared/awake-timeout.js";
import { conversationStorageScope } from "./storage-scope";

export interface SessionAssignment { clientConversationId: string; contextDir: string }
export type ChatController = ActorRefFrom<typeof chatMachine>;
type SendEvent = Extract<ChatEvent, { type: "SEND" }>;
interface Entry {
  actor: ChatController;
  target: ConversationTarget;
  pins: number;
  started: boolean;
  awaitingAssignment: boolean;
  startRejected: boolean;
  alias: string | null;
  assigned: boolean;
  waiters: Set<() => void>;
}
export function conversationKey(target: ConversationTarget): string {
  return target.kind === "session" ? target.sessionId : target.clientConversationId;
}

/** Session actors own turns; this pool outlives selection while input has one owner. */
export class ConversationControllerPool {
  private readonly entries = new Map<string, Entry>();
  private readonly ready = new Set<string>();
  private selected: string | null = null;
  private active = true;
  private lifecycleGeneration = 0;
  private readonly apiBase: string;
  private readonly readApiBase: () => string;
  readonly storageScope: string;
  private readonly createController: (input: ChatMachineInput) => ChatController;
  private readonly aliasWaitMs: number;
  private readonly starts: StartRecords | null;
  private recoveryNotice: string | null = null;
  private onRecovery: ((notice: string | null) => void) | undefined;
  onAssignment: ((sessionId: string, assignment?: SessionAssignment) => void) | undefined;
  constructor(readonly boxSlug: string, options: {
    storage: RoutingStorage;
    createController?: (input: ChatMachineInput) => ChatController;
    getApiBase?: () => string;
    aliasWaitMs?: number;
  }) {
    this.readApiBase = options.getApiBase ?? getApiBase;
    this.apiBase = this.readApiBase();
    this.storageScope = conversationStorageScope(this.apiBase);
    try { this.starts = new StartRecords(options.storage, this.storageScope); }
    catch (error) {
      this.starts = null;
      this.recoveryNotice = error instanceof Error ? error.message : "Conversation startup records need recovery";
    }
    this.createController = options.createController ?? ((input) => createActor(chatMachine, { input }));
    this.aliasWaitMs = options.aliasWaitMs ?? 30000;
  }
  setRecoveryHandler(handler: (notice: string | null) => void): void {
    this.onRecovery = handler;
    handler(this.recoveryNotice);
  }
  private reportRecovery(): void {
    this.recoveryNotice = "Message accepted; startup association could not be saved. Open the conversation before reloading.";
    this.onRecovery?.(this.recoveryNotice);
  }
  private startupRecords(): StartRecords {
    if (this.starts === null) throw new ConversationRoutingError({ kind: "storage" });
    return this.starts;
  }
  setAssignmentHandler(handler: typeof this.onAssignment): void { this.onAssignment = handler; }
  conversationIdentity(target: ConversationTarget): string {
    const key = conversationKey(target);
    const entry = this.entries.get(key) ?? [...this.entries.values()].find((value) => value.alias === key);
    return entry === undefined ? key : conversationKey(entry.target);
  }
  controller(target: ConversationTarget, input?: ChatMachineInput): ChatController {
    const key = conversationKey(target);
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing.actor;
    // Assignment changes identity for routing, never the actor following the turn.
    const carried = [...this.entries.values()].find((entry) => entry.alias === key);
    if (carried !== undefined) return carried.actor;
    const actor = this.createController(input ?? {
      sessionInput: target.kind === "session" ? target.sessionId : "new",
      contextDir: target.contextDir,
      ...(target.kind === "start" ? { startEngine: target.engine, startModel: target.model } : {}),
    });
    const entry: Entry = { actor, target, pins: 0, started: false, awaitingAssignment: false, startRejected: false, alias: null, assigned: false, waiters: new Set() };
    this.entries.set(key, entry);
    actor.subscribe((snapshot) => {
      if (target.kind === "start" && snapshot.context.sessionId !== null) {
        entry.alias = snapshot.context.sessionId;
        if (this.ready.has(entry.alias)) this.assign(entry);
      }
      for (const wake of entry.waiters) wake();
      this.collect();
    });
    return actor;
  }
  select(target: ConversationTarget, input?: ChatMachineInput): ChatController {
    this.active = true;
    const actor = this.controller(target, input);
    this.selected = conversationKey(target);
    actor.start();
    this.collect();
    return actor;
  }
  markReady(sessionId: string): void {
    this.ready.add(sessionId);
    for (const entry of this.entries.values()) {
      if (entry.alias === sessionId) this.assign(entry);
    }
  }
  private assign(entry: Entry): void {
    if (entry.assigned || entry.alias === null || entry.target.kind !== "start") return;
    const id = entry.target.clientConversationId;
    const prior = this.starts?.get(id);
    if (prior !== undefined) {
      try { this.starts?.put(id, { ...prior, state: "assigned", sessionId: entry.alias }); }
      catch (_error) { this.reportRecovery(); }
    }
    entry.assigned = true;
    entry.awaitingAssignment = false;
    this.onAssignment?.(entry.alias, { clientConversationId: id, contextDir: entry.target.contextDir });
    for (const wake of entry.waiters) wake();
  }
  capture(binding: SendBinding): { send: (event: ChatEvent) => void; release: () => void; finished: () => Promise<void> } {
    if (!this.active || binding.boxSlug !== this.boxSlug || this.readApiBase() !== this.apiBase) {
      throw new ConversationRoutingError({ kind: "box" });
    }
    const actor = this.controller(binding.target);
    const entry = [...this.entries.values()].find((candidate) => candidate.actor === actor);
    if (entry === undefined) throw new ConversationRoutingError({ kind: "controller" });
    entry.pins++;
    actor.start();
    const record = binding.target.kind === "start" ? this.starts?.get(binding.target.clientConversationId) : undefined;
    // Only a gesture made after definitive refusal may nominate a replacement.
    // A capture still preparing when refusal arrives cannot become the first send.
    const replacesFirstId = record?.state === "prepared" ? record.firstEmissionId : undefined;
    let work: Promise<void> = Promise.resolve();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.pins--;
      this.collect();
    };
    return {
      release,
      finished: () => work,
      send: (event) => {
        if (event.type !== "SEND") { actor.send(event); return; }
        work = this.deliver(entry, { binding, event, replacesFirstId }).catch((error: unknown) => {
          settleReceipt({ disposition: "rejected", emissionId: event.messageId,
            reason: error instanceof Error ? error.message : "Conversation delivery failed" });
        }).finally(release);
      },
    };
  }
  private async deliver(entry: Entry, { binding, event, replacesFirstId }: { binding: SendBinding; event: SendEvent; replacesFirstId?: string }): Promise<void> {
    let target = binding.target;
    let startup = false;
    if (target.kind === "start") {
      const id = target.clientConversationId;
      const record = this.startupRecords().get(id);
      if (record === undefined) {
        this.startupRecords().put(id, { target, firstEmissionId: event.messageId, state: "attempted" });
        entry.started = true;
        entry.startRejected = false;
        entry.awaitingAssignment = true;
      } else if (record.state === "prepared" && (record.firstEmissionId === event.messageId || record.firstEmissionId === replacesFirstId)) {
        this.startupRecords().put(id, { ...record, firstEmissionId: event.messageId, state: "attempted" });
        entry.started = true;
        entry.startRejected = false;
        entry.awaitingAssignment = true;
      } else if (record.sessionId !== undefined) {
        target = { kind: "session", sessionId: record.sessionId, contextDir: target.contextDir };
      } else if (record.firstEmissionId !== event.messageId || record.state !== "prepared") {
        // Only a live owning stream can complete this association. After reload,
        // an attempted first send is uncertain, never permission for a fresh chat.
        if (entry.startRejected || (entry.alias === null && !entry.started)) {
          throw new ConversationRoutingError({ kind: "recovery" });
        }
        await this.awaitAlias(entry);
        if (entry.alias === null) throw new ConversationRoutingError({ kind: "waiting" });
        target = { kind: "session", sessionId: entry.alias, contextDir: target.contextDir };
        startup = !entry.assigned;
      }
    }
    if (target.kind === "start") await this.awaitReadyToStart(entry);
    if (!this.active || this.readApiBase() !== this.apiBase) throw new ConversationRoutingError({ kind: "box" });
    const receipt = expectReceipt(event.messageId);
    entry.actor.send({ ...event, binding: { ...binding, target }, startup });
    const result = await receipt;
    if (result.disposition === "rejected" && binding.target.kind === "start") {
      this.rejectStart(entry, { id: binding.target.clientConversationId, messageId: event.messageId, definitive: result.definitive === true });
    }
    else if (startup) this.assign(entry);
    if (binding.target.kind === "start" && result.disposition !== "rejected") {
      const id = binding.target.clientConversationId;
      const record = this.startupRecords().get(id);
      if (record !== undefined && record.state !== "assigned") {
        try { this.startupRecords().put(id, { ...record, state: "accepted" }); }
        catch (_error) { this.reportRecovery(); }
      }
    }
  }
  private rejectStart(entry: Entry, result: { id: string; messageId: string; definitive: boolean }): void {
    const record = this.starts?.get(result.id);
    // A failed follow-up can never alter the first-send permission.
    if (record?.firstEmissionId !== result.messageId || entry.assigned) return;
    entry.awaitingAssignment = false;
    entry.startRejected = true;
    if (result.definitive) {
      try { this.starts?.put(result.id, { ...record, state: "prepared" }); }
      catch (_error) { this.reportRecovery(); }
    }
    for (const wake of entry.waiters) wake();
  }
  private awaitReadyToStart(entry: Entry): Promise<void> {
    if (entry.actor.getSnapshot().matches("idle")) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.active && !entry.actor.getSnapshot().matches("idle")) return;
        entry.waiters.delete(check);
        resolve();
      };
      entry.waiters.add(check);
      check();
    });
  }
  private awaitAlias(entry: Entry): Promise<void> {
    return new Promise((resolve) => {
      let fallback = false;
      const timer = startAwakeTimeout({ timeoutMs: 250, periodMs: 50, onTimeout: () => {
        fallback = true;
        if (entry.alias !== null) finish();
      } });
      const ceiling = startAwakeTimeout({ timeoutMs: this.aliasWaitMs, periodMs: 50, onTimeout: () => {
        if (entry.alias === null) entry.awaitingAssignment = false;
        finish();
      } });
      const finish = () => { timer.stop(); ceiling.stop(); entry.waiters.delete(check); resolve(); };
      const check = () => { if (!this.active || entry.startRejected || entry.assigned || (fallback && entry.alias !== null)) finish(); };
      entry.waiters.add(check);
      if (entry.assigned) finish();
    });
  }
  private collect(): void {
    for (const [key, entry] of this.entries) {
      if (key === this.selected || entry.alias === this.selected || entry.pins > 0) continue;
      const snapshot = entry.actor.getSnapshot();
      if (snapshot.matches("streaming") || snapshot.matches("refreshing")) continue;
      if (entry.awaitingAssignment && !entry.assigned) continue;
      entry.actor.stop();
      this.entries.delete(key);
    }
  }
  attach(): () => void {
    this.lifecycleGeneration++;
    this.active = true;
    return () => {
      this.active = false;
      const generation = ++this.lifecycleGeneration;
      // React's development effect replay immediately attaches again. Keep
      // that actor; a real box unmount still blocks sends synchronously.
      queueMicrotask(() => { if (generation === this.lifecycleGeneration) this.suspend(); });
    };
  }
  suspend(): void {
    this.active = false;
    for (const entry of this.entries.values()) {
      for (const wake of entry.waiters) wake();
      entry.actor.stop();
    }
    this.entries.clear();
  }
}
