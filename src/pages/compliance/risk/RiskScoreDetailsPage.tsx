import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { useUserCode } from '@/hooks/useUserCode';
import { toast } from 'sonner';
import {
  getRiskProfile,
  listFactors,
  getLatestHistory,
  applyManualOverride,
} from '@/services/riskProfileService';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { Activity, AlertCircle, ShieldOff, Edit3 } from 'lucide-react';
import OpenDecisionNotice from '@/components/compliance/governance/OpenDecisionNotice';

const PERMISSION = 'manage_compliance';
const BANDS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function RiskScoreDetailsPage() {
  if (!isComplianceFeatureEnabled('risk.scoreDetails')) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShieldOff className="mx-auto h-8 w-8 mb-2" />
            Risk scoring is disabled. Enable from Administration → Feature Toggles.
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function bandVariant(band?: string | null) {
  const b = (band || '').toUpperCase();
  if (b === 'CRITICAL') return 'destructive';
  if (b === 'HIGH') return 'destructive';
  if (b === 'MEDIUM') return 'default';
  return 'secondary';
}

function Inner() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [input, setInput] = useState(params.get('employer') || '');
  const employerId = params.get('employer');
  const [override, setOverride] = useState<{ open: boolean; band: string; reason: string }>({
    open: false,
    band: '',
    reason: '',
  });

  const { data: profile } = useQuery({
    queryKey: ['risk-profile', employerId],
    queryFn: () => (employerId ? getRiskProfile(employerId) : Promise.resolve(null)),
    enabled: !!employerId,
  });

  const { data: factors = [] } = useQuery({ queryKey: ['risk-factors'], queryFn: listFactors });

  const { data: history } = useQuery({
    queryKey: ['risk-history', profile?.id],
    queryFn: () => (profile?.id ? getLatestHistory(profile.id) : Promise.resolve(null)),
    enabled: !!profile?.id,
  });

  const breakdown = useMemo(() => {
    if (!profile) return [];
    // Map historical calculation_details by factor_code if present, else use score columns from profile
    const detail: Record<string, any> = {};
    const cd = history?.calculation_details;
    if (cd && typeof cd === 'object') {
      // accept either { factors: [{code, value, points}] } or { code: { value, points } }
      if (Array.isArray((cd as any).factors)) {
        for (const f of (cd as any).factors) detail[f.code || f.factor_code] = f;
      } else {
        for (const k of Object.keys(cd)) detail[k] = (cd as any)[k];
      }
    }
    // fallback core 5 from profile columns
    const fallback: Record<string, number> = {
      arrears: Number(profile.arrears_score || 0),
      violations: Number(profile.violation_score || 0),
      filings: Number(profile.filing_score || 0),
      legal: Number(profile.legal_history_score || 0),
      payment: Number(profile.payment_behavior_score || 0),
    };
    return factors.map((f) => {
      const d = detail[f.factor_code] || {};
      const points = d.points != null ? Number(d.points) : fallback[f.factor_code] ?? 0;
      return {
        code: f.factor_code,
        name: f.factor_name,
        category: f.category,
        weight: Number(f.weight),
        value: d.value ?? '—',
        points,
        enabled: f.is_enabled,
      };
    });
  }, [profile, factors, history]);

  const overrideMut = useMutation({
    mutationFn: () =>
      applyManualOverride(profile!.id, override.band || null, override.reason, userCode || 'SYSTEM'),
    onSuccess: () => {
      toast.success('Manual override applied');
      qc.invalidateQueries({ queryKey: ['risk-profile', employerId] });
      qc.invalidateQueries({ queryKey: ['risk-history', profile?.id] });
      setOverride({ open: false, band: '', reason: '' });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const search = () => {
    if (input.trim()) setParams({ employer: input.trim() });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Risk Score Details
        </h1>
        <p className="text-sm text-muted-foreground">
          Explainable breakdown of the employer risk score by factor, weight, value, and points.
        </p>
      </div>

      <OpenDecisionNotice codes={['E-RISK-FACTOR-WEIGHTS']} />

      <Card>
        <CardContent className="py-4 flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">Employer Registration Number</Label>
            <Input
              value={input}
              placeholder="e.g. 663809"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </div>
          <Button onClick={search}>Load</Button>
        </CardContent>
      </Card>

      {employerId && !profile && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" /> No risk profile found for {employerId}
          </CardContent>
        </Card>
      )}

      {profile && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                {profile.employer_name || profile.employer_id}
                <Badge variant={bandVariant(profile.override_band || profile.risk_band) as any}>
                  {profile.override_band || profile.risk_band}
                </Badge>
                {profile.override_band && (
                  <Badge variant="outline" className="text-[10px]">OVERRIDE</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Reg #{profile.employer_id} · Total score{' '}
                <span className="font-semibold text-foreground">{Number(profile.total_score).toFixed(2)}</span>
                {' · '}
                Last calculated: {profile.last_calculated_at?.slice(0, 19).replace('T', ' ') || '—'}
                {' · '}
                Version: {profile.scoring_version || '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <PermissionButton
                moduleName={PERMISSION}
                actionName="manage"
                variant="outline"
                onClick={() =>
                  setOverride({
                    open: true,
                    band: profile.override_band || '',
                    reason: profile.override_reason || '',
                  })
                }
              >
                <Edit3 className="h-4 w-4 mr-2" /> Manual Override
              </PermissionButton>
              <Button variant="ghost" onClick={() => navigate(`/compliance/field/employer-360?employer=${profile.employer_id}`)}>
                View Employer 360
              </Button>
            </CardContent>
          </Card>

          {(() => {
            const sumPoints = breakdown.reduce((s, f) => s + (Number(f.points) || 0), 0);
            const total = Number(profile.total_score) || 0;
            const diff = Math.round((total - sumPoints) * 100) / 100;
            const hasDetail = !!history?.calculation_details;
            const reconciles = Math.abs(diff) < 0.01;
            return (
              <div className="space-y-4">
              <RiskExplainabilityPanel employerId={profile.employer_id} />
              <Card>
                <CardHeader>
                  <CardTitle>Audit-Priority Factor Catalogue</CardTitle>
                  <CardDescription>
                    {breakdown.length} configured factor(s)
                    {!reconciles && (
                      <span className="ml-2 text-amber-700">
                        · Sum of factor points {sumPoints.toFixed(2)} does not match total score {total.toFixed(2)}
                        {!hasDetail
                          ? ' — per-factor points were not stored for the last calculation (only the 5 legacy scores are available). Re-run the scoring job to refresh the breakdown.'
                          : ` — unallocated ${diff.toFixed(2)} point(s) shown below.`}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factor</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Weight</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Points</TableHead>
                        <TableHead>Enabled</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breakdown.map((f) => (
                        <TableRow key={f.code}>
                          <TableCell>
                            <div className="font-medium">{f.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{f.code}</div>
                          </TableCell>
                          <TableCell><Badge variant="outline">{f.category}</Badge></TableCell>
                          <TableCell>{f.weight.toFixed(2)}</TableCell>
                          <TableCell className="text-sm">{String(f.value)}</TableCell>
                          <TableCell className="font-semibold">{Number(f.points).toFixed(2)}</TableCell>
                          <TableCell>{f.enabled ? '✓' : '—'}</TableCell>
                        </TableRow>
                      ))}
                      {!reconciles && hasDetail && (
                        <TableRow className="bg-amber-50">
                          <TableCell colSpan={4} className="text-xs text-amber-800 italic">
                            Unallocated (factors not present in stored calculation_details)
                          </TableCell>
                          <TableCell className="font-semibold text-amber-800">{diff.toFixed(2)}</TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                      <TableRow className="bg-muted/40">
                        <TableCell colSpan={4} className="text-sm font-medium">Total score</TableCell>
                        <TableCell className="font-bold">{total.toFixed(2)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              </div>
            );
          })()}


          {profile.override_band && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Active Override</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Band:</span> {profile.override_band}</div>
                <div><span className="text-muted-foreground">Reason:</span> {profile.override_reason || '—'}</div>
                <div><span className="text-muted-foreground">By:</span> {profile.override_by || '—'}</div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={override.open} onOpenChange={(o) => !o && setOverride({ open: false, band: '', reason: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Risk Band Override</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Override Band (leave blank to clear)</Label>
              <Select value={override.band || '__clear__'} onValueChange={(v) => setOverride((s) => ({ ...s, band: v === '__clear__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Clear override" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">— Clear —</SelectItem>
                  {BANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason (required)</Label>
              <Textarea rows={4} value={override.reason} onChange={(e) => setOverride((s) => ({ ...s, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride({ open: false, band: '', reason: '' })}>Cancel</Button>
            <Button
              onClick={() => overrideMut.mutate()}
              disabled={!override.reason.trim() || overrideMut.isPending}
            >
              Apply Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
