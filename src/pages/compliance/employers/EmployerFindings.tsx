import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, FileText, AlertTriangle, Building2, MapPin, Eye, Plus, Loader2 } from 'lucide-react';
import { InspectionFinding } from '@/types/inspectionTypes';
import { Violation } from '@/types/violation';
import { inspectionService } from '@/services/inspectionService';
import { violationService } from '@/services/violationService';
import { supabase } from '@/integrations/supabase/client';
import { CreateViolationFromFindingDialog } from '@/components/compliance/CreateViolationFromFindingDialog';
import { FindingReviewDialog } from '@/components/compliance/FindingReviewDialog';
import {
  DISPOSITION_LABELS,
  FindingDisposition,
  evaluateConversionEligibility,
} from '@/services/compliance/findingDispositionService';
import { toast } from 'sonner';
import { format } from 'date-fns';

/** Safe date formatter — never throws on null/invalid values. */
function safeDate(value?: string | null, pattern = 'MMM dd, yyyy') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return format(d, pattern);
  } catch {
    return '—';
  }
}

/** Safe label formatter for code-style values. */
function safeLabel(value?: string | null, fallback = '—') {
  if (!value) return fallback;
  return String(value).replace(/_/g, ' ');
}

export default function EmployerFindings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const employerIdParam = searchParams.get('employerId');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployer, setSelectedEmployer] = useState<{ id: string; name: string; code: string; territory: string } | null>(null);
  const [findings, setFindings] = useState<InspectionFinding[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<InspectionFinding | null>(null);
  const [showCreateViolation, setShowCreateViolation] = useState(false);
  const [recentFindings, setRecentFindings] = useState<any[]>([]);
  const [reviewFinding, setReviewFinding] = useState<any | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);

  useEffect(() => {
    if (employerIdParam) {
      loadEmployerData(employerIdParam);
    }
  }, [employerIdParam]);

  // Organisation-wide findings so the screen is useful without employer context.
  useEffect(() => {
    if (selectedEmployer || employerIdParam) return;
    let cancelled = false;
    setRecentLoading(true);
    inspectionService
      .getRecentFindings(200)
      .then((rows) => { if (!cancelled) setRecentFindings(rows); })
      .catch((e) => {
        console.error('[EmployerFindings] recent findings failed', e);
        if (!cancelled) setRecentFindings([]);
      })
      .finally(() => { if (!cancelled) setRecentLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEmployer, employerIdParam]);

  const loadEmployerData = async (employerId: string) => {
    setLoading(true);
    try {
      // Fetch real employer from DB
      const { data: emp } = await supabase
        .from('er_master')
        .select('regno, name, office_code')
        .eq('regno', employerId)
        .maybeSingle();

      setSelectedEmployer({
        id: (emp as any)?.regno ?? employerId,
        name: (emp as any)?.name ?? employerId,
        code: (emp as any)?.regno ?? employerId,
        territory: 'St Kitts',
      });

      // Load findings and employer-scoped violations from DB
      const [findingsData, violationsData] = await Promise.all([
        inspectionService.getFindingsByEmployer(employerId),
        violationService.getByEmployerId(employerId),
      ]);
      setFindings(findingsData ?? []);
      setViolations(violationsData ?? []);
    } catch (error) {
      console.error('Error loading employer data:', error);
      toast.error('Failed to load employer data');
      setFindings([]);
      setViolations([]);
    } finally {
      setLoading(false);
    }
  };


  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast.error('Please enter an employer name or code');
      return;
    }
    setSearching(true);
    try {
      const { data } = await supabase
        .from('er_master')
        .select('regno, name')
        .or(`regno.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`)
        .limit(20);
      setSearchResults(data ?? []);
      if (data && data.length === 1) {
        loadEmployerData((data[0] as any).regno);
      }
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleReviewFinding = (finding: any) => {
    setReviewFinding(finding);
    setShowReview(true);
  };

  const applyDisposition = (findingId: string, disposition: FindingDisposition) => {
    setFindings((prev) => prev.map((f) => (f.id === findingId ? { ...f, disposition } : f)));
    setRecentFindings((prev) => prev.map((f) => (f.id === findingId ? { ...f, disposition } : f)));
  };

  const handleCreateViolation = (finding: InspectionFinding) => {
    setSelectedFinding(finding);
    setShowCreateViolation(true);
  };

  const handleViewViolation = (violationId: string) => {
    navigate(`/compliance/violations/${violationId}`);
  };

  const getFindingTypeBadge = (type: string) => {
    const variants: Record<string, any> = {
      COMPLIANT: 'default',
      MINOR_ISSUE: 'secondary',
      MAJOR_ISSUE: 'destructive',
      POSSIBLE_VIOLATION: 'destructive'
    };
    return variants[type] || 'secondary';
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, any> = {
      Low: 'secondary',
      Medium: 'default',
      High: 'destructive',
      Critical: 'destructive'
    };
    return variants[severity] || 'secondary';
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Inspection Findings</h1>
          <p className="text-muted-foreground">
            Review inspection findings and convert them into violations.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/compliance/inspections/convert-finding')}>
          Conversion Queue
        </Button>
      </div>


      {/* Employer Search */}
      {!selectedEmployer && (
        <Card>
          <CardHeader>
            <CardTitle>Search Employer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  placeholder="Enter employer name or registration code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Search
              </Button>
            </div>
            {searchResults.length > 1 && (
              <div className="border rounded-lg divide-y">
                {searchResults.map((r: any) => (
                  <button
                    key={r.regno}
                    className="w-full text-left px-4 py-2 hover:bg-accent/50 text-sm"
                    onClick={() => loadEmployerData(r.regno)}
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground ml-2">({r.regno})</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}




      {/* Organisation-wide recent findings (no employer context) */}
      {!selectedEmployer && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Findings (All Employers)</CardTitle>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : recentFindings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No inspection findings recorded yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Inspection</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Violation</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentFindings.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell>{safeDate(f.createdAt)}</TableCell>
                      <TableCell className="text-sm">
                        {f.employerName ?? f.employerId ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{f.inspectionNumber ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={getFindingTypeBadge(f.findingType)}>
                          {safeLabel(f.findingType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getSeverityBadge(f.severity)}>{f.severity ?? '—'}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{f.title || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {DISPOSITION_LABELS[(f.disposition ?? 'PENDING_REVIEW') as FindingDisposition]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {f.isViolationCreated ? (
                          <Badge variant="default">Created</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {f.isViolationCreated && f.violationId ? (
                          <Button variant="outline" size="sm" onClick={() => handleViewViolation(f.violationId)}>
                            <Eye className="h-4 w-4 mr-1" />
                            View Violation
                          </Button>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleReviewFinding(f)}>
                              Review
                            </Button>
                            {f.employerId && (
                              <Button variant="default" size="sm" onClick={() => loadEmployerData(f.employerId)}>
                                <Plus className="h-4 w-4 mr-1" />
                                Open Employer
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Employer Context */}
      {selectedEmployer && (
        <>
          <Card>

            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Building2 className="h-8 w-8 text-primary" />
                  <div>
                    <CardTitle className="text-xl">{selectedEmployer.name}</CardTitle>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      <span>{selectedEmployer.code}</span>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {selectedEmployer.territory}
                      </div>
                    </div>
                  </div>
                </div>
                <Button variant="outline" onClick={() => { setSelectedEmployer(null); setSearchResults([]); }}>
                  Change Employer
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="findings" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="findings">
                <FileText className="h-4 w-4 mr-2" />
                Findings ({findings.length})
              </TabsTrigger>
              <TabsTrigger value="violations">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Violations ({violations.length})
              </TabsTrigger>
              <TabsTrigger value="visits">Visits History</TabsTrigger>
            </TabsList>

            {/* Findings Tab */}
            <TabsContent value="findings">
              <Card>
                <CardHeader>
                  <CardTitle>All Inspection Findings</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : findings.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No findings recorded for this employer</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Classification</TableHead>
                          <TableHead>Violation Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {findings.map((finding) => (
                          <TableRow key={finding.id}>
                            <TableCell>
                              {safeDate(finding.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getFindingTypeBadge(finding.findingType)}>
                                {safeLabel(finding.findingType)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={getSeverityBadge(finding.severity)}>
                                {finding.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{finding.title}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {DISPOSITION_LABELS[(finding.disposition ?? 'PENDING_REVIEW') as FindingDisposition]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {finding.isViolationCreated ? (
                                <Badge variant="default">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Violation Created
                                </Badge>
                              ) : (
                                <Badge variant="outline">No Violation</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {!finding.isViolationCreated && (
                                  <Button variant="outline" size="sm" onClick={() => handleReviewFinding(finding)}>
                                    Review
                                  </Button>
                                )}
                                {!finding.isViolationCreated && (() => {
                                  const eligibility = evaluateConversionEligibility(finding as any);
                                  return (
                                    <Button
                                      variant="default"
                                      size="sm"
                                      disabled={!eligibility.allowed}
                                      title={eligibility.reasons.join(' ')}
                                      onClick={() => handleCreateViolation(finding)}
                                    >
                                      <Plus className="h-4 w-4 mr-1" />
                                      Confirm as Violation
                                    </Button>
                                  );
                                })()}
                                {finding.isViolationCreated && finding.violationId && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleViewViolation(finding.violationId!)}
                                  >
                                    <Eye className="h-4 w-4 mr-1" />
                                    View Violation
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Violations Tab */}
            <TabsContent value="violations">
              <Card>
                <CardHeader>
                  <CardTitle>Violations for This Employer</CardTitle>
                </CardHeader>
                <CardContent>
                  {violations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No violations recorded for this employer</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Number</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Discovered</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {violations.map((violation) => (
                          <TableRow key={violation.id}>
                            <TableCell className="font-mono">
                              {violation.violationNumber}
                            </TableCell>
                            <TableCell>
                              {safeLabel(violation.violationType as any)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{violation.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={violation.priority === 'High' || violation.priority === 'Critical' ? 'destructive' : 'default'}>
                                {violation.priority}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {safeDate(violation.discoveredDate)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewViolation(violation.id)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Visits Tab */}
            <TabsContent value="visits">
              <Card>
                <CardHeader>
                  <CardTitle>Visit History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    Visit history will be displayed here
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Create Violation Dialog */}
      {selectedFinding && selectedEmployer && (
        <CreateViolationFromFindingDialog
          open={showCreateViolation}
          onOpenChange={setShowCreateViolation}
          finding={selectedFinding}
          employerId={selectedEmployer.id}
          employerName={selectedEmployer.name}
          onViolationCreated={() => {
            setShowCreateViolation(false);
            loadEmployerData(selectedEmployer.id);
          }}
        />
      )}

      <FindingReviewDialog
        open={showReview}
        onOpenChange={setShowReview}
        findingId={reviewFinding?.id ?? null}
        findingTitle={reviewFinding?.title}
        currentDisposition={reviewFinding?.disposition}
        onClassified={(disposition) => {
          if (reviewFinding?.id) applyDisposition(reviewFinding.id, disposition);
        }}
      />
    </div>

  );
}
