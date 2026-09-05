import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { D1TodoStore } from "./d1.js";

async function main() {
  const config = readConfig();
  const store = new D1TodoStore(config);
  await store.initialize();
  const app = createApp(store, config.mcpAuthToken);
  const listener = app.listen(config.port, "0.0.0.0", () => {
    console.log(`MCP server listening on port ${config.port}; D1 storage ready`);
  });
  const shutdown = () => {
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Server startup failed");
  process.exitCode = 1;
});
