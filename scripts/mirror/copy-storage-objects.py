#!/usr/bin/env python3
"""
Copy every Storage bucket + object from the source (Lovable Cloud) project
into the mirror project.

Resumable: objects already present in the target are skipped, so re-running
after an interruption picks up where it left off. Progress is written to
$STATE_DIR/progress.json after every object.

Env required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        -- source (read)
  MIRROR_TARGET_URL | derived from MIRROR_TARGET_DATABASE_URL
  MIRROR_TARGET_SERVICE_ROLE_KEY                 -- target (write)
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

STATE_DIR = os.environ.get("STATE_DIR", "/tmp/mirror-storage")
os.makedirs(STATE_DIR, exist_ok=True)
PROGRESS = os.path.join(STATE_DIR, "progress.json")
LOG = open(os.path.join(STATE_DIR, "copy.log"), "a", buffering=1)


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.write(line + "\n")


SRC_URL = os.environ["SUPABASE_URL"].rstrip("/")
SRC_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DST_KEY = os.environ["MIRROR_TARGET_SERVICE_ROLE_KEY"]

dst_url = os.environ.get("MIRROR_TARGET_URL")
if not dst_url:
    m = re.search(r"db\.([a-z0-9]+)\.supabase\.co", os.environ.get("MIRROR_TARGET_DATABASE_URL", ""))
    if not m:
        m = re.search(r"postgres\.([a-z0-9]{20})[:@]", os.environ.get("MIRROR_TARGET_DATABASE_URL", ""))
    if not m:
        sys.exit("cannot derive target project ref; set MIRROR_TARGET_URL")
    dst_url = f"https://{m.group(1)}.supabase.co"
DST_URL = dst_url.rstrip("/")


def req(url, key, method="GET", body=None, headers=None, raw=False, timeout=300):
    h = {"Authorization": f"Bearer {key}", "apikey": key}
    if headers:
        h.update(headers)
    data = body
    if body is not None and not isinstance(body, (bytes, bytearray)):
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        payload = resp.read()
    return payload if raw else (json.loads(payload) if payload else None)


def list_objects(bucket):
    out, offset = [], 0
    while True:
        page = req(
            f"{SRC_URL}/storage/v1/object/list/{bucket}",
            SRC_KEY,
            method="POST",
            body={"prefix": "", "limit": 1000, "offset": offset,
                  "sortBy": {"column": "name", "order": "asc"}},
        )
        if not page:
            break
        for it in page:
            if it.get("id") is None:  # pseudo-folder: recurse
                out.extend(list_prefix(bucket, it["name"]))
            else:
                out.append(it["name"])
        if len(page) < 1000:
            break
        offset += 1000
    return out


def list_prefix(bucket, prefix):
    out, offset = [], 0
    while True:
        page = req(
            f"{SRC_URL}/storage/v1/object/list/{bucket}",
            SRC_KEY,
            method="POST",
            body={"prefix": prefix, "limit": 1000, "offset": offset,
                  "sortBy": {"column": "name", "order": "asc"}},
        )
        if not page:
            break
        for it in page:
            name = f"{prefix}/{it['name']}"
            if it.get("id") is None:
                out.extend(list_prefix(bucket, name))
            else:
                out.append(name)
        if len(page) < 1000:
            break
        offset += 1000
    return out


def main():
    buckets = req(f"{SRC_URL}/storage/v1/bucket", SRC_KEY)
    try:
        existing = {b["id"] for b in req(f"{DST_URL}/storage/v1/bucket", DST_KEY)}
    except urllib.error.HTTPError as e:
        sys.exit(f"cannot reach target storage API: {e}")

    plan = {}
    for b in buckets:
        plan[b["id"]] = list_objects(b["id"])
    total = sum(len(v) for v in plan.values())
    log(f"source: {len(buckets)} buckets, {total} objects")

    done = failed = skipped = 0
    state = {"total": total, "done": 0, "skipped": 0, "failed": 0,
             "buckets": {}, "started_at": time.time(), "finished": False}

    def flush():
        state.update(done=done, skipped=skipped, failed=failed,
                     updated_at=time.time())
        with open(PROGRESS, "w") as f:
            json.dump(state, f)

    for b in buckets:
        bid = b["id"]
        if bid not in existing:
            req(f"{DST_URL}/storage/v1/bucket", DST_KEY, method="POST", body={
                "id": bid, "name": b.get("name", bid), "public": b.get("public", False),
                "file_size_limit": b.get("file_size_limit"),
                "allowed_mime_types": b.get("allowed_mime_types"),
            })
            log(f"created bucket {bid}")

        names = plan[bid]
        state["buckets"][bid] = {"total": len(names), "done": 0}
        for name in names:
            try:
                # already in target? (HEAD via info endpoint)
                try:
                    req(f"{DST_URL}/storage/v1/object/info/{bid}/{urllib.parse.quote(name)}", DST_KEY)
                    skipped += 1
                    state["buckets"][bid]["done"] += 1
                    flush()
                    continue
                except urllib.error.HTTPError as e:
                    if e.code not in (400, 404):
                        raise

                blob = req(f"{SRC_URL}/storage/v1/object/{bid}/{urllib.parse.quote(name)}",
                           SRC_KEY, raw=True)
                req(f"{DST_URL}/storage/v1/object/{bid}/{urllib.parse.quote(name)}",
                    DST_KEY, method="POST", body=blob,
                    headers={"Content-Type": "application/octet-stream",
                             "x-upsert": "true"})
                done += 1
                state["buckets"][bid]["done"] += 1
                if (done + skipped) % 5 == 0:
                    log(f"{done + skipped}/{total} ({bid})")
            except Exception as exc:  # noqa: BLE001
                failed += 1
                log(f"FAILED {bid}/{name}: {exc}")
            flush()

    state["finished"] = True
    flush()
    log(f"DONE copied={done} skipped={skipped} failed={failed} of {total}")


if __name__ == "__main__":
    import urllib.parse  # noqa: E402
    main()
