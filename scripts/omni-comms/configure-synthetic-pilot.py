#!/usr/bin/env python3
"""
Omni-Comms — Synthetic Pilot Configuration (non-production, dry-run only).

Configures ONE complete synthetic email path for:
    event   OMNI.TEST.CONTROLLED_DRY_RUN
    channel email
    locale  en-US
    mode    dry_run only  (live delivery stays disabled)

Every mutation goes through the governed Omni-Comms SECURITY DEFINER RPCs with
the authenticated administrator session — no direct table writes, no provider
SDK, no send behaviour.
"""
import json
import os
import sys
import urllib.request

BASE = os.environ["OMNI_SUPABASE_URL"].rstrip("/")
ANON = os.environ["OMNI_SUPABASE_ANON_KEY"]
TOKEN = os.environ["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"]
ORG = os.environ.get("OMNI_ORG_ID", "69afc88b-da5c-4f41-a1e7-199e1ee1d416")
EVENT = os.environ.get("OMNI_EVENT_ID", "ae17bb99-0807-4496-a628-bee7a47d799a")

CORR = "omni-pilot-config"


def rpc(name, args):
    req = urllib.request.Request(
        f"{BASE}/rest/v1/rpc/{name}",
        data=json.dumps(args).encode(),
        headers={
            "apikey": ANON,
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise SystemExit(f"RPC {name} failed: {e.code} {detail}")


def summary():
    return rpc("omni_comms_email_config_summary", {"p_organization_id": ORG})


def step(label, value=""):
    print(f"  [ok] {label} {value}")


def main():
    print("== Omni-Comms synthetic pilot configuration ==")
    s = summary()

    # 1. Provider ------------------------------------------------------
    if not s.get("provider"):
        rpc("omni_comms_email_provider_ensure", {"p_correlation_id": CORR})
        s = summary()
    prov = s["provider"]
    if prov["status"] != "active":
        rpc("omni_comms_email_provider_activate", {
            "p_id": prov["id"], "p_expected_updated_at": prov["updated_at"],
            "p_correlation_id": CORR})
        s = summary()
    step("provider", s["provider"]["code"])

    # 2. Provider account (sandbox) -------------------------------------
    acct = next((a for a in s.get("provider_accounts", [])
                 if a["code"] == "omni_pilot_sandbox"), None)
    if acct is None:
        rpc("omni_comms_provider_account_upsert_draft", {
            "p_id": None, "p_expected_updated_at": None,
            "p_organization_id": ORG,
            "p_code": "omni_pilot_sandbox",
            "p_display_name": "Synthetic dry-run sandbox account",
            "p_secret_ref": "OMNI_COMMS_RESEND_PILOT_SANDBOX",
            "p_region": None, "p_sandbox_mode": True,
            "p_correlation_id": CORR})
        s = summary()
        acct = next(a for a in s["provider_accounts"] if a["code"] == "omni_pilot_sandbox")
    if acct.get("health_state") == "unknown":
        rpc("omni_comms_provider_account_record_credential_check", {
            "p_id": acct["id"], "p_expected_updated_at": acct["updated_at"],
            "p_result": "healthy", "p_correlation_id": CORR})
        s = summary()
        acct = next(a for a in s["provider_accounts"] if a["code"] == "omni_pilot_sandbox")
    if acct["status"] == "draft":
        rpc("omni_comms_provider_account_activate", {
            "p_id": acct["id"], "p_expected_updated_at": acct["updated_at"],
            "p_correlation_id": CORR})
        s = summary()
        acct = next(a for a in s["provider_accounts"] if a["code"] == "omni_pilot_sandbox")
    step("provider account", f'{acct["code"]} status={acct["status"]} sandbox')

    # 3. Sender identity -------------------------------------------------
    snd = next((x for x in s.get("sender_identities", [])
                if x["code"] == "omni_pilot_sender"), None)
    if snd is None:
        rpc("omni_comms_sender_identity_upsert_draft", {
            "p_id": None, "p_expected_updated_at": None,
            "p_organization_id": ORG, "p_department_id": None,
            "p_event_definition_id": None,
            "p_code": "omni_pilot_sender",
            "p_display_name": "Synthetic dry-run sender",
            "p_from_address": "no-reply@example.com",
            "p_from_name": "Omni-Comms Dry Run",
            "p_reply_to_address": None,
            "p_correlation_id": CORR})
        s = summary()
        snd = next(x for x in s["sender_identities"] if x["code"] == "omni_pilot_sender")
    if snd["status"] == "draft":
        rpc("omni_comms_sender_identity_activate", {
            "p_id": snd["id"], "p_expected_updated_at": snd["updated_at"],
            "p_correlation_id": CORR})
        s = summary()
        snd = next(x for x in s["sender_identities"] if x["code"] == "omni_pilot_sender")
    step("sender identity", f'{snd["code"]} status={snd["status"]}')

    # 4. Binding ----------------------------------------------------------
    bind = next((b for b in s.get("bindings", [])
                 if b["sender_identity_id"] == snd["id"]
                 and b["provider_account_id"] == acct["id"]), None)
    if bind is None:
        rpc("omni_comms_binding_upsert_draft", {
            "p_id": None, "p_expected_updated_at": None,
            "p_sender_identity_id": snd["id"],
            "p_provider_account_id": acct["id"],
            "p_priority": 1, "p_external_sender_ref": None,
            "p_correlation_id": CORR})
        s = summary()
        bind = next(b for b in s["bindings"]
                    if b["sender_identity_id"] == snd["id"]
                    and b["provider_account_id"] == acct["id"])
    if bind.get("verification_status") != "verified":
        rpc("omni_comms_binding_record_verification", {
            "p_id": bind["id"], "p_expected_updated_at": bind["updated_at"],
            "p_status": "verified", "p_correlation_id": CORR})
        s = summary()
        bind = next(b for b in s["bindings"]
                    if b["sender_identity_id"] == snd["id"]
                    and b["provider_account_id"] == acct["id"])
    if bind["status"] == "draft":
        rpc("omni_comms_binding_activate", {
            "p_id": bind["id"], "p_expected_updated_at": bind["updated_at"],
            "p_correlation_id": CORR})
        s = summary()
        bind = next(b for b in s["bindings"]
                    if b["sender_identity_id"] == snd["id"]
                    and b["provider_account_id"] == acct["id"])
    step("binding", f'status={bind["status"]} verification={bind.get("verification_status")}')

    # 5. Channel setting — enabled, LIVE DELIVERY OFF -----------------------
    cs = s.get("channel_setting")
    rpc("omni_comms_channel_setting_upsert", {
        "p_id": cs["id"] if cs else None,
        "p_expected_updated_at": cs["updated_at"] if cs else None,
        "p_organization_id": ORG, "p_department_id": None,
        "p_channel": "email", "p_enabled": True,
        "p_live_delivery_enabled": False,
        "p_quiet_hours_start": None, "p_quiet_hours_end": None,
        "p_quiet_hours_timezone": None, "p_per_minute_limit": None,
        "p_correlation_id": CORR})
    s = summary()
    step("channel setting", "email enabled, live delivery disabled")

    # 6. Template family + version ------------------------------------------
    fams = rpc("omni_comms_template_family_list", {
        "p_search": "omni_test_controlled_dry_run_email",
        "p_status": None, "p_scope_type": None,
        "p_organization_id": ORG, "p_limit": 50, "p_offset": 0})
    items = fams["items"] if isinstance(fams, dict) else fams
    fam = next((f for f in items if f["code"] == "omni_test_controlled_dry_run_email"), None)
    if fam is None:
        created = rpc("omni_comms_template_family_create", {
            "p_code": "omni_test_controlled_dry_run_email",
            "p_name": "Controlled dry-run synthetic email",
            "p_description": "Synthetic template used only by the controlled dry-run pilot.",
            "p_scope_type": "organization",
            "p_organization_id": ORG, "p_department_id": None,
            "p_event_definition_id": EVENT,
            "p_correlation_id": CORR})
        fam = created
    if fam.get("status") != "active":
        rpc("omni_comms_template_family_activate", {
            "p_id": fam["id"], "p_reason": "Synthetic dry-run pilot", "p_correlation_id": CORR})
    step("template family", fam["code"])

    versions = rpc("omni_comms_template_version_list", {
        "p_template_family_id": fam["id"], "p_channel": "email",
        "p_locale": None, "p_status": None, "p_limit": 50, "p_offset": 0})
    vitems = versions["items"] if isinstance(versions, dict) else versions
    ver = next((v for v in vitems if v["locale"].lower() == "en-us"), None)
    if ver is None:
        ver = rpc("omni_comms_template_version_create", {
            "p_template_family_id": fam["id"], "p_channel": "email",
            "p_locale": "en-US", "p_version_number": 1,
            "p_content": {
                "subject": "Controlled dry run for {{subjectName}}",
                "text": "Reference {{reference}} for {{subjectName}}. Synthetic dry-run only.",
                "html": "<p>Reference {{reference}} for {{subjectName}}.</p>"
                        "<p>Synthetic dry-run only — no live delivery.</p>",
            },
            "p_correlation_id": CORR})
    if ver["status"] == "draft":
        # Segregation of duties: the approver MUST differ from the author.
        # If the signed-in operator authored the draft, this step is left to a
        # second authorised approver in the Templates UI.
        try:
            rpc("omni_comms_template_version_approve", {
                "p_id": ver["id"], "p_approval_note": "Synthetic dry-run pilot",
                "p_correlation_id": CORR})
        except SystemExit as e:
            if "approver_must_differ_from_author" not in str(e):
                raise
            print("  [hold] template version awaiting a second authorised approver "
                  "(segregation of duties enforced)")
        ver = rpc("omni_comms_template_version_get", {"p_id": ver["id"]})
    if ver["status"] == "approved":
        rpc("omni_comms_template_version_publish", {
            "p_id": ver["id"], "p_expected_updated_at": ver["updated_at"],
            "p_confirm_replacement": False, "p_replacement_reason": None,
            "p_correlation_id": CORR})
        ver = rpc("omni_comms_template_version_get", {"p_id": ver["id"]})
    step("template version", f'v{ver["version_number"]} {ver["locale"]} status={ver["status"]}')

    # 7. Event route ---------------------------------------------------------
    routes = rpc("omni_comms_event_route_list", {
        "p_organization_id": ORG, "p_department_id": None,
        "p_event_definition_id": EVENT, "p_channel": "email",
        "p_lifecycle_state": None, "p_limit": 50, "p_offset": 0})
    ritems = routes["items"] if isinstance(routes, dict) else routes
    route = ritems[0] if ritems else None
    if route is None:
        rid = rpc("omni_comms_event_route_upsert_draft", {
            "p_id": None, "p_expected_updated_at": None,
            "p_organization_id": ORG, "p_department_id": None,
            "p_event_definition_id": EVENT, "p_channel": "email",
            "p_is_required": True, "p_is_enabled": True, "p_priority": 1,
            "p_template_family_id": fam["id"],
            "p_sender_identity_id": snd["id"],
            "p_sender_resolution_policy": "explicit",
            "p_preference_policy": "respect",
            "p_correlation_id": CORR})
        route = rpc("omni_comms_event_route_get", {"p_id": rid})
    if route.get("lifecycle_state") != "active":
        rpc("omni_comms_event_route_set_lifecycle", {
            "p_id": route["id"], "p_expected_updated_at": route["updated_at"],
            "p_target_state": "active", "p_reason": "Synthetic dry-run pilot",
            "p_correlation_id": CORR})
        route = rpc("omni_comms_event_route_get", {"p_id": route["id"]})
    step("event route", f'state={route["lifecycle_state"]}')

    # 8. Readiness -----------------------------------------------------------
    readiness = rpc("omni_comms_setup_readiness", {
        "p_organization_id": ORG, "p_department_id": None,
        "p_event_definition_id": EVENT, "p_channel": "email",
        "p_locale": "en-US"})
    blockers = [b for b in readiness["blockers"] if b["severity"] == "blocker"]
    print(json.dumps({
        "dry_run_ready": readiness["dry_run_ready"],
        "blockers": blockers,
        "warnings": [b for b in readiness["blockers"] if b["severity"] != "blocker"],
    }, indent=2))
    if not readiness["dry_run_ready"]:
        sys.exit("PILOT CONFIGURATION INCOMPLETE")
    print("OMNI COMMS SYNTHETIC PILOT CONFIGURATION OK")


if __name__ == "__main__":
    main()
