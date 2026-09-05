import { randomUUID } from "node:crypto";
import { z } from "zod";

export type Todo = { id: string; title: string; done: boolean };
const envelopeSchema = z.object({
  success: z.boolean(),
  result: z.array(z.object({ success: z.boolean(), results: z.array(z.unknown()) })).optional(),
});
const todoRowsSchema = z.array(z.object({
  id: z.string(), title: z.string(), done: z.union([z.literal(0), z.literal(1)]),
}));

export class D1TodoStore {
  private readonly url: string;
  private readonly apiToken: string;

  constructor(
    config: { accountId: string; databaseId: string; apiToken: string },
    private readonly request: typeof fetch = fetch,
  ) {
    this.url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
    this.apiToken = config.apiToken;
  }

  async query(sql: string, params: string[] = []): Promise<unknown[]> {
    // A lost response may follow a committed write; do not automatically retry.
    let response: Response;
    try {
      response = await this.request(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new Error("D1 request failed or timed out; a write may have completed. Check the task list before retrying.");
    }
    if (!response.ok) throw new Error(`D1 request failed (HTTP ${response.status})`);
    // Upstream response text can contain SQL or private data; do not forward it.
    const body = envelopeSchema.safeParse(await response.json().catch(() => null));
    if (!body.success || !body.data.success || body.data.result?.length !== 1 || !body.data.result[0].success) {
      throw new Error("D1 returned an unsuccessful or invalid query response");
    }
    return body.data.result[0].results;
  }

  async initialize(): Promise<void> {
    await this.query(`CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    await this.query("SELECT id, title, done, created_at FROM todos LIMIT 0");
  }

  async create(title: string): Promise<Todo> {
    const todo = { id: randomUUID(), title, done: false };
    await this.query("INSERT INTO todos (id, title, done) VALUES (?, ?, 0)", [todo.id, title]);
    return todo;
  }

  async list(): Promise<Todo[]> {
    const rows = todoRowsSchema.parse(await this.query("SELECT id, title, done FROM todos ORDER BY created_at, id"));
    return rows.map(row => ({ ...row, done: row.done === 1 }));
  }

  async complete(id: string): Promise<Todo | undefined> {
    const rows = todoRowsSchema.parse(await this.query("UPDATE todos SET done = 1 WHERE id = ? RETURNING id, title, done", [id]));
    return rows[0] ? { ...rows[0], done: rows[0].done === 1 } : undefined;
  }
}
