import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DayOfWeek } from '@/hooks/useWeeklyPlanBuilder';
import { CreatePlanItemRequest, PlanItemType, PlanVisitType, PlanItemPriority, PlanItemDuration } from '@/types/weeklyPlan';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface PlanItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: Omit<CreatePlanItemRequest, 'plan_id' | 'created_by'>) => void;
  weekDays: { name: DayOfWeek; date: string }[];
}

export function PlanItemFormDialog({ open, onOpenChange, onSubmit, weekDays }: PlanItemFormDialogProps) {
  const [itemType, setItemType] = useState<string>(PlanItemType.EMPLOYER_VISIT);
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>('Monday');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [duration, setDuration] = useState<string>(PlanItemDuration.HALF_DAY_AM);
  const [visitType, setVisitType] = useState<string>(PlanVisitType.AUDIT);
  const [priority, setPriority] = useState<string>(PlanItemPriority.MEDIUM);
  const [employerName, setEmployerName] = useState('');
  const [employerId, setEmployerId] = useState('');
  const [areaName, setAreaName] = useState('');
  const [territory, setTerritory] = useState('St Kitts');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!dayOfWeek) return;
    const dayInfo = weekDays.find(d => d.name === dayOfWeek);

    onSubmit({
      item_type: itemType,
      day_of_week: dayOfWeek,
      scheduled_date: dayInfo?.date,
      scheduled_start_time: startTime || undefined,
      scheduled_end_time: endTime || undefined,
      duration,
      visit_type: visitType,
      priority,
      employer_name: employerName || undefined,
      employer_id: employerId || undefined,
      area_name: areaName || undefined,
      territory: territory || undefined,
      purpose: purpose || notes || undefined,
      source_type: 'MANUAL',
    });

    // Reset
    setEmployerName('');
    setEmployerId('');
    setAreaName('');
    setPurpose('');
    setNotes('');
    onOpenChange(false);
  };

  const isScouting = itemType === PlanItemType.SCOUTING;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Exception Item</DialogTitle>
          <DialogDescription>Add an exception item not covered by system suggestions</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Item Type</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PlanItemType.EMPLOYER_VISIT}>Employer Visit</SelectItem>
                  <SelectItem value={PlanItemType.SCOUTING}>Scouting</SelectItem>
                  <SelectItem value={PlanItemType.CALL}>Phone Call</SelectItem>
                  <SelectItem value={PlanItemType.DESK_REVIEW}>Desk Review</SelectItem>
                  <SelectItem value={PlanItemType.NOTICE_FOLLOW_UP}>Notice Follow-up</SelectItem>
                  <SelectItem value={PlanItemType.MEETING}>Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Day</Label>
              <Select value={dayOfWeek} onValueChange={v => setDayOfWeek(v as DayOfWeek)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start Time</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Time</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isScouting && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Employer Name</Label>
                <Input value={employerName} onChange={e => setEmployerName(e.target.value)} placeholder="Enter employer name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Visit Type</Label>
                <Select value={visitType} onValueChange={setVisitType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PlanVisitType.AUDIT}>Audit</SelectItem>
                    <SelectItem value={PlanVisitType.C3_FOLLOW_UP}>C3 Follow-up</SelectItem>
                    <SelectItem value={PlanVisitType.PAYMENT_FOLLOW_UP}>Payment Follow-up</SelectItem>
                    <SelectItem value={PlanVisitType.INSPECTION}>Inspection</SelectItem>
                    <SelectItem value={PlanVisitType.RISK_BASED_AUDIT}>Risk-based Audit</SelectItem>
                    <SelectItem value={PlanVisitType.COMPLAINT_INVESTIGATION}>Complaint Investigation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isScouting && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Area Name</Label>
                <Input value={areaName} onChange={e => setAreaName(e.target.value)} placeholder="e.g. Basseterre Industrial Zone" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Territory</Label>
                <Select value={territory} onValueChange={setTerritory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="St Kitts">St Kitts</SelectItem>
                    <SelectItem value="Nevis">Nevis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Purpose / Notes</Label>
            <Textarea
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="Describe the purpose of this visit or activity"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>Add to Plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
