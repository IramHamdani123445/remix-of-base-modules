/**
 * Omni-Comms C1 — shared presentation primitives for the channel workspace.
 * Pure presentation: no RPC calls, no provider SDKs, no send behaviour.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';

export function toastError(err: unknown, fallback: string): void {
  if (err instanceof OmniCommsRpcError) {
    toast.error(`${err.code} ${err.detail ?? fallback}`);
  } else {
    toast.error(err instanceof Error ? err.message : fallback);
  }
}

export const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

export const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <select
      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— select —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

export const Detail: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{value}</p>
  </div>
);

/** Truthful, read-only explanation used by every deferred capability. */
export const DeferredCapabilityCard: React.FC<{
  title: string;
  description: string;
  bullets?: readonly string[];
  footer?: string;
  testId?: string;
}> = ({ title, description, bullets, footer, testId }) => (
  <Card data-testid={testId}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {bullets && bullets.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          {bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
      ) : null}
      {footer ? <p className="text-xs text-muted-foreground">{footer}</p> : null}
    </CardContent>
  </Card>
);
