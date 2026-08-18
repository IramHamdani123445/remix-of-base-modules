/**
 * Omni-Comms — business-oriented template catalogue (pure domain).
 *
 * Presents governed catalogue metadata as
 *   MODULE → BUSINESS OBJECT → BUSINESS EVENT → COMMUNICATION ACTION → CHANNELS
 *
 * Grouping and ordering are driven ONLY by governed metadata
 * (module_code, business_object_code, display_order). Template codes are never
 * parsed to infer a hierarchy. No React, no Supabase, no Legacy imports.
 */
import {
  TEMPLATE_CHANNELS,
  type TemplateChannel,
  type TemplateFamilyStatus,
  type TemplateScopeType,
  type TemplateVersionStatus,
} from '../application/templateCatalogueTypes';

/** Channel order used by every business row so the grid never shifts. */
export const CATALOGUE_CHANNEL_ORDER: readonly TemplateChannel[] = [
  'email', 'sms', 'whatsapp', 'print', 'in_app', 'push',
];

export const CHANNEL_LABEL: Record<TemplateChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  print: 'Print',
  in_app: 'In-App',
  push: 'Push',
};

export interface CatalogueChannelVariant {
  channel: TemplateChannel;
  version_id: string | null;
  status: TemplateVersionStatus | null;
  version_number: number | null;
  version_count: number;
}

export interface CatalogueAction {
  id: string;
  code: string;
  name: string;
  status: TemplateFamilyStatus;
  scope_type: TemplateScopeType;
  department_id: string | null;
  channels: CatalogueChannelVariant[];
}

export interface CatalogueEvent {
  id: string;
  code: string;
  name: string;
  status: string;
  communication_class: string | null;
  display_order: number;
  actions: CatalogueAction[];
}

export interface CatalogueBusinessObject {
  code: string;
  name: string;
  display_order: number;
  events: CatalogueEvent[];
}

export interface CatalogueModule {
  module_code: string;
  module_name: string;
  business_objects: CatalogueBusinessObject[];
}

export interface TemplateBusinessCatalogue {
  modules: CatalogueModule[];
  /** Genuinely reusable communications that belong to no business event. */
  shared: CatalogueAction[];
}

/** Presentation state of one channel for one Communication Action. */
export type ChannelCellState =
  | 'published'
  | 'approved'
  | 'draft'
  | 'retired'
  | 'missing';

export const CHANNEL_STATE_GLYPH: Record<ChannelCellState, string> = {
  published: '✓',
  approved: '◐',
  draft: '●',
  retired: '!',
  missing: '—',
};

export const CHANNEL_STATE_LABEL: Record<ChannelCellState, string> = {
  published: 'Published',
  approved: 'Approved',
  draft: 'Draft',
  retired: 'Retired',
  missing: 'Not configured',
};

/** Inheritance source shown next to each channel (never duplicated content). */
export function scopeSourceLabel(scope: TemplateScopeType): string {
  switch (scope) {
    case 'event': return 'Event override';
    case 'department': return 'Department × module default';
    default: return 'Organisation default';
  }
}

export function channelVariant(
  action: CatalogueAction,
  channel: TemplateChannel,
): CatalogueChannelVariant | null {
  return action.channels.find((c) => c.channel === channel) ?? null;
}

export function channelState(
  action: CatalogueAction,
  channel: TemplateChannel,
): ChannelCellState {
  const v = channelVariant(action, channel);
  if (!v || !v.status) return 'missing';
  return v.status as ChannelCellState;
}

/** All supported channels are ALWAYS returned — missing ones included. */
export function channelRow(action: CatalogueAction): Array<{
  channel: TemplateChannel;
  state: ChannelCellState;
  variant: CatalogueChannelVariant | null;
}> {
  return CATALOGUE_CHANNEL_ORDER.map((channel) => ({
    channel,
    state: channelState(action, channel),
    variant: channelVariant(action, channel),
  }));
}

export interface CatalogueSummary {
  events: number;
  configured: number;
  incomplete: number;
}

export function summariseBusinessObject(bo: CatalogueBusinessObject): CatalogueSummary {
  let configured = 0;
  for (const ev of bo.events) {
    const anyPublished = ev.actions.some((a) =>
      a.channels.some((c) => c.status === 'published'));
    if (anyPublished) configured += 1;
  }
  return {
    events: bo.events.length,
    configured,
    incomplete: bo.events.length - configured,
  };
}

// ─── Filtering & search ──────────────────────────────────────────────────────

export type CompletenessFilter = 'all' | 'configured' | 'missing';

export interface CatalogueFilters {
  search?: string;
  moduleCode?: string | null;
  businessObjectCode?: string | null;
  channel?: TemplateChannel | null;
  status?: TemplateFamilyStatus | null;
  scopeType?: TemplateScopeType | null;
  completeness?: CompletenessFilter;
}

function matchesSearch(
  needle: string,
  module: CatalogueModule,
  bo: CatalogueBusinessObject,
  ev: CatalogueEvent,
  action: CatalogueAction,
): boolean {
  const haystack = [
    module.module_code, module.module_name,
    bo.code, bo.name,
    ev.code, ev.name,
    action.code, action.name,
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function actionPasses(
  action: CatalogueAction,
  f: CatalogueFilters,
): boolean {
  if (f.status && action.status !== f.status) return false;
  if (f.scopeType && action.scope_type !== f.scopeType) return false;
  if (f.channel) {
    const state = channelState(action, f.channel);
    if (f.completeness === 'missing') return state === 'missing';
    if (f.completeness === 'configured') return state !== 'missing';
    return true;
  }
  if (f.completeness === 'configured') {
    return action.channels.some((c) => c.status !== null);
  }
  if (f.completeness === 'missing') {
    return CATALOGUE_CHANNEL_ORDER.some((c) => channelState(action, c) === 'missing');
  }
  return true;
}

/** Applies every filter and drops empty branches, preserving governed order. */
export function filterCatalogue(
  catalogue: TemplateBusinessCatalogue,
  filters: CatalogueFilters = {},
): TemplateBusinessCatalogue {
  const needle = (filters.search ?? '').trim().toLowerCase();

  const modules = catalogue.modules
    .filter((m) => !filters.moduleCode || m.module_code === filters.moduleCode)
    .map((m) => ({
      ...m,
      business_objects: m.business_objects
        .filter((b) => !filters.businessObjectCode || b.code === filters.businessObjectCode)
        .map((b) => ({
          ...b,
          events: b.events
            .map((ev) => ({
              ...ev,
              actions: ev.actions.filter(
                (a) => actionPasses(a, filters)
                  && (!needle || matchesSearch(needle, m, b, ev, a)),
              ),
            }))
            // An event with no matching action is still shown when the event
            // itself matches the search and no action-level filter is set.
            .filter((ev) =>
              ev.actions.length > 0
              || (!needle
                ? !filters.status && !filters.scopeType && !filters.channel
                  && (filters.completeness ?? 'all') !== 'configured'
                : [ev.code, ev.name, b.name, b.code, m.module_name]
                  .join(' ').toLowerCase().includes(needle))),
        }))
        .filter((b) => b.events.length > 0),
    }))
    .filter((m) => m.business_objects.length > 0);

  const shared = catalogue.shared.filter(
    (a) => actionPasses(a, filters)
      && (!needle
        || [a.code, a.name, 'shared general'].join(' ').toLowerCase().includes(needle))
      && !filters.moduleCode && !filters.businessObjectCode,
  );

  return { modules, shared };
}

/** Distinct module options for the filter bar (governed codes only). */
export function moduleOptions(catalogue: TemplateBusinessCatalogue) {
  return catalogue.modules.map((m) => ({ code: m.module_code, name: m.module_name }));
}

export function businessObjectOptions(
  catalogue: TemplateBusinessCatalogue,
  moduleCode?: string | null,
) {
  return catalogue.modules
    .filter((m) => !moduleCode || m.module_code === moduleCode)
    .flatMap((m) => m.business_objects.map((b) => ({ code: b.code, name: b.name })))
    .filter((o, i, all) => all.findIndex((x) => x.code === o.code) === i);
}

/** All template channels remain the supported set — re-exported for views. */
export const SUPPORTED_TEMPLATE_CHANNELS = TEMPLATE_CHANNELS;
