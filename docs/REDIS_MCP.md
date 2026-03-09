# Redis MCP (Cursor)

The **Redis MCP Server** lets the AI in Cursor talk to Redis (get/set keys, queues, etc.) via natural language. It’s separate from your app’s Redis connection.

## Project config

This project has the Redis MCP configured in **`.cursor/mcp.json`** (PyPI / `uvx`, `redis://localhost:6379/0`). After pulling or editing that file:

1. Ensure **Redis is running** (local or cloud) and the URL in `.cursor/mcp.json` matches (e.g. same as `REDIS_URL` in `.env` if you want app and MCP to share data).
2. **Restart Cursor** so it loads the MCP. Then use **Tools & MCP** in settings to confirm the Redis server is enabled.

To use a different URL (e.g. Redis Cloud), edit the `--url` value in `.cursor/mcp.json`.

---

## 1. You need a Redis instance

- **Local:** [redis.io/download](https://redis.io/download) or `winget install Redis.Redis` (Windows), `brew install redis` (macOS).
- **Cloud:** [Redis Cloud](https://redis.com/try-free/) (free tier), get connection URL or host/port/password.

## 2. Add Redis MCP in Cursor

Cursor reads MCP config from **Cursor Settings → MCP** (or your project’s MCP config file). Add a Redis server there.

### Option A: Official Redis MCP with `uvx` (Python)

You need [uv](https://docs.astral.sh/uv/) (or uvx). Then in Cursor’s MCP config add:

```json
{
  "mcpServers": {
    "redis": {
      "command": "uvx",
      "args": [
        "--from", "git+https://github.com/redis/mcp-redis.git",
        "redis-mcp-server",
        "--url", "redis://localhost:6379/0"
      ]
    }
  }
}
```

- Replace `redis://localhost:6379/0` with your Redis URL (e.g. Redis Cloud: `redis://default:YOUR_PASSWORD@host:port/0`).
- With password: `redis://default:yourpassword@localhost:6379/0`.

### Option B: Docker

If you use Docker and the [official Redis MCP image](https://hub.docker.com/r/mcp/redis):

```json
{
  "mcpServers": {
    "redis": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "REDIS_HOST=host.docker.internal",
        "-e", "REDIS_PORT=6379",
        "-e", "REDIS_PWD=yourpassword",
        "mcp/redis"
      ]
    }
  }
}
```

(Use your real host/port/password; `host.docker.internal` is for Redis on your machine.)

### Option C: Smithery (one-time setup)

```bash
npx -y @smithery/cli install @redis/mcp-redis --client cursor
```

Follow the prompts and set your Redis connection details.

## 3. After adding the server

- Restart Cursor or reload MCP so it picks up the new Redis server.
- You can then ask the AI to “get key X from Redis”, “cache this in Redis”, etc.; it will use the Redis MCP tools.

## 4. App Redis vs MCP Redis

| | **Your Node app** | **Redis MCP** |
|---|-------------------|----------------|
| **Purpose** | Code uses Redis (cache, queues) via `lib/redis.js` and `REDIS_URL` | AI in Cursor can run Redis commands via chat |
| **Config** | `.env` → `REDIS_URL` | Cursor MCP config (see above) |
| **Same Redis?** | Yes — use the same Redis URL/host in both so the app and MCP see the same data. |

Use the same Redis instance (and URL) in both `.env` and the MCP config if you want the app and the AI to share the same Redis data.
