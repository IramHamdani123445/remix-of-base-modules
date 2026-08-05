/**
 * Restricted Medical Provider Portal — Medical Review referrals.
 *
 * Mounted inside the existing external Doctor portal shell at
 * `/doctor/reviews`. This is a deliberately narrow surface:
 *
 *  - it shows ONLY referrals scoped to the signed-in provider identity, and
 *    that scoping is decided server-side by
 *    `bn_medical_review_provider_worklist_v1`
 *  - it exposes no Benefits worklist, no other claimant, no award data, no
 *    administrative decision and no Board deliberation
 *  - clinical content is limited to the evidence release scope attached to
 *    the referral
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMedicalReviewActionsState } from '@/hooks/bn/useMedicalReviewActionsState';
import {
  medicalReviewQueryService,
  type ProviderReferralRow,
} from '@/services/bn/medicalReviewQueryService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';
import { MEDICAL_REVIEW_ACTIONS } from '@/features/bn/medical-reviews/model/permissions';
import {
  MedicalReviewActionButton,
  MedicalReviewDarkLaunchBanner,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';

const MedicalProviderReferralWorkspace: React.FC = () => {
  const actionsState = useMedicalReviewActionsState();
  const [rows, setRows] = useState<ProviderReferralRow[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProviderReferralRow | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const result = await medicalReviewQueryService.providerWorklist();
      setRows(result.rows);
      setProviderId(result.providerId);
    } catch (e) {
      setFailure(describeMedicalReviewFailure(e));
      setRows([]);
      setProviderId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDetail(null);
      return;
    }
    medicalReviewQueryService
      .providerReferralDetail(selected.referralId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setFailure(describeMedicalReviewFailure(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="space-y-4" data-testid="mr-provider-portal">
      <header>
        <h1 className="text-xl font-semibold">Medical Review Requests</h1>
        <p className="text-sm text-muted-foreground">
          Referrals issued to your practice for a Social Security medical review. You can see only
          the cases referred to you.
        </p>
      </header>

      <MedicalReviewDarkLaunchBanner
        actionsEnabled={actionsState.actionsEnabled}
        isLoading={actionsState.isLoading}
      />

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Restricted view</AlertTitle>
        <AlertDescription>
          Clinical information shown here is limited to the evidence released with each referral.
          Nothing about other claimants, awards, payments or Board deliberations is available in
          this portal.
        </AlertDescription>
      </Alert>

      {failure && (
        <Alert variant="destructive" data-testid="mr-provider-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load your referrals</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><Skeleton className="h-40 w-full" /></div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="mr-provider-empty">
              {providerId
                ? 'You have no open medical review referrals.'
                : 'Your account is not linked to a registered medical provider. Contact Social Security to complete provider verification.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referral</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Accept by</TableHead>
                  <TableHead>Report by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.referralId}
                    className="cursor-pointer"
                    data-state={selected?.referralId === r.referralId ? 'selected' : undefined}
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="font-medium">{r.referralReference ?? '—'}</TableCell>
                    <TableCell>{r.purpose ?? '—'}</TableCell>
                    <TableCell><MedicalReviewStatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.acceptanceDeadline ?? '—'}</TableCell>
                    <TableCell>{r.reportDeadline ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card data-testid="mr-provider-referral-detail">
          <CardHeader>
            <CardTitle className="text-base">
              {selected.referralReference ?? 'Referral'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Questions to answer</div>
                <div className="text-sm">
                  {String((detail?.review_questions as string) ?? '—')}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Evidence release scope</div>
                <div className="text-sm">
                  <Badge variant="outline">
                    {String((detail?.evidence_release_scope as string) ?? '—')}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Provider-side actions. Permission is implicit in the referral
                  assignment; the RPC re-checks provider identity server-side. */}
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.submitAssessment}
                hasPermission
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
              >
                Accept referral
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
                variant="outline"
              >
                Schedule appointment
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.submitAssessment}
                hasPermission
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
                variant="outline"
              >
                Submit report
              </MedicalReviewActionButton>
              {/* Deliberately absent: decisions, proposals, Board actions. */}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MedicalProviderReferralWorkspace;
