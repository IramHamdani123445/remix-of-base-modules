import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Send, Building2, Users, MapPin, FileText, Calendar, Scale, ClipboardList, Eye, Download, Upload, Loader2, CheckCircle, RefreshCw, Pencil, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useEmployerRegistration } from '@/hooks/useEmployerRegistration';
import { useEmployerRegistrationSubmit } from '@/hooks/useEmployerRegistrationSubmit';
import { ERMasterFormData, EROwnerData, ERLocationData, ER_STATUS_CODES } from '@/types/employerRegistration';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Plus } from 'lucide-react';
import FormDetailTab from './tabs/FormDetailTab';
import { WorkflowActionButtons } from '@/components/workflow/WorkflowActionButtons';
import { formatDisplayDate } from '@/lib/dateFormat';
import { supabase } from '@/integrations/supabase/client';
import { logAuditTrail } from '@/services/auditService';
import { useUserCode } from '@/hooks/useUserCode';
import { useQuery } from '@tanstack/react-query';
import { ACCEPTED_TYPES, MAX_FILE_SIZE } from '@/components/documents/shared/types';
import { format } from 'date-fns';
import { useCountries } from '@/hooks/useIPMasterLookups';
import { SearchableSelect } from '@/components/ui/searchable-select';

export default function EmployerRegistrationForm() {
  const { regno } = useParams<{ regno: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userCode } = useUserCode();
  const isViewMode = window.location.pathname.includes('/view/');
  const isNewMode = window.location.pathname.includes('/new');
  const action = searchParams.get('action');

  const {
    formData, setFormData, owners, locations, notes, commenceDates,
    isLoading, isSaving, isNewRecord, saveEmployer, submitForVerification,
    addOwner, updateOwner, deleteOwner, addLocation, updateLocation, deleteLocation, addNote, addCommenceDate
  } = useEmployerRegistration({ regno, mode: isNewMode ? 'create' : isViewMode ? 'view' : 'edit' });

  const { data: countries = [] } = useCountries();

  const resolveCountryName = (code: string | null | undefined): string => {
    if (!code) return '—';
    const found = countries.find(c => c.code?.trim() === code?.trim());
    return found?.description?.trim() || code;
  };

  const countryOptions = countries.map(c => ({
    value: c.code,
    label: c.description || c.code,
    searchText: c.nationality || '',
  }));

  const { submitERRegistration, isSubmitting } = useEmployerRegistrationSubmit();

  // Fetch transferred documents for this employer (canonical: er_documents)
  const { data: erDocuments = [], refetch: refetchDocs } = useQuery({
    queryKey: ['er-documents', regno],
    queryFn: async () => {
      if (!regno) return [];
      const { data, error } = await supabase
        .from('er_documents')
        .select('*')
        .eq('regno', regno)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) { console.error('Error fetching ER docs:', error); return []; }
      return data || [];
    },
    enabled: !!regno,
  });

  const [activeTab, setActiveTab] = useState('details');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [showOwnerDialog, setShowOwnerDialog] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [editingOwner, setEditingOwner] = useState<EROwnerData | null>(null);
  const [editingLocation, setEditingLocation] = useState<ERLocationData | null>(null);
  const [ownerForm, setOwnerForm] = useState({ name: '', title: '', phone: '', mobile: '', email: '', ssn: '', location_id: 0 });
  const [ownerErrors, setOwnerErrors] = useState<Record<string, string>>({});
  const [locationForm, setLocationForm] = useState({ trade_name: '', loc_addr1: '', loc_addr2: '', activity_type: '', city: '', state: '', country: '' });
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (action === 'submit') setShowSubmitConfirm(true);
    // Approve/Reject actions are now handled by WorkflowActionButtons
  }, [action]);

  const handleFieldChange = useCallback((field: keyof ERMasterFormData, value: any) => {
    if (isViewMode) return;
    setFormData(prev => ({ ...prev, [field]: value }));
  }, [isViewMode, setFormData]);

  const handleSave = useCallback(async (): Promise<string | null> => {
    if (!formData.name?.trim()) {
      toast.error('Employer name is required');
      return null;
    }
    const result = await saveEmployer(formData);
    if (result && isNewRecord) {
      navigate(`/employer-registration/edit/${result}`, { replace: true });
    }
    return result;
  }, [formData, saveEmployer, isNewRecord, navigate]);

  /**
   * Non-fatal acknowledgement evidence. When the Hub accepted (or replayed)
   * the emission we expose a deep link to the Omni-Comms Operations console
   * for that exact request. Never blocks navigation.
   */
  const notifySubmitted = (submitResult: Awaited<ReturnType<typeof submitERRegistration>>) => {
    const communication = submitResult.communication;
    const requestId = communication?.requestId;
    toast.success(submitResult.message || 'Registration submitted successfully', {
      description: communication?.summary,
      ...(requestId
        ? {
            action: {
              label: 'View communication evidence',
              onClick: () =>
                navigate(
                  `/admin/omnichannel-communications/operations?request=${encodeURIComponent(requestId)}`,
                ),
            },
          }
        : {}),
    });
  };

  const handleSubmit = async () => {
    setShowSubmitConfirm(false);
    
    // Save first if new record
    if (!formData.regno) {
      const result = await saveEmployer(formData);
      if (!result) return;
      
      // Use the new registration number for submission
      const submitResult = await submitERRegistration(result, user?.id);
      if (submitResult.success) {
        notifySubmitted(submitResult);
        navigate('/employer-registration');
      } else {
        toast.error(submitResult.message || 'Submission failed');
      }
      return;
    }
    
    // Submit existing record
    const submitResult = await submitERRegistration(formData.regno, user?.id);
    if (submitResult.success) {
      notifySubmitted(submitResult);
      navigate('/employer-registration');
    } else {
      toast.error(submitResult.message || 'Submission failed');
    }
  };


  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    await addNote(newNote, user?.id || '');
    setNewNote('');
  };

  const handleAddOwner = async () => {
    const errors: Record<string, string> = {};
    if (!ownerForm.name.trim()) errors.name = 'Owner name is required';
    if (ownerForm.name.length > 40) errors.name = 'Max 40 characters';
    if (ownerForm.title.length > 25) errors.title = 'Max 25 characters';
    if (ownerForm.phone && (ownerForm.phone.length > 10 || !/^\+?\d*$/.test(ownerForm.phone))) errors.phone = 'Max 10 digits';
    if (ownerForm.mobile && (ownerForm.mobile.length > 10 || !/^\+?\d*$/.test(ownerForm.mobile))) errors.mobile = 'Max 10 digits';
    if (ownerForm.email && (ownerForm.email.length > 30 || (ownerForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerForm.email)))) errors.email = 'Invalid email (max 30 chars)';
    if (ownerForm.ssn && (ownerForm.ssn.length > 6 || !/^\d*$/.test(ownerForm.ssn))) errors.ssn = 'Max 6 digits only';
    if (Object.keys(errors).length > 0) { setOwnerErrors(errors); return; }
    setOwnerErrors({});
    
    let success = false;
    if (editingOwner && editingOwner.owner_id) {
      success = await updateOwner(editingOwner.owner_id, ownerForm);
    } else {
      success = await addOwner(ownerForm);
    }
    if (success) {
      setOwnerForm({ name: '', title: '', phone: '', mobile: '', email: '', ssn: '', location_id: 0 });
      setEditingOwner(null);
      setShowOwnerDialog(false);
    }
  };

  const handleEditOwner = (owner: EROwnerData) => {
    setEditingOwner(owner);
    setOwnerForm({
      name: owner.name || '',
      title: owner.title || '',
      phone: owner.phone || '',
      mobile: owner.mobile || '',
      email: owner.email || '',
      ssn: owner.ssn || '',
      location_id: owner.location_id || 0,
    });
    setOwnerErrors({});
    setShowOwnerDialog(true);
  };

  const handleAddLocation = async () => {
    const errors: Record<string, string> = {};
    if (!locationForm.trade_name.trim()) errors.trade_name = 'Trade name is required';
    if (locationForm.trade_name.length > 40) errors.trade_name = 'Max 40 characters';
    if (locationForm.loc_addr1.length > 25) errors.loc_addr1 = 'Max 25 characters';
    if (locationForm.loc_addr2.length > 25) errors.loc_addr2 = 'Max 25 characters';
    if (locationForm.activity_type.length > 50) errors.activity_type = 'Max 50 characters';
    if (Object.keys(errors).length > 0) { setLocationErrors(errors); return; }
    setLocationErrors({});

    let success = false;
    if (editingLocation && editingLocation.location_id) {
      success = await updateLocation(editingLocation.location_id, locationForm);
    } else {
      success = await addLocation(locationForm);
    }
    if (success) {
      setLocationForm({ trade_name: '', loc_addr1: '', loc_addr2: '', activity_type: '', city: '', state: '', country: '' });
      setEditingLocation(null);
      setShowLocationDialog(false);
    }
  };

  const handleEditLocation = (loc: ERLocationData) => {
    setEditingLocation(loc);
    setLocationForm({
      trade_name: loc.trade_name || '',
      loc_addr1: loc.loc_addr1 || '',
      loc_addr2: loc.loc_addr2 || '',
      activity_type: loc.activity_type || '',
      city: (loc as any).city || '',
      state: (loc as any).state || '',
      country: (loc as any).country || '',
    });
    setLocationErrors({});
    setShowLocationDialog(true);
  };

  const handleWorkflowActionComplete = (action: string, endState: string | null) => {
    navigate('/employer-registration');
  };

  const getStatusBadge = () => {
    const config = ER_STATUS_CODES[formData.status as keyof typeof ER_STATUS_CODES];
    return config ? <Badge variant={config.variant}>{config.label}</Badge> : null;
  };

  if (isLoading) {
    return <div className="container mx-auto p-4"><p>Loading...</p></div>;
  }

  // Show Submit button only for Draft status
  const showSubmitButton = !isViewMode && formData.status === 'Z';

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header - Matching IP Registration styling */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => navigate('/employer-registration')}
            className="flex items-center gap-2 border-0 border-l-2 border-l-primary shadow-md"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
              {isNewMode ? 'Register New Employer' : isViewMode ? 'View Employer' : 'Edit Employer'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {formData.regno && <span className="text-sm text-muted-foreground">Reg. No: {formData.regno}</span>}
              {getStatusBadge()}
            </div>
          </div>
        </div>
        <div className="flex gap-2 self-start lg:self-center">
          {/* Edit button in View mode */}
          {isViewMode && (
            <Button 
              onClick={() => navigate(`/employer-registration/edit/${regno}`)}
              className="flex items-center gap-2 border-r-4 border-r-primary"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {/* Submit button for Draft status */}
          {showSubmitButton && (
            <Button 
              onClick={() => setShowSubmitConfirm(true)} 
              disabled={isSaving || isSubmitting}
              className="flex items-center gap-2 border-r-4 border-r-primary"
            >
              <Send className="h-4 w-4" />
              Submit
            </Button>
          )}
          
          {/* Workflow-driven action buttons (Approve/Reject) — view mode only */}
          {isViewMode && (
            <WorkflowActionButtons
              sourceModule="employers"
              sourceRecordId={formData.regno || null}
              variant="default"
              onActionComplete={handleWorkflowActionComplete}
            />
          )}
        </div>
      </div>

      {/* Card wrapper matching IP Registration */}
      <Card>
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-8">
              <TabsTrigger value="details" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Form Detail</span>
              </TabsTrigger>
              <TabsTrigger value="owners" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Owners</span>
              </TabsTrigger>
              <TabsTrigger value="locations" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">Locations</span>
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Documents</span>
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Notes</span>
              </TabsTrigger>
              <TabsTrigger value="commence" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Commence</span>
              </TabsTrigger>
              <TabsTrigger value="visits" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                <span className="hidden sm:inline">Visits</span>
              </TabsTrigger>
              <TabsTrigger value="suits" className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                <span className="hidden sm:inline">Suits</span>
              </TabsTrigger>
            </TabsList>

        {/* Form Detail Tab with Sub-Steps */}
        <TabsContent value="details">
          <FormDetailTab
            formData={formData}
            onChange={handleFieldChange}
            onSave={handleSave}
            isViewMode={isViewMode}
            isSaving={isSaving}
          />
        </TabsContent>

        {/* Owners Tab */}
        <TabsContent value="owners">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Owners / Partners</CardTitle>
              {!isViewMode && <Button onClick={() => { setEditingOwner(null); setOwnerForm({ name: '', title: '', phone: '', mobile: '', email: '', ssn: '', location_id: 0 }); setOwnerErrors({}); setShowOwnerDialog(true); }}><Plus className="h-4 w-4 mr-2" />Add Owner</Button>}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Title</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>SSN</TableHead>{!isViewMode && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {owners.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No owners added</TableCell></TableRow> :
                    owners.map((owner, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{owner.name}</TableCell><TableCell>{owner.title}</TableCell><TableCell>{owner.phone}</TableCell><TableCell>{owner.email}</TableCell><TableCell>{owner.ssn}</TableCell>
                        {!isViewMode && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEditOwner(owner)}><Pencil className="h-4 w-4 text-primary" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => owner.owner_id && deleteOwner(owner.owner_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Business Locations</CardTitle>
              {!isViewMode && <Button onClick={() => { setEditingLocation(null); setLocationForm({ trade_name: '', loc_addr1: '', loc_addr2: '', activity_type: '', city: '', state: '', country: '' }); setLocationErrors({}); setShowLocationDialog(true); }}><Plus className="h-4 w-4 mr-2" />Add Location</Button>}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Trade Name</TableHead><TableHead>Address 1</TableHead><TableHead>Address 2</TableHead><TableHead>City</TableHead><TableHead>State</TableHead><TableHead>Country</TableHead><TableHead>Activity Type</TableHead>{!isViewMode && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {locations.length === 0 ? <TableRow><TableCell colSpan={isViewMode ? 7 : 8} className="text-center text-muted-foreground">No locations added</TableCell></TableRow> :
                    locations.map((loc, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{loc.trade_name || '—'}</TableCell><TableCell>{loc.loc_addr1 || '—'}</TableCell><TableCell>{loc.loc_addr2 || '—'}</TableCell><TableCell>{(loc as any).city || '—'}</TableCell><TableCell>{(loc as any).state || '—'}</TableCell><TableCell>{resolveCountryName((loc as any).country)}</TableCell><TableCell>{loc.activity_type || '—'}</TableCell>
                        {!isViewMode && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEditLocation(loc)}><Pencil className="h-4 w-4 text-primary" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => loc.location_id && deleteLocation(loc.location_id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents">
          <ERDocumentsTab
            documents={erDocuments}
            regno={regno || ''}
            isViewMode={isViewMode}
            userId={user?.id}
            userCode={userCode || ''}
            onRefresh={refetchDocs}
          />
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!isViewMode && (
                <div className="flex gap-2">
                  <Input placeholder="Enter note..." value={newNote} onChange={e => setNewNote(e.target.value)} maxLength={100} />
                  <Button onClick={handleAddNote} disabled={!newNote.trim()}>Add Note</Button>
                </div>
              )}
              <div className="space-y-2">
                {notes.length === 0 ? <p className="text-muted-foreground">No notes</p> :
                  notes.map((note, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg">
                      <p>{note.note}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(note.note_date).toLocaleString()}</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Commence Date Tab */}
        <TabsContent value="commence">
          <Card>
            <CardHeader><CardTitle>Commence Dates</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date Commenced</TableHead><TableHead>Date Ceased</TableHead><TableHead>Modified By</TableHead></TableRow></TableHeader>
                <TableBody>
                  {commenceDates.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No commence dates</TableCell></TableRow> :
                    commenceDates.map((c, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{c.date_commenced ? formatDisplayDate(c.date_commenced) : '-'}</TableCell>
                        <TableCell>{c.date_ceased ? formatDisplayDate(c.date_ceased) : '-'}</TableCell>
                        <TableCell>{c.modified_by || '-'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visits Tab */}
        <TabsContent value="visits">
          <Card>
            <CardHeader><CardTitle>Inspection Visits</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No visits recorded yet.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Suits Tab */}
        <TabsContent value="suits">
          <Card>
            <CardHeader><CardTitle>Legal Suits</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No legal suits recorded.</p>
            </CardContent>
          </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

      {/* Submit Confirmation Dialog */}
      <AlertDialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Submit for Verification?</AlertDialogTitle><AlertDialogDescription>Once submitted, the employer will be reviewed by a compliance officer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleSubmit}>Submit</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Owner Dialog */}
      <Dialog open={showOwnerDialog} onOpenChange={(open) => { setShowOwnerDialog(open); if (!open) { setOwnerErrors({}); setEditingOwner(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingOwner ? 'Edit Owner' : 'Add Owner'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label className={ownerErrors.name ? 'text-destructive' : ''}>Name * <span className="text-xs text-muted-foreground">(max 40)</span></Label>
              <Input value={ownerForm.name} onChange={e => { setOwnerForm({ ...ownerForm, name: e.target.value }); setOwnerErrors(prev => ({ ...prev, name: '' })); }} maxLength={40} className={ownerErrors.name ? 'border-destructive' : ''} />
              {ownerErrors.name && <p className="text-xs text-destructive mt-1">{ownerErrors.name}</p>}
            </div>
            <div>
              <Label className={ownerErrors.title ? 'text-destructive' : ''}>Title <span className="text-xs text-muted-foreground">(max 25)</span></Label>
              <Input value={ownerForm.title} onChange={e => { setOwnerForm({ ...ownerForm, title: e.target.value }); setOwnerErrors(prev => ({ ...prev, title: '' })); }} maxLength={25} className={ownerErrors.title ? 'border-destructive' : ''} />
              {ownerErrors.title && <p className="text-xs text-destructive mt-1">{ownerErrors.title}</p>}
            </div>
            <div>
              <Label className={ownerErrors.phone ? 'text-destructive' : ''}>Phone <span className="text-xs text-muted-foreground">(max 10 digits)</span></Label>
              <Input value={ownerForm.phone} onChange={e => { const v = e.target.value.replace(/[^\d+]/g, ''); setOwnerForm({ ...ownerForm, phone: v }); setOwnerErrors(prev => ({ ...prev, phone: '' })); }} maxLength={10} className={ownerErrors.phone ? 'border-destructive' : ''} />
              {ownerErrors.phone && <p className="text-xs text-destructive mt-1">{ownerErrors.phone}</p>}
            </div>
            <div>
              <Label className={ownerErrors.mobile ? 'text-destructive' : ''}>Mobile <span className="text-xs text-muted-foreground">(max 10 digits)</span></Label>
              <Input value={ownerForm.mobile} onChange={e => { const v = e.target.value.replace(/[^\d+]/g, ''); setOwnerForm({ ...ownerForm, mobile: v }); setOwnerErrors(prev => ({ ...prev, mobile: '' })); }} maxLength={10} className={ownerErrors.mobile ? 'border-destructive' : ''} />
              {ownerErrors.mobile && <p className="text-xs text-destructive mt-1">{ownerErrors.mobile}</p>}
            </div>
            <div>
              <Label className={ownerErrors.email ? 'text-destructive' : ''}>Email <span className="text-xs text-muted-foreground">(max 30)</span></Label>
              <Input value={ownerForm.email} onChange={e => { setOwnerForm({ ...ownerForm, email: e.target.value }); setOwnerErrors(prev => ({ ...prev, email: '' })); }} maxLength={30} className={ownerErrors.email ? 'border-destructive' : ''} />
              {ownerErrors.email && <p className="text-xs text-destructive mt-1">{ownerErrors.email}</p>}
            </div>
            <div>
              <Label className={ownerErrors.ssn ? 'text-destructive' : ''}>SSN <span className="text-xs text-muted-foreground">(max 6 digits)</span></Label>
              <Input value={ownerForm.ssn} onChange={e => { const v = e.target.value.replace(/\D/g, ''); setOwnerForm({ ...ownerForm, ssn: v }); setOwnerErrors(prev => ({ ...prev, ssn: '' })); }} maxLength={6} className={ownerErrors.ssn ? 'border-destructive' : ''} />
              {ownerErrors.ssn && <p className="text-xs text-destructive mt-1">{ownerErrors.ssn}</p>}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowOwnerDialog(false)}>Cancel</Button><Button onClick={handleAddOwner}>{editingOwner ? 'Save' : 'Add'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Location Dialog */}
      <Dialog open={showLocationDialog} onOpenChange={(open) => { setShowLocationDialog(open); if (!open) { setLocationErrors({}); setEditingLocation(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingLocation ? 'Edit Location' : 'Add Location'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label className={locationErrors.trade_name ? 'text-destructive' : ''}>Trade Name * <span className="text-xs text-muted-foreground">(max 40)</span></Label>
              <Input value={locationForm.trade_name} onChange={e => { setLocationForm({ ...locationForm, trade_name: e.target.value }); setLocationErrors(prev => ({ ...prev, trade_name: '' })); }} maxLength={40} className={locationErrors.trade_name ? 'border-destructive' : ''} />
              {locationErrors.trade_name && <p className="text-xs text-destructive mt-1">{locationErrors.trade_name}</p>}
            </div>
            <div>
              <Label className={locationErrors.loc_addr1 ? 'text-destructive' : ''}>Address 1 <span className="text-xs text-muted-foreground">(max 25)</span></Label>
              <Input value={locationForm.loc_addr1} onChange={e => { setLocationForm({ ...locationForm, loc_addr1: e.target.value }); setLocationErrors(prev => ({ ...prev, loc_addr1: '' })); }} maxLength={25} className={locationErrors.loc_addr1 ? 'border-destructive' : ''} />
              {locationErrors.loc_addr1 && <p className="text-xs text-destructive mt-1">{locationErrors.loc_addr1}</p>}
            </div>
            <div>
              <Label className={locationErrors.loc_addr2 ? 'text-destructive' : ''}>Address 2 <span className="text-xs text-muted-foreground">(max 25)</span></Label>
              <Input value={locationForm.loc_addr2} onChange={e => { setLocationForm({ ...locationForm, loc_addr2: e.target.value }); setLocationErrors(prev => ({ ...prev, loc_addr2: '' })); }} maxLength={25} className={locationErrors.loc_addr2 ? 'border-destructive' : ''} />
              {locationErrors.loc_addr2 && <p className="text-xs text-destructive mt-1">{locationErrors.loc_addr2}</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>City <span className="text-xs text-muted-foreground">(max 50)</span></Label>
                <Input value={locationForm.city} onChange={e => setLocationForm({ ...locationForm, city: e.target.value })} maxLength={50} placeholder="Enter city" />
              </div>
              <div>
                <Label>State <span className="text-xs text-muted-foreground">(max 50)</span></Label>
                <Input value={locationForm.state} onChange={e => setLocationForm({ ...locationForm, state: e.target.value })} maxLength={50} placeholder="Enter state" />
              </div>
              <div>
                <Label>Country</Label>
                <SearchableSelect
                  options={countryOptions}
                  value={locationForm.country}
                  onValueChange={(val) => setLocationForm({ ...locationForm, country: val })}
                  placeholder="Select country"
                  searchPlaceholder="Search countries..."
                  emptyMessage="No country found."
                />
              </div>
            </div>
            <div>
              <Label className={locationErrors.activity_type ? 'text-destructive' : ''}>Activity Type <span className="text-xs text-muted-foreground">(max 50)</span></Label>
              <Input value={locationForm.activity_type} onChange={e => { setLocationForm({ ...locationForm, activity_type: e.target.value }); setLocationErrors(prev => ({ ...prev, activity_type: '' })); }} maxLength={50} className={locationErrors.activity_type ? 'border-destructive' : ''} />
              {locationErrors.activity_type && <p className="text-xs text-destructive mt-1">{locationErrors.activity_type}</p>}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowLocationDialog(false)}>Cancel</Button><Button onClick={handleAddLocation}>{editingLocation ? 'Save' : 'Add'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ER Documents Tab (inline) ──────────────────────────────────────────────

function ERDocumentsTab({
  documents,
  regno,
  isViewMode,
  userId,
  userCode,
  onRefresh,
}: {
  documents: any[];
  regno: string;
  isViewMode: boolean;
  userId?: string;
  userCode: string;
  onRefresh: () => void;
}) {
  const fileInputRefs = React.useRef<Record<number, HTMLInputElement | null>>({});
  const [uploadingIdx, setUploadingIdx] = React.useState<number | null>(null);

  const handleDocAction = async (doc: any, action: 'view' | 'download') => {
    try {
      let url = doc.storage_url;
      if (doc.file_path) {
        const { data: signedData, error } = await supabase.storage
          .from('employer-documents')
          .createSignedUrl(doc.file_path, 3600);
        if (!error && signedData) url = signedData.signedUrl;
      }
      if (!url) { toast.error('Document URL not available'); return; }

      logAuditTrail({
        action: action === 'view' ? 'DOCUMENT_VIEW' : 'DOCUMENT_DOWNLOAD',
        entityType: 'er_application_documents',
        entityId: doc.id,
        module: 'employer-registration',
        metadata: { file_name: doc.file_name, regno },
        userCode,
        userId,
      });

      if (action === 'view') {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.file_name || 'document';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error('Document action failed:', err);
      toast.error('Failed to access document');
    }
  };

  const handleReupload = async (idx: number, file: File | undefined) => {
    if (!file || !regno) return;
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_TYPES.includes(ext)) { toast.error(`File type ${ext} not allowed`); return; }
    if (file.size > MAX_FILE_SIZE) { toast.error('File exceeds 10MB limit'); return; }

    setUploadingIdx(idx);
    const doc = documents[idx];
    try {
      const fileExt = file.name.split('.').pop();
      const storagePath = `er_${regno}/${doc.document_type || 'doc'}_${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await supabase.storage.from('employer-documents').upload(storagePath, file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('employer-documents').getPublicUrl(storagePath);

      // Deactivate old
      await supabase
        .from('er_documents')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', doc.id);

      // Insert new (canonical: er_documents)
      await supabase.from('er_documents').insert({
        regno,
        source_application_reference: doc.source_application_reference || '',
        doc_code: doc.doc_code,
        document_type: doc.document_type,
        document_description: doc.document_description,
        file_name: file.name,
        file_path: storagePath,
        storage_url: urlData?.publicUrl || '',
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: userId || null,
        uploaded_by_code: userCode || null,
        transferred_by: userCode || null,
      });

      logAuditTrail({
        action: 'DOCUMENT_REUPLOAD',
        entityType: 'er_documents',
        entityId: doc.id,
        module: 'employer-registration',
        afterValue: { file_name: file.name, document_type: doc.document_type, regno },
        userCode,
        userId,
      });

      toast.success(`"${file.name}" uploaded successfully`);
      onRefresh();
    } catch (err: any) {
      console.error('Reupload failed:', err);
      toast.error(err.message || 'Failed to upload document');
    } finally {
      setUploadingIdx(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5" />
            Documents
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{documents.length} document(s) transferred</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {documents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Document Type</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Transferred</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc: any, idx: number) => (
                <TableRow key={doc.id}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-medium">{doc.document_type || doc.doc_code || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[250px]">{doc.file_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{doc.transferred_at ? format(new Date(doc.transferred_at), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleDocAction(doc, 'view')} title="View">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDocAction(doc, 'download')} title="Download">
                        <Download className="h-4 w-4" />
                      </Button>
                      {!isViewMode && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRefs.current[idx]?.click()}
                            disabled={uploadingIdx !== null}
                          >
                            {uploadingIdx === idx ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Upload className="h-3.5 w-3.5 mr-1" />
                                Replace
                              </>
                            )}
                          </Button>
                          <input
                            type="file"
                            ref={(el) => { fileInputRefs.current[idx] = el; }}
                            className="hidden"
                            accept={ACCEPTED_TYPES.join(',')}
                            onChange={(e) => handleReupload(idx, e.target.files?.[0])}
                          />
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No documents transferred yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
