import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { forwardBenefitsClaimToLegal } from "@/services/legal/benefitsForwardingService";
import { useUserCode } from "@/hooks/useUserCode";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bnClaimId: string;
  claimNumber: string;
  exposureAmount?: number | null;
}

export function ForwardClaimToLegalDialog({
  open,
  onOpenChange,
  bnClaimId,
  claimNumber,
  exposureAmount,
}: Props) {
  const [reason, setReason] = useState("");
  const [matterType, setMatterType] = useState("BENEFIT_DISPUTE");
  const [priority, setPriority] = useState("MEDIUM");
  const [submitting, setSubmitting] = useState(false);
  const { userCode } = useUserCode();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a referral reason");
      return;
    }
    setSubmitting(true);
    try {
      const result = await forwardBenefitsClaimToLegal({
        bn_claim_id: bnClaimId,
        matter_type_code: matterType,
        referral_reason: reason.trim(),
        priority_code: priority,
        exposure_amount: exposureAmount ?? null,
        user_code: userCode ?? null,
      });
      toast.success(`Forwarded to Legal — ${result.referral_no}`, {
        description: `Legal Intake ${result.lg_intake_no} created — pending Legal review`,
        action: {
          label: "Open Intake",
          onClick: () => navigate(`/legal/cases/intake/${result.lg_intake_id}`),
        },
      });
      qc.invalidateQueries({ queryKey: ["bn-claim", bnClaimId] });
      qc.invalidateQueries({ queryKey: ["bn_claim", bnClaimId] });
      onOpenChange(false);
      setReason("");
    } catch (e: any) {
      toast.error("Failed to forward to Legal", { description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" /> Forward Claim to Legal
          </DialogTitle>
          <DialogDescription>
            Create a Legal referral and intake linked to claim <strong>{claimNumber}</strong>.
            No benefit data is duplicated — Legal references the source records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {exposureAmount != null && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Exposure:{" "}
              <strong>
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "XCD",
                }).format(exposureAmount)}
              </strong>
            </div>
          )}

          <div>
            <Label>Matter Type</Label>
            <Select value={matterType} onValueChange={setMatterType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BENEFIT_DISPUTE">Benefit Dispute</SelectItem>
                <SelectItem value="OVERPAYMENT_RECOVERY">Overpayment Recovery</SelectItem>
                <SelectItem value="FRAUD_INVESTIGATION">Fraud Investigation</SelectItem>
                <SelectItem value="APPEAL">Appeal</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Referral Reason *</Label>
            <Textarea
              rows={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this claim is being referred to Legal (fraud, contested ruling, recovery action, etc.)"
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Scale className="h-4 w-4 mr-1" />
            )}
            Forward to Legal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
