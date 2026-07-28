/**
 * Omnichannel Communications — Route Registry.
 *
 * Documents the seven permanent admin routes and the approved tab names
 * inside each route. This file does NOT register React routes — it is the
 * source of truth against which the real router configuration is
 * validated.
 */

import type { OmniCommsRouteEntry } from './registry.types';

const ADMIN_PREFIX = '/admin/omnichannel-communications';

export const OMNI_COMMS_ROUTE_REGISTRY: readonly OmniCommsRouteEntry[] = [
  {
    routeId: 'root',
    path: `${ADMIN_PREFIX}`,
    label: 'Overview',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Landing overview linking to the other Omni-Comms admin surfaces.',
    approvedTabs: ['overview'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsLandingPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
  },
  {
    routeId: 'operations',
    path: `${ADMIN_PREFIX}/operations`,
    label: 'Operations',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Operational console for requests, messages and batches (planned).',
    approvedTabs: ['requests', 'messages', 'batches'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsOperationsPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx',
  },
  {
    routeId: 'events',
    path: `${ADMIN_PREFIX}/events`,
    label: 'Events',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Event definitions, contracts, routing and simulator (planned).',
    approvedTabs: ['definitions', 'contracts', 'routes', 'simulator'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsEventsPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx',
  },
  {
    routeId: 'templates',
    path: `${ADMIN_PREFIX}/templates`,
    label: 'Templates',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Template library, versions and preview (planned).',
    approvedTabs: ['library', 'versions', 'preview'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsTemplatesPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx',
  },
  {
    routeId: 'channels',
    path: `${ADMIN_PREFIX}/channels`,
    label: 'Channels',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Channel settings, senders, providers and bindings (planned).',
    approvedTabs: ['settings', 'senders', 'providers', 'bindings'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsChannelsPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx',
  },
  {
    routeId: 'preferences',
    path: `${ADMIN_PREFIX}/preferences`,
    label: 'Preferences',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose: 'Recipient preferences and suppression management (planned).',
    approvedTabs: ['preferences'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsPreferencesPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsPreferencesPage.tsx',
  },
  {
    routeId: 'health',
    path: `${ADMIN_PREFIX}/health`,
    label: 'Health',
    requiredPermission: 'omni_comms.view',
    owningEpic: 1,
    currentStatus: 'available',
    purpose:
      'Readiness manifest and future data-model, queues, webhooks, audit and migration surfaces.',
    approvedTabs: ['readiness', 'data-model', 'queues', 'webhooks', 'audit', 'migration'],
    pageWrapperPath: 'src/pages/admin/omnichannel-communications/OmniCommsHealthPage.tsx',
    moduleViewPath: 'src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx',
  },
] as const;

export const OMNI_COMMS_ROUTE_COUNT = OMNI_COMMS_ROUTE_REGISTRY.length;
