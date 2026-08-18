/**
 * Omni-Comms — Approved permanent route registry (18 routes).

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
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/events',
    label: 'Events',
    pageWrapper: 'src/pages/admin/omnichannel-communications/EventsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/templates',
    label: 'Templates',
    pageWrapper: 'src/pages/admin/omnichannel-communications/TemplatesPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/channels',
    label: 'Channels',
    pageWrapper: 'src/pages/admin/omnichannel-communications/ChannelsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
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
  {
    path: '/admin/omnichannel-communications/control-center',
    label: 'Control Center',
    pageWrapper: 'src/pages/admin/omnichannel-communications/ControlCenterPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsControlCenterPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/setup',
    label: 'Setup readiness',
    pageWrapper: 'src/pages/admin/omnichannel-communications/SetupPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsSetupPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/safe-test',
    label: 'Safe test',
    pageWrapper: 'src/pages/admin/omnichannel-communications/SafeTestPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsSafeTestPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/reference-data',
    label: 'Reference data',
    pageWrapper: 'src/pages/admin/omnichannel-communications/ReferenceDataPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/OmniCommsReferenceDataPage.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/branding/defaults',
    label: 'Defaults & overrides',
    pageWrapper: 'src/pages/admin/omnichannel-communications/branding/DefaultsOverridesPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/branding/BrandingDefaultsView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/letterheads',
    label: 'Letterheads',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/LetterheadsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/LetterheadsView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/email-layouts',
    label: 'Email layouts',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/EmailLayoutsPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/EmailLayoutsView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/media',
    label: 'Media library',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/MediaLibraryPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/MediaLibraryView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/text-blocks',
    label: 'Text blocks',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/TextBlocksPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/TextBlocksView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/headers-footers',
    label: 'Headers & footers',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/HeadersFootersPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/HeadersFootersView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/signatures',
    label: 'Signatures',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/SignaturesPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/SignaturesView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
  {
    path: '/admin/omnichannel-communications/stationery/disclaimers',
    label: 'Disclaimers',
    pageWrapper: 'src/pages/admin/omnichannel-communications/stationery/DisclaimersPage.tsx',
    moduleView: 'src/platform/omni-comms/admin/views/stationery/DisclaimersView.tsx',
    requiredPermission: 'omni_comms.view',
    state: 'Available',
  },
] as const;


export const OMNI_COMMS_ROUTE_COUNT = OMNI_COMMS_ROUTE_REGISTRY.length;
