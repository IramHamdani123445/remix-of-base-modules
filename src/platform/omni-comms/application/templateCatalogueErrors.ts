/**
 * Template-catalogue-specific detail slugs. Error CODES are shared via
 * omniCommsRpcErrors; this file only enumerates DETAIL slugs recognised by
 * the Template Catalogue RPCs. Template behaviour never depends on
 * eventCatalogueTypes.
 */
export const TEMPLATE_CATALOGUE_VALIDATION_DETAILS = [
  // family
  'scope_type_invalid',
  'organization_required',
  'department_required',
  'department_not_found',
  'department_organization_mismatch',
  'event_definition_required',
  'duplicate_family_code',
  'family_not_draft',
  'family_retired',
  'family_already_retired',
  'template_family_not_found',
  'template_family_id_required',
  // version
  'channel_unknown',
  'locale_required',
  'locale_format_invalid',
  'version_number_invalid',
  'duplicate_version',
  'version_not_draft',
  'version_not_approved',
  'version_cannot_be_retired',
  'template_version_not_found',
  'approver_must_differ_from_author',
  'approval_note_too_long',
  'already_published',
  'publication_conflict',
  // content
  'content_not_object',
  'content_too_large',
  'content_unknown_key',
  'content_null_value',
  'content_non_string_value',
  'content_empty_value',
  'content_missing_required_key',
  'content_email_body_required',
  // tokens (surfaced by validator, distinct from renderer errors)
  'template_token_unmatched_open',
  'template_token_unmatched_close',
  'template_token_triple_brace',
  'template_token_empty',
  'template_token_disallowed_syntax',
  'template_token_path_invalid',
  // optimistic-concurrency
  'updated_at_mismatch',
] as const;

export type TemplateCatalogueValidationDetail =
  (typeof TEMPLATE_CATALOGUE_VALIDATION_DETAILS)[number];
