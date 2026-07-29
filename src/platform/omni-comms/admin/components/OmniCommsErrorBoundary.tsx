/**
 * OmniCommsErrorBoundary — shared route error boundary for the Omni-Comms
 * admin shell. Catches render / lazy-import failures inside a route and
 * shows a friendly recovery UI without leaking SQL text, stack traces,
 * secret names or provider payloads.
 */
import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface State {
  hasError: boolean;
  referenceId: string | null;
}

interface Props {
  children: React.ReactNode;
}

function makeReferenceId(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OMNI-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export class OmniCommsErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, referenceId: null };

  static getDerivedStateFromError(): State {
    return { hasError: true, referenceId: makeReferenceId() };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error("[omni-comms] route error", {
      referenceId: this.state.referenceId,
      // Do not include SQL, secrets or payload bodies.
      name: (error as Error)?.name,
      message: (error as Error)?.message,
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, referenceId: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        data-testid="omni-comms-error-boundary"
        className="container mx-auto p-6 space-y-4"
      >
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This Omni-Comms screen could not be loaded.</AlertTitle>
          <AlertDescription>
            Something went wrong while rendering this screen. You can retry, or
            return to the Omnichannel Communications overview.
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What to do next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={this.handleRetry}>
                <RefreshCcw className="h-4 w-4 mr-2" /> Retry
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/omnichannel-communications">
                  <Home className="h-4 w-4 mr-2" /> Back to Overview
                </Link>
              </Button>
            </div>
            {this.state.referenceId ? (
              <p className="text-xs text-muted-foreground">
                Reference:{" "}
                <code data-testid="omni-comms-error-reference">
                  {this.state.referenceId}
                </code>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }
}

export default OmniCommsErrorBoundary;
