---
description: Secure credential handling for TypeScript projects
applyTo: "**/*.ts,**/*.tsx,**/*.js"
---
# Credential Storage Rules

- Never hardcode API keys, passwords, tokens, or other credentials.
- Read secrets from environment variables or a platform secret manager.
- Never log credentials or include them in error messages.
- Keep local secret files out of version control; examples must contain only
  empty placeholders.
