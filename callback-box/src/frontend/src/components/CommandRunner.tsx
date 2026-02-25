/**
 * CommandRunner - Execute cb commands with streaming output display.
 *
 * Makes the web UI feel isomorphic to the CLI by showing the actual
 * command being run and its streaming output.
 */

import { useState, useRef, useEffect } from "react";
import AnsiToHtml from "ansi-to-html";
import { executeCommand, type CommandResult } from "../api";

// Create a singleton converter with dark theme colors
const ansiConverter = new AnsiToHtml({
  fg: "#e5e7eb", // gray-200
  bg: "#111827", // gray-900
  colors: {
    0: "#374151",  // black -> gray-700
    1: "#ef4444",  // red
    2: "#22c55e",  // green
    3: "#eab308",  // yellow
    4: "#3b82f6",  // blue
    5: "#a855f7",  // magenta
    6: "#06b6d4",  // cyan
    7: "#e5e7eb",  // white -> gray-200
    8: "#6b7280",  // bright black -> gray-500
    9: "#f87171",  // bright red
    10: "#4ade80", // bright green
    11: "#facc15", // bright yellow
    12: "#60a5fa", // bright blue
    13: "#c084fc", // bright magenta
    14: "#22d3ee", // bright cyan
    15: "#f9fafb", // bright white -> gray-50
  },
});

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

/**
 * Format args object into CLI-style string for display.
 */
function formatArgsForDisplay(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === true) {
      parts.push(`--${key}`);
    } else if (value !== false && value !== undefined && value !== null) {
      parts.push(`--${key}=${JSON.stringify(value)}`);
    }
  }
  return parts.join(" ");
}

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
  const argsString = formatArgsForDisplay(args);
  const fullCommand = argsString ? `cb ${command} ${argsString}` : `cb ${command}`;

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
      const result = await executeCommand({
        command,
        args,
        onOutput: (text) => {
          setOutput((prev) => [...prev, text]);
        },
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
    idle: "bg-warm-100 border-warm-400",
    running: "bg-iris-50 border-plum-light",
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
                ? "text-plum animate-pulse"
                : state === "success"
                  ? "text-green-600"
                  : state === "error"
                    ? "text-red-600"
                    : "text-warm-500"
            }`}
          >
            {stateIcons[state]}
          </span>
          <code className="text-sm font-mono font-semibold text-warm-800">
            {commandLabel}
          </code>
        </div>

        <div className="flex items-center gap-2">
          {state === "idle" && (
            <button
              onClick={runCommand}
              className="px-3 py-1 text-sm bg-plum text-white rounded hover:bg-plum-dark transition-colors"
            >
              Run
            </button>
          )}

          {state === "running" && (
            <span className="text-xs text-plum">Running...</span>
          )}

          {(state === "success" || state === "error") && (
            <button
              onClick={runCommand}
              className="px-3 py-1 text-sm bg-warm-200 text-warm-700 rounded hover:bg-warm-300 transition-colors"
            >
              Run Again
            </button>
          )}

          {onClose ? <button
              onClick={onClose}
              className="px-3 py-1 text-sm text-warm-600 hover:text-warm-700 hover:bg-warm-100 rounded transition-colors"
            >
              Close
            </button> : null}
        </div>
      </div>

      {/* Output area */}
      {(output.length > 0 || error) ? <pre
          ref={outputRef}
          data-debug-context={fullCommand}
          className="flex-1 p-3 text-xs font-mono overflow-auto min-h-[200px] bg-gray-900 text-gray-100 whitespace-pre-wrap break-words"
        >
          {output.map((line, i) => (
            <div
              key={i}
              dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(line) }}
            />
          ))}
          {error ? <div className="text-red-400">Error: {error}</div> : null}
        </pre> : null}

      {/* Empty state */}
      {state === "idle" && output.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-3 py-8 text-sm text-warm-600">
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
        className="text-xs text-warm-600 hover:text-warm-700"
      >
        Collapse
      </button>
    </div>
  );
}
