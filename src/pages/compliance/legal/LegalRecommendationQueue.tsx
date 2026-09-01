import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Scale,
  Search,
  AlertTriangle,
  DollarSign,
  FileText,
  CheckCircle,
  XCircle,
  Eye,
  Send,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { legalEscalationService } from '@/services/legalEscalationService';
import { approveLegalReferral, rejectLegalReferral } from '@/services/compliance/legalReferralGovernance';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { LegalRecommendation } from '@/types/legalEscalation';

const LegalRecommendationQueue = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userCode } = useAuditFields();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedRiskBand, setSelectedRiskBand] = useState('ALL');
  const [selectedRecommendation, setSelectedRecommendation] = useState<LegalRecommendation | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['legal-recommendations'] });
    queryClient.invalidateQueries({ queryKey: ['legal-rec-stats'] });
  };

  // Queries
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['legal-recommendations', selectedStatus, selectedZone, selectedRiskBand],
    queryFn: () => legalEscalationService.getLegalRecommendations({
      status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
      zone: selectedZone !== 'ALL' ? selectedZone : undefined,
      riskBand: selectedRiskBand !== 'ALL' ? selectedRiskBand : undefined,
    }),
  });

  const { data: stats } = useQuery({
    queryKey: ['legal-rec-stats'],
    queryFn: () => legalEscalationService.getQueueStats(),
  });

  // Mutations
  const generateMut = useMutation({
    mutationFn: () => legalEscalationService.generateRecommendations(userCode || 'SYSTEM'),
    onSuccess: (count) => {
      invalidateAll();
      if (count === 0) {
        toast.info('No new recommendations generated', {
          description: 'No employers currently meet the configured legal-escalation thresholds.',
        });
      } else {
        toast.success(`Generated ${count} new recommendation${count !== 1 ? 's' : ''} from compliance data`);
      }
    },
    // Issue #6 — Surface the real error from the RPC so admins can act on it
    // (e.g. missing escalation policy, no qualifying cases, RPC permission).
    onError: (err: any) => {
      const msg = err?.message || err?.error?.message || 'Unknown error';
      toast.error('Failed to generate recommendations', { description: msg });
      // Non-blocking diagnostic log for support
      // eslint-disable-next-line no-console
      console.error('[LegalRecommendations] generate failed', err);
    },
  });

  // Checkpoint D governance: management approval/rejection must go through the
  // governed RPCs (separation of duties, authority check, referral packet
  // minting). A direct status update on ce_legal_recommendations would bypass
  // all of it, so it is never used here.
  const approveMut = useMutation({
    mutationFn: (id: string) => approveLegalReferral(id, 'Approved from Legal Recommendation Queue'),
    onSuccess: (res) => {
      invalidateAll();
      toast.success('Recommendation approved', {
        description: `Referral ${res.referral_number} created in ${res.next_stage}. Legal Pack preparation is next.`,
      });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve recommendation'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectLegalReferral(id, reason),
    onSuccess: () => { invalidateAll(); toast.success('Recommendation rejected'); },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject recommendation'),
  });

  const handleReject = (recommendationId: string) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    rejectMut.mutate({ id: recommendationId, reason });
  };

  const handleCreateReferral = (recommendation: LegalRecommendation) => {
    navigate('/compliance/enforcement/legal-referral', { state: { recommendation } });
  };

  const filteredRecommendations = recommendations.filter(rec =>
    rec.employerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rec.employerId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRiskBadgeColor = (riskBand: string) => {
    switch (riskBand.toUpperCase()) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-300';
      case 'HIGH': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-green-100 text-green-800 border-green-300';
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'PENDING_REVIEW': return 'bg-blue-100 text-blue-800';
      case 'APPROVED_FOR_REFERRAL': return 'bg-green-100 text-green-800';
      case 'REFERRAL_CREATED': return 'bg-purple-100 text-purple-800';
      case 'REJECTED': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading recommendations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Scale className="h-8 w-8" />
            Legal Recommendation Queue
          </h1>
          <p className="text-muted-foreground mt-2">
            Review employers meeting legal escalation thresholds and create legal referrals
          </p>
        </div>
        <Button
          onClick={() => generateMut.mutate()}
          disabled={generateMut.isPending}
        >
          {generateMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Generate Recommendations
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Employers</p>
                <p className="text-2xl font-bold">{stats.totalEmployers}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-orange-500" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Subcases</p>
                <p className="text-2xl font-bold">{stats.totalSubcases}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-500" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Amount at Risk</p>
                <p className="text-2xl font-bold">EC${stats.totalAmountAtRisk.toLocaleString()}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-500" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-bold">{stats.pendingReview}</p>
              </div>
              <Scale className="h-8 w-8 text-purple-500" />
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PENDING_REVIEW">Pending Review</SelectItem>
              <SelectItem value="APPROVED_FOR_REFERRAL">Approved for Referral</SelectItem>
              <SelectItem value="REFERRAL_CREATED">Referral Created</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedZone} onValueChange={setSelectedZone}>
            <SelectTrigger><SelectValue placeholder="All Zones" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Zones</SelectItem>
              {(stats?.byZone || []).map(z => (
                <SelectItem key={z.zoneName} value={z.zoneName}>{z.zoneName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedRiskBand} onValueChange={setSelectedRiskBand}>
            <SelectTrigger><SelectValue placeholder="All Risk Bands" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Risk Bands</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Recommendations List */}
      <div className="space-y-4">
        {filteredRecommendations.map((rec) => (
          <Card key={rec.id} className="p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-semibold">{rec.employerName}</h3>
                  <Badge className={getRiskBadgeColor(rec.riskBand)}>
                    {rec.riskBand} Risk ({rec.riskScore})
                  </Badge>
                  <Badge className={getStatusBadgeColor(rec.status)}>
                    {rec.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {rec.employerZone} • Recommended {new Date(rec.recommendedDate).toLocaleDateString()}
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm"
                  onClick={() => { setSelectedRecommendation(rec); setShowDetailsDialog(true); }}>
                  <Eye className="h-4 w-4 mr-2" /> View Details
                </Button>
                {rec.status === 'PENDING_REVIEW' && (
                  <>
                    <Button variant="outline" size="sm"
                      disabled={approveMut.isPending}
                      onClick={() => approveMut.mutate(rec.id)}>
                      <CheckCircle className="h-4 w-4 mr-2" /> Approve
                    </Button>
                    <Button variant="outline" size="sm"
                      disabled={rejectMut.isPending}
                      onClick={() => handleReject(rec.id)}>
                      <XCircle className="h-4 w-4 mr-2" /> Reject
                    </Button>
                  </>
                )}
                {rec.status === 'APPROVED_FOR_REFERRAL' && (
                  <Button size="sm" onClick={() => handleCreateReferral(rec)}>
                    <Send className="h-4 w-4 mr-2" /> Create Referral
                  </Button>
                )}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-4 gap-4 p-4 bg-muted rounded-lg mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Principal</p>
                <p className="text-lg font-semibold">EC${rec.totalPrincipal.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Penalties</p>
                <p className="text-lg font-semibold">EC${rec.totalPenalties.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Interest</p>
                <p className="text-lg font-semibold">EC${rec.totalInterest.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Grand Total</p>
                <p className="text-xl font-bold text-primary">EC${rec.grandTotal.toLocaleString()}</p>
              </div>
            </div>

            {/* Subcases Summary */}
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Qualifying Subcases ({rec.subcaseSummary.length})</p>
              <div className="space-y-2">
                {rec.subcaseSummary.map((subcase) => (
                  <div key={subcase.subcaseId} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded">
                    <span className="font-medium">{subcase.caseNumber}</span>
                    <span className="text-muted-foreground">{subcase.caseType.replace(/_/g, ' ')}</span>
                    <span>{subcase.periodFrom || '—'} to {subcase.periodTo || '—'}</span>
                    <span className="font-medium">EC${subcase.totalAmount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Triggered Rules */}
            <div>
              <p className="text-sm font-medium mb-2">Escalation Reasons ({rec.triggeredRules.length})</p>
              <div className="flex flex-wrap gap-2">
                {rec.triggeredRules.map((rule) => (
                  <Badge key={rule.ruleId} variant="outline" className="text-xs">
                    {rule.ruleName}: {rule.reason}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>
        ))}

        {filteredRecommendations.length === 0 && (
          <Card className="p-12 text-center">
            <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {recommendations.length === 0
                ? 'No recommendations yet. Click "Generate Recommendations" to evaluate employers against escalation rules.'
                : 'No recommendations found matching your filters'}
            </p>
          </Card>
        )}
      </div>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Legal Recommendation Details</DialogTitle>
          </DialogHeader>

          {selectedRecommendation && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-lg mb-2">{selectedRecommendation.employerName}</h3>
                <div className="flex gap-2">
                  <Badge className={getRiskBadgeColor(selectedRecommendation.riskBand)}>
                    {selectedRecommendation.riskBand} Risk
                  </Badge>
                  <Badge>{selectedRecommendation.employerZone}</Badge>
                  <Badge className={getStatusBadgeColor(selectedRecommendation.status)}>
                    {selectedRecommendation.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Risk Score</p>
                  <p className="text-2xl font-bold">{selectedRecommendation.riskScore}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Grand Total</p>
                  <p className="text-2xl font-bold">EC${selectedRecommendation.grandTotal.toLocaleString()}</p>
                </Card>
              </div>

              {selectedRecommendation.reviewedBy && (
                <Card className="p-4 bg-muted/50">
                  <p className="text-sm text-muted-foreground">Reviewed by</p>
                  <p className="font-medium">{selectedRecommendation.reviewedBy}</p>
                  {selectedRecommendation.reviewedDate && (
                    <p className="text-xs text-muted-foreground">
                      on {new Date(selectedRecommendation.reviewedDate).toLocaleString()}
                    </p>
                  )}
                  {selectedRecommendation.reviewNotes && (
                    <p className="text-sm mt-1">{selectedRecommendation.reviewNotes}</p>
                  )}
                </Card>
              )}

              <div>
                <h4 className="font-medium mb-2">Qualifying Subcases</h4>
                <div className="space-y-2">
                  {selectedRecommendation.subcaseSummary.map((subcase) => (
                    <Card key={subcase.subcaseId} className="p-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Case:</span> {subcase.caseNumber}</div>
                        <div><span className="text-muted-foreground">Type:</span> {subcase.caseType.replace(/_/g, ' ')}</div>
                        <div><span className="text-muted-foreground">Period:</span> {subcase.periodFrom || '—'} - {subcase.periodTo || '—'}</div>
                        <div><span className="text-muted-foreground">Amount:</span> EC${subcase.totalAmount.toLocaleString()}</div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Escalation Rules Triggered</h4>
                <div className="space-y-2">
                  {selectedRecommendation.triggeredRules.map((rule) => (
                    <Card key={rule.ruleId} className="p-3">
                      <p className="font-medium text-sm">{rule.ruleName}</p>
                      <p className="text-sm text-muted-foreground">{rule.reason}</p>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LegalRecommendationQueue;
