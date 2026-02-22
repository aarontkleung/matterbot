# MatterBot

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/claude-agent-sdk` | Claude Agent SDK reference — use for any SDK questions, query() usage, hooks, MCP, sessions, permissions |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management (systemd user unit):
```bash
systemctl --user restart matterbot   # Restart
systemctl --user stop matterbot      # Stop
systemctl --user start matterbot     # Start
systemctl --user status matterbot    # Check status
journalctl --user -u matterbot -f    # Tail logs
```

## Container Build Cache

Docker's buildkit caches the build context aggressively. To force a truly clean rebuild:

```bash
docker builder prune -af
./container/build.sh
```

Always verify after rebuild: `docker run -i --rm --entrypoint wc matterbot-agent:latest -l /app/src/index.ts`
