# Security Policy

## Supported Versions

Security updates are applied to the latest minor release line. Use the newest tagged release when possible.

| Version   | Supported |
| --------- | --------- |
| 0.1.x     | Yes       |
| Pre-0.1.0 | No        |

## Reporting a Vulnerability

**Please do not report security issues through public GitHub issues.**

- **Preferred:** Use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository (if enabled by maintainers).
- **Email:** Send details to **security@contribos.dev** with a clear subject line (for example, `Security: brief summary`). Include steps to reproduce, affected components, and impact if known.

**Response time:** Maintainers aim to acknowledge receipt within **72 hours** (business days) and to provide a substantive update on triage within **7 days**, depending on severity and complexity. Timelines may vary for volunteer-maintained periods.

## Disclosure Policy

- Reports are handled confidentially until a fix is available or the reporter and maintainers agree on disclosure timing.
- Credit is given in advisories or release notes when the reporter wishes to be named.
- Coordinated disclosure: public discussion of unresolved vulnerabilities should wait until a patch or mitigation is published, unless otherwise agreed.

## Scope

### In scope

- This repository’s application code (`apps/web`, `services/api`, `workers/agent-worker`) and documented deployment configuration (for example, `docker-compose.yml`, Dockerfiles) when used as shipped.
- Authentication, authorization, session handling, and handling of secrets or tokens in the platform.
- Job queue, worker, and integration surfaces (GitHub OAuth, webhooks, LLM provider calls) implemented in this codebase.

### Out of scope

- Third-party services (GitHub, cloud providers, LLM vendors) except where this project’s integration is clearly at fault.
- Issues requiring physical access, social engineering, or compromised maintainer or user machines.
- Denial-of-service via resource exhaustion without a practical mitigation path in the application.
- Findings in dependencies without a demonstrable impact on ContribOS (report upstream; we still welcome a heads-up if you believe we must pin or patch).

If you are unsure whether something is in scope, report it anyway; triage will classify it.
