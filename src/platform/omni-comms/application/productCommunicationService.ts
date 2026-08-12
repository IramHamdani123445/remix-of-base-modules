/**
 * Omni-Comms — Product Definition communications (read model + admin writes).
 *
 * Business modules never choose a template, sender or channel themselves. This
 * service only reads the Hub's per-product configuration and submits bounded
 * configuration changes through the two admin RPCs. It NEVER sends, enqueues or
 * dispatches anything.
 */
import { supabase } from '@/integrations/supabase/client';

export type OmniCommsProductChannelConfig = {
  event_code: string;
  channel: string;
  is_enabled: boolean;
  applicability: string | null;
  delivery_mode: string | null;
  recipient_source: string | null;
  template_override: string | null;
  sender_override: string | null;
  effective_template: string | null;
  effective_template_source: 'product_override' | 'event_default' | 'unresolved' | string | null;
  effective_sender: string | null;
  effective_sender_source: 'product_override' | 'channel_default' | 'unresolved' | string | null;
  updated_at: string | null;
};

export type OmniCommsProductCommunicationRead = {
  product_id: string;
  product_code: string | null;
  product_name: string | null;
  can_configure: boolean;
  configs: OmniCommsProductChannelConfig[];
  audit: Array<{
    id: string;
    action: string;
    changed_at: string;
    changed_by_label: string | null;
    reason: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>;
};

export type OmniCommsProductResolution = {
  enabled: boolean;
  reason: string | null;
  event_code: string | null;
  channel: string | null;
  delivery_mode: string | null;
  recipient_source: string | null;
  template: string | null;
  sender: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export async function readProductCommunicationConfig(
  organizationId: string,
  productId: string,
): Promise<OmniCommsProductCommunicationRead | null> {
  const { data, error } = await (supabase as any).rpc('omni_comms_product_communication_read', {
    p_organization_id: organizationId,
    p_product_id: productId,
  });
  if (error) throw error;
  if (!data) return null;
  const raw = asRecord(data);
  return {
    product_id: String(raw.product_id ?? productId),
    product_code: (raw.product_code as string) ?? null,
    product_name: (raw.product_name as string) ?? null,
    can_configure: raw.can_configure === true,
    configs: Array.isArray(raw.configs) ? (raw.configs as OmniCommsProductChannelConfig[]) : [],
    audit: Array.isArray(raw.audit) ? (raw.audit as OmniCommsProductCommunicationRead['audit']) : [],
  };
}

export type OmniCommsProductCommunicationUpdate = {
  organizationId: string;
  productId: string;
  eventCode: string;
  channel?: string;
  isEnabled?: boolean;
  deliveryMode?: string | null;
  recipientSource?: string | null;
  templateOverride?: string | null;
  senderOverride?: string | null;
  clearTemplateOverride?: boolean;
  clearSenderOverride?: boolean;
  reason?: string | null;
};

export async function updateProductCommunicationConfig(
  input: OmniCommsProductCommunicationUpdate,
): Promise<OmniCommsProductChannelConfig> {
  const { data, error } = await (supabase as any).rpc('omni_comms_product_communication_update', {
    p_organization_id: input.organizationId,
    p_product_id: input.productId,
    p_event_code: input.eventCode,
    p_channel: input.channel ?? 'email',
    p_is_enabled: input.isEnabled ?? null,
    p_delivery_mode: input.deliveryMode ?? null,
    p_recipient_source: input.recipientSource ?? null,
    p_template_override: input.templateOverride ?? null,
    p_sender_override: input.senderOverride ?? null,
    p_clear_template_override: input.clearTemplateOverride ?? false,
    p_clear_sender_override: input.clearSenderOverride ?? false,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return asRecord(data) as unknown as OmniCommsProductChannelConfig;
}

/**
 * Producer boundary check. Fail-closed: any error means "not enabled", so a
 * business action is never blocked and never sends without configuration.
 */
export async function resolveProductCommunication(
  organizationId: string,
  productId: string,
  eventCode = 'BENEFITS.CLAIM.SUBMITTED',
  channel = 'email',
): Promise<OmniCommsProductResolution> {
  const disabled: OmniCommsProductResolution = {
    enabled: false,
    reason: 'resolution_unavailable',
    event_code: eventCode,
    channel,
    delivery_mode: null,
    recipient_source: null,
    template: null,
    sender: null,
  };
  try {
    const { data, error } = await (supabase as any).rpc('omni_comms_product_communication_resolve', {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_event_code: eventCode,
      p_channel: channel,
    });
    if (error || !data) return disabled;
    const raw = asRecord(data);
    return {
      enabled: raw.enabled === true,
      reason: (raw.reason as string) ?? null,
      event_code: (raw.event_code as string) ?? eventCode,
      channel: (raw.channel as string) ?? channel,
      delivery_mode: (raw.delivery_mode as string) ?? null,
      recipient_source: (raw.recipient_source as string) ?? null,
      template: (raw.template as string) ?? null,
      sender: (raw.sender as string) ?? null,
    };
  } catch {
    return disabled;
  }
}
