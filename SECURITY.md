# Security Policy

## Reporting

Email security@voidstrike.gg (or open a private security advisory). We
respond within 72 hours.

## Scope highlights

- **Game integrity**: score submission anti-fraud (Protocol §10 ceiling +
  statistical flags in the Java service); server-authoritative Versus; no
  client-trusted state.
- **Secrets**: never commit tokens (CI runs gitleaks). Model registry
  artifacts are `rules_hash`-pinned — loading a mismatched policy fails hard.
- **Transport**: WSS everywhere in production; the gameserver never trusts
  client positions, only last-wins intent inputs.
