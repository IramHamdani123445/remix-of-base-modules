import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ClipboardCheck, CheckCircle, XCircle, MinusCircle, Trash2, Loader2, BookTemplate, Edit, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useAuditChecklists } from '@/hooks/useAuditChecklists';
import { useChecklistTemplates, useLoadChecklistTemplate } from '@/hooks/useChecklistTemplates';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { CommunicationTimeline } from '@/components/audit/CommunicationTimeline';
import { NotificationLogViewer } from '@/components/audit/NotificationLogViewer';
import { DocumentRequestsTab } from '@/components/audit/DocumentRequestsTab';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Download } from 'lucide-react';
import { StandardModal } from '@/components/common';
import { History } from 'lucide-react';
import { PriorAuditHistoryPanel } from '@/components/audit/execution/PriorAuditHistoryPanel';

interface AuditPreparationTabProps {
  auditId: string;
  audit: any;
  engagementContext?: any;
}

export function AuditPreparationTab({ auditId, audit, engagementContext }: AuditPreparationTabProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    checklist: true,
    communications: false,
    documents: false,
    priorHistory: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {/* Checklist Section */}
      <Collapsible open={openSections.checklist} onOpenChange={() => toggleSection('checklist')}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />Audit Checklist
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openSections.checklist ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <ChecklistSection auditId={auditId} departmentId={audit?.department_id} />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Communications Section */}
      <Collapsible open={openSections.communications} onOpenChange={() => toggleSection('communications')}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />Communications & Notifications
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openSections.communications ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <CommunicationTimeline engagementId={auditId} engagementName={audit?.engagement_name} engagementContext={engagementContext} />
              <NotificationLogViewer engagementId={auditId} />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Document Requests Section */}
      <Collapsible open={openSections.documents} onOpenChange={() => toggleSection('documents')}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />Document Requests (PBC)
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openSections.documents ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <DocumentRequestsTab engagementId={auditId} departmentId={audit?.department_id} engagementName={audit?.engagement_name} />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Prior Audit History — auditor-private continuity workspace */}
      <Collapsible open={openSections.priorHistory} onOpenChange={() => toggleSection('priorHistory')}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />Prior Audit History
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openSections.priorHistory ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <PriorAuditHistoryPanel engagementId={auditId} />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>

  );
}

function ChecklistSection({ auditId, departmentId }: { auditId: string; departmentId?: string }) {
  const { data: items = [], isLoading, create, update, archive } = useAuditChecklists(auditId);
  const { data: templates = [] } = useChecklistTemplates(departmentId);
  const loadTemplate = useLoadChecklistTemplate();
  const [newQuestion, setNewQuestion] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ question: '', description: '', category: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = () => {
    if (!newQuestion.trim()) return;
    create.mutate({
      question: newQuestion.trim(),
      description: newDescription.trim() || null,
      category: newCategory.trim() || null,
      response: 'Not Assessed',
      status: 'Pending',
      sort_order: items.length,
    }, {
      onSuccess: () => { setNewQuestion(''); setNewDescription(''); setNewCategory(''); setShowAddForm(false); },
    });
  };

  const handleLoadTemplate = (templateId: string) => {
    loadTemplate.mutate({ auditId, templateId }, {
      onSuccess: () => setShowTemplateModal(false),
    });
  };

  const handleResponse = (id: string, response: string) => {
    update.mutate({ id, response, status: response === 'Not Assessed' ? 'Pending' : 'Completed' });
  };

  const handleEditSave = () => {
    if (!editingItem || !editForm.question.trim()) return;
    update.mutate({
      id: editingItem.id,
      question: editForm.question.trim(),
      description: editForm.description.trim() || null,
      category: editForm.category.trim() || null,
    });
    setEditingItem(null);
  };

  const openEdit = (item: any) => {
    setEditForm({ question: item.question || '', description: item.description || '', category: item.category || '' });
    setEditingItem(item);
  };

  const responseIcon = (response: string) => {
    if (response === 'Compliant') return <CheckCircle className="h-4 w-4 text-primary" />;
    if (response === 'Non-Compliant') return <XCircle className="h-4 w-4 text-destructive" />;
    if (response === 'Not Applicable') return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    return <ClipboardCheck className="h-4 w-4 text-muted-foreground" />;
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const totalAssessed = items.filter((i: any) => i.response !== 'Not Assessed').length;
  const progress = items.length > 0 ? Math.round((totalAssessed / items.length) * 100) : 0;
  const compliantCount = items.filter((i: any) => i.response === 'Compliant').length;
  const nonCompliantCount = items.filter((i: any) => i.response === 'Non-Compliant').length;
  const pendingCount = items.filter((i: any) => i.response === 'Not Assessed').length;

  // Group by category
  const categories = Array.from(new Set(items.map((i: any) => i.category || 'General'))).sort();

  return (
    <div className="space-y-4">
      {/* Progress and Stats */}
      <div className="flex items-center gap-3">
        <Progress value={progress} className="h-2 flex-1" />
        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{progress}% assessed</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={items.length} />
        <StatCard label="Compliant" value={compliantCount} color="text-primary" />
        <StatCard label="Non-Compliant" value={nonCompliantCount} color="text-destructive" />
        <StatCard label="Pending" value={pendingCount} />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add Item
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowTemplateModal(true)}>
          <Download className="h-3.5 w-3.5 mr-1" />Load Template
        </Button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Question *</Label>
                <Input value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="Enter checklist question..." />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Financial Controls" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea value={newDescription} onChange={e => setNewDescription(e.target.value)} rows={2} placeholder="Additional guidance..." />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newQuestion.trim() || create.isPending}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist Items grouped by category */}
      {items.length === 0 ? (
        <AuditEmptyState
          icon={ClipboardCheck}
          title="No checklist items"
          description="Load a template or add questions manually to evaluate audit readiness."
          actionLabel="Load Template"
          onAction={() => setShowTemplateModal(true)}
        />
      ) : (
        <div className="space-y-4">
          {categories.map(cat => {
            const catItems = items.filter((i: any) => (i.category || 'General') === cat);
            const catAssessed = catItems.filter((i: any) => i.response !== 'Not Assessed').length;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h4>
                  <Badge variant="secondary" className="text-[10px]">{catAssessed}/{catItems.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {catItems.map((item: any, idx: number) => (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                      <div className="shrink-0">{responseIcon(item.response)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.question}</p>
                        {item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
                        {item.evidence_required && <Badge variant="outline" className="text-[9px] px-1 py-0 mt-0.5">Evidence Required</Badge>}
                      </div>
                      <Select value={item.response || 'Not Assessed'} onValueChange={(v) => handleResponse(item.id, v)}>
                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Not Assessed">Not Assessed</SelectItem>
                          <SelectItem value="Compliant">Compliant</SelectItem>
                          <SelectItem value="Non-Compliant">Non-Compliant</SelectItem>
                          <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0" onClick={() => openEdit(item)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => archive.mutate(item.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Item Modal */}
      <StandardModal
        open={!!editingItem}
        onOpenChange={() => setEditingItem(null)}
        title="Edit Checklist Item"
        mode="edit"
        onSave={handleEditSave}
        saveLabel="Save Changes"
        isSaving={update.isPending}
      >
        <div className="space-y-4">
          <div><Label>Question *</Label><Input value={editForm.question} onChange={e => setEditForm(f => ({ ...f, question: e.target.value }))} /></div>
          <div><Label>Category</Label><Input value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} /></div>
          <div><Label>Description</Label><Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} /></div>
        </div>
      </StandardModal>

      {/* Template Picker Modal */}
      <StandardModal
        open={showTemplateModal}
        onOpenChange={() => setShowTemplateModal(false)}
        title="Load Checklist Template"
        mode="create"
        saveLabel=""
        size="3xl"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a template to load pre-defined checklist items. Items will be added to your existing checklist.
            {departmentId && <span className="block mt-1 text-xs">Templates matching this audit's department are shown first.</span>}
          </p>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No templates available.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t: any) => (
                <div key={t.id} className={`flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors ${t.department_id === departmentId ? 'border-primary/30 bg-primary/5' : 'border-border/50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-sm font-semibold">{t.template_name}</h4>
                      {t.department_id === departmentId && <Badge className="text-[9px]">Recommended</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {t.control_area && <Badge variant="outline" className="text-[10px]">{t.control_area}</Badge>}
                      {t.audit_type && <Badge variant="secondary" className="text-[10px]">{t.audit_type}</Badge>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleLoadTemplate(t.id)}
                    disabled={loadTemplate.isPending}
                    className="shrink-0 ml-3"
                  >
                    {loadTemplate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                    Load
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </StandardModal>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg border border-border/50 bg-background">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold ${color || ''}`}>{value}</p>
    </div>
  );
}
