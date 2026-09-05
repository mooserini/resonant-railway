import { readDatabaseConfig } from "./config.js";
import { D1TodoStore } from "./d1.js";

async function main() {
  const store = new D1TodoStore(readDatabaseConfig());
  const tables = await store.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  console.log("D1 read access verified. Tables:", JSON.stringify(tables));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "D1 verification failed");
  process.exitCode = 1;
});
