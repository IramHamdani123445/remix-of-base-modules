import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Plus, Edit, Trash2, Eye, EyeOff, CheckCircle2,
  Server, Zap, TestTube, Star, AlertCircle, RefreshCw,
  MessageSquare, Bell, Settings2, Phone, Smartphone
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  useNotificationTypes,
  useCreateNotificationType,
  useUpdateNotificationType,
  useToggleNotificationType,
  type NotificationType,
  type NotificationTypeFormData,
} from "@/hooks/useNotificationTypes";

// ── Types ─────────────────────────────────────────────────────────────────────
type EmailProviderType = "smtp" | "resend";
type SmsProviderType = "twilio" | "messagebird" | "custom_gateway";
type PushProviderType = "fcm" | "onesignal" | "custom";
type ChannelType = "email" | "sms" | "push";

interface ProviderRecord {
  id: string;
  channel: string;
  provider_name: string;
  display_name: string | null;
  description: string | null;
  email_provider_type: EmailProviderType | null;
  sms_provider_type: SmsProviderType | null;
  push_provider_type: PushProviderType | null;
  is_active: boolean;
  is_default: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ── Field definitions ──────────────────────────────────────────────────────────
type FieldDef = { key: string; label: string; type: string; placeholder: string; secret?: boolean; required?: boolean };

const SMTP_FIELDS: FieldDef[] = [
  { key: "smtp_host",     label: "SMTP Host",       type: "text",     placeholder: "smtp.example.com",  required: true  },
  { key: "smtp_port",     label: "SMTP Port",       type: "number",   placeholder: "587",               required: true  },
  { key: "smtp_user",     label: "Username",        type: "text",     placeholder: "user@example.com",  required: true  },
  { key: "smtp_password", label: "Password",        type: "password", placeholder: "••••••••",          required: true, secret: true },
  { key: "smtp_secure",   label: "Use TLS/SSL",     type: "boolean",  placeholder: ""                                   },
  { key: "from_email",    label: "From Email",      type: "email",    placeholder: "noreply@domain.com", required: true },
  { key: "from_name",     label: "From Name",       type: "text",     placeholder: "My App Notifications"               },
];

const RESEND_FIELDS: FieldDef[] = [
  { key: "api_key",    label: "Resend API Key", type: "password", placeholder: "re_••••••••••••",       required: true, secret: true },
  { key: "from_email", label: "From Email",     type: "email",    placeholder: "info@secureserve.biz", required: true },
  { key: "from_name",  label: "From Name",      type: "text",     placeholder: "My App Notifications"               },
];

const TWILIO_FIELDS: FieldDef[] = [
  { key: "account_sid",          label: "Account SID",          type: "text",     placeholder: "ACxxxxxxxxxxxxxxx",     required: true },
  { key: "auth_token",           label: "Auth Token",           type: "password", placeholder: "••••••••",              required: true, secret: true },
  { key: "from_number",          label: "From Number",          type: "text",     placeholder: "+15017122661",          required: true },
  { key: "messaging_service_sid",label: "Messaging Service SID",type: "text",     placeholder: "MGxxxxxxxxxxxxxxx"                    },
];

const MESSAGEBIRD_FIELDS: FieldDef[] = [
  { key: "api_key",     label: "API Key",     type: "password", placeholder: "••••••••", required: true, secret: true },
  { key: "originator",  label: "Originator",  type: "text",     placeholder: "MyApp or +1234567890", required: true },
];

const CUSTOM_SMS_FIELDS: FieldDef[] = [
  { key: "api_url",      label: "API URL",      type: "text",     placeholder: "https://api.gateway.com/sms", required: true },
  { key: "api_key",      label: "API Key",      type: "password", placeholder: "••••••••",                    required: true, secret: true },
  { key: "from_number",  label: "From Number",  type: "text",     placeholder: "+1234567890"                                  },
  { key: "http_method",  label: "HTTP Method",  type: "text",     placeholder: "POST"                                         },
];

const FCM_FIELDS: FieldDef[] = [
  { key: "server_key",  label: "Server Key",  type: "password", placeholder: "••••••••",               required: true, secret: true },
  { key: "project_id",  label: "Project ID",  type: "text",     placeholder: "my-firebase-project",   required: true },
  { key: "sender_id",   label: "Sender ID",   type: "text",     placeholder: "123456789"                              },
];

const ONESIGNAL_FIELDS: FieldDef[] = [
  { key: "app_id",       label: "App ID",       type: "text",     placeholder: "xxxxxxxx-xxxx-xxxx",  required: true },
  { key: "rest_api_key", label: "REST API Key", type: "password", placeholder: "••••••••",            required: true, secret: true },
];

const CUSTOM_PUSH_FIELDS: FieldDef[] = [
  { key: "api_url",   label: "API URL",   type: "text",     placeholder: "https://api.push.com/send", required: true },
  { key: "api_key",   label: "API Key",   type: "password", placeholder: "••••••••",                  required: true, secret: true },
  { key: "headers",   label: "Additional Headers (JSON)", type: "text", placeholder: '{"X-Custom": "value"}'         },
];

// ── SMS/Push provider type options ────────────────────────────────────────────
const SMS_PROVIDER_OPTIONS: { value: SmsProviderType; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "twilio", label: "Twilio", desc: "Global SMS platform", icon: <Phone className="h-6 w-6" /> },
  { value: "messagebird", label: "MessageBird", desc: "Enterprise messaging", icon: <MessageSquare className="h-6 w-6" /> },
  { value: "custom_gateway", label: "Custom Gateway", desc: "Custom HTTP API", icon: <Server className="h-6 w-6" /> },
];

const PUSH_PROVIDER_OPTIONS: { value: PushProviderType; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "fcm", label: "Firebase (FCM)", desc: "Google Cloud Messaging", icon: <Bell className="h-6 w-6" /> },
  { value: "onesignal", label: "OneSignal", desc: "Multi-platform push", icon: <Smartphone className="h-6 w-6" /> },
  { value: "custom", label: "Custom", desc: "Custom push API", icon: <Server className="h-6 w-6" /> },
];

function getFieldsForProvider(channel: ChannelType, subtype: string): FieldDef[] {
  if (channel === "email") return subtype === "resend" ? RESEND_FIELDS : SMTP_FIELDS;
  if (channel === "sms") {
    if (subtype === "twilio") return TWILIO_FIELDS;
    if (subtype === "messagebird") return MESSAGEBIRD_FIELDS;
    return CUSTOM_SMS_FIELDS;
  }
  if (channel === "push") {
    if (subtype === "fcm") return FCM_FIELDS;
    if (subtype === "onesignal") return ONESIGNAL_FIELDS;
    return CUSTOM_PUSH_FIELDS;
  }
  return [];
}

function getSubtypeLabel(channel: ChannelType, subtype: string): string {
  if (channel === "email") return subtype === "smtp" ? "SMTP" : "Resend";
  if (channel === "sms") {
    if (subtype === "twilio") return "Twilio";
    if (subtype === "messagebird") return "MessageBird";
    return "Custom Gateway";
  }
  if (subtype === "fcm") return "Firebase (FCM)";
  if (subtype === "onesignal") return "OneSignal";
  return "Custom";
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const maskSecret = (val: string | undefined): string => {
  if (!val) return "";
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
};

// ── Validation ─────────────────────────────────────────────────────────────────
function validateProvider(channel: ChannelType, subtype: string, config: Record<string, any>, name: string): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("Provider name is required");

  const fields = getFieldsForProvider(channel, subtype);
  fields.forEach((field) => {
    if (field.required && !config[field.key]?.toString().trim()) {
      errors.push(`${field.label} is required`);
    }
  });

  // Email-specific validations
  if (channel === "email") {
    if (config.from_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.from_email)) {
      errors.push("From Email is not valid");
    }
    if (subtype === "smtp" && config.smtp_port) {
      const port = Number(config.smtp_port);
      if (port < 1 || port > 65535) errors.push("SMTP Port must be between 1 and 65535");
    }
    if (subtype === "resend" && config.api_key && !config.api_key.startsWith("re_")) {
      errors.push("Resend API Key must start with 're_'");
    }
  }

  return errors;
}

// ── Generic Provider Form ──────────────────────────────────────────────────────
interface GenericProviderFormProps {
  channel: ChannelType;
  form: {
    provider_name: string;
    display_name: string;
    description: string;
    subtype: string;
    config: Record<string, any>;
  };
  onChange: (form: GenericProviderFormProps["form"]) => void;
  isEditing: boolean;
}

function GenericProviderForm({ channel, form, onChange, isEditing }: GenericProviderFormProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) =>
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));

  const setConfig = (key: string, val: any) =>
    onChange({ ...form, config: { ...form.config, [key]: val } });

  const fields = getFieldsForProvider(channel, form.subtype);

  // Provider type options
  const typeOptions = channel === "email"
    ? [{ value: "smtp", label: "SMTP", desc: "Custom mail server", icon: <Server className="h-6 w-6" /> },
       { value: "resend", label: "Resend", desc: "API-based delivery", icon: <Zap className="h-6 w-6" /> }]
    : channel === "sms"
      ? SMS_PROVIDER_OPTIONS
      : PUSH_PROVIDER_OPTIONS;

  return (
    <div className="space-y-5">
      {/* Provider type selector */}
      {!isEditing && (
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Provider Type *</Label>
          <div className={cn("grid gap-3", typeOptions.length <= 2 ? "grid-cols-2" : "grid-cols-3")}>
            {typeOptions.map((opt) => {
              const isSelected = form.subtype === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...form, subtype: opt.value, config: {} })}
                  className={cn(
                    "relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all text-center focus:outline-none",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "border-border bg-background hover:border-primary/60 hover:bg-muted/50 text-foreground"
                  )}
                >
                  {isSelected && (
                    <span className="absolute top-2 right-2">
                      <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                    </span>
                  )}
                  <div className={cn(isSelected ? "text-primary-foreground" : "text-muted-foreground")}>
                    {opt.icon}
                  </div>
                  <div>
                    <p className={cn("font-semibold text-sm", isSelected ? "text-primary-foreground" : "text-foreground")}>
                      {opt.label}
                    </p>
                    <p className={cn("text-xs", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                      {opt.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{getSubtypeLabel(channel, form.subtype)} Provider</span>
          <Badge variant="secondary" className="ml-auto text-xs">Cannot change type</Badge>
        </div>
      )}

      <Separator />

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5 col-span-2">
          <Label className="text-sm font-medium">Provider Name *</Label>
          <Input
            value={form.provider_name}
            onChange={(e) => onChange({ ...form, provider_name: e.target.value })}
            placeholder="e.g., Production Provider"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Display Name</Label>
          <Input
            value={form.display_name}
            onChange={(e) => onChange({ ...form, display_name: e.target.value })}
            placeholder="Friendly display name"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Description</Label>
          <Input
            value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })}
            placeholder="Optional notes"
          />
        </div>
      </div>

      <Separator />

      {/* Dynamic config fields */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">
          {getSubtypeLabel(channel, form.subtype)} Configuration
        </p>
        {fields.map((field) => {
          if (field.type === "boolean") {
            return (
              <div key={field.key} className="flex items-center justify-between rounded-lg border p-3">
                <Label className="text-sm">{field.label}</Label>
                <Switch
                  checked={!!form.config[field.key]}
                  onCheckedChange={(v) => setConfig(field.key, v)}
                />
              </div>
            );
          }
          const isSecret = !!field.secret;
          const effectiveType = isSecret && !showSecrets[field.key] ? "password" : field.type === "password" ? "text" : field.type;
          return (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-sm font-medium">
                {field.label} {field.required && <span className="text-destructive">*</span>}
              </Label>
              <div className="flex gap-2">
                <Input
                  type={effectiveType}
                  value={form.config[field.key] ?? ""}
                  onChange={(e) => setConfig(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="flex-1"
                />
                {isSecret && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleSecret(field.key)}
                    title={showSecrets[field.key] ? "Hide" : "Show"}
                  >
                    {showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Provider Card ──────────────────────────────────────────────────────────────
interface ProviderCardProps {
  channel: ChannelType;
  provider: ProviderRecord;
  onEdit: (p: ProviderRecord) => void;
  onDelete: (p: ProviderRecord) => void;
  onSetDefault: (p: ProviderRecord) => void;
  onTest: (p: ProviderRecord) => void;
  isTestingId: string | null;
  isSettingDefault: boolean;
}

function ProviderCard({ channel, provider, onEdit, onDelete, onSetDefault, onTest, isTestingId, isSettingDefault }: ProviderCardProps) {
  const subtype = channel === "email" ? (provider.email_provider_type || "smtp")
    : channel === "sms" ? (provider.sms_provider_type || "custom_gateway")
    : (provider.push_provider_type || "custom");
  const isTestingThis = isTestingId === provider.id;

  // Config summary key/values
  const summaryItems: { label: string; value: string; secret?: boolean }[] = [];
  const cfg = provider.config || {};

  if (channel === "email") {
    if (subtype === "smtp") {
      summaryItems.push({ label: "Host", value: `${cfg.smtp_host || "—"}:${cfg.smtp_port || "—"}` });
      summaryItems.push({ label: "Username", value: cfg.smtp_user || "—" });
      summaryItems.push({ label: "Password", value: maskSecret(cfg.smtp_password), secret: true });
    } else {
      summaryItems.push({ label: "API Key", value: maskSecret(cfg.api_key), secret: true });
    }
    summaryItems.push({ label: "From", value: cfg.from_email || "—" });
  } else if (channel === "sms") {
    if (subtype === "twilio") {
      summaryItems.push({ label: "Account SID", value: cfg.account_sid || "—" });
      summaryItems.push({ label: "Auth Token", value: maskSecret(cfg.auth_token), secret: true });
      summaryItems.push({ label: "From Number", value: cfg.from_number || "—" });
    } else if (subtype === "messagebird") {
      summaryItems.push({ label: "API Key", value: maskSecret(cfg.api_key), secret: true });
      summaryItems.push({ label: "Originator", value: cfg.originator || "—" });
    } else {
      summaryItems.push({ label: "API URL", value: cfg.api_url || "—" });
      summaryItems.push({ label: "API Key", value: maskSecret(cfg.api_key), secret: true });
    }
  } else {
    if (subtype === "fcm") {
      summaryItems.push({ label: "Project ID", value: cfg.project_id || "—" });
      summaryItems.push({ label: "Server Key", value: maskSecret(cfg.server_key), secret: true });
    } else if (subtype === "onesignal") {
      summaryItems.push({ label: "App ID", value: cfg.app_id || "—" });
      summaryItems.push({ label: "API Key", value: maskSecret(cfg.rest_api_key), secret: true });
    } else {
      summaryItems.push({ label: "API URL", value: cfg.api_url || "—" });
      summaryItems.push({ label: "API Key", value: maskSecret(cfg.api_key), secret: true });
    }
  }

  const channelIcon = channel === "email"
    ? (subtype === "smtp" ? <Server className="h-5 w-5" /> : <Zap className="h-5 w-5" />)
    : channel === "sms"
      ? <MessageSquare className="h-5 w-5" />
      : <Bell className="h-5 w-5" />;

  return (
    <Card className={cn(
      "relative transition-all",
      provider.is_default && "ring-2 ring-primary ring-offset-2"
    )}>
      {provider.is_default && (
        <div className="absolute -top-3 left-4">
          <Badge className="bg-primary text-primary-foreground gap-1 shadow-sm">
            <Star className="h-3 w-3 fill-current" /> Active Provider
          </Badge>
        </div>
      )}
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              {channelIcon}
            </div>
            <div>
              <CardTitle className="text-base">{provider.display_name || provider.provider_name}</CardTitle>
              <CardDescription className="text-xs">
                {provider.provider_name} · {getSubtypeLabel(channel, subtype)}
              </CardDescription>
            </div>
          </div>
          <Badge variant={provider.is_active ? "default" : "secondary"} className="shrink-0">
            {provider.is_active ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-sm">
          {summaryItems.map((item, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-muted-foreground">{item.label}</span>
              <span className={cn("font-mono text-xs", item.secret && "text-muted-foreground")}>{item.value}</span>
            </div>
          ))}
        </div>

        {provider.description && (
          <p className="text-xs text-muted-foreground">{provider.description}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {!provider.is_default && (
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
              onClick={() => onSetDefault(provider)} disabled={isSettingDefault}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Set as Active
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 text-xs"
            onClick={() => onTest(provider)} disabled={isTestingThis}>
            {isTestingThis
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <TestTube className="h-3.5 w-3.5" />}
            {isTestingThis ? "Testing…" : "Test"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onEdit(provider)}>
            <Edit className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost"
            className="gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(provider)}
            disabled={provider.is_default}
            title={provider.is_default ? "Cannot delete the active provider" : "Delete provider"}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Channel Provider Tab ───────────────────────────────────────────────────────
function ChannelProviderTab({ channel }: { channel: ChannelType }) {
  const queryClient = useQueryClient();
  const channelKey = `${channel}-providers`;
  const defaultSubtype = channel === "email" ? "smtp" : channel === "sms" ? "twilio" : "fcm";

  const EMPTY_FORM = {
    provider_name: "", display_name: "", description: "",
    subtype: defaultSubtype, config: {} as Record<string, any>,
  };

  const [showDialog, setShowDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testTargetProvider, setTestTargetProvider] = useState<ProviderRecord | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: [channelKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_providers")
        .select("*")
        .eq("channel", channel)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as ProviderRecord[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const errors = validateProvider(channel, form.subtype, form.config, form.provider_name);
      if (errors.length) throw Object.assign(new Error("Validation failed"), { validationErrors: errors });

      const subtypeField = channel === "email" ? "email_provider_type"
        : channel === "sms" ? "sms_provider_type" : "push_provider_type";

      const basePayload: any = {
        provider_name: form.provider_name.trim(),
        display_name: form.display_name.trim() || null,
        description: form.description.trim() || null,
        [subtypeField]: form.subtype,
        channel,
        config: form.config,
        updated_at: new Date().toISOString(),
      };

      if (editingProvider?.id) {
        const { error } = await supabase
          .from("notification_providers")
          .update(basePayload)
          .eq("id", editingProvider.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("notification_providers")
          .insert([{ ...basePayload, is_active: true }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelKey] });
      toast.success(editingProvider ? "Provider updated successfully" : "Provider added successfully");
      setShowDialog(false);
      setValidationErrors([]);
    },
    onError: (err: any) => {
      if (err.validationErrors) setValidationErrors(err.validationErrors);
      else toast.error(err.message || "Failed to save provider");
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (provider: ProviderRecord) => {
      const rpcName = channel === "email" ? "set_email_provider_default"
        : channel === "sms" ? "set_sms_provider_default" : "set_push_provider_default";
      const { error } = await supabase.rpc(rpcName as any, { provider_id: provider.id } as any);
      if (error) throw error;
    },
    onMutate: () => setIsSettingDefault(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelKey] });
      toast.success("Active provider updated");
      setIsSettingDefault(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to set active provider");
      setIsSettingDefault(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notification_providers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelKey] });
      toast.success("Provider deleted");
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete provider"),
  });

  /**
   * Provider test sends are NOT performed here.
   *
   * Omni-Comms governance: every real dispatch must pass the certified test
   * delivery boundary (`omni-comms-test-delivery`), which enforces sender
   * authorisation, recipient allowlists and the evidence ledger. Invoking a
   * campaign or notification function straight from this admin screen was an
   * ungoverned bypass, so it has been removed rather than re-pointed.
   */
  const testMutation = useMutation({
    mutationFn: async ({ provider, recipient }: { provider: ProviderRecord; recipient: string }) => {
      setTestingId(provider.id);
      return {
        success: false,
        error:
          `Test sends are governed by Omni-Comms. Open Omni-Comms → Channels → ${channel.toUpperCase()} ` +
          `Test Delivery to send to ${recipient} with sender authorisation, allowlist checks and an evidence record.`,
      };
    },
    onSuccess: (data) => {
      setTestingId(null);
      setShowTestDialog(false);
      toast.info("Send test deliveries from Omni-Comms", { description: data?.error });
    },
    onError: (err: any) => {
      setTestingId(null);
      toast.error(err.message || "Test failed");
    },
  });


  const handleOpenAdd = () => {
    setEditingProvider(null);
    setForm(EMPTY_FORM);
    setValidationErrors([]);
    setShowDialog(true);
  };

  const handleOpenEdit = (provider: ProviderRecord) => {
    const subtype = channel === "email" ? (provider.email_provider_type || "smtp")
      : channel === "sms" ? (provider.sms_provider_type || "custom_gateway")
      : (provider.push_provider_type || "custom");
    setEditingProvider(provider);
    setForm({
      provider_name: provider.provider_name,
      display_name: provider.display_name || "",
      description: provider.description || "",
      subtype,
      config: provider.config || {},
    });
    setValidationErrors([]);
    setShowDialog(true);
  };

  const handleOpenTest = (provider: ProviderRecord) => {
    setTestTargetProvider(provider);
    setTestRecipient("");
    setShowTestDialog(true);
  };

  const defaultProvider = providers.find(p => p.is_default);
  const channelLabel = channel === "email" ? "Email" : channel === "sms" ? "SMS" : "Push";
  const channelIcon = channel === "email" ? <Mail className="h-6 w-6 text-primary" />
    : channel === "sms" ? <MessageSquare className="h-6 w-6 text-primary" />
    : <Bell className="h-6 w-6 text-primary" />;

  const testPlaceholder = channel === "email" ? "test@example.com"
    : channel === "sms" ? "+1234567890" : "device-token-or-topic";
  const testLabel = channel === "email" ? "Recipient Email"
    : channel === "sms" ? "Recipient Phone Number" : "Device Token / Topic";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            {channelIcon} {channelLabel} Providers
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure {channelLabel} providers. One provider is designated as <strong>Active</strong> and used for all dispatches.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Provider
        </Button>
      </div>

      {defaultProvider ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Active Provider: </span>
            <span>{defaultProvider.display_name || defaultProvider.provider_name}</span>
          </div>
        </div>
      ) : providers.length > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive font-medium">
            No active provider selected. {channelLabel} dispatch is disabled.
          </p>
        </div>
      ) : null}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && providers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              {channelIcon}
            </div>
            <div>
              <p className="font-semibold">No {channelLabel} providers configured</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a {channelLabel} provider to enable outgoing {channelLabel.toLowerCase()} notifications.
              </p>
            </div>
            <Button onClick={handleOpenAdd} className="mt-2 gap-2">
              <Plus className="h-4 w-4" /> Add Your First Provider
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && providers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {providers.map(p => (
            <ProviderCard
              key={p.id}
              channel={channel}
              provider={p}
              onEdit={handleOpenEdit}
              onDelete={setDeleteTarget}
              onSetDefault={(prov) => setDefaultMutation.mutate(prov)}
              onTest={handleOpenTest}
              isTestingId={testingId}
              isSettingDefault={isSettingDefault}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) setValidationErrors([]); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingProvider
                ? <><Edit className="h-4 w-4" /> Edit Provider</>
                : <><Plus className="h-4 w-4" /> Add {channelLabel} Provider</>}
            </DialogTitle>
          </DialogHeader>
          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive mb-1">
                Please fix {validationErrors.length} error{validationErrors.length > 1 ? "s" : ""} before saving:
              </p>
              <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <GenericProviderForm
            channel={channel}
            form={form}
            onChange={(f) => { setForm(f); setValidationErrors([]); }}
            isEditing={!!editingProvider}
          />
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editingProvider ? "Update Provider" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TestTube className="h-4 w-4" /> Send Test {channelLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Send a test {channelLabel.toLowerCase()} via <strong>{testTargetProvider?.display_name || testTargetProvider?.provider_name}</strong>.
            </p>
            <div className="space-y-1.5">
              <Label>{testLabel} *</Label>
              <Input
                placeholder={testPlaceholder}
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!testRecipient.trim()) { toast.error("Please enter a recipient"); return; }
                if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient)) {
                  toast.error("Please enter a valid email address"); return;
                }
                if (testTargetProvider) {
                  testMutation.mutate({ provider: testTargetProvider, recipient: testRecipient });
                }
              }}
              disabled={testMutation.isPending}>
              {testMutation.isPending ? <><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> Sending…</> : "Send Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.display_name || deleteTarget?.provider_name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Notification Types Management Tab ──────────────────────────────────────────
function NotificationTypesTab() {
  const { data: types = [], isLoading } = useNotificationTypes();
  const createMutation = useCreateNotificationType();
  const updateMutation = useUpdateNotificationType();
  const toggleMutation = useToggleNotificationType();

  const [showDialog, setShowDialog] = useState(false);
  const [editingType, setEditingType] = useState<NotificationType | null>(null);
  const [form, setForm] = useState<NotificationTypeFormData>({
    code: "", display_name: "", description: "", icon: "", display_order: 0, is_active: true,
  });

  const handleOpenAdd = () => {
    setEditingType(null);
    setForm({ code: "", display_name: "", description: "", icon: "", display_order: types.length + 1, is_active: true });
    setShowDialog(true);
  };

  const handleOpenEdit = (nt: NotificationType) => {
    setEditingType(nt);
    setForm({
      code: nt.code,
      display_name: nt.display_name,
      description: nt.description || "",
      icon: nt.icon || "",
      display_order: nt.display_order,
      is_active: nt.is_active,
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.code.trim() || !form.display_name.trim()) {
      toast.error("Code and Display Name are required");
      return;
    }
    if (editingType) {
      updateMutation.mutate({ id: editingType.id, form }, { onSuccess: () => setShowDialog(false) });
    } else {
      createMutation.mutate(form, { onSuccess: () => setShowDialog(false) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-primary" /> Notification Types
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage notification types available across the system. Active types appear in workflow and template dropdowns.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Type
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : types.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="font-semibold">No notification types configured</p>
            <Button onClick={handleOpenAdd} className="mt-2 gap-2">
              <Plus className="h-4 w-4" /> Add First Type
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table sticky>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Order</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((nt) => (
                <TableRow key={nt.id}>
                  <TableCell className="font-mono text-sm">{nt.code}</TableCell>
                  <TableCell className="font-medium">{nt.display_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{nt.description || "—"}</TableCell>
                  <TableCell className="text-center">{nt.display_order}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={nt.is_active}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: nt.id, is_active: checked })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => handleOpenEdit(nt)}>
                      <Edit className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingType ? "Edit Notification Type" : "Add Notification Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g., Email, SMS, Push"
                disabled={!!editingType}
              />
              {editingType && <p className="text-xs text-muted-foreground">Code cannot be changed after creation</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Display Name *</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="e.g., Email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Display Order</Label>
                <Input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) ? "Saving…" : editingType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
const ProviderSettings = () => {
  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notification Providers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure providers for each notification channel and manage notification types.
        </p>
      </div>

      <Tabs defaultValue="email" className="w-full">
        <TabsList>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="h-4 w-4" /> Email Providers
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-1.5">
            <MessageSquare className="h-4 w-4" /> SMS Providers
          </TabsTrigger>
          <TabsTrigger value="push" className="gap-1.5">
            <Bell className="h-4 w-4" /> Push Providers
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-1.5">
            <Settings2 className="h-4 w-4" /> Notification Types
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <ChannelProviderTab channel="email" />
        </TabsContent>
        <TabsContent value="sms">
          <ChannelProviderTab channel="sms" />
        </TabsContent>
        <TabsContent value="push">
          <ChannelProviderTab channel="push" />
        </TabsContent>
        <TabsContent value="types">
          <NotificationTypesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProviderSettings;
