/**
 * BN Screen & Field Builder
 * Drag/drop builder for reusable screen templates and smart field metadata.
 * Consumed by /bn/config/screen-setup → Screen & Field Library.
 *
 * Storage notes:
 *  - bn_screen_template.sections: jsonb array [{ code, label, sort_order, visible_for_channels }]
 *  - bn_field_metadata: extra props (visible_for_channels, editable_by_roles,
 *    source_adapter, field_name alias) are stored inside validation_rules JSON
 *    to avoid a schema migration. Persisted columns: field_code, field_label,
 *    field_type, section_code, is_required, sort_order, options_source,
 *    default_value, help_text, validation_rules, is_active.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  GripVertical, Plus, Trash2, Settings2, Save, Layers, Type, Eye, EyeOff,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useBnFieldMetadata,
  useUpsertBnScreenTemplate,
  useUpsertBnFieldMetadata,
  useDeleteBnFieldMetadata,
} from '@/hooks/bn/useBnConfig';
import { SMART_FIELD_TYPES } from '@/services/bn/registries';
import { ScreenTemplatePreview } from './ScreenTemplatePreview';
import { BnBusyButton } from '@/components/bn/shared';

export const APP_CHANNELS = [
  { key: 'PUBLIC_ONLINE', label: 'Public Online' },
  { key: 'STAFF_OFFLINE', label: 'Staff Offline' },
  { key: 'ASSISTED_COUNTER', label: 'Assisted Counter' },
  { key: 'BACK_OFFICE_ENTRY', label: 'Back Office Entry' },
] as const;

export type AppChannel = (typeof APP_CHANNELS)[number]['key'];

export interface SectionDef {
  code: string;
  label: string;
  sort_order: number;
  visible_for_channels?: AppChannel[];
}

interface Props {
  template: any; // bn_screen_template row (id may be undefined when new)
  onClose: () => void;
}

const DEFAULT_CHANNELS: AppChannel[] = ['PUBLIC_ONLINE', 'STAFF_OFFLINE', 'ASSISTED_COUNTER', 'BACK_OFFICE_ENTRY'];

export function ScreenBuilder({ template, onClose }: Props) {
  const { toast } = useToast();
  const upsertTemplate = useUpsertBnScreenTemplate();
  const upsertField = useUpsertBnFieldMetadata();
  const deleteField = useDeleteBnFieldMetadata();

  const [templateId, setTemplateId] = useState<string | undefined>(template?.id);
  const [code, setCode] = useState(template?.template_code ?? '');
  const [name, setName] = useState(template?.template_name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [layout, setLayout] = useState(template?.layout_type ?? 'TABBED');
  const [sections, setSections] = useState<SectionDef[]>(
    Array.isArray(template?.sections) && template.sections.length
      ? (template.sections as SectionDef[])
      : [{ code: 'MAIN', label: 'Main', sort_order: 10, visible_for_channels: DEFAULT_CHANNELS }],
  );
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.code ?? 'MAIN');
  const [editingField, setEditingField] = useState<any | null>(null);

  const { data: dbFields = [], refetch } = useBnFieldMetadata(templateId);
  // local working copy of fields ordered by section
  const [fields, setFields] = useState<any[]>([]);
  useEffect(() => { setFields(dbFields); }, [dbFields]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const sectionFields = useMemo(
    () => fields.filter(f => f.section_code === activeSection).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [fields, activeSection],
  );

  const saveTemplate = async () => {
    if (!code.trim() || !name.trim()) {
      toast({ title: 'Validation', description: 'Code and Name are required.', variant: 'destructive' });
      return;
    }
    try {
      const saved = await upsertTemplate.mutateAsync({
        id: templateId,
        template_code: code.trim().toUpperCase(),
        template_name: name.trim(),
        description: description || null,
        layout_type: layout,
        sections,
        is_active: true,
      } as any);
      setTemplateId(saved.id);
      toast({ title: 'Saved', description: `Template "${saved.template_name}" saved.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'Failed to save template.', variant: 'destructive' });
    }
  };

  // ─── Sections ─────────────────────────────
  const addSection = () => {
    const idx = sections.length + 1;
    const code = `SECTION_${idx}`;
    setSections(s => [...s, { code, label: `Section ${idx}`, sort_order: idx * 10, visible_for_channels: DEFAULT_CHANNELS }]);
    setActiveSection(code);
  };
  const removeSection = (code: string) => {
    if (sections.length === 1) return;
    if (fields.some(f => f.section_code === code)) {
      toast({ title: 'Section has fields', description: 'Move or delete fields before removing the section.', variant: 'destructive' });
      return;
    }
    const next = sections.filter(s => s.code !== code);
    setSections(next);
    if (activeSection === code) setActiveSection(next[0].code);
  };
  const updateSection = (code: string, patch: Partial<SectionDef>) =>
    setSections(s => s.map(x => x.code === code ? { ...x, ...patch } : x));

  const onSectionDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sections.findIndex(s => s.code === active.id);
    const newIdx = sections.findIndex(s => s.code === over.id);
    const reordered = arrayMove(sections, oldIdx, newIdx).map((s, i) => ({ ...s, sort_order: (i + 1) * 10 }));
    setSections(reordered);
  };

  // ─── Fields ─────────────────────────────
  const onFieldDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionFields.findIndex(f => f.id === active.id);
    const newIdx = sectionFields.findIndex(f => f.id === over.id);
    const reordered = arrayMove(sectionFields, oldIdx, newIdx);
    // optimistic update
    const updates = reordered.map((f, i) => ({ ...f, sort_order: (i + 1) * 10 }));
    setFields(prev => prev.map(f => updates.find(u => u.id === f.id) ?? f));
    // persist new sort orders
    try {
      await Promise.all(updates.map(u => upsertField.mutateAsync({ id: u.id, screen_template_id: templateId, sort_order: u.sort_order } as any)));
    } catch (err: any) {
      toast({ title: 'Reorder failed', description: err?.message, variant: 'destructive' });
      refetch();
    }
  };

  const addField = () => {
    if (!templateId) {
      toast({ title: 'Save template first', description: 'Save the screen template before adding fields.', variant: 'destructive' });
      return;
    }
    setEditingField({
      screen_template_id: templateId,
      field_code: '',
      field_label: '',
      field_type: 'TEXT',
      section_code: activeSection,
      is_required: false,
      sort_order: (sectionFields.length + 1) * 10,
      validation_rules: {
        visible_for_channels: DEFAULT_CHANNELS,
        editable_by_roles: [],
        source_adapter: '',
      },
      help_text: '',
      is_active: true,
    });
  };

  const saveField = async () => {
    if (!editingField?.field_code?.trim() || !editingField?.field_label?.trim()) {
      toast({ title: 'Validation', description: 'Field code and label are required.', variant: 'destructive' });
      return;
    }
    try {
      const payload = {
        ...editingField,
        field_code: editingField.field_code.trim(),
        // mirror field_code into validation_rules.field_name for callers expecting that key
        validation_rules: { ...editingField.validation_rules, field_name: editingField.field_code.trim() },
      };
      await upsertField.mutateAsync(payload as any);
      toast({ title: 'Saved', description: 'Field saved.' });
      setEditingField(null);
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  };

  const removeField = async (f: any) => {
    if (!confirm(`Remove field "${f.field_label}"?`)) return;
    try {
      await deleteField.mutateAsync({ id: f.id, templateId });
      refetch();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Template header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Screen Template</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Template Code *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SICKNESS_INTAKE" disabled={!!templateId} maxLength={30} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Template Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Sickness Benefit Intake Form" />
          </div>
          <div className="space-y-1">
            <Label>Layout</Label>
            <Select value={layout} onValueChange={setLayout}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TABBED">Tabbed</SelectItem>
                <SelectItem value="STEPPED">Stepped Wizard</SelectItem>
                <SelectItem value="SINGLE_PAGE">Single Page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4 space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={description ?? ''} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="md:col-span-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={saveTemplate} disabled={upsertTemplate.isPending} className="gap-2">
              <Save className="h-4 w-4" /> Save Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Builder canvas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* Sections column */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5"><Layers className="h-4 w-4" /> Sections</CardTitle>
            <Button size="sm" variant="ghost" onClick={addSection} className="h-7 px-2"><Plus className="h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
              <SortableContext items={sections.map(s => s.code)} strategy={verticalListSortingStrategy}>
                {sections.map(s => (
                  <SortableSectionItem
                    key={s.code}
                    section={s}
                    active={activeSection === s.code}
                    onSelect={() => setActiveSection(s.code)}
                    onChange={p => updateSection(s.code, p)}
                    onRemove={() => removeSection(s.code)}
                    fieldCount={fields.filter(f => f.section_code === s.code).length}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>

        {/* Fields column */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Type className="h-4 w-4" /> Fields in <span className="font-mono">{activeSection}</span>
            </CardTitle>
            <Button size="sm" onClick={addField} className="h-7 gap-1"><Plus className="h-3.5 w-3.5" /> Add Field</Button>
          </CardHeader>
          <CardContent className="pt-0">
            {!templateId ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Save the template to begin adding fields.</p>
            ) : sectionFields.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No fields yet. Click <strong>Add Field</strong> to select a smart-field type.</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd}>
                <SortableContext items={sectionFields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {sectionFields.map(f => (
                      <SortableFieldItem key={f.id} field={f} onEdit={() => setEditingField(f)} onRemove={() => removeField(f)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live form preview */}
      <ScreenTemplatePreview
        templateCode={code}
        templateName={name}
        sections={sections}
        fields={fields}
      />

      {/* Inspector dialog */}
      <FieldInspectorDialog
        field={editingField}
        sections={sections}
        onChange={setEditingField}
        onCancel={() => setEditingField(null)}
        onSave={saveField}
        saving={upsertField.isPending}
      />
    </div>
  );
}

// ─── Sortable section ─────────────────────────────
function SortableSectionItem({
  section, active, onSelect, onChange, onRemove, fieldCount,
}: { section: SectionDef; active: boolean; onSelect: () => void; onChange: (p: Partial<SectionDef>) => void; onRemove: () => void; fieldCount: number; }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.code });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`group flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${active ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground" aria-label="Drag section"><GripVertical className="h-3.5 w-3.5" /></button>
      <button onClick={onSelect} className="flex-1 text-left text-sm">
        <Input
          value={section.label}
          onChange={e => onChange({ label: e.target.value })}
          className="h-7 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
        />
        <span className="text-[10px] font-mono text-muted-foreground">{section.code} · {fieldCount} fields</span>
      </button>
      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
    </div>
  );
}

// ─── Sortable field ─────────────────────────────
function SortableFieldItem({ field, onEdit, onRemove }: { field: any; onEdit: () => void; onRemove: () => void; }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const ft = SMART_FIELD_TYPES.find(t => t.key === field.field_type);
  const channels: AppChannel[] = (field.validation_rules?.visible_for_channels as AppChannel[]) ?? DEFAULT_CHANNELS;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2">
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground" aria-label="Drag field"><GripVertical className="h-3.5 w-3.5" /></button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{field.field_label}</span>
          {field.is_required && <Badge variant="destructive" className="text-[9px] px-1 py-0">Required</Badge>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{field.field_code}</span> ·
          <Badge variant="outline" className="text-[9px] px-1 py-0">{ft?.label ?? field.field_type}</Badge>
          <span>{channels.length}/4 channels</span>
        </div>
      </div>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onEdit}><Settings2 className="h-3.5 w-3.5" /></Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

// ─── Inspector dialog ─────────────────────────────
function FieldInspectorDialog({
  field, sections, onChange, onCancel, onSave, saving,
}: {
  field: any | null;
  sections: SectionDef[];
  onChange: (f: any) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!field) return null;
  const vr = field.validation_rules ?? {};
  const channels: AppChannel[] = vr.visible_for_channels ?? DEFAULT_CHANNELS;
  const roles: string[] = vr.editable_by_roles ?? [];

  const toggleChannel = (c: AppChannel) => {
    const next = channels.includes(c) ? channels.filter(x => x !== c) : [...channels, c];
    onChange({ ...field, validation_rules: { ...vr, visible_for_channels: next } });
  };

  const setVR = (patch: Record<string, any>) =>
    onChange({ ...field, validation_rules: { ...vr, ...patch } });

  return (
    <Dialog open={!!field} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{field.id ? 'Edit Field' : 'Add Field'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Field Code (field_name) *</Label>
                <Input value={field.field_code} onChange={e => onChange({ ...field, field_code: e.target.value })} placeholder="ssn" />
              </div>
              <div className="space-y-1">
                <Label>Field Label *</Label>
                <Input value={field.field_label} onChange={e => onChange({ ...field, field_label: e.target.value })} placeholder="Social Security Number" />
              </div>
              <div className="space-y-1">
                <Label>Field Type</Label>
                <Select value={field.field_type} onValueChange={v => onChange({ ...field, field_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {SMART_FIELD_TYPES.map(t => (
                      <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Section</Label>
                <Select value={field.section_code} onValueChange={v => onChange({ ...field, section_code: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sections.map(s => <SelectItem key={s.code} value={s.code}>{s.label} ({s.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Sort Order</Label>
                <Input type="number" value={field.sort_order ?? 0} onChange={e => onChange({ ...field, sort_order: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={!!field.is_required} onCheckedChange={v => onChange({ ...field, is_required: v })} />
                <Label>Required</Label>
              </div>
            </div>

            <Separator />

            <div>
              <Label className="text-xs uppercase">Visible for Channels</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {APP_CHANNELS.map(c => {
                  const on = channels.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleChannel(c.key)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${on ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                    >
                      {on ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Source Adapter</Label>
                <Input
                  value={vr.source_adapter ?? ''}
                  onChange={e => setVR({ source_adapter: e.target.value })}
                  placeholder="ip_master, er_master, ip_wages..."
                />
              </div>
              <div className="space-y-1">
                <Label>Editable by Roles (comma separated)</Label>
                <Input
                  value={roles.join(',')}
                  onChange={e => setVR({ editable_by_roles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="benefits_officer, supervisor"
                />
              </div>
              <div className="space-y-1">
                <Label>Options Source</Label>
                <Input
                  value={field.options_source ?? ''}
                  onChange={e => onChange({ ...field, options_source: e.target.value })}
                  placeholder="lookup:bn_branch"
                />
              </div>
              <div className="space-y-1">
                <Label>Default Value</Label>
                <Input
                  value={field.default_value ?? ''}
                  onChange={e => onChange({ ...field, default_value: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Help Text</Label>
              <Textarea rows={2} value={field.help_text ?? ''} onChange={e => onChange({ ...field, help_text: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Validation Rules (JSON)</Label>
              <Textarea
                rows={3}
                value={JSON.stringify({ ...vr, visible_for_channels: undefined, editable_by_roles: undefined, source_adapter: undefined }, null, 2).replace(/"visible_for_channels": undefined,?\s*/g, '')}
                onChange={e => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    onChange({ ...field, validation_rules: { ...parsed, visible_for_channels: channels, editable_by_roles: roles, source_adapter: vr.source_adapter } });
                  } catch { /* ignore until valid */ }
                }}
              />
              <p className="text-[10px] text-muted-foreground">e.g. {`{ "min": 0, "max": 100, "regex": "^[A-Z0-9]+$" }`}</p>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <BnBusyButton loading={saving} onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save Field'}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
