/**
 * Readiness tab body for the Omnichannel Communications Health page.
 *
 * Story 3: all architectural lists (routes, objects, integrations, queues)
 * are derived from the source-controlled registries in
 * `src/platform/omni-comms/registry`. The manifest no longer duplicates
 * these lists.
 */
import React from 'react';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import ReadinessSection from '../../components/ReadinessSection';
import ReadinessStatusBadge from '../../components/ReadinessStatusBadge';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from '@/platform/omni-comms/registry/deferredObjects';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '@/platform/omni-comms/registry/integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from '@/platform/omni-comms/registry/queueRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';

const dt = (label: string, value: React.ReactNode) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
    <dt className="w-52 shrink-0 text-muted-foreground">{label}</dt>
    <dd className="font-medium break-all">{value}</dd>
  </div>
);

const CATEGORY_TITLES: Record<string, string> = {
  events_and_content: 'Events and content',
  channels_senders_preferences: 'Channels, senders and preferences',
  runtime: 'Runtime',
};

export const ReadinessTab: React.FC = () => {
  const id = M.systemIdentity;
  const validation = validateOmniCommsRegistries();

  const objectsByCategory = (['events_and_content', 'channels_senders_preferences', 'runtime'] as const).map(
    (cat) => ({
      category: cat,
      title: CATEGORY_TITLES[cat],
      items: OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.category === cat),
    }),
  );

  const edgeFunctions = OMNI_COMMS_INTEGRATION_REGISTRY.filter((i) => i.kind === 'edge_function');
  const providers = OMNI_COMMS_INTEGRATION_REGISTRY.filter((i) => i.kind === 'provider');
  const sharedPlatform = OMNI_COMMS_INTEGRATION_REGISTRY.filter((i) => i.ownership === 'shared_platform');

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
          {dt('Overall status', <ReadinessStatusBadge state={id.overallStatus as 'Verified' | 'In progress'} />)}
        </dl>
      </ReadinessSection>

      {/* Registry validation */}
      <ReadinessSection
        id="registry-validation"
        title="Registry validation"
        description="Static invariant check across the Story 3 registries."
      >
        <div
          data-testid="omni-comms-registry-validation"
          data-ok={validation.ok ? 'true' : 'false'}
          className="flex items-start gap-3"
        >
          {validation.ok ? (
            <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" aria-hidden="true" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive mt-0.5" aria-hidden="true" />
          )}
          <div className="text-sm">
            <div className="font-medium">
              {validation.ok ? 'All registries valid' : `${validation.errors.length} validation error(s)`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Active objects: {validation.counts.activeObjects} · Deferred: {validation.counts.deferredObjects} ·
              Routes: {validation.counts.routes} · Integrations: {validation.counts.integrations} ·
              Queues: {validation.counts.queues}
            </div>
            {!validation.ok ? (
              <ul className="list-disc pl-5 mt-2 text-xs text-destructive">
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
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

      {/* Approved permanent routes — from routeRegistry */}
      <ReadinessSection
        id="permanent-routes"
        title="Approved permanent routes"
        description="The seven routes reserved for the new system."
      >
        <ul className="divide-y" data-testid="omni-comms-route-catalogue">
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

      {/* Object catalogue — from objectRegistry, showing epic + write authority */}
      <ReadinessSection
        id="object-catalogue"
        title="Approved logical object catalogue"
        description="19 approved objects. Objects marked Available exist as physical schema; service capability may still be planned."
      >
        <div className="grid gap-4 md:grid-cols-3" data-testid="omni-comms-object-catalogue">
          {objectsByCategory.map((group) => (
            <div key={group.category}>
              <h3 className="font-medium mb-2">{group.title}</h3>
              <ul className="space-y-2">
                {group.items.map((o) => {
                  const isAvailable = o.status === 'AVAILABLE';
                  return (
                    <li
                      key={o.name}
                      className="rounded border p-2"
                      data-testid={`omni-comms-object-${o.name}`}
                      data-object-status={o.status}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs break-all">{o.name}</code>
                        <ReadinessStatusBadge state={isAvailable ? 'Available' : 'Planned'} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Epic {o.epic} · {o.writeAuthority.replace(/_/g, ' ')}
                      </div>
                      <div className="text-xs mt-1">{o.purpose}</div>
                      <div className="text-[11px] mt-1 text-muted-foreground">
                        {isAvailable
                          ? `Physical schema available — service capability planned${o.introductionStory ? ` (${o.introductionStory})` : ''}`
                          : 'Registered in architecture catalogue — Not yet created'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <p className="text-xs text-muted-foreground">
          Approved ceiling. Each object is mapped to a specific epic and write authority.
        </p>
      </ReadinessSection>

      {/* Deferred objects */}
      <ReadinessSection
        id="deferred-objects"
        title="Deferred objects"
        description="Proposed objects intentionally NOT created; satisfied by shared platform infrastructure."
      >
        <ul className="divide-y" data-testid="omni-comms-deferred-objects">
          {OMNI_COMMS_DEFERRED_OBJECTS.map((d) => (
            <li key={d.proposedName} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs">{d.proposedName}</code>
                <ReadinessStatusBadge state="Not applicable" />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Replaced by <code>{d.replacedBy}</code>
              </div>
              <div className="text-xs mt-1">{d.note}</div>
            </li>
          ))}
        </ul>
      </ReadinessSection>

      {/* Reserved integrations — from integrationRegistry (7 entries) */}
      <ReadinessSection
        id="reserved-integrations"
        title="Reserved integrations"
        description="Seven external touchpoints reserved for the new system. Nothing has been deployed or wired."
      >
        <div className="grid gap-4 md:grid-cols-3" data-testid="omni-comms-integration-catalogue">
          <div>
            <h3 className="font-medium mb-2">Edge functions</h3>
            <ul className="space-y-1">
              {edgeFunctions.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{i.name}</code>
                  <div className="flex gap-1">
                    {i.status === 'Available' ? (
                      <ReadinessStatusBadge state="Available" />
                    ) : (
                      <>
                        <ReadinessStatusBadge state="Reserved" />
                        <ReadinessStatusBadge state="Not created" />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-2">Providers</h3>
            <ul className="space-y-1">
              {providers.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{i.name}</code>
                  <div className="flex gap-1">
                    {i.status === 'Available' ? (
                      <ReadinessStatusBadge state="Available" />
                    ) : (
                      <>
                        <ReadinessStatusBadge state="Reserved" />
                        <ReadinessStatusBadge state="Not created" />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-2">Shared platform assets (reused)</h3>
            <ul className="space-y-1">
              {sharedPlatform.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{i.name}</code>
                  <ReadinessStatusBadge state="Reused" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ReadinessSection>

      {/* Reserved queues — from queueRegistry (5 entries) */}
      <ReadinessSection
        id="reserved-queues"
        title="Reserved queues"
        description="Five logical queue names reserved for the new system."
      >
        <ul className="space-y-1" data-testid="omni-comms-queue-catalogue">
          {OMNI_COMMS_QUEUE_REGISTRY.map((q) => (
            <li key={q.name} className="flex items-center justify-between gap-2">
              <div>
                <code className="text-xs">{q.name}</code>
                <div className="text-xs text-muted-foreground">{q.purpose}</div>
              </div>
              <div className="flex gap-1">
                <ReadinessStatusBadge state="Reserved" />
                <ReadinessStatusBadge state="Not created" />
              </div>
            </li>
          ))}
        </ul>
      </ReadinessSection>

      {/* Architecture boundaries — Story 4 */}
      <ReadinessSection
        id="architecture-boundaries"
        title="Architecture boundaries"
        description="Ten architecture rules enforced locally and in pull-request CI. This page does not execute repository scans."
      >
        <ul className="divide-y" data-testid="omni-comms-architecture-boundaries">
          {M.architectureBoundaries.map((r) => (
            <li key={r.ruleId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground"><code>{r.ruleId}</code></div>
              </div>
              <ReadinessStatusBadge state="Verified" />
              <span className="text-xs text-muted-foreground sm:ml-3">Enforced in CI</span>
            </li>
          ))}
        </ul>
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
