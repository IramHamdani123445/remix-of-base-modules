"""
Omni-Comms UI Smoke Suite — all 7 permanent routes.
Signs in via managed Supabase session, walks each route, captures screenshots,
records console errors and failed responses, then prints
OMNI COMMS UI SMOKE OK when every gate passes.
"""
import asyncio, json, os, re, sys
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"

ROUTES = [
    ("overview",    "/admin/omnichannel-communications",              "Omnichannel Communications"),
    ("operations",  "/admin/omnichannel-communications/operations",   "Operations"),
    ("events",      "/admin/omnichannel-communications/events",       "Events"),
    ("templates",   "/admin/omnichannel-communications/templates",    "Templates"),
    ("channels",    "/admin/omnichannel-communications/channels",     "Channels"),
    ("preferences", "/admin/omnichannel-communications/preferences",  "Preferences"),
    ("health",      "/admin/omnichannel-communications/health",       "Health"),
]

# Failed request statuses that should not appear on a stable page.
BAD_STATUSES = {401, 403, 404, 500, 502, 503}
# Ignore known-noise substrings on the network side.
NETWORK_IGNORE_SUBSTR = [
    "/rest/v1/rpc/omni_comms_email_config_summary",  # documented safe blocker (missing Resend secret) may 4xx
]

# Console message substrings that are known-safe (informational only).
CONSOLE_IGNORE_SUBSTR = [
    "Download the React DevTools",
    "vite",
    "[HMR]",
    "Multiple GoTrueClient",
]

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

async def visit(page, slug, path, heading, console_errors, bad_responses):
    url = BASE + path
    local_console = []
    local_bad = []

    def on_console(msg):
        if msg.type in ("error",):
            text = msg.text
            if any(s in text for s in CONSOLE_IGNORE_SUBSTR):
                return
            local_console.append(text)

    def on_response(resp):
        if resp.status in BAD_STATUSES:
            u = resp.url
            if any(s in u for s in NETWORK_IGNORE_SUBSTR):
                return
            # Ignore vite HMR fetches
            if "/__" in u:
                return
            local_bad.append(f"{resp.status} {u}")

    page.on("console", on_console)
    page.on("response", on_response)

    await page.goto(url, wait_until="domcontentloaded")
    # Give the app a beat to hydrate
    try:
        await page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    # URL check (allow trailing slash / hash)
    final_url = page.url
    ok_url = final_url.startswith(url)
    # Not blank: body innerText length > 50
    body_text = (await page.inner_text("body"))[:5000]
    not_blank = len(body_text.strip()) > 50
    heading_present = heading.lower() in body_text.lower()

    shot = SCREENSHOTS / f"{slug}.png"
    await page.screenshot(path=str(shot))

    # Detach handlers
    page.remove_listener("console", on_console)
    page.remove_listener("response", on_response)

    console_errors[slug] = local_console
    bad_responses[slug] = local_bad

    return {
        "slug": slug,
        "path": path,
        "final_url": final_url,
        "ok_url": ok_url,
        "not_blank": not_blank,
        "heading_present": heading_present,
        "text_sample": body_text[:200],
    }

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1366, "height": 768})
        page = await context.new_page()

        await restore_session(context, page)

        # Warm-up: first navigation after localStorage.setItem races against
        # early boot-time fetches (SecurityPolicy config, themes, roles) that
        # fire before the Supabase JS client rehydrates. Do an unmeasured
        # pre-visit to let the session settle, then wait until dashboard-ish
        # bootstrap has quiesced.
        await page.goto(BASE + ROUTES[0][1], wait_until="domcontentloaded")
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        await page.wait_for_timeout(500)

        console_errors, bad_responses = {}, {}
        results = []
        for slug, path, heading in ROUTES:
            r = await visit(page, slug, path, heading, console_errors, bad_responses)
            results.append(r)
            print(f"[{slug}] url_ok={r['ok_url']} not_blank={r['not_blank']} heading={r['heading_present']} final={r['final_url']}")
            print(f"   sample: {r['text_sample']!r}")

        # Refresh test — reload each route
        print("\n-- refresh cycle --")
        refresh_results = []
        for slug, path, heading in ROUTES:
            await page.goto(BASE + path, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except Exception: pass
            await page.reload(wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception: pass
            await page.wait_for_timeout(400)
            body = (await page.inner_text("body"))[:2000]
            ok = heading.lower() in body.lower() and len(body.strip()) > 50
            refresh_results.append((slug, ok, page.url))
            print(f"  refresh[{slug}] ok={ok} url={page.url}")

        # Back navigation
        print("\n-- back --")
        await page.goto(BASE + ROUTES[0][1], wait_until="domcontentloaded")
        await page.goto(BASE + ROUTES[3][1], wait_until="domcontentloaded")
        await page.go_back(wait_until="domcontentloaded")
        print(f"  back_url={page.url}")

        await browser.close()

        # Gates
        failures = []
        for r in results:
            if not r["ok_url"]: failures.append(f"{r['slug']}: url mismatch -> {r['final_url']}")
            if not r["not_blank"]: failures.append(f"{r['slug']}: blank page")
            if not r["heading_present"]: failures.append(f"{r['slug']}: missing heading text")
        for slug, errs in console_errors.items():
            if errs:
                failures.append(f"{slug}: console errors -> {errs[:3]}")
        for slug, bads in bad_responses.items():
            if bads:
                failures.append(f"{slug}: bad responses -> {bads[:3]}")
        for slug, ok, url in refresh_results:
            if not ok: failures.append(f"{slug}: refresh failed -> {url}")

        print("\n=== SUMMARY ===")
        if failures:
            for f in failures:
                print("  FAIL:", f)
            sys.exit(1)
        print("OMNI COMMS UI SMOKE OK")

asyncio.run(main())
