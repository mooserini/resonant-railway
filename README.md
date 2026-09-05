# resonant-railway
Railway gives Resonance to the Mirror

A personal MCP server with three tools: `create_todo`, `list_todos`, and
`complete_todo`. It stores tasks in Cloudflare D1 through the HTTPS REST API.
The Node.js server can run on Railway; no Cloudflare Worker or Wrangler is needed.

This is persistent task storage. Conversation recording and memory search are
not implemented.

## Configuration

Use Node.js 22.13 or later. Install and build:

```sh
npm ci
npm run build
```

For local use, copy `.env.example` to `.env` if `.env` does not already exist.
Set the following values:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing your D1 database |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 database UUID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Account / D1 / Edit permission for that account |
| `MCP_AUTH_TOKEN` | A separate, randomly generated secret shared with your MCP client |
| `PORT` | Optional listening port; defaults to 3000 |

Generate the MCP secret with a password manager or `openssl rand -hex 32`.
Keep both secrets out of Git and chat. `.env` is ignored by Git; protect a local
copy with `chmod 600 .env`. The account-scoped Cloudflare token can access D1
resources beyond the particular database ID configured in this application.

Verify database read access without creating tables or changing data:

```sh
npm run db:check
```

Then start the server:

```sh
npm run start:local
```

Startup validates configuration, creates the `todos` table **if it is missing**,
checks its columns, then opens the HTTP listener. Existing tasks remain intact.
Missing credentials or an inaccessible/incompatible database stop startup.
The Cloudflare token is never sent to the MCP client.

## Connect a client

Use Streamable HTTP at `http://localhost:3000/mcp` locally, or
`https://YOUR_SERVICE_DOMAIN/mcp` when hosted. Configure the client to send:

```text
Authorization: Bearer YOUR_MCP_AUTH_TOKEN
```

The client must support custom authorization headers or bearer-token
configuration. There is no browser login or OAuth flow. Possession of this
MCP token permits all three tools against the shared task list.

All `/mcp` requests require the token. `/healthz` is public and returns only
`{"status":"ok"}` once startup has completed; it does not probe D1 on every call.

## Railway

Deploy the repository as a Node.js service. Set the four required variables
above in the service's Variables panel, set the build command to `npm run build`
and start command to `npm start`, and use `/healthz` as the healthcheck path.
Railway supplies `PORT`. Configure credentials before exposing the service's
public domain. The server binds to `0.0.0.0` for Railway routing.

`npm start` uses injected environment variables; `.env` is only loaded by the
local commands. Keep the same `MCP_AUTH_TOKEN` configured in the client and
service across redeployments. Updating it revokes clients using the old value.

D1's direct REST API is subject to Cloudflare's global API limits. Failed
requests become tool errors; the server never falls back to temporary memory.
Writes are not retried automatically because a lost response can follow a
successful write. Check `list_todos` before retrying a creation after a timeout.

## Validation

```sh
npm test
```

Tests run entirely offline using an emulated D1 HTTP response backed by a real
temporary SQLite database. They cover HTTP authentication, required secrets,
tool calls, persistence across app/database restart, concurrent requests,
SQL parameterization, and upstream failures. Passing them does not establish
that a live Cloudflare token has D1 permissions or that Railway is deployed.

References: [Railway MCP guide](https://docs.railway.com/guides/mcp-server),
[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
[D1 API token permissions](https://developers.cloudflare.com/d1/tutorials/import-to-d1-with-rest-api/).
