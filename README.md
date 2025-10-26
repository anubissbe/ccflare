# ccflare 🛡️

**Track Every Request. Go Low-Level. Never Hit Rate Limits Again.**

The ultimate Claude API proxy with intelligent load balancing across multiple accounts. Full visibility into every request, response, and rate limit.


https://github.com/user-attachments/assets/c859872f-ca5e-4f8b-b6a0-7cc7461fe62a


![ccflare Dashboard](apps/lander/src/screenshot-dashboard.png)

## Why ccflare?

- **🚀 Zero Rate Limit Errors** - Automatically distribute requests across multiple accounts
- **📊 Request-Level Analytics** - Track latency, token usage, and costs in real-time  
- **🔍 Deep Debugging** - Full request/response logging and error traces
- **⚡ <10ms Overhead** - Minimal performance impact on your API calls
- **💸 Free & Open Source** - Run it yourself, modify it, own your infrastructure

## Quick Start

```bash
# Clone and install
git clone https://github.com/snipeship/ccflare
cd ccflare
bun install

# Start ccflare (TUI + Server)
bun run ccflare

# Configure Claude SDK
export ANTHROPIC_BASE_URL=http://localhost:8080
```

## Run with Docker

```bash
# Build the image (ships with dashboard assets prebuilt)
docker build -t ccflare .

# Start the server inside Docker
docker run -d \
  --name ccflare \
  -p 8080:8080 \
  -v ccflare_data:/data \
  -e PORT=8080 \
  -e LB_STRATEGY=session \
  ccflare
```

The container stores configuration and the SQLite database under `/data` (mapped to
`ccflare_CONFIG_PATH=/data/config/ccflare.json` and `ccflare_DB_PATH=/data/storage/ccflare.db`).
Mount a volume there (shown above) to persist settings between restarts. See
[`docs/deployment.md`](docs/deployment.md#docker-deployment) for compose examples
and advanced options (health checks, reverse proxies, custom networks, etc.).

## Agent Workspaces & Discovery

ccflare loads agents from Markdown files inside `.claude/agents/` folders. To keep
your container in sync with projects scattered across Linux, WSL, or Windows:

```bash
# One-time automation: scan, capture workspaces, restart container with minimal mounts
bun run agents:setup

# Manual scan if you want to keep the container running
bun run agents:scan -- /host /mnt/c --max-depth 8
```

- The setup script stops `ccflare-dev`, launches a helper container with wide
  mounts, runs the scanner, and restarts `ccflare-dev` with only the discovered
  bind mounts plus `/data`, while sharing a `ccflare-workspaces` volume that
  persists `/root/.ccflare/workspaces.json` between restarts.
- The dashboard now includes a **Register Workspace Paths** card (Agents tab) so
  you can add absolute paths on the fly. Behind the scenes it calls
  `POST /api/workspaces` (documented in [`docs/api-http.md`](docs/api-http.md#post-apiworkspaces)).
- For more examples (mount tables, environment variables, troubleshooting) see
  [`docs/agent-workspaces.md`](docs/agent-workspaces.md).

## Features

### 🎯 Intelligent Load Balancing
- **Session-based** - Maintain conversation context (5hr sessions)

### 📈 Real-Time Analytics
- Token usage tracking per request
- Response time monitoring
- Rate limit detection and warnings
- Cost estimation and budgeting

### 🛠️ Developer Tools
- Interactive TUI (`bun run ccflare`)
- Web dashboard (`http://localhost:8080/dashboard`)
- CLI for account management
- REST API for automation

### 🔒 Production Ready
- Automatic failover between accounts
- OAuth token refresh handling
- SQLite database for persistence
- Configurable retry logic

## Documentation

Full documentation available in [`docs/`](docs/):
- [Getting Started](docs/index.md)
- [Architecture](docs/architecture.md) 
- [API Reference](docs/api-http.md)
- [Configuration](docs/configuration.md)
- [Load Balancing Strategies](docs/load-balancing.md)

## Screenshots

<table>
  <tr>
    <td><img src="apps/lander/src/screenshot-dashboard.png" alt="Dashboard"/></td>
    <td><img src="apps/lander/src/screenshot-logs.png" alt="Logs"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Dashboard</b></td>
    <td align="center"><b>Request Logs</b></td>
  </tr>
  <tr>
    <td colspan="2"><img src="apps/lander/src/screenshot-analytics.png" alt="Analytics"/></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>Analytics & Usage Tracking</b></td>
  </tr>
</table>

## Requirements

- [Bun](https://bun.sh) >= 1.2.8
- Claude API accounts (Free, Pro, or Team)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](docs/contributing.md) for guidelines.

## License

MIT - See [LICENSE](LICENSE) for details

---

<p align="center">
  Built with ❤️ for developers who ship
</p>

[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge-flat.svg)](https://github.com/hesreallyhim/awesome-claude-code)

[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)
