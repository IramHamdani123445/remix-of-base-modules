/**
 * Readiness tab body for the Omnichannel Communications Health page.
 * All data comes from the source-controlled readiness manifest.
 */
import React from 'react';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, ArrowRight } from 'lucide-react';
import ReadinessSection from '../../components/ReadinessSection';
import ReadinessStatusBadge from '../../components/ReadinessStatusBadge';
import {
  OMNI_COMMS_READINESS_MANIFEST as M,
} from '@/platform/omni-comms/registry/readinessManifest';

const dt = (label: string, value: React.ReactNode) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
    <dt className="w-52 shrink-0 text-muted-foreground">{label}</dt>
    <dd className="font-medium break-all">{value}</dd>
  </div>
);

export const ReadinessTab: React.FC = () => {
  const id = M.systemIdentity;

  return (
    <div className="space-y-6" data-testid="omni-comms-readiness-tab">
      {/* System identity */}
      <ReadinessSection
        id="system-identity"
        title="System identity"
        description="Factual identifiers for the new parallel system."
      >
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {dt('Product name', id.productName)}
          {dt('System type', id.systemType)}
          {dt('Source namespace', <code>{id.sourceNamespace}</code>)}
          {dt('Admin route prefix', <code>{id.adminPrefix}</code>)}
          {dt('API route prefix', <code>{id.apiPrefix}</code>)}
          {dt('Database prefix', <code>{id.dbPrefix}</code>)}
          {dt('Queue prefix', <code>{id.queuePrefix}</code>)}
          {dt('Current epic', id.currentEpic)}
          {dt('Current story', id.currentStory)}
          {dt('Overall status', <ReadinessStatusBadge state="Verified" />)}
        </dl>
      </ReadinessSection>

      {/* Foundation status */}
      <ReadinessSection
        id="foundation-status"
        title="Foundation status"
        description="Static, source-controlled implementation status per foundation concern."
      >
        <ul className="divide-y">
          {M.foundationStatus.map((row) => (
            <li key={row.item} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{row.item}</div>
                {row.note ? <div className="text-xs text-muted-foreground">{row.note}</div> : null}
              </div>
              <ReadinessStatusBadge state={row.state} />
            </li>
          ))}
        </ul>
      </ReadinessSection>

      {/* Legacy isolation */}
      <ReadinessSection
        id="legacy-isolation"
        title="Legacy isolation"
        description="Rules governing the boundary with Legacy Communication Hub."
      >
        <ul className="list-disc pl-5 space-y-1">
          {M.legacyIsolation.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3">
          This section does not query Legacy tables.
        </p>
      </ReadinessSection>

      {/* Permanent routes */}
      <ReadinessSection
        id="permanent-routes"
        title="Approved permanent routes"
        description="The seven routes reserved for the new system."
      >
        <ul className="divide-y">
          {M.permanentRoutes.map((r) => (
            <li key={r.path} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground"><code>{r.path}</code></div>
              </div>
              <ReadinessStatusBadge state={r.state} />
            </li>
          ))}
        </ul>
      </ReadinessSection>

      {/* Capabilities */}
      <ReadinessSection
        id="capabilities"
        title="Approved capabilities"
        description="Permission keys governing the new system. Role identifiers are not exposed."
      >
        <ul className="divide-y">
          {M.capabilities.map((c) => (
            <li key={c.key} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <code className="font-medium">{c.key}</code>
                <div className="flex flex-wrap gap-2">
                  <ReadinessStatusBadge state={c.registration} />
                  <ReadinessStatusBadge state={c.mapping} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{c.intendedUse}</p>
            </li>
          ))}
        </ul>
      </ReadinessSection>

      {/* Planned objects */}
      <ReadinessSection
        id="planned-objects"
        title="Approved logical object ceiling"
        description={M.plannedObjects.note}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: 'Events and content', items: M.plannedObjects.eventsAndContent },
            { title: 'Channels, senders and preferences', items: M.plannedObjects.channelsSendersPreferences },
            { title: 'Runtime', items: M.plannedObjects.runtime },
          ].map((group) => (
            <div key={group.title}>
              <h3 className="font-medium mb-2">{group.title}</h3>
              <ul className="space-y-1">
                {group.items.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-2">
                    <code className="text-xs">{name}</code>
                    <ReadinessStatusBadge state="Planned" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <p className="text-xs text-muted-foreground">
          None of these tables have been created. The Readiness page does not query the database for them.
        </p>
      </ReadinessSection>

      {/* Reserved integrations */}
      <ReadinessSection
        id="reserved-integrations"
        title="Reserved integrations"
        description="Names reserved for the new system. Nothing has been deployed."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium mb-2">Edge functions</h3>
            <ul className="space-y-1">
              {M.reservedEdgeFunctions.map((name) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{name}</code>
                  <div className="flex gap-1">
                    <ReadinessStatusBadge state="Reserved" />
                    <ReadinessStatusBadge state="Not created" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-2">Queues</h3>
            <ul className="space-y-1">
              {M.reservedQueues.map((name) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{name}</code>
                  <div className="flex gap-1">
                    <ReadinessStatusBadge state="Reserved" />
                    <ReadinessStatusBadge state="Not created" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ReadinessSection>

      {/* Blockers */}
      <ReadinessSection
        id="blockers"
        title="Blockers"
        description="Active blockers scoped to the epics they affect."
      >
        <ul className="divide-y">
          {M.blockers.map((b) => (
            <li key={b.id} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{b.description}</div>
                  <div className="text-xs text-muted-foreground">Affects Epic {b.affectsEpic}</div>
                </div>
                <ReadinessStatusBadge state="Blocked" />
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3">
          These blockers do not affect Epics 1 through 10.
        </p>
      </ReadinessSection>

      {/* Next step */}
      <Alert data-testid="omni-comms-next-step">
        <Info className="h-4 w-4" />
        <AlertTitle>Next approved step</AlertTitle>
        <AlertDescription>
          <span className="inline-flex items-center gap-2">
            <span className="font-medium">
              {M.nextStep.epic} — {M.nextStep.story}
            </span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            <span>{M.nextStep.title}</span>
          </span>
          <div className="text-xs text-muted-foreground mt-1">Informational only.</div>
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default ReadinessTab;
