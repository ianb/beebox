export type DeletePhase = "preflight" | "stopped" | "schedules" | "pointer" | "history" | "review" | "storage" | "husk";

/** One structured progress record per destructive phase for crash diagnosis. */
export function logDeletePhase(options: { sessionId: string; phase: DeletePhase; detail?: Record<string, unknown> }): void {
  console.info("chat-delete: phase", { sessionId: options.sessionId, phase: options.phase, ...(options.detail ?? {}) });
}
