/** Console/log channel a line came from. */
export type LogLevel = "log" | "warn" | "error";

/**
 * The runtime object a run's surface talks back to: log lines and snapshot requests
 * are recorded against whatever frame is currently executing.
 */
export interface SketchHost {
  recordLog(entry: { level: LogLevel; message: string }): void;
  requestSnapshot(label: string | undefined): void;
}
