/**
 * Claim Workbench Tab Error Boundary
 *
 * Wraps a single tab's content so that a failure in one tab cannot
 * crash the whole Claim Workbench. Shows a friendly error UI with a
 * retry button that re-mounts the children.
 */
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  tabName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  resetKey: number;
}

export class ClaimWorkbenchTabBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Non-blocking log; do not throw
    // eslint-disable-next-line no-console
    console.error(`[ClaimWorkbench:${this.props.tabName}] tab crashed`, error, info);
  }

  handleRetry = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <Card className="border-destructive/40">
          <CardContent className="py-8 flex flex-col items-center text-center gap-3">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">This tab could not load</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {this.props.tabName} encountered an error and was isolated to protect the rest of the workspace.
              </p>
            </div>
            <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-w-full overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
            <Button size="sm" variant="outline" onClick={this.handleRetry} className="gap-1">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <div key={this.state.resetKey} className="contents">
        {this.props.children}
      </div>
    );
  }
}

export default ClaimWorkbenchTabBoundary;
