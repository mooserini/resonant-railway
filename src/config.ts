export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required(env, "CLOUDFLARE_D1_DATABASE_ID");
  const apiToken = required(env, "CLOUDFLARE_API_TOKEN");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID");
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId)) throw new Error("CLOUDFLARE_D1_DATABASE_ID must be a database UUID");
  return { accountId, databaseId, apiToken };
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const mcpAuthToken = required(env, "MCP_AUTH_TOKEN");
  if (mcpAuthToken.length < 32 || /\s/.test(mcpAuthToken)) {
    throw new Error("MCP_AUTH_TOKEN must contain at least 32 non-whitespace characters; use a randomly generated secret");
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return { ...readDatabaseConfig(env), mcpAuthToken, port };
}
