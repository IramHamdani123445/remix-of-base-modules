/**
 * Omni-Comms — business template catalogue RPC adapter.
 *
 * Wraps the SECURITY DEFINER RPC `omni_comms_template_business_catalogue`,
 * which returns the governed MODULE → BUSINESS OBJECT → EVENT → ACTION →
 * CHANNEL tree used by the Templates administration workspace.
 */
import { OmniCommsRpcClient, callOmniCommsRpc } from './omniCommsRpcErrors';
import type { TemplateBusinessCatalogue } from '../domain/templateBusinessCatalogue';

export const getTemplateBusinessCatalogue = (
  c: OmniCommsRpcClient,
  organizationId?: string | null,
) => callOmniCommsRpc<TemplateBusinessCatalogue>(
  c,
  'omni_comms_template_business_catalogue',
  { p_organization_id: organizationId ?? null },
);
