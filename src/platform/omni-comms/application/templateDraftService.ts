/**
 * Omni-Comms — governed draft allocation for template authoring.
 *
 * Version numbers are never chosen in the browser. The server owns the
 * sequence per (template family, channel, locale) and either reuses the open
 * draft or clones the published content into the next draft atomically.
 */
import {
  OmniCommsRpcClient,
  callOmniCommsRpc,
} from "./omniCommsRpcErrors";
import type {
  TemplateChannel,
  TemplateVersionStatus,
} from "./templateCatalogueTypes";

export interface TemplateNextDraftResult {
  id: string;
  template_family_id: string;
  version_number: number;
  channel: TemplateChannel;
  locale: string;
  status: TemplateVersionStatus;
  content: Record<string, string>;
  reused_existing_draft: boolean;
  source_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNextDraftInput {
  templateFamilyId: string;
  channel: TemplateChannel;
  locale: string;
  correlationId?: string | null;
}

export const createNextTemplateDraft = (
  c: OmniCommsRpcClient,
  i: CreateNextDraftInput,
) =>
  callOmniCommsRpc<TemplateNextDraftResult>(
    c,
    "omni_comms_template_version_create_next_draft",
    {
      p_template_family_id: i.templateFamilyId,
      p_channel: i.channel,
      p_locale: i.locale,
      p_correlation_id: i.correlationId ?? null,
    },
  );
