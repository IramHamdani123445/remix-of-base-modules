/**
 * Omni-Comms C1 — generic channel tab shell.
 *
 * Drives the administration tab strip from the channel catalogue instead of
 * per-channel hard-coded markup. Tabs a channel does not declare are never
 * rendered. For channels whose delivery adapter is not yet built, the shell is
 * fail-closed: it renders a reserved-surface placeholder and mounts no
 * configuration or send capability.
 *
 * C2–C5 will replace the individual placeholders with real Accounts,
 * Identities, Endpoints, Bindings, Policies, Test Centre and Diagnostics
 * panels; the shell contract stays unchanged.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OMNI_COMMS_GENERIC_TABS,
  type OmniCommsChannelDescriptor,
  type OmniCommsGenericTab,
} from '@/platform/omni-comms/domain/channelCatalogue';
import { resolveTabParam, useOmniCommsTabParam } from '../hooks/useOmniCommsTabParam';

const TAB_LABELS: Record<OmniCommsGenericTab, string> = {
  overview: 'Overview',
  accounts: 'Accounts',
  identities: 'Identities',
  endpoints: 'Endpoints',
  bindings: 'Bindings',
  policies: 'Policies',
  test: 'Test centre',
  diagnostics: 'Diagnostics',
};

const TAB_CHUNK: Record<OmniCommsGenericTab, string> = {
  overview: 'C1',
  accounts: 'C2',
  identities: 'C3',
  endpoints: 'C3',
  bindings: 'C4',
  policies: 'C4',
  test: 'C5',
  diagnostics: 'C5',
};

export interface OmniCommsChannelTabShellProps {
  descriptor: OmniCommsChannelDescriptor;
  /** Optional per-tab content overrides supplied by later chunks. */
  render?: Partial<Record<OmniCommsGenericTab, React.ReactNode>>;
}

const ReservedPanel: React.FC<{
  descriptor: OmniCommsChannelDescriptor;
  tab: OmniCommsGenericTab;
}> = ({ descriptor, tab }) => (
  <Card data-testid={`omni-comms-reserved-${descriptor.channel}-${tab}`}>
    <CardHeader>
      <CardTitle className="text-base">
        {TAB_LABELS[tab]} — reserved surface
      </CardTitle>
      <CardDescription>
        {descriptor.label} · delivered in build chunk {TAB_CHUNK[tab]}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle>Not yet configurable</AlertTitle>
        <AlertDescription>
          This surface is reserved by the channel catalogue. No provider
          adapter, credential store or send capability is mounted for the{' '}
          {descriptor.label.toLowerCase()} channel, so nothing can be
          dispatched from here.
        </AlertDescription>
      </Alert>
    </CardContent>
  </Card>
);

const OverviewPanel: React.FC<{ descriptor: OmniCommsChannelDescriptor }> = ({
  descriptor,
}) => (
  <Card data-testid={`omni-comms-channel-overview-${descriptor.channel}`}>
    <CardHeader>
      <CardTitle className="text-base">{descriptor.label}</CardTitle>
      <CardDescription>{descriptor.description}</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <div className="text-muted-foreground">Delivery shape</div>
        <div className="font-medium">{descriptor.kind.replace(/_/g, ' ')}</div>
      </div>
      <div>
        <div className="text-muted-foreground">Owning build chunk</div>
        <div className="font-medium">{descriptor.chunk}</div>
      </div>
      <div>
        <div className="text-muted-foreground">Seed namespace</div>
        <div className="font-mono text-xs">{descriptor.seedNamespace}</div>
      </div>
      <div>
        <div className="text-muted-foreground">Status</div>
        <div className="font-medium">
          {descriptor.implemented ? 'Administration surface available' : 'Reserved'}
        </div>
      </div>
    </CardContent>
  </Card>
);

export const OmniCommsChannelTabShell: React.FC<OmniCommsChannelTabShellProps> = ({
  descriptor,
  render,
}) => {
  const allowed = descriptor.tabs;
  const fallback = allowed[0] ?? 'overview';
  const [tab, setTab] = useOmniCommsTabParam(allowed, fallback);

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="w-full"
      data-testid={`omni-comms-channel-shell-${descriptor.channel}`}
    >
      <TabsList className="flex-wrap">
        {allowed.map((t) => (
          <TabsTrigger key={t} value={t} data-testid={`omni-comms-tab-${t}`}>
            {TAB_LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>

      {allowed.map((t) => (
        <TabsContent key={t} value={t} className="pt-4">
          {render?.[t] ??
            (t === 'overview' ? (
              <OverviewPanel descriptor={descriptor} />
            ) : (
              <ReservedPanel descriptor={descriptor} tab={t} />
            ))}
        </TabsContent>
      ))}
    </Tabs>
  );
};

export { TAB_LABELS as OMNI_COMMS_TAB_LABELS, OMNI_COMMS_GENERIC_TABS, resolveTabParam };
export default OmniCommsChannelTabShell;
