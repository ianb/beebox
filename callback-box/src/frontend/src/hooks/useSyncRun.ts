/**
 * useSyncRun — owns the running state and accumulated output of a single
 * background `cb wakeup` invocation, so the modal that displays it can be
 * closed and re-opened without restarting the run or losing scrollback.
 *
 * The subprocess runs server-side (POST /api/commands/execute streams
 * results); closing the modal does not abort it.
 */

import { useCallback, useState } from "react";
import { executeCommand, type CommandResult } from "../api";

export interface SyncRun {
  open: boolean;
  running: boolean;
  output: string[];
  result: CommandResult | null;
  start: () => void;
  close: () => void;
}

export function useSyncRun(): SyncRun {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [result, setResult] = useState<CommandResult | null>(null);

  const beginRun = useCallback(async () => {
    setRunning(true);
    setOutput([]);
    setResult(null);
    try {
      const finalResult = await executeCommand({
        command: "wakeup",
        args: {},
        onOutput: (line) => setOutput((prev) => [...prev, line]),
      });
      setResult(finalResult);
    } catch (err) {
      setResult({ success: false, error: (err as Error).message });
    } finally {
      setRunning(false);
    }
  }, []);

  const start = useCallback(() => {
    setOpen(true);
    if (!running) {
      void beginRun();
    }
  }, [running, beginRun]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return { open, running, output, result, start, close };
}
