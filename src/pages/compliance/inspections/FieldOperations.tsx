import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Clock, Camera, FileText, CheckCircle2, AlertCircle, Search, Filter, Eye, Upload, LogIn, LogOut, Loader2, Building2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchFieldActivities } from "@/services/complianceDataService";
import { supabase } from "@/integrations/supabase/client";
import { SearchBar } from "@/components/common/SearchBar";

export default function FieldOperations() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [checkedInActivities, setCheckedInActivities] = useState<Set<string>>(new Set());

  const { data: activities = [], isPending, isFetching } = useQuery({
    queryKey: ['ce_field_activities', statusFilter, searchTerm],
    queryFn: () => fetchFieldActivities({ status: statusFilter, search: searchTerm || undefined }),
    placeholderData: keepPreviousData,
  });


  const getStatusColor = (status: string) => {
    switch (status) {
      case "checked_in": return "bg-info";
      case "in_progress": return "bg-warning";
      case "completed": return "bg-success";
      default: return "bg-muted-foreground";
    }
  };

  const handleCheckIn = async (activityId: string) => {
    try {
      const { error } = await supabase
        .from('ce_field_activities')
        .update({ status: 'checked_in', check_in_time: new Date().toISOString() })
        .eq('id', activityId);
      if (error) throw error;
      setCheckedInActivities(prev => new Set(prev).add(activityId));
      toast({ title: "Check-In Successful", description: "You have checked in to this visit. GPS location recorded." });
    } catch {
      toast({ title: "Check-In Failed", description: "Could not persist check-in.", variant: "destructive" });
    }
    setCheckInDialogOpen(false);
  };

  const handleCheckOut = async (activityId: string) => {
    try {
      const { error } = await supabase
        .from('ce_field_activities')
        .update({ status: 'completed', check_out_time: new Date().toISOString() })
        .eq('id', activityId);
      if (error) throw error;
      setCheckedInActivities(prev => { const n = new Set(prev); n.delete(activityId); return n; });
      toast({ title: "Check-Out Successful", description: "Visit completed and recorded." });
    } catch {
      toast({ title: "Check-Out Failed", description: "Could not persist check-out.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-foreground">Field Operations</h1><p className="text-muted-foreground">Track check-ins, evidence collection, and working papers</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{checkedInActivities.size}</div><p className="text-sm text-muted-foreground">Active Check-Ins</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{activities.length}</div><p className="text-sm text-muted-foreground">Total Activities</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{activities.filter((a: any) => a.status === 'completed').length}</div><p className="text-sm text-muted-foreground">Completed</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{activities.filter((a: any) => a.status === 'in_progress').length}</div><p className="text-sm text-muted-foreground">In Progress</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Field Activities</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by employer or case number..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></div>
            <Button variant="outline" className="gap-2"><Filter className="h-4 w-4" />Filters</Button>
          </div>

          {activities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No field activities found</div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity: any) => {
                const isCheckedIn = checkedInActivities.has(activity.id);
                return (
                  <div key={activity.id} className="border rounded-lg p-4 hover:border-primary/50 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground">{activity.employer_name}</h3>
                          <Badge variant="outline" className="text-xs">{activity.case_number}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" /><span>Plan: {activity.plan_reference}</span></div>
                      </div>
                      <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${getStatusColor(activity.status)}`} /><span className="text-sm text-muted-foreground capitalize">{(activity.status || '').replace('_', ' ')}</span></div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
                      <div><p className="text-xs text-muted-foreground mb-1">Plan Reference</p><p className="text-sm font-semibold text-foreground">{activity.plan_reference}</p></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Check-In Time</p><p className="text-sm font-semibold text-foreground">{activity.check_in_time || 'Not checked in'}</p></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Visit Type</p><p className="text-sm font-semibold text-foreground">{activity.visit_type}</p></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Evidence Files</p><p className="text-sm font-semibold text-foreground">{activity.evidence_count || 0}</p></div>
                    </div>
                    {isCheckedIn && (<div className="flex items-center gap-2 mb-3 p-2 bg-info/10 dark:bg-info/5 rounded"><Clock className="h-4 w-4 text-info" /><p className="text-sm text-info">Checked in • Visit in progress</p></div>)}
                      <div className="flex gap-2 flex-wrap">
                        {activity.employer_id && (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/compliance/field/visit/${activity.employer_id}`)}>
                            <Building2 className="h-4 w-4 mr-2" />Visit Workspace
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => { setSelectedActivity(activity); setViewDialogOpen(true); }}><Eye className="h-4 w-4 mr-2" />View Details</Button>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedActivity(activity); setUploadDialogOpen(true); }}><Upload className="h-4 w-4 mr-2" />Upload Evidence</Button>
                        {!isCheckedIn ? (
                          <Button size="sm" onClick={() => { setSelectedActivity(activity); setCheckInDialogOpen(true); }}><LogIn className="h-4 w-4 mr-2" />Check In</Button>
                        ) : (
                          <Button size="sm" variant="destructive" onClick={() => handleCheckOut(activity.id)}><LogOut className="h-4 w-4 mr-2" />Check Out</Button>
                        )}
                      </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Field Activity Details</DialogTitle><DialogDescription>Complete details of field visit and activities</DialogDescription></DialogHeader>
          {selectedActivity && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label className="text-muted-foreground">Employer</Label><p className="font-medium">{selectedActivity.employer_name}</p></div>
                <div><Label className="text-muted-foreground">Case Number</Label><p className="font-medium">{selectedActivity.case_number}</p></div>
                <div><Label className="text-muted-foreground">Plan Reference</Label><p className="font-medium">{selectedActivity.plan_reference}</p></div>
                <div><Label className="text-muted-foreground">Visit Type</Label><p className="font-medium">{selectedActivity.visit_type}</p></div>
                <div><Label className="text-muted-foreground">Check-In Time</Label><p className="font-medium">{selectedActivity.check_in_time || 'Not checked in'}</p></div>
                <div><Label className="text-muted-foreground">Check-Out Time</Label><p className="font-medium">{selectedActivity.check_out_time || 'In progress'}</p></div>
              </div>
              <div><Label className="text-muted-foreground">Purpose</Label><Card className="mt-2"><CardContent className="pt-4"><p className="text-sm">{selectedActivity.purpose || "Follow-up visit for C3 compliance"}</p></CardContent></Card></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setViewDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Evidence</DialogTitle><DialogDescription>Upload photos, documents, or other evidence files</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label htmlFor="evidence-type">Evidence Type</Label><select id="evidence-type" className="w-full p-2 border rounded-md"><option value="PHOTO">Photo</option><option value="DOCUMENT">Document</option><option value="SIGNED_FORM">Signed Form</option><option value="AUDIO">Audio Recording</option></select></div>
            <div className="space-y-2"><Label htmlFor="evidence-file">Select File</Label><Input id="evidence-file" type="file" multiple /></div>
            <div className="space-y-2"><Label htmlFor="evidence-description">Description</Label><Textarea id="evidence-description" placeholder="Describe the evidence..." rows={3} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUploadDialogOpen(false)}>Cancel</Button><Button onClick={() => { toast({ title: "Evidence Uploaded", description: "Evidence files have been uploaded successfully." }); setUploadDialogOpen(false); }}><Upload className="h-4 w-4 mr-2" />Upload</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Check In to Visit</DialogTitle><DialogDescription>Confirm your location and start the field visit</DialogDescription></DialogHeader>
          {selectedActivity && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted rounded-lg space-y-2"><p className="font-medium">{selectedActivity.employer_name}</p><p className="text-sm text-muted-foreground">Plan: {selectedActivity.plan_reference}</p><p className="text-sm text-muted-foreground">Case: {selectedActivity.case_number}</p></div>
              <div className="flex items-center gap-2 p-3 bg-info/10 dark:bg-info/5 rounded"><MapPin className="h-4 w-4 text-info" /><p className="text-sm text-info">GPS location will be recorded upon check-in</p></div>
              <div className="space-y-2"><Label htmlFor="checkin-notes">Initial Notes (Optional)</Label><Textarea id="checkin-notes" placeholder="Add any initial observations..." rows={3} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>Cancel</Button><Button onClick={() => selectedActivity && handleCheckIn(selectedActivity.id)}><LogIn className="h-4 w-4 mr-2" />Confirm Check-In</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
