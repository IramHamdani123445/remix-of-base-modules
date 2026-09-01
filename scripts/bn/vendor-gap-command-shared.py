#!/usr/bin/env python3
"""Regenerate supabase/functions/bn-gap-command/_shared.ts.

Supabase Edge Functions cannot import from `src/` (the API bundler only
uploads assets under supabase/functions), so the transport-neutral command
pipeline is vendored into the function directory. Run this after changing any
of the SOURCES below, then re-deploy `bn-gap-command`.
"""
import re

SOURCES = [
    'src/types/bn/commands/commandEnvelope.ts',
    'src/types/bn/commands/commandResult.ts',
    'src/types/bn/commands/moduleCodes.ts',
    'src/services/bn/commands/benefitsCapabilityRegistry.ts',
    'src/services/bn/commands/benefitsCommandPipeline.ts',
    'src/services/bn/commands/pingCommand.ts',
]

TARGET = 'supabase/functions/bn-gap-command/_shared.ts'

HEADER = """/**
 * VENDORED — do not edit by hand.
 *
 * Deno-deployable copy of the portable BN gap command pipeline. Regenerate
 * with scripts/bn/vendor-gap-command-shared.py.
 */
"""

REGISTRY = """
// ─── handler registry (edge boundary: diagnostics only) ───
// Business handlers live in their own dedicated edge functions (e.g.
// bn-mortality-command). Unregistered commands fail closed with
// HANDLER_NOT_REGISTERED.
const HANDLERS: readonly CommandHandler<any, any>[] = [BN_GAP_PING_HANDLER];

export const benefitsCommandHandlerRegistry: HandlerRegistry = {
  get(commandName: string, commandVersion: number): CommandHandler | null {
    return (
      HANDLERS.find(
        (h) => h.commandName === commandName && h.commandVersion === commandVersion,
      ) ?? null
    );
  },
};
"""

IMPORT = re.compile(r"^import\s")


def strip_imports(text: str) -> str:
    kept, skip = [], False
    for line in text.split('\n'):
        if skip:
            if line.rstrip().endswith(';') and ("from '" in line or line.strip() == "';"):
                skip = False
            continue
        if IMPORT.match(line):
            if "from '" in line and line.rstrip().endswith(';'):
                continue
            skip = True
            continue
        kept.append(line)
    return '\n'.join(kept).strip()


def main() -> None:
    parts = [HEADER]
    for path in SOURCES:
        with open(path) as fh:
            parts.append(f"// ─── vendored from {path} ───\n" + strip_imports(fh.read()) + '\n')
    with open(TARGET, 'w') as fh:
        fh.write('\n'.join(parts) + REGISTRY)
    print(f"wrote {TARGET}")


if __name__ == '__main__':
    main()
