/**
 * Omni-Comms — Approved permanent route registry (7 routes).
 *
 * These are the only admin routes reserved for the new system. All routes
 * are protected by `OmniCommsAdminRoute`, which checks `omni_comms.view`.
 * File paths reflect the current shell (Story 1 + Story 2).
 */
import type { RouteRegistryEntry } from './registry.types';

export const OMNI_COMMS_ROUTE_REGISTRY: readonly RouteRegistryEntry[] = [
  {
    path: '/admin/omnichannel-communications',
    label: 'Overview',
    pageWrapper: 'src/pages/admin/omnichannel-communications/LandingPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/operations',
    label: 'Operations',
    pageWrapper: 'src/pages/admin/omnichannel-communications/OperationsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Not implemented',
  },
  {
    path: '/admin/omnichannel-communications/events',
    label: 'Events',
    pageWrapper: 'src/pages/admin/omnichannel-communications/EventsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Not implemented',
  },
  {
    path: '/admin/omnichannel-communications/templates',
    label: 'Templates',
    pageWrapper: 'src/pages/admin/omnichannel-communications/TemplatesPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Not implemented',
  },
  {
    path: '/admin/omnichannel-communications/channels',
    label: 'Channels',
    pageWrapper: 'src/pages/admin/omnichannel-communications/ChannelsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Not implemented',
  },
  {
    path: '/admin/omnichannel-communications/preferences',
    label: 'Preferences',
    pageWrapper: 'src/pages/admin/omnichannel-communications/PreferencesPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsPreferencesPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Not implemented',
  },
  {
    path: '/admin/omnichannel-communications/health',
    label: 'Health',
    pageWrapper: 'src/pages/admin/omnichannel-communications/HealthPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
] as const;

export const OMNI_COMMS_ROUTE_COUNT = OMNI_COMMS_ROUTE_REGISTRY.length;
