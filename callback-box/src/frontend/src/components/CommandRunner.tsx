/**
 * CommandRunner - Execute cb commands with streaming output display.
 *
 * Makes the web UI feel isomorphic to the CLI by showing the actual
 * command being run and its streaming output.
 */

import { useState, useRef, useEffect } from "react";
import { executeCommand, type CommandResult } from "../api";

interface CommandRunnerProps {
  /** The command to run (e.g., "wakeup", "create") */
  command: string;
  /** Arguments to pass to the command */
  args?: Record<string, unknown>;
  /** Called when execution completes */
  onComplete?: (result: CommandResult) => void;
  /** If true, start running immediately */
  autoRun?: boolean;
  /** Custom label (defaults to "cb <command>") */
  label?: string;
  /** Called when close button is clicked */
  onClose?: () => void;
  /** Additional class name for the container */
  className?: string;
}

type RunState = "idle" | "running" | "success" | "error";

export function CommandRunner({
  command,
  args = {},
  onComplete,
  autoRun = false,
  label,
  onClose,
  className = "",
}: CommandRunnerProps) {
  const [state, setState] = useState<RunState>("idle");
  const [output, setOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const commandLabel = label ?? `cb ${command}`;

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Auto-run on mount if requested
  useEffect(() => {
    if (autoRun) {
      runCommand();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCommand = async () => {
    setState("running");
    setOutput([]);
    setError(null);

    try {
      const result = await executeCommand(command, args, (text) => {
        setOutput((prev) => [...prev, text]);
      });

      if (result.success) {
        setState("success");
      } else {
        setState("error");
        setError(result.error ?? "Command failed");
      }

      onComplete?.(result);
    } catch (err) {
      setState("error");
      setError((err as Error).message);
      onComplete?.({ success: false, error: (err as Error).message });
    }
  };

  const stateColors = {
    idle: "bg-gray-100 border-gray-300",
    running: "bg-blue-50 border-blue-300",
    success: "bg-green-50 border-green-300",
    error: "bg-red-50 border-red-300",
  };

  const stateIcons = {
    idle: "○",
    running: "◉",
    success: "✓",
    error: "✗",
  };

  return (
    <div className={`flex flex-col border rounded-lg overflow-hidden ${stateColors[state]} ${className}`}>
      {/* Command header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white/50">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${
              state === "running"
                ? "text-blue-600 animate-pulse"
                : state === "success"
                  ? "text-green-600"
                  : state === "error"
                    ? "text-red-600"
                    : "text-gray-400"
            }`}
          >
            {stateIcons[state]}
          </span>
          <code className="text-sm font-mono font-semibold text-gray-800">
            {commandLabel}
          </code>
        </div>

        <div className="flex items-center gap-2">
          {state === "idle" && (
            <button
              onClick={runCommand}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Run
            </button>
          )}

          {state === "running" && (
            <span className="text-xs text-blue-600">Running...</span>
          )}

          {(state === "success" || state === "error") && (
            <button
              onClick={runCommand}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Run Again
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      {(output.length > 0 || error) && (
        <pre
          ref={outputRef}
          className="flex-1 p-3 text-xs font-mono overflow-auto min-h-[200px] bg-gray-900 text-gray-100"
        >
          {output.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {error && <div className="text-red-400">Error: {error}</div>}
        </pre>
      )}

      {/* Empty state */}
      {state === "idle" && output.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-3 py-8 text-sm text-gray-500">
          Click Run to execute
        </div>
      )}
    </div>
  );
}

/**
 * Inline command button that expands to show output when run.
 */
interface CommandButtonProps {
  command: string;
  args?: Record<string, unknown>;
  onComplete?: (result: CommandResult) => void;
  className?: string;
  children?: React.ReactNode;
}

export function CommandButton({
  command,
  args = {},
  onComplete,
  className = "",
  children,
}: CommandButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const commandLabel = `cb ${command}`;

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className={`font-mono text-sm ${className}`}
        title={`Run: ${commandLabel}`}
      >
        {children ?? commandLabel}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <CommandRunner
        command={command}
        args={args}
        onComplete={onComplete}
        autoRun
      />
      <button
        onClick={() => setIsExpanded(false)}
        className="text-xs text-gray-500 hover:text-gray-700"
      >
        Collapse
      </button>
    </div>
  );
}
