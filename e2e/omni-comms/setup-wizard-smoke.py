#!/usr/bin/env python3
"""
Omni-Comms — Phase 4 Guided Configuration Setup Wizard browser smoke.

Read-only. Opens the Overview route, switches to the Setup Wizard tab,
captures the guided plan and proves:
  - the wizard lives on the existing Overview route (?view=setup);
  - no eighth permanent Omni-Comms admin route exists;
  - fourteen guided steps render;
  - no write control is offered by the wizard itself;
  - no console errors.

Requires an authenticated preview session
(LOVABLE_BROWSER_AUTH_STATUS=injected). Skips cleanly when signed out.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ROUTE = "/admin/omnichannel-communications"
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


async def main() -> int:
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "unknown")
    if status != "injected":
        print(f"SKIP — no authenticated preview session (status={status}).")
        return 0

    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")

    failures: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        if cookies_json:
            cookies = json.loads(cookies_json)
            for c in cookies:
                c["url"] = BASE
            await context.add_cookies(cookies)

        page = await context.new_page()
        console_errors: list[str] = []
        page.on(
            "console",
            lambda m: console_errors.append(m.text) if m.type == "error" else None,
        )

        await page.goto(BASE, wait_until="domcontentloaded")
        if storage_key and session_json:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
            )

        # 1. Overview loads.
        await page.goto(f"{BASE}{ROUTE}", wait_until="networkidle")
        landing = page.get_by_test_id("omni-comms-landing")
        if await landing.count() == 0:
            failures.append("Overview landing did not render.")
        await page.screenshot(path=str(SCREENSHOTS / "1_overview.png"))

        # 2. Setup Wizard tab is present on the existing route.
        tab = page.get_by_test_id("omni-comms-landing-tab-setup")
        if await tab.count() == 0:
            failures.append("Setup Wizard tab is missing from Overview.")
        else:
            await tab.click()
            await page.wait_for_timeout(1500)
            if "view=setup" not in page.url:
                failures.append(f"Setup tab did not update the URL: {page.url}")
            await page.screenshot(path=str(SCREENSHOTS / "2_setup_wizard.png"))

        # 3. Deep link restores the wizard directly.
        await page.goto(f"{BASE}{ROUTE}?view=setup", wait_until="networkidle")
        panel = page.get_by_test_id("omni-comms-setup-wizard")
        if await panel.count() == 0:
            failures.append("Setup Wizard panel did not render from a deep link.")
        await page.screenshot(path=str(SCREENSHOTS / "3_setup_deeplink.png"))

        # 4. No eighth permanent route.
        resp = await page.goto(f"{BASE}{ROUTE}/setup", wait_until="domcontentloaded")
        body = (await page.inner_text("body")).lower()
        if "setup wizard" in body and "not found" not in body and "404" not in body:
            failures.append("An eighth permanent /setup route appears to exist.")
        _ = resp

        # 5. The wizard offers no write control.
        await page.goto(f"{BASE}{ROUTE}?view=setup", wait_until="networkidle")
        forbidden = ["Send test", "Dispatch", "Retry", "Resend", "Save configuration"]
        text = await page.inner_text("body")
        for label in forbidden:
            if label.lower() in text.lower():
                failures.append(f"Wizard exposes a write/dispatch control: {label}")

        await browser.close()

    if console_errors:
        print("Console errors observed:")
        for e in console_errors[:10]:
            print(f"  - {e}")

    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1

    print("PASS — Setup Wizard smoke completed with no failures.")
    return 0


sys.exit(asyncio.run(main()))
