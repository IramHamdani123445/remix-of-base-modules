#!/usr/bin/env python3
"""
Omni-Comms — synthetic pilot template v2 (non-production, dry-run only).

v1 used bare tokens ({{reference}}) which the runtime token contract does not
expose; the runtime namespaces caller data under `payload.*`. This authors v2
with the correct namespaced tokens, pins the synthetic layout, and publishes it
through the governed RPCs (author != approver is preserved).
"""
import json
import os
import urllib.request

BASE = os.environ["OMNI_SUPABASE_URL"].rstrip("/")
ANON = os.environ["OMNI_SUPABASE_ANON_KEY"]
AUTHOR = os.environ["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"]
APPROVER = os.environ["OMNI_APPROVER_TOKEN"]

FAMILY = os.environ.get("OMNI_TEMPLATE_FAMILY_ID", "1dcc6454-0ce3-466f-a7db-623db0c3b73b")
LAYOUT = os.environ.get("OMNI_LAYOUT_ID", "89d43119-97ea-4dd4-b8ab-2bf3e760b68e")
LAYOUT_VERSION = os.environ.get("OMNI_LAYOUT_VERSION_ID", "f44020f9-85df-4fc0-bb66-e1a8118b0b5c")
CORR = "omni-pilot-template-v2"


def rpc(name, args, token):
    req = urllib.request.Request(
        f"{BASE}/rest/v1/rpc/{name}",
        data=json.dumps(args).encode(),
        headers={
            "apikey": ANON,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"RPC {name} failed: {e.code} {e.read().decode()}")


def main():
    listed = rpc("omni_comms_template_version_list", {
        "p_template_family_id": FAMILY, "p_channel": "email",
        "p_locale": None, "p_status": None, "p_limit": 50, "p_offset": 0}, AUTHOR)
    items = listed["items"] if isinstance(listed, dict) else listed
    ver = next((v for v in items if v["version_number"] == 2), None)

    if ver is None:
        ver = rpc("omni_comms_template_version_create", {
            "p_template_family_id": FAMILY, "p_channel": "email",
            "p_locale": "en-US", "p_version_number": 2,
            "p_content": {
                "subject": "Controlled dry run for {{payload.subjectName}}",
                "text": "Reference {{payload.reference}} for {{payload.subjectName}}. "
                        "Synthetic dry-run only.",
                "html": "<p>Reference {{payload.reference}} for {{payload.subjectName}}.</p>"
                        "<p>Synthetic dry-run only — no live delivery.</p>",
            },
            "p_correlation_id": CORR}, AUTHOR)
    print("version", ver["id"], ver["status"])

    if ver["status"] == "draft":
        rpc("omni_comms_template_version_set_layout_selection", {
            "p_version_id": ver["id"], "p_mode": "pinned",
            "p_layout_id": LAYOUT, "p_pinned_layout_version_id": LAYOUT_VERSION,
            "p_expected_updated_at": ver["updated_at"]}, AUTHOR)
        ver = rpc("omni_comms_template_version_get", {"p_id": ver["id"]}, AUTHOR)
        rpc("omni_comms_template_version_approve", {
            "p_id": ver["id"], "p_approval_note": "Synthetic dry-run pilot v2",
            "p_correlation_id": CORR}, APPROVER)
        ver = rpc("omni_comms_template_version_get", {"p_id": ver["id"]}, APPROVER)

    if ver["status"] == "approved":
        rpc("omni_comms_template_version_publish", {
            "p_id": ver["id"], "p_expected_updated_at": ver["updated_at"],
            "p_confirm_replacement": True,
            "p_replacement_reason": "Corrects token namespace to payload.*",
            "p_correlation_id": CORR}, APPROVER)
        ver = rpc("omni_comms_template_version_get", {"p_id": ver["id"]}, APPROVER)

    print("final", ver["version_number"], ver["status"])


main()
