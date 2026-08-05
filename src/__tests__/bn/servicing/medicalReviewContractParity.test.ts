/**
 * BN Medical Reviews — frontend/backend contract parity.
 *
 * These tests assert that every state, controlled value and RPC payload key
 * used by the frontend actually exists in the applied migrations. They are the
 * guard against "invented" values drifting back into the UI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATES,
  ASSESSMENT_FIELD_KEYS,
  ASSESSMENT_STATES,
  BOARD_ATTENDANCE_STATUS_CODES,
  BOARD_CASE_STATES,
  BOARD_DETERMINATION_OUTCOME_CODES,
  BOARD_MEETING_MODES,
  BOARD_SESSION_STATES,
  BOARD_VOTE_CODES,
  DECISION_OUTCOME_CODE_VALUES,
  DECISION_STATES,
  INCAPACITY_NATURE_CODES,
  LIFECYCLE_STATES,
  MEDICAL_OUTCOME_CODES,
  NON_ATTENDANCE_CATEGORY_CODES,
  OBLIGATION_STATES,
  REASONABLE_CAUSE_OUTCOME_CODES,
  REFERRAL_STATES,
  toAssessmentFieldsDto,
  toBoardParticipationDto,
  toDecisionDto,
} from '@/features/bn/medical-reviews/model/backendContract';
import {
  BOARD_ATTENDANCE_STATUSES,
  BOARD_OUTCOME_CODES,
  BOARD_VOTES,
  DECISION_OUTCOME_CODES,
  INCAPACITY_NATURES,
  MEDICAL_OUTCOMES,
  MEETING_MODES,
  NON_ATTENDANCE_CATEGORIES,
  REASONABLE_CAUSE_OUTCOMES,
} from '@/features/bn/medical-reviews/model/controlledValues';
import * as availability from '@/features/bn/medical-reviews/model/actionAvailability';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const migrationSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .filter((sql) => sql.includes('bn_medical_review') || sql.includes('bn_medical_board'))
  .join('\n');

/** Every controlled code must appear literally in the medical-review SQL. */
function expectPresentInSql(codes: readonly string[], label: string) {
  const missing = codes.filter((code) => !migrationSql.includes(`'${code}'`));
  expect(missing, `${label}: values absent from the applied migrations`).toEqual([]);
}

describe('Medical Review contract parity — lifecycle states', () => {
  it.each([
    ['obligation', OBLIGATION_STATES],
    ['referral', REFERRAL_STATES],
    ['appointment', APPOINTMENT_STATES],
    ['assessment', ASSESSMENT_STATES],
    ['board case', BOARD_CASE_STATES],
    ['board session', BOARD_SESSION_STATES],
    ['decision', DECISION_STATES],
  ])('%s states all exist in the database contract', (label, states) => {
    expectPresentInSql(states, label);
  });

  it('contains no invented states', () => {
    const all = Object.values(LIFECYCLE_STATES).flat() as string[];
    for (const invented of ['NOMINATED', 'BOARD_SELECTED', 'VOTING_COMPLETE', 'SESSION_HELD', 'CLARIFIED']) {
      expect(all).not.toContain(invented);
    }
  });
});

describe('Medical Review contract parity — controlled values', () => {
  it.each([
    ['medical outcome', MEDICAL_OUTCOME_CODES],
    ['incapacity nature', INCAPACITY_NATURE_CODES],
    ['board determination outcome', BOARD_DETERMINATION_OUTCOME_CODES],
    ['decision outcome', DECISION_OUTCOME_CODE_VALUES],
    ['non-attendance category', NON_ATTENDANCE_CATEGORY_CODES],
    ['board attendance status', BOARD_ATTENDANCE_STATUS_CODES],
    ['board vote', BOARD_VOTE_CODES],
    ['meeting mode', BOARD_MEETING_MODES],
    ['reasonable cause outcome', REASONABLE_CAUSE_OUTCOME_CODES],
  ])('%s codes all exist in the database contract', (label, codes) => {
    expectPresentInSql(codes, label);
  });

  it.each([
    ['MEDICAL_OUTCOMES', MEDICAL_OUTCOMES, MEDICAL_OUTCOME_CODES],
    ['INCAPACITY_NATURES', INCAPACITY_NATURES, INCAPACITY_NATURE_CODES],
    ['BOARD_OUTCOME_CODES', BOARD_OUTCOME_CODES, BOARD_DETERMINATION_OUTCOME_CODES],
    ['DECISION_OUTCOME_CODES', DECISION_OUTCOME_CODES, DECISION_OUTCOME_CODE_VALUES],
    ['NON_ATTENDANCE_CATEGORIES', NON_ATTENDANCE_CATEGORIES, NON_ATTENDANCE_CATEGORY_CODES],
    ['BOARD_ATTENDANCE_STATUSES', BOARD_ATTENDANCE_STATUSES, BOARD_ATTENDANCE_STATUS_CODES],
    ['BOARD_VOTES', BOARD_VOTES, BOARD_VOTE_CODES],
    ['MEETING_MODES', MEETING_MODES, BOARD_MEETING_MODES],
    ['REASONABLE_CAUSE_OUTCOMES', REASONABLE_CAUSE_OUTCOMES, REASONABLE_CAUSE_OUTCOME_CODES],
  ])('%s form options submit only canonical codes', (_label, options, codes) => {
    expect(options.map((o) => o.value)).toEqual([...codes]);
    expect(options.every((o) => o.label.trim().length > 0)).toBe(true);
  });

  it('never offers the unsupported LATE board attendance status', () => {
    expect(BOARD_ATTENDANCE_STATUSES.map((o) => o.value)).not.toContain('LATE');
    expect(() => toBoardParticipationDto({ attendanceStatus: 'LATE' })).toThrow();
  });
});

describe('Medical Review contract parity — command adapters', () => {
  it('maps the assessment form to the exact snake_case p_fields contract', () => {
    const dto = toAssessmentFieldsDto({
      examinationDate: '2026-05-01',
      identityVerification: 'PHOTO_ID',
      attendance: 'ATTENDED',
      functionalLimitations: 'Limited standing tolerance.',
      workCapacityOpinion: 'LIMITED_CAPACITY',
      expectedDurationMonths: '6',
      incapacityNature: 'TEMPORARY',
      prognosisCategory: 'STABLE',
      impairmentPercentage: '25',
      furtherEvidenceRequired: true,
      specialistRequired: false,
      recommendedNextReviewDate: '2026-11-01',
      medicalOutcome: 'INCAPACITY_CONTINUES',
      clinicalNarrative: 'Ongoing rehabilitation.',
      providerDeclarationComplete: true,
    });

    for (const dtoKey of Object.keys(dto)) {
      expect(ASSESSMENT_FIELD_KEYS).toContain(dtoKey);
    }
    expect(dto.expected_duration_months).toBe(6);
    expect(typeof dto.expected_duration_months).toBe('number');
    expect(dto.impairment_percentage).toBe(25);
    expect(dto.further_evidence_required).toBe(true);
    expect(dto.specialist_required).toBe(false);
  });

  it('rejects an out-of-range impairment percentage before any RPC call', () => {
    expect(() => toAssessmentFieldsDto({ impairmentPercentage: 140 })).toThrow();
    expect(() => toAssessmentFieldsDto({ impairmentPercentage: -1 })).toThrow();
  });

  it('requires conflict details when a conflict is declared', () => {
    expect(() => toAssessmentFieldsDto({ conflictDeclared: true })).toThrow();
    expect(() =>
      toAssessmentFieldsDto({ conflictDeclared: true, conflictDetails: 'Treating relative.' }),
    ).not.toThrow();
  });

  it('rejects a non-canonical medical outcome', () => {
    expect(() => toAssessmentFieldsDto({ medicalOutcome: 'FIT_FOR_DUTY' })).toThrow();
  });

  it('rejects a non-canonical administrative decision outcome', () => {
    expect(() =>
      toDecisionDto({
        outcomeCode: 'REVIEW_SATISFIED',
        medicalRecommendationAccepted: true,
        departureReason: null,
        effectiveDate: '2026-05-01',
        nextReviewDate: null,
        reasonCode: 'MEDICAL_EVIDENCE_SUPPORTS',
        reasonNarrative: 'Evidence supports continuation.',
      }),
    ).toThrow();
  });
});

describe('Medical Review contract parity — action availability', () => {
  const ctx = (state: string) => ({ state, actionsEnabled: true, rowVersion: 1, hasPermission: () => true });

  it('gates approval on PENDING_APPROVAL, not an invented SUBMITTED state', () => {
    expect(availability.decisionActionAvailability(ctx('PENDING_APPROVAL') as never)['approve_decision'].enabled).toBe(true);
    expect(availability.decisionActionAvailability(ctx('SUBMITTED') as never)['approve_decision'].enabled).toBe(false);
  });

  it('offers reasonable cause only from a recorded non-attendance', () => {
    const actions = availability.appointmentActionAvailability(ctx('CLAIMANT_NO_SHOW') as never);
    expect(actions['reasonable_cause'].enabled).toBe(true);
    expect(availability.appointmentActionAvailability(ctx('SCHEDULED') as never)['reasonable_cause'].enabled).toBe(false);
  });

  it('finalises a board determination only from IN_SESSION', () => {
    expect(availability.boardCaseActionAvailability(ctx('IN_SESSION') as never)['record_board_determination'].enabled).toBe(true);
    expect(availability.boardCaseActionAvailability(ctx('MEMBERS_ASSIGNED') as never)['record_board_determination'].enabled).toBe(false);
  });
});
