/**
 * Canonical token grammar & rendering fixtures.
 *
 * Parity mechanism (declared, not implied):
 *   1. This TS file is the single source of truth.
 *   2. TS tests iterate CANONICAL_TOKEN_FIXTURES directly.
 *   3. scripts/omni-comms/verify-epic3-story2-db.sql enumerates the SAME
 *      fixture IDs in comment-marker blocks so the DB verification suite
 *      exercises each canonical case.
 *   4. epic3-story2-templates.test.ts asserts every fixture ID listed here
 *      appears in the SQL verification script.
 */
export interface CanonicalTokenFixture {
  id: string;
  source: string;
  outcome: 'accept' | 'reject';
  /** For reject: expected detail slug. */
  rejectDetail?: string;
  /** For accept: expected extracted token paths. */
  tokens?: string[];
}

export const CANONICAL_TOKEN_FIXTURES: readonly CanonicalTokenFixture[] = [
  { id: 'tok_accept_simple',       source: 'Hello {{name}}',        outcome: 'accept', tokens: ['name'] },
  { id: 'tok_accept_dotted',       source: '{{user.first_name}}',   outcome: 'accept', tokens: ['user.first_name'] },
  { id: 'tok_accept_multi',        source: '{{a}} {{b}} {{a}}',     outcome: 'accept', tokens: ['a', 'b'] },
  { id: 'tok_accept_none',         source: 'no tokens here',        outcome: 'accept', tokens: [] },
  { id: 'tok_reject_empty',        source: '{{  }}',                outcome: 'reject', rejectDetail: 'template_token_empty' },
  { id: 'tok_reject_triple',       source: '{{{name}}}',            outcome: 'reject', rejectDetail: 'template_token_triple_brace' },
  { id: 'tok_reject_unmatched_o',  source: 'hi {{name',             outcome: 'reject', rejectDetail: 'template_token_unmatched_open' },
  { id: 'tok_reject_unmatched_c',  source: 'hi name}}',             outcome: 'reject', rejectDetail: 'template_token_unmatched_close' },
  { id: 'tok_reject_section',      source: '{{#items}}',            outcome: 'reject', rejectDetail: 'template_token_disallowed_syntax' },
  { id: 'tok_reject_partial',      source: '{{>partial}}',          outcome: 'reject', rejectDetail: 'template_token_disallowed_syntax' },
  { id: 'tok_reject_comment',      source: '{{!hidden}}',           outcome: 'reject', rejectDetail: 'template_token_disallowed_syntax' },
  { id: 'tok_reject_index',        source: '{{items[0]}}',          outcome: 'reject', rejectDetail: 'template_token_path_invalid' },
  { id: 'tok_reject_dot_leading',  source: '{{.leading}}',          outcome: 'reject', rejectDetail: 'template_token_path_invalid' },
  { id: 'tok_reject_dot_trailing', source: '{{trailing.}}',         outcome: 'reject', rejectDetail: 'template_token_path_invalid' },
];

export const CANONICAL_FIXTURE_IDS: readonly string[] =
  CANONICAL_TOKEN_FIXTURES.map((f) => f.id);
