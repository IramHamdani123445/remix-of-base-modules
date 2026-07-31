#!/usr/bin/env python3
"""
Omni-Comms — authenticated Events / Contracts / Routes browser smoke.

Exercises the Event Catalogue administration UI with a SYNTHETIC event only
(`OMNI.TEST.CONTROLLED_DRY_RUN`). Read/write happens exclusively through the
UI, which itself uses only the authorised RPC surface.

Safety:
  * Never touches a real production event — the synthetic code is fixed.
  * Never sends a communication and never contacts a provider.
  * Idempotent: reuses the synthetic event/contract when they already exist.
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ROUTE = "/admin/omnichannel-communications/events"
SYNTHETIC_CODE = "OMNI.TEST.CONTROLLED_DRY_RUN"
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": ["reference", "subjectName"],
    "properties": {
        "reference": {"type": "string", "maxLength": 64},
        "subjectName": {"type": "string", "maxLength": 120},
    },
}
SAMPLE = {"reference": "OMNI-TEST-0001", "subjectName": "Synthetic Test Subject"}

PROVIDER_HOSTS = ("resend.com", "twilio.com", "sendgrid", "graph.facebook.com",
                  "fcm.googleapis.com", "mailgun")


async def main() -> int:
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if status != "injected" or not session_json or not storage_key:
        print("Events smoke: Not executed — authenticated preview unavailable "
              f"(status={status or 'unset'}).")
        return 0

    failures: list[str] = []
    provider_calls: list[str] = []
    console_errors: list[str] = []
    server_errors: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)
        page.on("request", lambda r: provider_calls.append(r.url)
                if any(h in r.url for h in PROVIDER_HOSTS) else None)
        page.on("response", lambda r: server_errors.append(f"{r.status} {r.url}")
                if r.status >= 500 else None)

        await page.goto(BASE, wait_until="domcontentloaded")
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, "
            f"{json.dumps(session_json)})"
        )
        await page.goto(f"{BASE}{ROUTE}", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="oc-events-page"]', timeout=30000)
        await page.wait_for_timeout(2500)

        # ── 1. Event definition (create if absent, then activate) ──────────
        search = page.locator('[data-testid="oc-search-input"]')
        if await search.count():
            await search.fill(SYNTHETIC_CODE)
            await page.wait_for_timeout(1500)

        row = page.locator("tr", has_text=SYNTHETIC_CODE)
        if await row.count() == 0:
            await page.locator('[data-testid="oc-definition-new"]').click()
            await page.wait_for_timeout(600)
            await page.locator('[data-testid="oc-def-code"]').fill(SYNTHETIC_CODE)
            await page.locator('[data-testid="oc-def-module"]').fill("OMNI")
            await page.locator('[data-testid="oc-def-entity"]').fill("ADMIN_TEST")
            await page.locator('[data-testid="oc-def-name"]').fill(
                "Synthetic controlled dry-run test event")
            save = page.locator('[data-testid="oc-def-save"]')
            if not await save.is_enabled():
                failures.append("Event definition Save stayed disabled")
            else:
                await save.click()
                await page.wait_for_timeout(3000)
            if await search.count():
                await search.fill(SYNTHETIC_CODE)
                await page.wait_for_timeout(1800)
            row = page.locator("tr", has_text=SYNTHETIC_CODE)
            if await row.count() == 0:
                failures.append("Synthetic event definition was not created")

        await page.screenshot(path=str(SCREENSHOTS / "events_1_definitions.png"))

        if await row.count():
            status_text = (await row.first.inner_text()).lower()
            if "active" not in status_text:
                activate = row.first.get_by_role("button", name=re.compile("activate", re.I))
                if await activate.count():
                    await activate.first.click()
                    await page.wait_for_timeout(800)
                    await page.locator('[data-testid="oc-reason-input"]').fill(
                        "Authenticated browser verification — synthetic test event.")
                    synth = page.locator('[data-testid="oc-synth-confirm"]')
                    if await synth.count():
                        await synth.click()
                    await page.locator('[data-testid="oc-reason-confirm"]').click()
                    await page.wait_for_timeout(3500)
                    if await search.count():
                        await search.fill(SYNTHETIC_CODE)
                        await page.wait_for_timeout(1800)
                    row = page.locator("tr", has_text=SYNTHETIC_CODE)
                    status_text = (await row.first.inner_text()).lower()
            if "active" not in status_text:
                failures.append(f"Synthetic event is not active: {status_text.strip()[:120]}")

        # ── 2. Contract (draft v1 then publish) ────────────────────────────
        await page.get_by_role("tab", name="Contracts").click()
        await page.wait_for_selector('[data-testid="oc-contracts-tab"]', timeout=20000)
        await page.wait_for_timeout(2000)

        picker = page.locator("#oc-def-picker")
        chosen = False
        for opt in await picker.locator("option").all():
            if SYNTHETIC_CODE in ((await opt.inner_text()) or ""):
                await picker.select_option(value=await opt.get_attribute("value"))
                chosen = True
                break
        if not chosen:
            failures.append("Synthetic event missing from the contract event picker")
        await page.wait_for_timeout(2500)

        body = await page.inner_text("body")
        if "published" not in body.lower():
            new_contract = page.locator('[data-testid="oc-contract-new"]')
            if await new_contract.count() and await new_contract.is_enabled():
                await new_contract.click()
                await page.wait_for_timeout(600)
                await page.locator('[data-testid="oc-contract-schema"]').fill(
                    json.dumps(SCHEMA, indent=2))
                await page.locator('[data-testid="oc-contract-sample"]').fill(
                    json.dumps(SAMPLE, indent=2))
                csave = page.locator('[data-testid="oc-contract-save"]')
                if not await csave.is_enabled():
                    failures.append("Contract Create draft stayed disabled")
                else:
                    await csave.click()
                    await page.wait_for_timeout(3500)
            publish = page.get_by_role("button", name=re.compile(r"^publish$", re.I))
            if await publish.count():
                await publish.first.click()
                await page.wait_for_timeout(800)
                await page.locator('[data-testid="oc-reason-input"]').fill(
                    "Authenticated browser verification — publish synthetic contract v1.")
                synth = page.locator('[data-testid="oc-synth-confirm"]')
                if await synth.count():
                    await synth.click()
                await page.locator('[data-testid="oc-reason-confirm"]').click()
                await page.wait_for_timeout(3500)
            else:
                failures.append("Publish control not offered for the draft contract")

        await page.screenshot(path=str(SCREENSHOTS / "events_2_contracts.png"))
        body = await page.inner_text("body")
        if "published" not in body.lower():
            failures.append("Synthetic contract is not published")
        if not re.search(r"[0-9a-f]{16,}", body):
            failures.append("Contract checksum not displayed")

        # ── 3. Routes tab loads and offers lifecycle controls ─────────────
        await page.get_by_role("tab", name="Routes").click()
        await page.wait_for_selector('[data-testid="oc-routes-tab"]', timeout=20000)
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(SCREENSHOTS / "events_3_routes.png"))
        if not await page.locator('[data-testid="oc-route-lifecycle-filter"]').count():
            failures.append("Routes tab did not render its lifecycle filter")
        new_route = page.locator('[data-testid="oc-route-new"]')
        if await new_route.count() and await new_route.is_enabled():
            await new_route.click()
            await page.wait_for_timeout(900)
            if not await page.locator('[data-testid="oc-route-save"]').count():
                failures.append("Route editor did not open")
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(500)

        await browser.close()

    real_console = [c for c in console_errors if "Failed to fetch" not in c]
    if real_console:
        failures.append(f"Console errors: {real_console[:5]}")
    if provider_calls:
        failures.append(f"Provider network calls observed: {provider_calls}")
    if server_errors:
        failures.append(f"Server-error responses: {server_errors[:5]}")

    if failures:
        print("FAIL — events synthetic smoke")
        for f in failures:
            print(f"  • {f}")
        return 1

    print("PASS — events synthetic smoke (definition active, contract published, "
          "routes usable, no provider call)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
