# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** page.
2. Select **Advisories**.
3. Select **Report a vulnerability**.

Do not open a public issue with exploit steps, credentials, private repository
content, or a working bypass. A public issue may describe affected boundaries
and remediation status after maintainers have contained the issue.

Include the affected Lazyhub version, platform, operation, expected security
boundary, observed behavior, reproduction, and any evidence of credential or
repository impact. Remove live secrets from attachments.

## Supported versions

Until the first stable gateway release, security fixes target the latest npm
release and the current `main` branch. Maintainers may ask reporters to verify a
private candidate build before coordinated disclosure.

## Security model

Read `docs/THREAT_MODEL.md` for the exact claims, exclusions, coverage states,
and T1-T21 threat checklist. In particular, Alpha is approval-only, local-agent
approval is `managed_gateway`, and Lazyhub does not claim to secure a fully
compromised same-user operating system.
