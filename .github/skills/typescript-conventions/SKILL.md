---
name: typescript-conventions
description: Pragmatic TypeScript conventions for readable, safe, maintainable code.
---

# TypeScript Conventions

- Follow the repository's existing patterns and tooling.
- Keep boundaries explicit; validate untrusted input.
- Prefer readable types and clear errors over unsafe assertions or silent
  fallbacks.
- Keep core logic deterministic and isolate side effects so it can be tested.
