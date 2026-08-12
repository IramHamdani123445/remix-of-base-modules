/**
 * Omni-Comms — held business message review and retirement.
 *
 * These are pure request-contract tests. They construct nothing that can send,
 * contact no provider and never touch a runtime table.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHeldJobReviewBody,
  buildRetireHeldJobBody,
} from '@/platform/omni-comms/application/channelReleaseControlService';

describe('held job review request contract', () => {
  it('names only the tenant scope and never a job or recipient', () => {
    const body = buildHeldJobReviewBody('org-1', 'dept-1');
    expect(body).toEqual({
      action: 'held_job_review',
      organizationId: 'org-1',
      departmentId: 'dept-1',
    });
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it('omits an absent department instead of sending an empty value', () => {
    expect(buildHeldJobReviewBody('org-1', null)).toEqual({
      action: 'held_job_review',
      organizationId: 'org-1',
    });
    expect(buildHeldJobReviewBody('org-1')).toEqual({
      action: 'held_job_review',
      organizationId: 'org-1',
    });
  });
});

describe('held job retirement request contract', () => {
  it('carries the job identity and a bounded machine reason', () => {
    expect(
      buildRetireHeldJobBody('org-1', 'job-1', {
        departmentId: 'dept-1',
        reason: 'superseded_pre_production_pilot_job',
      }),
    ).toEqual({
      action: 'retire_held_job',
      organizationId: 'org-1',
      jobId: 'job-1',
      departmentId: 'dept-1',
      reason: 'superseded_pre_production_pilot_job',
    });
  });

  it('never carries a recipient, a message, a template or a provider', () => {
    const body = buildRetireHeldJobBody('org-1', 'job-1');
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['action', 'jobId', 'organizationId']);
    const serialized = JSON.stringify(body);
    for (const forbidden of ['email', 'recipient', 'template', 'provider', 'apiKey']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('is a distinct action from the controlled send', () => {
    expect(buildRetireHeldJobBody('org-1', 'job-1').action).toBe('retire_held_job');
    expect(buildHeldJobReviewBody('org-1').action).toBe('held_job_review');
  });
});
