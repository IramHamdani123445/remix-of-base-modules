import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Upload, CheckCircle, FileText, Users, Trash2 } from 'lucide-react';

import { useIADepartmentAudits } from '@/hooks/useAuditDataExtended';
import { useIADepartmentAuditMutations } from '@/hooks/useAuditData';
import { usePreparationChecklists, usePreparationChecklistMutations, usePreparationDocuments, usePreparationDocumentMutations } from '@/hooks/useAuditPreparation';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { PageShell, DataTable, StatusBadge } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { EngagementFilterBanner, useEngagementFilter } from '@/components/audit/EngagementFilterBanner';

export default function AuditPreparation() {
  const { getCreateFields } = useAuditFields();
  const { engagementId } = useEngagementFilter();
  const { data: audits = [], isLoading } = useIADepartmentAudits();
  const { update: updateAudit } = useIADepartmentAuditMutations();
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);

  // Filter audits ready for preparation (Accepted or In Preparation)
  const preparationAudits = audits.filter((a: any) => 
    ['Accepted', 'Approved', 'In Preparation'].includes(a.status)
  );

  const selectedAudit = preparationAudits.find((a: any) => a.id === selectedAuditId);

  const { data: checklists = [] } = usePreparationChecklists(selectedAuditId || undefined, engagementId);
  const { create: createChecklist, update: updateChecklist, remove: removeChecklist } = usePreparationChecklistMutations();
  const { data: documents = [] } = usePreparationDocuments(selectedAuditId || undefined, engagementId);
  const { create: createDocument, remove: removeDocument } = usePreparationDocumentMutations();

  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newChecklistCategory, setNewChecklistCategory] = useState('General');
  const [newDocName, setNewDocName] = useState('');
  const [newDocType, setNewDocType] = useState('General');

  const handleAddChecklist = () => {
    if (!newChecklistItem.trim() || (!selectedAuditId && !engagementId)) return;
    createChecklist.mutate({
      // ADR-01: writes are anchored on the canonical engagement spine only.
      ...(engagementId ? { engagement_id: engagementId } : { engagement_id: selectedAuditId }),
      item_text: newChecklistItem.trim(),
      category: newChecklistCategory,
      ...getCreateFields(),
    });
    setNewChecklistItem('');
  };

  const handleToggleChecklist = (item: any) => {
    updateChecklist.mutate({ id: item.id, is_completed: !item.is_completed });
  };

  const handleAddDocument = () => {
    if (!newDocName.trim() || (!selectedAuditId && !engagementId)) return;
    createDocument.mutate({
      // ADR-01: writes are anchored on the canonical engagement spine only.
      ...(engagementId ? { engagement_id: engagementId } : { engagement_id: selectedAuditId }),
      file_name: newDocName.trim(),
      document_type: newDocType,
      ...getCreateFields(),
    });
    setNewDocName('');
  };

  const handleMarkReady = () => {
    if (!selectedAuditId) return;
    updateAudit.mutate({ id: selectedAuditId, status: 'Ready for Execution' });
  };

  const handleStartPreparation = () => {
    if (!selectedAuditId) return;
    updateAudit.mutate({ id: selectedAuditId, status: 'In Preparation' });
  };

  const completedCount = checklists.filter((c: any) => c.is_completed).length;
  const totalCount = checklists.length;

  // If engagement context is active, show engagement-centric view
  const showEngagementMode = !!engagementId && !selectedAuditId;

  return (
    <PageShell
      title="Audit Preparation"
      subtitle="Prepare audits for execution with checklists, documents, and team assignments"
      breadcrumbs={[{ label: 'Internal Audit' }, { label: 'Audit Preparation' }]}
      isLoading={isLoading}
    >
      <EngagementFilterBanner />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Audit Selection */}
        {!engagementId && (
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Audits Ready for Preparation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {preparationAudits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No audits awaiting preparation.</p>
                ) : (
                  preparationAudits.map((audit: any) => (
                    <Button
                      key={audit.id}
                      variant={selectedAuditId === audit.id ? 'default' : 'outline'}
                      className="w-full justify-start text-left h-auto py-3"
                      onClick={() => setSelectedAuditId(audit.id)}
                    >
                      <div>
                        <div className="font-medium text-sm">{audit.department_name}</div>
                        <div className="text-xs opacity-70">
                          {audit.audit_type === 'ad_hoc' ? 'Ad-Hoc' : 'Planned'} · {audit.status}
                        </div>
                      </div>
                    </Button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Right: Preparation Details */}
        <div className={engagementId ? 'lg:col-span-3' : 'lg:col-span-2'}>
          {!selectedAudit && !showEngagementMode ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select an audit from the left panel to begin preparation.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Status Bar - only for department audit mode */}
              {selectedAudit && (
                <Card>
                  <CardContent className="pt-4 pb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{selectedAudit.department_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Status: <StatusBadge status={selectedAudit.status} />
                        {totalCount > 0 && ` · Checklist: ${completedCount}/${totalCount}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {selectedAudit.status === 'Accepted' || selectedAudit.status === 'Approved' ? (
                        <Button size="sm" onClick={handleStartPreparation}>Start Preparation</Button>
                      ) : selectedAudit.status === 'In Preparation' ? (
                        <Button size="sm" onClick={handleMarkReady}>
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Mark Ready for Execution
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              )}

              {showEngagementMode && totalCount > 0 && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm text-muted-foreground">
                      Checklist: {completedCount}/{totalCount} completed
                    </p>
                  </CardContent>
                </Card>
              )}

              <Tabs defaultValue="checklist">
                <TabsList>
                  <TabsTrigger value="checklist">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Checklist ({totalCount})
                  </TabsTrigger>
                  <TabsTrigger value="documents">
                    <FileText className="w-3 h-3 mr-1" />
                    Documents ({documents.length})
                  </TabsTrigger>
                  {selectedAudit && (
                    <TabsTrigger value="team">
                      <Users className="w-3 h-3 mr-1" />
                      Team
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* Checklist Tab */}
                <TabsContent value="checklist" className="space-y-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex gap-2 mb-4">
                        <Input
                          placeholder="Add checklist item..."
                          value={newChecklistItem}
                          onChange={(e) => setNewChecklistItem(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddChecklist()}
                        />
                        <Select value={newChecklistCategory} onValueChange={setNewChecklistCategory}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="General">General</SelectItem>
                            <SelectItem value="Procedure">Procedure</SelectItem>
                            <SelectItem value="Objective">Objective</SelectItem>
                            <SelectItem value="Risk">Key Risk</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button onClick={handleAddChecklist} size="icon">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {checklists.map((item: any) => (
                          <div key={item.id} className="flex items-center gap-3 p-2 rounded border">
                            <Checkbox
                              checked={item.is_completed}
                              onCheckedChange={() => handleToggleChecklist(item)}
                            />
                            <div className="flex-1">
                              <span className={item.is_completed ? 'line-through text-muted-foreground' : ''}>
                                {item.item_text}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">({item.category})</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeChecklist.mutate(item.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        {checklists.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">No checklist items yet. Add procedures, objectives, or key risks above.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Documents Tab */}
                <TabsContent value="documents" className="space-y-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex gap-2 mb-4">
                        <Input
                          placeholder="Document name..."
                          value={newDocName}
                          onChange={(e) => setNewDocName(e.target.value)}
                        />
                        <Select value={newDocType} onValueChange={setNewDocType}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="General">General</SelectItem>
                            <SelectItem value="Audit Program">Audit Program</SelectItem>
                            <SelectItem value="Planning Notes">Planning Notes</SelectItem>
                            <SelectItem value="Preliminary">Preliminary</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button onClick={handleAddDocument} size="icon">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {documents.map((doc: any) => (
                          <div key={doc.id} className="flex items-center gap-3 p-2 rounded border">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1">
                              <span className="text-sm font-medium">{doc.file_name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">({doc.document_type})</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeDocument.mutate(doc.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        {documents.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">No documents uploaded yet.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Team Tab */}
                {selectedAudit && (
                  <TabsContent value="team">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="space-y-3">
                          {selectedAudit.lead_auditor_name && (
                            <div className="flex items-center gap-2 p-2 rounded border">
                              <Users className="h-4 w-4 text-primary" />
                              <span className="font-medium text-sm">{selectedAudit.lead_auditor_name}</span>
                              <StatusBadge status="Lead" />
                            </div>
                          )}
                          {selectedAudit.team_member_ids?.length > 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {selectedAudit.team_member_ids.length} team member(s) assigned
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">No additional team members assigned.</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
