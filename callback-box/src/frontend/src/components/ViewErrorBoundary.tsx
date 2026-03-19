/**
 * Error boundary for agent-generated view components.
 *
 * Catches runtime errors in dynamically loaded view code and shows
 * the error message + stack trace instead of crashing the page.
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

export class ViewErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("View render error:", error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="border border-red-300 bg-red-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-red-800 font-medium">View Error</h3>
            <button
              onClick={this.handleReset}
              className="text-sm text-red-600 hover:text-red-800 underline"
            >
              Retry
            </button>
          </div>
          <pre className="text-sm text-red-700 whitespace-pre-wrap overflow-auto max-h-48">
            {this.state.error.message}
            {this.state.error.stack ? "\n\n" + this.state.error.stack : ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
