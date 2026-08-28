#!/usr/bin/env node
// DEF-13 — deployment identity truth.
//
// Produces a deterministic 40-hex build revision from the CONTENT of every
// source file that constitutes the Omni-Comms runtime and dispatcher. The
// artifact is committed so a deployed function can always report a verified
// revision, even when the platform-wide `OMNI_COMMS_DEPLOYED_REVISION`
// environment variable is absent or stale.
//
// Usage: node scripts/omni-comms/generate-build-revision.mjs [--check]

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SOURCE_DIRS = [
  "supabase/functions/omni-comms-runtime",
  "supabase/functions/omni-comms-dispatch",
  "supabase/functions/_shared/omni-comms",
];
const ARTIFACT = "supabase/functions/_shared/omni-comms/buildRevision.generated.ts";

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|json)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => relative(ROOT, f).split("\\").join("/"))
  // The artifact itself is never part of its own input.
  .filter((f) => f !== ARTIFACT)
  .sort();

const digest = createHash("sha256");
for (const file of files) {
  digest.update(file, "utf8");
  digest.update("\0", "utf8");
  digest.update(createHash("sha256").update(readFileSync(join(ROOT, file))).digest("hex"), "utf8");
  digest.update("\n", "utf8");
}
// 40 hex characters: the same shape as a git revision, so every existing
// governance check and column keeps working unchanged.
const revision = digest.digest("hex").slice(0, 40);

const body = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/omni-comms/generate-build-revision.mjs from the content
// of the Omni-Comms runtime, dispatcher and shared adapter sources.
//
// Source files hashed: ${files.length}
export const OMNI_COMMS_BUILD_REVISION = "${revision}";
export const OMNI_COMMS_BUILD_SOURCE_FILE_COUNT = ${files.length};
`;

const current = (() => {
  try {
    return readFileSync(join(ROOT, ARTIFACT), "utf8");
  } catch {
    return null;
  }
})();

if (process.argv.includes("--check")) {
  if (current !== body) {
    console.error(
      `omni-comms build revision artifact is stale.\nExpected revision ${revision}.\nRun: node scripts/omni-comms/generate-build-revision.mjs`,
    );
    process.exit(1);
  }
  console.log(`omni-comms build revision up to date: ${revision}`);
} else {
  if (current !== body) writeFileSync(join(ROOT, ARTIFACT), body);
  console.log(`omni-comms build revision: ${revision} (${files.length} source files)`);
}
