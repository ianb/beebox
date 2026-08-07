# Security TODOs (dissolved)

This file was the standing security-posture notes. It dissolved
(2026-08-07) into two better homes, per the
[agent-maintained security report](../../issues/features/2026-07-20-agent-maintained-security-report.md)
design:

- **Current posture, accepted risks, and the full inventory** →
  [docs/security-report.md](security-report.md) (structured accounting)
  and [SECURITY.md](../SECURITY.md) (the readable report).
- **Actionable hardening items** → the issue queue. The items that lived
  here: Google shared-token hardening →
  [google-auth-policy-proxy](../../issues/features/2026-07-28-google-auth-policy-proxy.md);
  WS-auth socket-level test →
  [no-socket-level-ws-auth-test](../../issues/code-quality/2026-08-07-no-socket-level-ws-auth-test.md);
  MFA / web password reset →
  [web-password-reset-account-recovery](../../issues/features/2026-08-07-web-password-reset-account-recovery.md).
  The old "File permissions" section was fixed outright (0600 across the
  credential stores; two residual exceptions tracked in
  [connector-secret-file-modes](../../issues/bugs/2026-08-07-connector-secret-file-modes.md)).

Nothing accumulates here anymore — file security tensions as issues, and
posture changes flow into the report via `/security-report`.
