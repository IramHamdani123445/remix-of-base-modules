/**
 * Omni-Comms Accelerated Build 2 — email channel configuration workspace.
 *
 * Read/write surface for the Resend email provider setup, provider accounts,
 * sender identities, bindings, and channel settings. All mutations go through
 * SECURITY DEFINER RPCs via the bound Omni-Comms RPC client. No provider SDK
 * imports, no direct table writes, no send behaviour.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OMNI_COMMS_CHANNEL_TABS,
  useOmniCommsTabParam,
} from "../hooks/useOmniCommsTabParam";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import { OmniCommsTenantSelector } from "../components/OmniCommsTenantSelector";
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";
import {
  activateBinding,
  activateEmailProvider,
  activateProviderAccount,
  activateSenderIdentity,
  ensureEmailProvider,
  getEmailConfigSummary,
  recordBindingVerification,
  recordProviderAccountCredentialCheck,
  upsertBindingDraft,
  upsertEmailChannelSetting,
  upsertProviderAccountDraft,
  upsertSenderIdentityDraft,
} from "@/platform/omni-comms/application/channelManagementService";
import type {
  EmailConfigSummary,
  ProviderAccountRow,
  SenderIdentityRow,
} from "@/platform/omni-comms/application/channelManagementTypes";
import { OmniCommsRpcError } from "@/platform/omni-comms/application/omniCommsRpcErrors";
import {
  PROVIDER_VERIFICATION_MESSAGES,
  verifyProviderCredentials,
} from "@/platform/omni-comms/application/providerVerificationService";


function toastError(err: unknown, fallback: string): void {
  if (err instanceof OmniCommsRpcError) {
    toast.error(`${err.code} ${err.detail ?? fallback}`);
  } else {
    toast.error(err instanceof Error ? err.message : fallback);
  }
}

export const OmniCommsChannelsPage: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const { organizationId: orgId, organizationName } = useOmniCommsTenant();
  const [summary, setSummary] = useState<EmailConfigSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const s = await getEmailConfigSummary(client, orgId);
      setSummary(s);
    } catch (e) {
      toastError(e, "Failed to load email configuration");
    } finally {
      setLoading(false);
    }
  }, [client, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL-controlled: ?tab=providers|accounts|senders|bindings|settings
  const [channelTab, setChannelTab] = useOmniCommsTabParam(
    OMNI_COMMS_CHANNEL_TABS,
    "providers",
  );

  if (!orgId) {
    return (
      <div className="space-y-4" data-testid="omni-comms-channels-page">
        <h1 className="text-2xl font-semibold">Channels — Email</h1>
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Select an organisation</AlertTitle>
          <AlertDescription>
            Email channel configuration is scoped to a specific organisation.
            Choose one below to load the email configuration summary.
          </AlertDescription>
        </Alert>
        <OmniCommsTenantSelector showDepartment={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="omni-comms-channels-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">
            Channels — {channelDescriptor.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Omnichannel Communications · {channelDescriptor.description}
            {organizationName ? ` · ${organizationName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isEmailChannel && <ReadinessBadge summary={summary} />}
          {isEmailChannel && (
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          )}
        </div>
      </div>

      <OmniCommsTenantSelector showDepartment={false} />

      <OmniCommsChannelSelector value={channel} onChange={setChannel} />

      {!isEmailChannel && (
        <OmniCommsChannelTabShell descriptor={channelDescriptor} />
      )}

      {isEmailChannel && (


      <Tabs value={channelTab} onValueChange={setChannelTab} className="w-full">
        <TabsList>
          <TabsTrigger value="providers">Provider</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="senders">Senders</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          <ProviderTab client={client} summary={summary} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsTab client={client} orgId={orgId} summary={summary} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="senders">
          <SendersTab client={client} orgId={orgId} summary={summary} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="bindings">
          <BindingsTab client={client} summary={summary} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab client={client} orgId={orgId} summary={summary} onChanged={refresh} />
        </TabsContent>
      </Tabs>
      )}
    </div>

  );
};

// ─── Readiness pill ─────────────────────────────────────────────────
const ReadinessBadge: React.FC<{ summary: EmailConfigSummary | null }> = ({ summary }) => {
  if (!summary) return <Badge variant="secondary">Loading…</Badge>;
  if (summary.email_send_ready) {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Email send ready
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <AlertCircle className="h-3 w-3 mr-1" /> Not ready
    </Badge>
  );
};

// ─── Provider tab ───────────────────────────────────────────────────
const ProviderTab: React.FC<{
  client: ReturnType<typeof useOmniCommsRpcClient>;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, summary, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const provider = summary?.provider ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resend email provider</CardTitle>
        <CardDescription>
          The Resend adapter is the sole email provider in Build 2. Register once, then activate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          {provider ? (
            <>
              <div>Code: <code>{provider.code}</code></div>
              <div>Status: <Badge>{provider.status}</Badge></div>
            </>
          ) : (
            <div className="text-muted-foreground">Provider not yet registered.</div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await ensureEmailProvider(client);
                toast.success("Resend email provider registered");
                await onChanged();
              } catch (e) { toastError(e, "Register failed"); }
              finally { setBusy(false); }
            }}
          >
            Register provider
          </Button>
          <Button
            disabled={busy || !provider || provider.status !== "draft"}
            onClick={async () => {
              if (!provider) return;
              setBusy(true);
              try {
                await activateEmailProvider(client, provider.id, provider.updated_at);
                toast.success("Provider activated");
                await onChanged();
              } catch (e) { toastError(e, "Activate failed"); }
              finally { setBusy(false); }
            }}
          >
            Activate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Accounts tab ───────────────────────────────────────────────────
const AccountsTab: React.FC<{
  client: ReturnType<typeof useOmniCommsRpcClient>;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const [form, setForm] = useState({
    code: "", displayName: "", secretRef: "", region: "", sandboxMode: false,
  });
  const [busy, setBusy] = useState(false);
  const accounts = summary?.provider_accounts ?? [];

  const create = async () => {
    setBusy(true);
    try {
      await upsertProviderAccountDraft(client, {
        organizationId: orgId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        secretRef: form.secretRef.trim(),
        region: form.region.trim() || null,
        sandboxMode: form.sandboxMode,
      });
      toast.success("Draft account created");
      setForm({ code: "", displayName: "", secretRef: "", region: "", sandboxMode: false });
      await onChanged();
    } catch (e) { toastError(e, "Create failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New provider account (draft)</CardTitle>
          <CardDescription>
            Secret is a reference, not a raw key. Only Resend references are accepted and
            must match <code>^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$</code>
            (for example <code>OMNI_COMMS_RESEND_PRIMARY</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          <Field label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
          <Field label="Secret ref" value={form.secretRef} onChange={(v) => setForm({ ...form, secretRef: v })}
            placeholder="OMNI_COMMS_RESEND_PRIMARY" />
          <Field label="Region" value={form.region} onChange={(v) => setForm({ ...form, region: v })}
            placeholder="eu-west-1" />
          <div className="flex items-center gap-2 col-span-2">
            <Switch checked={form.sandboxMode} onCheckedChange={(v) => setForm({ ...form, sandboxMode: v })} />
            <Label>Sandbox mode</Label>
          </div>
          <div className="col-span-2">
            <Button disabled={busy} onClick={create}>Create draft account</Button>
          </div>
        </CardContent>
      </Card>

      <ResendAccountSection orgId={orgId} accounts={accounts} onChanged={onChanged} />

      <Card>
        <CardHeader><CardTitle>Provider accounts</CardTitle></CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead>
                  <TableHead>Region</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <AccountRow key={a.id} account={a} client={client} onChanged={onChanged} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Resend Account (Step 1) ────────────────────────────────────────
// Provider-account configuration state + server-side credential verification.
// The API key itself is never requested, displayed, returned or logged; only
// the bounded secret REFERENCE name is shown.
const ResendAccountSection: React.FC<{
  orgId: string;
  accounts: ProviderAccountRow[];
  onChanged: () => Promise<void> | void;
}> = ({ orgId, accounts, onChanged }) => {
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const verify = async (account: ProviderAccountRow) => {
    setVerifyingId(account.id);
    setLastMessage(null);
    try {
      const res = await verifyProviderCredentials({
        organizationId: orgId,
        providerAccountId: account.id,
      });
      const message =
        PROVIDER_VERIFICATION_MESSAGES[res.code] ??
        "Verification could not be completed.";
      setLastMessage(message);
      if (res.ok) toast.success(message); else toast.error(message);
      await onChanged();
    } catch {
      const message = PROVIDER_VERIFICATION_MESSAGES.provider_unavailable;
      setLastMessage(message);
      toast.error(message);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <Card data-testid="omni-comms-resend-account-section">
      <CardHeader>
        <CardTitle>Resend Account</CardTitle>
        <CardDescription>
          Configuration and credential verification only. The API key lives in
          Edge Function secrets and is never shown here or sent to the browser.
          Verification contacts Resend with a read-only check and sends no email.
          Only secret references matching <code>^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$</code>
          can be resolved. Manual health evidence is not authoritative and never
          makes this account ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Resend account configured yet. Create a draft account below.
          </p>
        ) : (
          accounts.map((a) => (
            <div key={a.id} className="rounded-md border p-4 space-y-3"
              data-testid={`omni-comms-resend-account-${a.code}`}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <Detail label="Account name" value={a.display_name} />
                <Detail label="Provider code" value="resend" />
                <Detail label="Environment" value={a.sandbox_mode ? "sandbox" : "standard"} />
                <Detail label="Secret reference" value={a.secret_ref} mono />
                <Detail label="Account status" value={a.status} />
                <Detail
                  label="Verification status"
                  value={a.verification_status ?? "unverified"}
                />
                <Detail
                  label="Last verified"
                  value={a.verification_checked_at
                    ? new Date(a.verification_checked_at).toLocaleString()
                    : "Never"}
                />
                <Detail
                  label="Verification message"
                  value={a.verification_detail ?? "—"}
                />
                <Detail label="Updated" value={new Date(a.updated_at).toLocaleString()} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={verifyingId === a.id}
                  onClick={() => void verify(a)}
                  data-testid={`omni-comms-verify-credentials-${a.code}`}>
                  {verifyingId === a.id
                    ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying…</>)
                    : "Verify credentials"}
                </Button>
                <Button size="sm" variant="outline" disabled={verifyingId === a.id}
                  onClick={() => void onChanged()}>
                  <RefreshCcw className="h-4 w-4 mr-2" />Refresh
                </Button>
                {a.verification_status === "verified" ? (
                  <Badge variant="outline" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Provider verified
                  </Badge>
                ) : a.verification_status === "failed" ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" /> Verification failed
                  </Badge>
                ) : null}
              </div>
              {lastMessage && verifyingId === null ? (
                <p className="text-sm text-muted-foreground">{lastMessage}</p>
              ) : null}
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Live delivery remains unavailable. Verification never sends an email
          and creates no delivery attempt or dispatch job.
        </p>
      </CardContent>
    </Card>
  );
};

const Detail: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label, value, mono,
}) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={mono ? "font-mono text-sm break-all" : "text-sm"}>{value}</p>
  </div>
);

const AccountRow: React.FC<{
  account: ProviderAccountRow;
  client: ReturnType<typeof useOmniCommsRpcClient>;
  onChanged: () => Promise<void> | void;
}> = ({ account, client, onChanged }) => {
  const [busy, setBusy] = useState(false);

  const recordCheck = async (result: "healthy" | "degraded" | "failed") => {
    setBusy(true);
    try {
      await recordProviderAccountCredentialCheck(client, account.id, account.updated_at, result);
      toast.success(`Manual configuration evidence recorded: ${result}`);
      await onChanged();
    } catch (e) { toastError(e, "Credential check failed"); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true);
    try {
      await activateProviderAccount(client, account.id, account.updated_at);
      toast.success("Account activated");
      await onChanged();
    } catch (e) { toastError(e, "Activate failed"); }
    finally { setBusy(false); }
  };

  return (
    <TableRow>
      <TableCell><code>{account.code}</code></TableCell>
      <TableCell><Badge>{account.status}</Badge></TableCell>
      <TableCell><Badge variant="outline">{account.health_state}</Badge></TableCell>
      <TableCell>{account.region ?? "—"}</TableCell>
      <TableCell className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => recordCheck("healthy")}
          title="Manual configuration evidence — not provider verified">
          Manual evidence: healthy — not provider verified
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => recordCheck("failed")}
          title="Manual configuration evidence — not provider verified">
          Manual evidence: failed — not provider verified
        </Button>
        <Button size="sm"
          disabled={busy || account.status !== "draft" || account.verification_status !== "verified"}
          title={account.verification_status !== "verified"
            ? "Verified Resend credentials are required before activation"
            : undefined}
          onClick={activate}>Activate</Button>
      </TableCell>
    </TableRow>
  );
};


// ─── Senders tab ────────────────────────────────────────────────────
const SendersTab: React.FC<{
  client: ReturnType<typeof useOmniCommsRpcClient>;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const [form, setForm] = useState({
    code: "", displayName: "", fromAddress: "", fromName: "", replyTo: "",
  });
  const [busy, setBusy] = useState(false);
  const senders = summary?.sender_identities ?? [];

  const create = async () => {
    setBusy(true);
    try {
      await upsertSenderIdentityDraft(client, {
        organizationId: orgId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        fromAddress: form.fromAddress.trim(),
        fromName: form.fromName.trim() || null,
        replyToAddress: form.replyTo.trim() || null,
      });
      toast.success("Draft sender identity created");
      setForm({ code: "", displayName: "", fromAddress: "", fromName: "", replyTo: "" });
      await onChanged();
    } catch (e) { toastError(e, "Create failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New sender identity (email)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          <Field label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
          <Field label="From address" value={form.fromAddress} onChange={(v) => setForm({ ...form, fromAddress: v })}
            placeholder="noreply@your-domain.gov" />
          <Field label="From name" value={form.fromName} onChange={(v) => setForm({ ...form, fromName: v })} />
          <Field label="Reply-to" value={form.replyTo} onChange={(v) => setForm({ ...form, replyTo: v })} />
          <div className="col-span-2">
            <Button disabled={busy} onClick={create}>Create draft sender</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Sender identities</CardTitle></CardHeader>
        <CardContent>
          {senders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No senders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>From</TableHead>
                  <TableHead>Status</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {senders.map((s) => (
                  <SenderRow key={s.id} sender={s} client={client} onChanged={onChanged} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const SenderRow: React.FC<{
  sender: SenderIdentityRow;
  client: ReturnType<typeof useOmniCommsRpcClient>;
  onChanged: () => Promise<void> | void;
}> = ({ sender, client, onChanged }) => {
  const [busy, setBusy] = useState(false);
  return (
    <TableRow>
      <TableCell><code>{sender.code}</code></TableCell>
      <TableCell>{sender.from_address}</TableCell>
      <TableCell><Badge>{sender.status}</Badge></TableCell>
      <TableCell>
        <Button
          size="sm"
          disabled={busy || sender.status !== "draft"}
          onClick={async () => {
            setBusy(true);
            try {
              await activateSenderIdentity(client, sender.id, sender.updated_at);
              toast.success("Sender activated");
              await onChanged();
            } catch (e) { toastError(e, "Activate failed"); }
            finally { setBusy(false); }
          }}
        >
          Activate
        </Button>
      </TableCell>
    </TableRow>
  );
};

// ─── Bindings tab ───────────────────────────────────────────────────
const BindingsTab: React.FC<{
  client: ReturnType<typeof useOmniCommsRpcClient>;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, summary, onChanged }) => {
  const [form, setForm] = useState({
    senderId: "", accountId: "", priority: "100", externalRef: "",
  });
  const [busy, setBusy] = useState(false);
  const bindings = summary?.bindings ?? [];
  const senders = summary?.sender_identities ?? [];
  const accounts = summary?.provider_accounts ?? [];

  const create = async () => {
    setBusy(true);
    try {
      const priority = Number.parseInt(form.priority, 10);
      await upsertBindingDraft(client, {
        senderIdentityId: form.senderId,
        providerAccountId: form.accountId,
        priority: Number.isFinite(priority) ? priority : 100,
        externalSenderRef: form.externalRef.trim() || null,
      });
      toast.success("Draft binding created");
      setForm({ senderId: "", accountId: "", priority: "100", externalRef: "" });
      await onChanged();
    } catch (e) { toastError(e, "Create failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bind sender to provider account</CardTitle>
          <CardDescription>
            A binding must be verified before it can be activated. Verification is recorded here
            for Build 2; a later build wires real Resend domain checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField label="Sender identity" value={form.senderId}
            onChange={(v) => setForm({ ...form, senderId: v })}
            options={senders.map((s) => ({ value: s.id, label: `${s.code} — ${s.from_address ?? ""}` }))} />
          <SelectField label="Provider account" value={form.accountId}
            onChange={(v) => setForm({ ...form, accountId: v })}
            options={accounts.map((a) => ({ value: a.id, label: `${a.code} (${a.status})` }))} />
          <Field label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
          <Field label="External sender ref" value={form.externalRef}
            onChange={(v) => setForm({ ...form, externalRef: v })} placeholder="Resend domain id" />
          <div className="col-span-2">
            <Button disabled={busy || !form.senderId || !form.accountId} onClick={create}>Create draft</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bindings</CardTitle></CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bindings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead><TableHead>Verification</TableHead>
                  <TableHead>Status</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bindings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.priority}</TableCell>
                    <TableCell><Badge variant="outline">{b.verification_status}</Badge></TableCell>
                    <TableCell><Badge>{b.status}</Badge></TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline"
                        onClick={async () => {
                          try {
                            await recordBindingVerification(client, b.id, b.updated_at, "verified");
                            toast.success("Verification recorded: verified");
                            await onChanged();
                          } catch (e) { toastError(e, "Record failed"); }
                        }}
                      >Mark verified</Button>
                      <Button size="sm" variant="outline"
                        onClick={async () => {
                          try {
                            await recordBindingVerification(client, b.id, b.updated_at, "failed");
                            toast.success("Verification recorded: failed");
                            await onChanged();
                          } catch (e) { toastError(e, "Record failed"); }
                        }}
                      >Mark failed</Button>
                      <Button size="sm" disabled={b.status !== "draft" || b.verification_status !== "verified"}
                        onClick={async () => {
                          try {
                            await activateBinding(client, b.id, b.updated_at);
                            toast.success("Binding activated");
                            await onChanged();
                          } catch (e) { toastError(e, "Activate failed"); }
                        }}
                      >Activate</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Settings tab ───────────────────────────────────────────────────
const SettingsTab: React.FC<{
  client: ReturnType<typeof useOmniCommsRpcClient>;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const existing = summary?.channel_setting ?? null;
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [live, setLive] = useState(existing?.live_delivery_enabled ?? false);
  const [rate, setRate] = useState<string>(existing?.per_minute_limit?.toString() ?? "");
  const [quietStart, setQuietStart] = useState<string>(existing?.quiet_hours_start ?? "");
  const [quietEnd, setQuietEnd] = useState<string>(existing?.quiet_hours_end ?? "");
  const [tz, setTz] = useState<string>(existing?.quiet_hours_timezone ?? "America/St_Kitts");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(existing?.enabled ?? false);
    setLive(existing?.live_delivery_enabled ?? false);
    setRate(existing?.per_minute_limit?.toString() ?? "");
    setQuietStart(existing?.quiet_hours_start ?? "");
    setQuietEnd(existing?.quiet_hours_end ?? "");
    setTz(existing?.quiet_hours_timezone ?? "America/St_Kitts");
  }, [existing?.id, existing]);

  const save = async () => {
    setBusy(true);
    try {
      const parsedRate = rate.trim() === "" ? null : Number.parseInt(rate, 10);
      await upsertEmailChannelSetting(client, {
        id: existing?.id ?? null,
        expectedUpdatedAt: existing?.updated_at ?? null,
        organizationId: orgId,
        departmentId: null,
        enabled,
        liveDeliveryEnabled: live,
        quietHoursStart: quietStart || null,
        quietHoursEnd: quietEnd || null,
        quietHoursTimezone: quietStart ? tz : null,
        perMinuteLimit: parsedRate && Number.isFinite(parsedRate) ? parsedRate : null,
      });
      toast.success("Email channel settings saved");
      await onChanged();
    } catch (e) { toastError(e, "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Email channel settings (organisation)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label>Channel enabled</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={live} onCheckedChange={setLive} disabled={!enabled} />
          <Label>Live delivery enabled</Label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Per-minute limit" value={rate} onChange={setRate} placeholder="e.g. 120" />
          <Field label="Timezone" value={tz} onChange={setTz} />
          <Field label="Quiet hours start (HH:MM)" value={quietStart} onChange={setQuietStart} />
          <Field label="Quiet hours end (HH:MM)" value={quietEnd} onChange={setQuietEnd} />
        </div>
        <Button disabled={busy} onClick={save}>Save settings</Button>
      </CardContent>
    </Card>
  );
};

// ─── Tiny form primitives ───────────────────────────────────────────
const Field: React.FC<{
  label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

const SelectField: React.FC<{
  label: string; value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <select
      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— select —</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

export default OmniCommsChannelsPage;
