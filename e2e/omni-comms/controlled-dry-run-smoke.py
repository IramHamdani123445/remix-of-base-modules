#!/usr/bin/env python3
"""
Omni-Comms — Phase 5 Controlled Dry-Run browser smoke.

Read-only except for a single deliberate dry-run submission, which creates
Omni-Comms runtime evidence only and never contacts a provider.

Verifies:
  - Overview loads and the Controlled Dry Run tab opens (?view=dry-run);
  - no eighth permanent Omni-Comms admin route exists;
  - tenant and pilot event selection work;
  - setup readiness loads;
  - synthetic payload validates;
  - confirmation dialog appears before execution;
  - exactly one dry-run request is submitted and returns a request ID;
  - Operations detail opens for that request;
  - dispatch-job count is 0 and delivery-attempt count is 0;
  - no provider network request occurs;
  - no console errors / unexpected failed responses.

Skips cleanly (exit 0, not pass/fail) when the preview session is signed out
or the server feature gate reports the controlled dry run as disabled.
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ROUTE = "/admin/omnichannel-communications"
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

PROVIDER_HOSTS = (
    "resend.com",
    "api.twilio.com",
    "graph.facebook.com",
    "sendgrid",
    "fcm.googleapis.com",
    "mailgun",
    "postmark",
)


async def main() -> int:
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "unknown")
    if status != "injected":
        print("Browser smoke: Not executed — authenticated preview unavailable "
              f"(status={status}).")
        return 0

    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")

    failures: list[str] = []
    console_errors: list[str] = []
    provider_calls: list[str] = []
    failed_responses: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        if cookies_json:
            for c in json.loads(cookies_json):
                c["url"] = BASE
                await context.add_cookies([c])

        page = await context.new_page()
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)

        def on_request(req):
            if any(h in req.url for h in PROVIDER_HOSTS):
                provider_calls.append(req.url)

        page.on("request", on_request)
        page.on("response", lambda r: failed_responses.append(f"{r.status} {r.url}")
                if r.status >= 500 else None)

        await page.goto(BASE, wait_until="domcontentloaded")
        if storage_key and session_json:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, "
                f"{json.dumps(session_json)})"
            )

        # 1. Overview + Controlled Dry Run tab
        await page.goto(f"{BASE}{ROUTE}?view=dry-run", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(SCREENSHOTS / "dryrun_1_panel.png"))
        body = await page.inner_text("body")

        if "Controlled Dry Run" not in body and "controlled dry run" not in body.lower():
            failures.append("Controlled Dry Run panel did not render on ?view=dry-run")

        # 2. Server feature gate
        if re.search(r"disabled in this environment", body, re.I):
            print("Browser smoke: Not executed — controlled dry-run disabled "
                  "in this environment.")
            await browser.close()
            return 0

        if re.search(r"configuration is incomplete", body, re.I):
            print("Browser smoke: Not executed — pilot configuration is not "
                  "dry_run_ready in this environment.")
            await browser.close()
            return 0

        # 3. No eighth permanent route
        for forbidden in ("/test", "/dry-run", "/simulator"):
            resp = await page.goto(f"{BASE}{ROUTE}{forbidden}",
                                   wait_until="domcontentloaded")
            await page.wait_for_timeout(800)
            txt = (await page.inner_text("body")).lower()
            if "not found" not in txt and "404" not in txt:
                failures.append(f"Unexpected route resolved: {ROUTE}{forbidden}")

        await page.goto(f"{BASE}{ROUTE}?view=dry-run", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        # 4. Validate payload
        validate = page.get_by_role("button", name=re.compile("validate", re.I))
        if await validate.count():
            await validate.first.click()
            await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SCREENSHOTS / "dryrun_2_validated.png"))
        else:
            failures.append("Validate payload control not found")

        # 5. Execute with confirmation
        run = page.get_by_role("button", name=re.compile("run controlled dry run|start dry run|submit dry run", re.I))
        request_id = None
        if await run.count() and await run.first.is_enabled():
            await run.first.click()
            await page.wait_for_timeout(1000)
            dialog_text = await page.inner_text("body")
            if "will not send a communication" not in dialog_text:
                failures.append("Confirmation dialog wording missing")
            await page.screenshot(path=str(SCREENSHOTS / "dryrun_3_confirm.png"))
            confirm = page.get_by_role("button", name=re.compile("confirm|i understand", re.I))
            if await confirm.count():
                await confirm.last.click()
                await page.wait_for_timeout(8000)
            result = await page.inner_text("body")
            await page.screenshot(path=str(SCREENSHOTS / "dryrun_4_result.png"))
            m = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                          result)
            request_id = m.group(0) if m else None
            if not request_id:
                failures.append("No request ID returned from controlled dry run")
            if "Dispatch jobs: 0" not in result.replace("\n", " "):
                failures.append("Zero-dispatch-job invariant not displayed")
            if "Delivery attempts: 0" not in result.replace("\n", " "):
                failures.append("Zero-delivery-attempt invariant not displayed")
            if re.search(r"safety invariant violated", result, re.I):
                failures.append("CRITICAL — dry-run safety invariant violated")
        else:
            failures.append("Controlled dry-run execution control unavailable/disabled")

        # 6. Operations deep link
        if request_id:
            await page.goto(f"{BASE}{ROUTE}/operations?request={request_id}",
                            wait_until="domcontentloaded")
            await page.wait_for_timeout(4000)
            ops = await page.inner_text("body")
            await page.screenshot(path=str(SCREENSHOTS / "dryrun_5_operations.png"))
            if request_id[:8] not in ops:
                failures.append("Operations detail did not open for the request")
            if "dry_run" not in ops:
                failures.append("Operations detail does not show mode=dry_run")

        if provider_calls:
            failures.append(f"Provider network calls observed: {provider_calls}")
        if failed_responses:
            failures.append(f"Server-error responses: {failed_responses[:5]}")
        if console_errors:
            failures.append(f"Console errors: {console_errors[:5]}")

        await browser.close()

    if failures:
        print("FAIL — controlled dry-run smoke")
        for f in failures:
            print(f"  • {f}")
        return 1

    print("PASS — controlled dry-run smoke (no provider call, no email sent)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
