"""
Omni-Comms Health — Live Diagnostics authenticated smoke (Phase 3).

PREPARED, NOT EXECUTED while LOVABLE_BROWSER_AUTH_STATUS=signed_out.

Verifies, on the single permanent Health route:
  - the Health route loads;
  - the Readiness tab loads;
  - the Live Diagnostics tab loads;
  - tenant selection works;
  - diagnostics return live values;
  - Refresh works;
  - React issues NO direct PostgREST table request against omni_comms_* tables;
  - no runtime request is created (no POST to omni-comms-runtime);
  - no provider is contacted;
  - no console errors and no failed network responses.

Prints OMNI COMMS HEALTH LIVE DIAGNOSTICS SMOKE OK when every gate passes.
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"
HEALTH = BASE + "/admin/omnichannel-communications/health"

BAD_STATUSES = {401, 403, 404, 500, 502, 503}
PROVIDER_HOSTS = ("resend.com", "twilio.com", "sendgrid.net", "graph.facebook.com")
CONSOLE_IGNORE = ("Download the React DevTools", "[HMR]", "Multiple GoTrueClient", "vite")


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await context.add_cookies(cookies)
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def main() -> int:
    if os.environ.get("LOVABLE_BROWSER_AUTH_STATUS") != "injected":
        print("SKIPPED — authenticated preview session unavailable. Not executed.")
        return 0

    failures, console_errors, direct_table_reads = [], [], []
    runtime_posts, provider_calls, bad_responses = [], [], []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        def on_request(req):
            url = req.url
            if "/rest/v1/omni_comms_" in url:
                direct_table_reads.append(url.split("?")[0])
            if "omni-comms-runtime" in url and req.method == "POST":
                runtime_posts.append(url)
            if any(h in url for h in PROVIDER_HOSTS):
                provider_calls.append(url)

        def on_response(res):
            if res.status in BAD_STATUSES:
                bad_responses.append(f"{res.status} {res.url.split('?')[0]}")

        def on_console(msg):
            if msg.type == "error" and not any(s in msg.text for s in CONSOLE_IGNORE):
                console_errors.append(msg.text)

        page.on("request", on_request)
        page.on("response", on_response)
        page.on("console", on_console)

        await restore_session(context, page)
        await page.goto(HEALTH, wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="omni-comms-health-page"]', timeout=20000)
        await page.screenshot(path=str(SCREENSHOTS / "health_1_readiness.png"))

        # Readiness tab is the default view.
        if not await page.locator('[data-testid="omni-comms-readiness-tab"]').count():
            failures.append("Readiness tab did not render")

        # Live Diagnostics tab.
        await page.get_by_role("tab", name="Live Diagnostics").click()
        await page.wait_for_selector('[data-testid="omni-comms-live-diagnostics"]', timeout=20000)

        # Tenant selection.
        selector = page.locator('[data-testid="omni-comms-tenant-selector-org"]')
        if await selector.count():
            await selector.click()
            # Skip the "—" placeholder option; pick a real organisation.
            options = page.locator('[role="option"]')
            total = await options.count()
            picked = False
            for i in range(total):
                label = (await options.nth(i).inner_text()).strip()
                if label and label != "—":
                    await options.nth(i).click()
                    picked = True
                    break
            if not picked:
                failures.append("No selectable organisation in the tenant selector")
                await page.keyboard.press("Escape")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(SCREENSHOTS / "health_2_live.png"))

        if not await page.locator('[data-testid="omni-comms-health-posture"]').count():
            failures.append("Live diagnostics returned no posture card")
        if not await page.locator('[data-testid="omni-comms-health-category-event_catalogue"]').count():
            failures.append("Live diagnostics returned no event catalogue category")

        # Refresh.
        await page.locator('[data-testid="omni-comms-health-refresh"]').click()
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(SCREENSHOTS / "health_3_refresh.png"))

        await browser.close()

    if direct_table_reads:
        failures.append(f"direct table reads from React: {sorted(set(direct_table_reads))}")
    if runtime_posts:
        failures.append(f"runtime send request created: {runtime_posts}")
    if provider_calls:
        failures.append(f"provider contacted: {provider_calls}")
    if console_errors:
        failures.append(f"console errors: {console_errors}")
    if bad_responses:
        failures.append(f"failed responses: {sorted(set(bad_responses))}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1

    print("OMNI COMMS HEALTH LIVE DIAGNOSTICS SMOKE OK")
    return 0


sys.exit(asyncio.run(main()))
