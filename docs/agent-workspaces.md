# Agent Workspace Discovery

ccflare automatically surfaces agents that live in Markdown files under `.claude/agents/` folders. This guide covers every way to point the proxy at new projects—across Linux, WSL, and Windows—and how to keep the container mounts in sync.

## Default Discovery Flow

1. **Scan for `.claude/agents` directories.** The `packages/agents` scanner crawls the filesystem and writes the results to `~/.ccflare/workspaces.json`.
2. **Persist the workspace list.** Each entry stores the absolute path, a short name, and `lastSeen` timestamp.
3. **Load agents.** The dashboard/API reads every Markdown file and merges metadata with any per-agent model preferences stored in the database.

You can trigger the scan manually (`bun run agents:scan`) or run the automation script described below.

## Manual Scan (`bun run agents:scan`)

```
bun run agents:scan -- /host /mnt/c --max-depth 8
```

- Without arguments the scanner walks the current directory, your home folder, and a platform-aware list of defaults (`/workspaces`, `/host`, `/mnt/<drive>`, `/host_mnt/<drive>`, etc.).
- Pass custom roots via CLI arguments or `AGENT_SCAN_ROOTS="/host,/mnt/c"`. Use `AGENT_SCAN_EXTRA_ROOTS` to append to the defaults.
- `AGENT_SCAN_MAX_DEPTH` controls recursion depth (default `8`). Set `AGENT_SCAN_INCLUDE_ROOT=true` if you truly want to traverse `/`.
- Windows paths such as `C:\Projects\Repo` are automatically normalized to `/mnt/c/Projects/Repo` when the scanner runs inside WSL/Linux.

The command logs every discovered `.claude/agents` directory plus any warnings (e.g., unsupported `model: inherit`).

## Automated Setup (`bun run agents:setup`)

The orchestration script handles the full workflow:

1. Stops the current `ccflare-dev` container and any previous helper containers.
2. Launches a temporary `ccflare-dev-scan` container with wide mounts (`/` → `/host`, `/mnt/*`).
3. Runs the scanner (`bun run agents:scan --max-depth 8 /host /mnt/c`).
4. Reads `~/.ccflare/workspaces.json` from the helper container.
5. Tears down the helper and restarts `ccflare-dev` with bind mounts only for the discovered directories plus `/data`.

```bash
bun run agents:setup
```

Environment variables:

| Variable | Description |
| --- | --- |
| `CCFLARE_CONTAINER` | Name for the runtime container (`ccflare-dev` by default). |
| `CCFLARE_IMAGE` | Image tag to run (`ccflare:latest`). |
| `CCFLARE_DATA_VOLUME` | Data volume name (`ccflare-data`). |
| `CCFLARE_WORKSPACES_VOLUME` | Named volume that persists `/root/.ccflare/workspaces.json` (`ccflare-workspaces`). |
| `AGENT_SCAN_ROOTS` | Extra roots to mount during the scan (comma/semicolon/newline separated). |
| `AGENT_SCAN_MAX_DEPTH` | Overrides traversal depth. |

If no workspaces are found the script falls back to the wide mounts so you can diagnose manually.

## Mounting Host Paths

The scanner (and later the server) only sees directories that are mounted into the container. Examples:

| Host | Sample `docker run` mounts |
| --- | --- |
| Native Linux | `-v /:/host` plus more targeted paths (`-v /srv/projects:/srv/projects`). |
| WSL2 | `-v /:/host -v /mnt/c:/mnt/c` so Windows drives are visible as `/mnt/c`. |
| Windows (Docker Desktop) | `-v C:\\Users\\me\\agents:/windows/agents` for each shared directory. |

After adjusting mounts, rerun `bun run agents:setup` so the helper container refreshes both the bind mounts and the persisted `/root/.ccflare/workspaces.json` living inside the `ccflare-workspaces` volume. If you prefer to keep the container running, call `bun run agents:scan` followed by `POST /api/workspaces` (see below).

## Registering Paths from the Dashboard/API

- **Dashboard:** In the **Agents → Register Workspace Paths** card, paste absolute paths (e.g., `/opt/projects/app`, `/mnt/c/Users/me/tooling`). Paths are normalized and sent to the API; success/errors are shown inline.
- **API:**
  ```bash
  curl -X POST http://localhost:8080/api/workspaces \
    -H "Content-Type: application/json" \
    -d '{"paths":["/opt/projects/app","/mnt/c/Users/me/tooling"]}'
  ```
  The handler checks each path, registers valid ones, and returns counts for `added`, `updated`, `skipped`, plus any `invalidPaths`.

## Common Warnings

- **“invalid model: inherit”** – The agent file specifies a shorthand model name that ccflare doesn’t recognize. The default agent model (configurable in the dashboard/API) is used instead.
- **Duplicate agents** – Multiple mounts often point to the same repo (e.g., `/mnt/c/...` and Docker Desktop’s bind-mount mirrors). ccflare logs the duplicates but keeps the first copy; no action is required unless you want to prune redundant mounts.

Refer to [`docs/deployment.md`](docs/deployment.md#host-mounts-for-agent-discovery-linux-windows-wsl) for more mount examples and [`docs/api-http.md`](docs/api-http.md#post-apiworkspaces) for the full workspace API reference.
