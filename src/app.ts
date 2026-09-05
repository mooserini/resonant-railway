import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { D1TodoStore } from "./d1.js";

const digest = (token: string) => createHash("sha256").update(token).digest();

function createServer(store: D1TodoStore) {
  const server = new McpServer({ name: "todo-mcp-server", version: "1.0.0" });
  server.registerTool("create_todo", {
    description: "Add a task to the to-do list",
    inputSchema: z.object({ title: z.string().trim().min(1).max(2000).describe("What needs doing") }),
  }, async ({ title }) => {
    const todo = await store.create(title);
    return { content: [{ type: "text", text: `Created ${todo.id}: ${title}` }] };
  });
  server.registerTool("list_todos", {
    description: "List every task and its status",
    inputSchema: z.object({}),
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await store.list(), null, 2) }] }));
  server.registerTool("complete_todo", {
    description: "Mark a task as done",
    inputSchema: z.object({ id: z.string().uuid().describe("The id returned by create_todo") }),
  }, async ({ id }) => {
    const todo = await store.complete(id);
    return todo
      ? { content: [{ type: "text", text: `Done: ${todo.title}` }] }
      : { content: [{ type: "text", text: `No task with id ${id}` }], isError: true };
  });
  return server;
}

export function createApp(store: D1TodoStore, mcpAuthToken: string) {
  if (!mcpAuthToken || mcpAuthToken.length < 32 || /\s/.test(mcpAuthToken)) throw new Error("A strong MCP_AUTH_TOKEN is required");
  const expected = digest(mcpAuthToken);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.get("/healthz", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/mcp", (req, res, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token || !timingSafeEqual(digest(token), expected)) {
      res.set("WWW-Authenticate", 'Bearer realm="mcp"').status(401).send("Unauthorized");
      return;
    }
    next();
  });
  app.post("/mcp", async (req, res) => {
    const server = createServer(store);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
    } finally {
      await server.close().catch(() => undefined);
    }
  });
  app.all("/mcp", (_req, res) => { res.set("Allow", "POST").status(405).send("Method not allowed"); });
  return app;
}
