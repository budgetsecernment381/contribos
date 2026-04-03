# Contributing to ContribOS

Thank you for your interest in contributing. This document describes how we work together on the codebase.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Finding your first issue

Look for issues labeled [`good first issue`](https://github.com/aayushbaluni/contribos/labels/good%20first%20issue) — these are scoped to be approachable for newcomers to the codebase.

## Development environment

1. **Prerequisites:** Node.js ≥ 22, pnpm ≥ 9, Docker and Docker Compose, Python 3.12+ (for the agent worker), and a [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) for local sign-in.
2. **Clone** the repository and copy environment templates:
   - Root: `.env.example` → `.env` (used by Docker Compose).
   - API (local runs): `services/api/.env.example` → `services/api/.env`.
3. **Install JavaScript dependencies** from the repository root:

   ```bash
   pnpm install
   ```

4. **Infrastructure:** Start PostgreSQL and Redis (for example with `docker compose up postgres redis`, or full stack per [README.md](README.md)).
5. **Database:** From `services/api`, apply the schema (for example `pnpm exec prisma db push` or your team’s migration workflow).
6. **Run services** as needed:
   - Web: `pnpm run dev:web` (Vite dev server, default port **5173**).
   - API: `pnpm run dev:api` (default port **3001**).
   - Worker: from `workers/agent-worker`, install Python deps and run Uvicorn (see README).

Use `pnpm run dev` to run web and API together when you do not need Docker for those two.

## Branch naming

Use lowercase, hyphenated segments after the prefix:

| Prefix     | Use case              |
| ---------- | --------------------- |
| `feature/` | New features          |
| `fix/`     | Bug fixes             |
| `docs/`    | Documentation only    |

Examples: `feature/review-gate-ui`, `fix/job-timeout`, `docs/readme-env-table`.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new functionality  
- `fix:` bug fixes  
- `docs:` documentation  
- `chore:` tooling, config, deps  
- `refactor:`, `test:`, `ci:` as appropriate  

Example: `fix(api): validate worker callback token`.

## Pull requests

1. Open a PR from a named branch (not `master`/`main` direct commits for substantive work).
2. Describe **what** changed and **why**; link related issues when applicable.
3. Keep the diff focused; unrelated refactors belong in separate PRs.
4. Ensure **lint, typecheck, and tests** pass locally before requesting review.
5. Respond to review feedback; maintainers may request changes before merge.

## Code style

- **TypeScript:** Strict mode; match existing patterns in `apps/web` and `services/api` (formatting, imports, error handling).
- **Python:** Use type hints in `workers/agent-worker` where reasonable; follow existing module layout and naming.

## Testing

Before opening a PR:

- **Monorepo (JS/TS):** from the repository root:

  ```bash
  pnpm test
  ```

- **Agent worker (Python):** from `workers/agent-worker`:

  ```bash
  pytest
  ```

Add or update tests when you change behavior that is testable without excessive mocking.

## Reporting issues

Use GitHub Issues for bugs, feature requests, and questions that help the whole community. Include reproduction steps, expected vs actual behavior, and environment (OS, Node/pnpm versions, Docker vs local) when relevant.

## Security vulnerabilities

Do **not** open a public issue for security problems. Follow [SECURITY.md](SECURITY.md).
