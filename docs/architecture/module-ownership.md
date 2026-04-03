# Module Ownership Map

## Module Boundaries

| Module | Path | Responsibility | Boundary Rules |
|--------|------|----------------|----------------|
| **Auth** | `services/api/src/modules/auth/` | OAuth callback, JWT issuance, token refresh, session revocation | No direct DB writes outside `users` table; no business logic |
| **Onboarding** | `services/api/src/modules/onboarding/` | Profile ingestion, calibration, tier assignment | Reads from `users`, writes to `user_profiles`, `user_ecosystems`; calls LLM Gateway for calibration |
| **Matching** | `services/api/src/modules/matching/` | Issue scoring, recommendation, claim locking | Reads repos/issues, writes claim state; no job creation |
| **Jobs** | `services/api/src/modules/jobs/` | Job lifecycle, queue dispatch, gate evaluation, artifact metadata | Owns `jobs` table state machine; writes credit transactions; calls queue |
| **Review** | `services/api/src/modules/review/` | Screen 1/2 state machine, comprehension check, approval/rejection | Owns `reviews` table; reads job artifacts; calls LLM Gateway for questions |
| **PR** | `services/api/src/modules/pr/` | Branch push, PR creation, disclosure enforcement, idempotent submit | Owns `pull_requests` table; calls GitHub API; reads review approval |
| **Inbox** | `services/api/src/modules/inbox/` | Webhook processing, comment classification, guidance generation, reminders | Owns `pr_inbox_items` table; calls LLM Gateway for guidance |
| **Reputation** | `services/api/src/modules/reputation/` | CHS computation, tier progression, regression detection | Reads contribution events; writes CHS and tier to `users` |
| **Profile** | `services/api/src/modules/profile/` | Settings, public profile, visibility enforcement | Owns `user_profiles` reads/writes |
| **Credits** | `services/api/src/modules/credits/` | Balance queries, transaction history | Read-only on `credit_transactions`; balance changes happen in Jobs |
| **Admin** | `services/api/src/modules/admin/` | Repository allowlisting, prestige graph, policy management | Owns `repositories` admin writes; admin-gated |
| **AI** | `services/api/src/modules/ai/` | LLM gateway, provider registry, provider catalog, LLM preferences | Abstracts all LLM provider interactions for API-side workflows |
| **Health** | `services/api/src/modules/health/` | Readiness/liveness probes | No auth required; no writes |
| **Agent Worker** | `workers/agent-worker/` | Sandbox execution, diff generation, test running, artifact production | Isolated Python process; communicates via REST; uses provider adapters |

## Dependency Rules

1. Modules may **only** import from `common/` (shared types, guards, errors, config) and `lib/` (prisma, queue, s3 clients).
2. Cross-module imports are **forbidden**. If Module A needs data from Module B, it goes through the service interface, not direct import.
3. Exception: `ai/` module exports (`llm.gateway.ts`, `provider-catalog.ts`) may be imported by any module that needs LLM capabilities.
4. The `common/` directory is shared infrastructure — no business logic belongs there.
5. Worker communicates with API exclusively via REST contract (`POST /execute`, `POST /callback`).

## Data Flow Guardrails

- **Credit mutations** only happen inside `jobs.service.ts` within transactions.
- **Tier mutations** only happen in `onboarding.service.ts` (initial) and `reputation.service.ts` (progression).
- **Claim state** only changes in `matching.service.ts` within serializable transactions.
- **Job status** transitions follow the state machine: `queued → running → completed/failed → review_pending → approved/rejected → submitted`.
- **Review state** follows sequential progression: `not_started → section_a_viewed → section_b_viewed → diff_viewed → questions_presented → completed/failed`.
