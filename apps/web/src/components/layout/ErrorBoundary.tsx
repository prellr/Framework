import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-content error boundary. A component crash inside a page shows a contained, diagnosable error
 * (with the sidebar/nav still alive) instead of white-screening the app or leaving it half-dead —
 * which is indistinguishable from "the button doesn't work" and wastes a debugging session.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ui] page crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-16 max-w-lg space-y-4 rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <h2 className="text-lg font-semibold">This page hit an error</h2>
          <p className="break-words font-mono text-xs text-muted-foreground">{this.state.error.message}</p>
          <p className="text-sm text-muted-foreground">
            The rest of the app is fine. Reloading usually clears it — especially right after a deploy.
          </p>
          <div className="flex justify-center gap-2">
            <Button size="sm" onClick={() => window.location.reload()}>Reload</Button>
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
