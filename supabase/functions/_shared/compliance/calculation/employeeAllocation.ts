/**
 * Compliance — System-estimated employee allocation (Checkpoint C).
 *
 * Path B of the estimated-assessment lifecycle: the employer PAID an
 * estimated assessment but never filed the C3. The payment still has to reach
 * employee contribution records, so it is spread using historical wage /
 * contribution ratios from valid recent periods.
 *
 * Every line produced here is marked `SYSTEM_ESTIMATED`. It must never be
 * presented, exported or reported as employer-declared C3 data.
 *
 * Ambiguous people are NOT allocated silently — they are returned as
 * exceptions for the controlled review queue.
 *
 * Mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/calculation/employeeAllocation.ts`.
 */

import {
  CeCalculationConfigError,
  CeCalculationTrace,
  round2,
} from "./calculationTrace.ts";

/** Canonical marker written to every system-produced employee line. */
export const CE_SYSTEM_ESTIMATED_MARKER = "SYSTEM_ESTIMATED" as const;

export interface CeEmployeeHistory {
  person_ssn: string;
  /** Total wages the person earned across the basis periods. */
  wage_total: number;
  /** How many of the basis periods the person actually appears in. */
  periods_present: number;
  /** Earliest basis period the person appears in, "YYYY-MM". */
  first_seen_period?: string | null;
  /** Latest basis period the person appears in, "YYYY-MM". */
  last_seen_period?: string | null;
  /** Employment state known at the target period. */
  employment_status?: "active" | "ceased" | "unknown" | null;
  /** Date employment started, "YYYY-MM-DD". */
  employment_start_date?: string | null;
  /** Date employment ended, "YYYY-MM-DD". */
  employment_end_date?: string | null;
  /** Contribution already recorded in the insurable-ceiling year. */
  ceiling_used?: number | null;
  /** Person is receiving a benefit that overlaps the target period. */
  benefit_overlap?: boolean | null;
  /** Identity could not be matched confidently to a registered person. */
  identity_matched?: boolean | null;
}

export interface CeEmployeeAllocationParameters {
  /** Basis periods the ratios were derived from, "YYYY-MM". */
  basis_periods: string[];
  /** Fewest basis periods a person must appear in to be auto-allocated. */
  minimum_periods_present: number;
  /** Annual insurable ceiling per person. Null disables the cap check. */
  contribution_ceiling?: number | null;
  /** Allocate to people whose employment has ceased, or send to review. */
  allocate_ceased_employees: boolean;
  /** Allocate to people with an overlapping benefit, or send to review. */
  allocate_benefit_overlap: boolean;
  policy_version: string;
}

export type CeAllocationExceptionReason =
  | "joined_after_basis"
  | "employment_ceased"
  | "contribution_ceiling_reached"
  | "benefit_overlap"
  | "insufficient_history"
  | "identity_mismatch"
  | "no_allocable_basis";

export interface CeEmployeeAllocationLine {
  person_ssn: string;
  /** Share of the historical wage base, 0-1. */
  ratio: number;
  amount: number;
  /** Always SYSTEM_ESTIMATED — never employer-declared. */
  record_marker: typeof CE_SYSTEM_ESTIMATED_MARKER;
  /** Amount trimmed by the insurable ceiling, if any. */
  capped_amount: number;
  basis_wage_total: number;
  periods_present: number;
}

export interface CeEmployeeAllocationException {
  person_ssn: string;
  reason: CeAllocationExceptionReason;
  detail: string;
  /** Amount that would have been allocated, for the reviewer. */
  indicative_amount: number;
}

export interface CeEmployeeAllocationResult {
  target_amount: number;
  allocated_amount: number;
  /** Money that could not be placed — held for the review queue. */
  unallocated_amount: number;
  allocations: CeEmployeeAllocationLine[];
  exceptions: CeEmployeeAllocationException[];
  trace: CeCalculationTrace;
}

function assertParams(p: CeEmployeeAllocationParameters): void {
  if (!p) throw new CeCalculationConfigError("Employee allocation parameters are not configured");
  if (!Array.isArray(p.basis_periods) || p.basis_periods.length === 0) {
    throw new CeCalculationConfigError("Employee allocation: basis_periods must be a non-empty list");
  }
  if (!Number.isInteger(p.minimum_periods_present) || p.minimum_periods_present < 1) {
    throw new CeCalculationConfigError(
      "Employee allocation: minimum_periods_present must be a whole number >= 1",
    );
  }
  if (!p.policy_version) {
    throw new CeCalculationConfigError("Employee allocation: policy_version is required for audit");
  }
}

/**
 * Spread `target_amount` across employees by historical wage ratio.
 * Exceptions are excluded from the ratio base so the remaining people are not
 * silently inflated — the residue stays unallocated and reviewable.
 */
export function allocateEstimateToEmployees(input: {
  employer_id?: string;
  /** Period the allocation is for, "YYYY-MM". */
  target_period: string;
  target_amount: number;
  employees: CeEmployeeHistory[];
  params: CeEmployeeAllocationParameters;
}): CeEmployeeAllocationResult {
  const { params } = input;
  assertParams(params);

  const target = round2(Math.max(Number(input.target_amount) || 0, 0));
  const earliestBasis = [...params.basis_periods].sort()[0];
  const targetStart = `${input.target_period}-01`;

  const exceptions: CeEmployeeAllocationException[] = [];
  const eligible: CeEmployeeHistory[] = [];
  const steps: string[] = [
    `Basis periods: ${params.basis_periods.join(", ")}`,
    `Target ${input.target_period}: ${target.toFixed(2)} to spread by historical wage ratio`,
  ];

  for (const emp of input.employees ?? []) {
    const wage = Number(emp.wage_total) || 0;
    const push = (reason: CeAllocationExceptionReason, detail: string) => {
      exceptions.push({ person_ssn: emp.person_ssn, reason, detail, indicative_amount: 0 });
    };

    if (emp.identity_matched === false) {
      push("identity_mismatch", "Person could not be matched to a registered insured person");
      continue;
    }
    if ((Number(emp.periods_present) || 0) < params.minimum_periods_present) {
      push(
        "insufficient_history",
        `Present in ${emp.periods_present || 0} basis period(s); configuration requires ${params.minimum_periods_present}`,
      );
      continue;
    }
    if (emp.employment_start_date && emp.employment_start_date > `${earliestBasis}-28`) {
      const startsAfterBasis = emp.employment_start_date.slice(0, 7) > earliestBasis;
      if (startsAfterBasis && (Number(emp.periods_present) || 0) < params.basis_periods.length) {
        push(
          "joined_after_basis",
          `Employment started ${emp.employment_start_date}, after the basis window opened (${earliestBasis})`,
        );
        continue;
      }
    }
    if (emp.employment_status === "ceased" || (emp.employment_end_date && emp.employment_end_date < targetStart)) {
      if (!params.allocate_ceased_employees) {
        push(
          "employment_ceased",
          `Employment ceased ${emp.employment_end_date ?? "(date unknown)"} before ${input.target_period}`,
        );
        continue;
      }
    }
    if (emp.benefit_overlap && !params.allocate_benefit_overlap) {
      push("benefit_overlap", `Person has a benefit overlapping ${input.target_period}`);
      continue;
    }
    if (wage <= 0) {
      push("insufficient_history", "No historical wages in the basis periods");
      continue;
    }
    eligible.push(emp);
  }

  const base = eligible.reduce((sum, e) => sum + (Number(e.wage_total) || 0), 0);
  const allocations: CeEmployeeAllocationLine[] = [];

  if (base <= 0 || target <= 0) {
    steps.push(
      base <= 0
        ? "No eligible historical wage base — entire amount held for review"
        : "Nothing to allocate",
    );
    if (base <= 0 && target > 0) {
      exceptions.push({
        person_ssn: "",
        reason: "no_allocable_basis",
        detail: "No employee had usable historical wages; the full amount is held for review",
        indicative_amount: target,
      });
    }
  } else {
    steps.push(`Eligible employees: ${eligible.length}; historical wage base ${base.toFixed(2)}`);
    let running = 0;
    eligible.forEach((emp, index) => {
      const wage = Number(emp.wage_total) || 0;
      const ratio = wage / base;
      let amount =
        index === eligible.length - 1
          ? round2(target - running)
          : round2(target * ratio);

      let capped = 0;
      const ceiling = params.contribution_ceiling ?? null;
      if (ceiling !== null && ceiling !== undefined) {
        const headroom = round2(Math.max(Number(ceiling) - (Number(emp.ceiling_used) || 0), 0));
        if (amount > headroom) {
          capped = round2(amount - headroom);
          amount = headroom;
          exceptions.push({
            person_ssn: emp.person_ssn,
            reason: "contribution_ceiling_reached",
            detail: `Allocation trimmed by ${capped.toFixed(2)} — annual insurable ceiling ${Number(
              ceiling,
            ).toFixed(2)} reached`,
            indicative_amount: capped,
          });
        }
      }

      running = round2(running + amount + capped);
      allocations.push({
        person_ssn: emp.person_ssn,
        ratio: Math.round(ratio * 1e6) / 1e6,
        amount,
        record_marker: CE_SYSTEM_ESTIMATED_MARKER,
        capped_amount: capped,
        basis_wage_total: round2(wage),
        periods_present: Number(emp.periods_present) || 0,
      });
      steps.push(
        `${emp.person_ssn}: wage ${wage.toFixed(2)} / ${base.toFixed(2)} = ${(ratio * 100).toFixed(4)}% → ${amount.toFixed(2)}${capped ? ` (capped, ${capped.toFixed(2)} to review)` : ""} [SYSTEM_ESTIMATED]`,
      );
    });
  }

  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const unallocated = round2(Math.max(target - allocated, 0));
  if (unallocated > 0) {
    steps.push(`Unallocated residue ${unallocated.toFixed(2)} routed to the exception/review queue`);
  }

  return {
    target_amount: target,
    allocated_amount: allocated,
    unallocated_amount: unallocated,
    allocations,
    exceptions,
    trace: {
      rule_code: "CR-003",
      policy_version: params.policy_version,
      component: "ESTIMATED_ASSESSMENT",
      principal: target,
      rate: null,
      rate_basis: null,
      period_count: params.basis_periods.length,
      multiplier: null,
      compounding_basis: null,
      source_periods: [...params.basis_periods],
      allocation_basis: "historical_wage_ratio",
      rounding: "half_up_2",
      raw_amount: target,
      amount: allocated,
      steps,
      inputs: {
        employer_id: input.employer_id ?? null,
        target_period: input.target_period,
        target_amount: target,
        record_marker: CE_SYSTEM_ESTIMATED_MARKER,
        minimum_periods_present: params.minimum_periods_present,
        contribution_ceiling: params.contribution_ceiling ?? null,
        allocate_ceased_employees: params.allocate_ceased_employees,
        allocate_benefit_overlap: params.allocate_benefit_overlap,
        employees_considered: (input.employees ?? []).length,
        employees_allocated: allocations.length,
        exceptions: exceptions.length,
      },
    },
  };
}
