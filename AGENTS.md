# Repository Guidelines

## Project Structure & Module Organization
- `apps/` hosts runnable surfaces: `server` (REST + proxy), `tui` (interactive console), and `lander` (marketing site screenshot assets).
- `packages/` contains reusable modules grouped by concern: telemetry + core logic (`core`, `core-di`, `load-balancer`), IO layers (`http-api`, `proxy`, `database`), shared UI kits (`dashboard-web`, `ui-common`, `ui-constants`), and tooling (`agents`, `cli-commands`).
- Docs and product briefs live in `docs/`; configs such as `tsconfig.json` and `biome.json` sit at the root for repo-wide tooling.

## Build, Test & Development Commands
- `bun install` installs all workspace dependencies (Bun >= 1.2.8 required).
- `bun run dev:server` hot-reloads the API/proxy; `bun run dev:dashboard` serves the React dashboard with Bun’s HMR.
- `bun run tui` launches the interactive terminal UI; `bun run ccflare` builds then starts the TUI + server bundle.
- `bun run build` orchestrates `build:dashboard`, `build:tui`, and optional `build:lander` for release artifacts.
- `bun run typecheck`, `bun run lint`, and `bun run format` gate submissions (Biome auto-formats with tabs + double quotes).

## Coding Style & Naming Conventions
- Follow TypeScript strictness; prefer ES modules and workspace-relative imports (`@ccflare/<package>`).
- Biome enforces tab indentation, double-quoted strings, and organized imports—run `bun run format` before commits.
- Use descriptive PascalCase for React components/Providers, camelCase for functions/instances, SCREAMING_SNAKE_CASE for env vars.

## Testing Guidelines
- The project is migrating to Bun’s built-in test runner; place specs beside source files as `<name>.test.ts` and target observable behavior rather than mocks.
- Until coverage targets solidify, add tests for every bug fix plus high-risk flows (load balancing, account rotation, OAuth refresh). Use `bun test` (or `bun wip --watch` once available) before pushing.

## Commit & Pull Request Guidelines
- Match the existing Conventional Commit style (`feat:`, `fix:`, `chore:`). Scope optional but encouraged for packages (e.g., `fix(tui-core): guard null response`).
- Each PR should describe the change, include reproduction steps or screenshots for UI/TUI work, and link any GitHub issues.
- Ensure CI-critical commands (`typecheck`, `lint`, `build`) pass locally; note any skipped tests and justify in the PR description.

## Security & Configuration Tips
- Keep sensitive credentials in the local `.env`; never commit API keys. Prefer the config modules under `packages/config` for defaults.
- When debugging proxy flows, set `ANTHROPIC_BASE_URL` and related credentials via `bun run server` env vars instead of hardcoding values.
