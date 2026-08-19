/**
 * Provider registration — deliberately separate from MESSAGE CONTENT.
 *
 * An internal operator can register and submit a template to the provider and
 * ask for a status refresh. They can never assert the external outcome: the
 * approval state shown here is written by server-side reconciliation, and a
 * manually entered reference is always labelled as an attestation.
 */
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOmniCommsRpcClient } from "../../hooks/useOmniCommsRpcClient";
import {
  listTemplateProviderRegistrations,
  maskProviderTemplateRef,
  verificationModeLabel,
} from "@/platform/omni-comms/application/templateProviderRegistrationService";

export interface TemplateProviderRegistrationPanelProps {
  templateVersionId: string;
}

export const TemplateProviderRegistrationPanel: React.FC<TemplateProviderRegistrationPanelProps> = ({
  templateVersionId,
}) => {
  const rpc = useOmniCommsRpcClient();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["omni-comms-template-provider-registrations", templateVersionId],
    queryFn: () => listTemplateProviderRegistrations(rpc, templateVersionId),
    enabled: !!templateVersionId,
  });

  const refresh = useMutation({
    mutationFn: async (registrationId: string) => {
      // The browser asks; the server answers from the provider itself.
      const res = await supabase.functions.invoke("omni-comms-provider-template-refresh", {
        body: { registrationId },
      });
      if (res.error) throw new Error(res.error.message ?? "Provider status refresh failed.");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["omni-comms-template-provider-registrations", templateVersionId],
      });
      toast({ title: "Provider status refreshed" });
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: "Provider status not refreshed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });

  return (
    <Card data-testid="template-provider-registration-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Provider registration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Managed separately from the message content. Provider identifiers are never
          stored in the template itself.
        </p>

        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

        {!isLoading && registrations.length === 0 && (
          <Alert data-testid="provider-registration-empty">
            <AlertDescription className="text-xs">
              Not registered with a provider yet.
            </AlertDescription>
          </Alert>
        )}

        {registrations.map((registration) => (
          <div
            key={registration.id}
            className="space-y-2 rounded border p-3"
            data-testid={`provider-registration-${registration.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{registration.adapter_key}</Badge>
              <Badge
                variant={registration.provider_status === "approved" ? "default" : "secondary"}
                data-testid="provider-registration-status"
              >
                {registration.provider_status}
              </Badge>
              <Badge
                variant={
                  registration.verification_mode === "provider_verified" ? "outline" : "secondary"
                }
                data-testid="provider-registration-verification"
              >
                {verificationModeLabel(registration.verification_mode)}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-1 text-xs">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-mono">
                {maskProviderTemplateRef(registration.provider_template_ref)}
              </dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd>{registration.provider_language ?? "—"}</dd>
              <dt className="text-muted-foreground">Last checked</dt>
              <dd>{registration.last_checked_at ?? "—"}</dd>
            </dl>
            {registration.rejection_reason && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {registration.rejection_reason}
                </AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(registration.id)}
              data-testid="provider-registration-refresh"
            >
              Refresh provider status
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default TemplateProviderRegistrationPanel;
