import { describe, expect, it } from 'vitest';
import { projectEmailReadiness } from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import { projectDispatchDiagnostics } from '@/platform/omni-comms/admin/views/channels/dispatchDiagnosticsProjection';
import {
  projectEmailGoLiveReadiness,
} from '@/platform/omni-comms/admin/views/channels/goLiveReadiness';
import type { DispatchDiagnosticsRow } from '@/platform/omni-comms/application/dispatchDiagnosticsService';

const row = (over: Partial<DispatchDiagnosticsRow> = {}): DispatchDiagnosticsRow => ({
  dispatcher_implemented: true,
  live_delivery_enabled: false,
  release_live_state_available: false,
  dispatchable_channels: ['email'],
  organization_id: 'org',
  department_id: null,
  eligible_jobs: 0,
  in_flight_attempts: 0,
  reconciliation_required_count: 0,
  business_attempts_total: 0,
  business_accepted_total: 0,
  business_delivered_total: 0,
  ambiguous_callback_count: 0,
  queued_producer_binding_count: 0,
  release_state: 'configuration',
  release_control_id: null,
  blocker: 'pilot_business_producer_not_selected',
  ...over,
});

describe('omni-comms email go-live readiness', () => {
  it('maps the server dispatch projection without inventing evidence', () => {
    const d = projectDispatchDiagnostics(row());
    expect(d).not.toBeNull();
    expect(d!.dispatcher_installed).toBe(true);
    expect(d!.live_delivery_available).toBe(false);
    expect(d!.accepted_attempts).toBe(0);
    expect(d!.blocker).toBe('pilot_business_producer_not_selected');
  });

  it('returns null when no diagnostics were read', () => {
    expect(projectDispatchDiagnostics(null)).toBeNull();
  });

  it('never reports READY for an unconfigured system and names a next action', () => {
    const readiness = projectEmailReadiness(null);
    const go = projectEmailGoLiveReadiness(readiness, null);
    expect(go.allReady).toBe(false);
    expect(go.nextBlocker).not.toBeNull();
    expect(go.nextBlocker!.nextAction.length).toBeGreaterThan(0);
    expect(go.liveDeliveryAvailable).toBe(false);
    for (const item of go.items) {
      if (item.status !== 'READY') expect(item.nextAction).not.toBe('');
    }
  });

  it('surfaces the pilot business producer blocker as a first-class item', () => {
    const readiness = projectEmailReadiness(null);
    const go = projectEmailGoLiveReadiness(
      readiness,
      projectDispatchDiagnostics(row()),
    );
    const item = go.items.find((i) => i.key === 'pilot_business_producer');
    expect(item?.status).toBe('BLOCKED');
    expect(item?.nextAction).toContain('queued business producer');
  });

  it('reports SUSPENDED while a controlled-pilot suspension is in force', () => {
    const readiness = projectEmailReadiness(null);
    const go = projectEmailGoLiveReadiness(
      readiness,
      projectDispatchDiagnostics(row({ release_state: 'suspended', blocker: null })),
    );
    expect(go.pilotSuspended).toBe(true);
    expect(go.items.find((i) => i.key === 'pilot_safety')?.status).toBe('SUSPENDED');
  });

  it('never exposes a credential or secret value in any projected string', () => {
    const go = projectEmailGoLiveReadiness(
      projectEmailReadiness(null),
      projectDispatchDiagnostics(row()),
    );
    const blob = JSON.stringify(go).toLowerCase();
    expect(blob).not.toContain('api_key');
    expect(blob).not.toContain('re_');
    expect(blob).not.toContain('service_role');
  });
});
