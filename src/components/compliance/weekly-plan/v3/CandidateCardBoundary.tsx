import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface Props {
  /** Employer label used in the fallback so the planner can still act on it. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Per-candidate error isolation. A single defective candidate record must
 * degrade to an inline notice, never blank the entire planning workspace.
 */
export class CandidateCardBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CandidateCardBoundary] candidate failed to render', {
      label: this.props.label,
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium text-destructive">This candidate could not be displayed</p>
              <p className="text-muted-foreground truncate">{this.props.label}</p>
              <p className="text-muted-foreground mt-1">
                The record contains unexpected data. Other candidates are unaffected —
                please report it to the compliance system administrator.
              </p>
            </div>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
