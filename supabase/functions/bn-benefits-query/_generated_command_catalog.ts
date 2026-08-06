/**
 * DO NOT EDIT — generated from src/types/bn/mortality/mortalityCommandCatalog.ts
 * by scripts/bn/generate-mortality-command-catalog.ts.
 *
 * This mirrors the canonical browser catalogue for the Deno edge function,
 * which cannot import from the browser tree. The parity test
 * `src/__tests__/bn/mortality/mortalityCommandCatalogParity.test.ts`
 * fails the build if this file diverges from the canonical source.
 */
// deno-lint-ignore-file
export const MORTALITY_COMMAND_CATALOG_GENERATED = [
  {
    "command": "BN_MORTALITY_DRAFT_SAVE",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "DRAFT"
    ]
  },
  {
    "command": "BN_MORTALITY_REGISTER_REPORT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED"
    ]
  },
  {
    "command": "BN_MORTALITY_CANCEL",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED"
    ]
  },
  {
    "command": "BN_MORTALITY_MATCH_PERSON",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": true,
    "validFrom": [
      "DRAFT",
      "REPORTED",
      "VERIFICATION_PENDING",
      "CONFLICT"
    ]
  },
  {
    "command": "BN_MORTALITY_MARK_DUPLICATE",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED",
      "VERIFICATION_PENDING",
      "CONFLICT"
    ]
  },
  {
    "command": "BN_MORTALITY_ASSIGN",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED",
      "VERIFICATION_PENDING",
      "CONFLICT",
      "PROVISIONALLY_HELD",
      "IMPACT_REVIEW",
      "APPROVAL_PENDING",
      "VERIFIED",
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ]
  },
  {
    "command": "BN_MORTALITY_ATTACH_EVIDENCE",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED",
      "VERIFICATION_PENDING",
      "CONFLICT",
      "PROVISIONALLY_HELD",
      "IMPACT_REVIEW",
      "APPROVAL_PENDING",
      "VERIFIED",
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "integrationRequired": "dms"
  },
  {
    "command": "BN_MORTALITY_SUBMIT_FOR_VERIFICATION",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "DRAFT",
      "REPORTED"
    ],
    "dataRequires": [
      "matchedIp"
    ]
  },
  {
    "command": "BN_MORTALITY_PLACE_PROVISIONAL_HOLD",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": true,
    "validFrom": [
      "REPORTED",
      "VERIFICATION_PENDING",
      "CONFLICT",
      "IMPACT_REVIEW",
      "APPROVAL_PENDING"
    ],
    "integrationRequired": "awards"
  },
  {
    "command": "BN_MORTALITY_RELEASE_HOLD",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": true,
    "validFrom": [
      "PROVISIONALLY_HELD"
    ],
    "integrationRequired": "awards"
  },
  {
    "command": "BN_MORTALITY_RECORD_CONFLICT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "VERIFICATION_PENDING",
      "PROVISIONALLY_HELD"
    ]
  },
  {
    "command": "BN_MORTALITY_RESOLVE_CONFLICT",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "CONFLICT"
    ]
  },
  {
    "command": "BN_MORTALITY_CONFIRM_VERIFICATION",
    "capability": "bn_mortality:verify",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": false,
    "transactional": true,
    "validFrom": [
      "VERIFICATION_PENDING",
      "PROVISIONALLY_HELD"
    ],
    "makerSource": "BN_MORTALITY_SUBMIT_FOR_VERIFICATION"
  },
  {
    "command": "BN_MORTALITY_REJECT_REPORT",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "VERIFICATION_PENDING",
      "CONFLICT",
      "PROVISIONALLY_HELD"
    ],
    "makerSource": "BN_MORTALITY_SUBMIT_FOR_VERIFICATION"
  },
  {
    "command": "BN_MORTALITY_PREPARE_IMPACT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": true,
    "validFrom": [
      "VERIFIED",
      "IMPACT_REVIEW"
    ],
    "dataRequires": [
      "matchedIp",
      "verified"
    ]
  },
  {
    "command": "BN_MORTALITY_SUBMIT_IMPACT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "IMPACT_REVIEW"
    ],
    "dataRequires": [
      "impactPrepared"
    ]
  },
  {
    "command": "BN_MORTALITY_RETURN_IMPACT",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "APPROVAL_PENDING"
    ]
  },
  {
    "command": "BN_MORTALITY_APPROVE_IMPACT",
    "capability": "bn_mortality:approve_impact",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": false,
    "transactional": true,
    "validFrom": [
      "APPROVAL_PENDING"
    ],
    "makerSource": "BN_MORTALITY_SUBMIT_IMPACT"
  },
  {
    "command": "BN_MORTALITY_TERMINATE_AWARD",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": true,
    "transactional": true,
    "validFrom": [
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "makerSource": "BN_MORTALITY_APPROVE_IMPACT",
    "integrationRequired": "awards",
    "dataRequires": [
      "impactApproved"
    ]
  },
  {
    "command": "BN_MORTALITY_CREATE_PAD_OVERPAYMENT",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": true,
    "transactional": true,
    "validFrom": [
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "integrationRequired": "overpayments",
    "dataRequires": [
      "terminated"
    ]
  },
  {
    "command": "BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "integrationRequired": "survivor"
  },
  {
    "command": "BN_MORTALITY_INITIATE_FUNERAL_GRANT",
    "capability": "bn_mortality:write",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "integrationRequired": "funeral"
  },
  {
    "command": "BN_MORTALITY_COMPLETE_FOLLOWON",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "FOLLOW_ON_PROCESSING"
    ],
    "dataRequires": [
      "referral"
    ]
  },
  {
    "command": "BN_MORTALITY_REFER_LEGAL",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": true,
    "transactional": false,
    "validFrom": [
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING"
    ],
    "integrationRequired": "legal"
  },
  {
    "command": "BN_MORTALITY_REVERSE_CONFIRMATION",
    "capability": "bn_mortality:reverse",
    "implemented": true,
    "requiresMakerChecker": true,
    "requiresJustification": true,
    "transactional": true,
    "validFrom": [
      "VERIFIED",
      "CONFIRMED",
      "FOLLOW_ON_PROCESSING",
      "COMPLETED"
    ],
    "makerSource": "BN_MORTALITY_CONFIRM_VERIFICATION"
  },
  {
    "command": "BN_MORTALITY_CLOSE_EVENT",
    "capability": "bn_mortality:decide",
    "implemented": true,
    "requiresMakerChecker": false,
    "requiresJustification": false,
    "transactional": false,
    "validFrom": [
      "COMPLETED",
      "REJECTED",
      "REVERSED"
    ]
  }
] as const;

export const MORTALITY_COMMAND_COUNT_GENERATED = MORTALITY_COMMAND_CATALOG_GENERATED.length;
