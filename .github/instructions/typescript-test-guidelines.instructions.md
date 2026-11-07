---
description: Require automated tests for every TypeScript change (TDD)
applyTo: "**/*.ts,**/*.tsx"
---
# Automated Tests Required (TypeScript)

For any new or updated TypeScript implementation, add or update executable
automated tests. Prefer the project's existing test framework.

Tests should cover expected behavior, boundaries, invalid inputs, failures, and
regressions. Keep tests deterministic and isolate external services by default.
