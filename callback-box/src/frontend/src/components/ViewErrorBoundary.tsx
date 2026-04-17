/**
 * Error boundary for agent-generated view components.
 *
 * Catches runtime errors in dynamically loaded view code and shows
 * the error message + stack trace instead of crashing the page.
 */

import React from "react";
import { Pre } from "./ui/Pre";

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
        <div className="border border-danger-light bg-danger-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-danger-dark font-medium">View Error</h3>
            <button
              onClick={this.handleReset}
              className="text-sm text-danger-dark hover:text-danger-dark underline"
            >
              Retry
            </button>
          </div>
          <Pre size="sm" error scroll="md">
            {this.state.error.message}
            {this.state.error.stack ? "\n\n" + this.state.error.stack : ""}
          </Pre>
        </div>
      );
    }
    return this.props.children;
  }
}
