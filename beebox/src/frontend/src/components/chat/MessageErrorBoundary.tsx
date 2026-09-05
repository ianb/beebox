/**
 * Error boundary for a single chat message. A broken message (e.g. malformed
 * markdown, an unexpected attribute that React rejects) renders as a compact
 * red bar instead of crashing the whole transcript. The error is logged to
 * `console.error`, which the DebugLog pipe forwards to the server so the
 * issue is recoverable from the client-debug log.
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  /** Identifier included in the log line, e.g. the group index or entry uuid. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class MessageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const label = this.props.label ? ` [${this.props.label}]` : "";
    console.error(
      `Chat message render error${label}: ${error.message}\n${error.stack ?? ""}\nComponent stack:${info.componentStack ?? ""}`,
    );
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="mx-3 sm:mx-6 my-1 px-3 py-2 rounded border border-danger-light bg-danger-50 text-xs text-danger-dark">
          <span className="font-medium">Message render error:</span>{" "}
          <span className="font-mono">{error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
