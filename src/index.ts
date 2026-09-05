import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

type Todo = { id: string; title: string; done: boolean };
const todos = new Map<string, Todo>();

const server = new McpServer({
  name: "todo-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "create_todo",
  {
    description: "Add a task to the to-do list",
    inputSchema: z.object({
      title: z.string().describe("What needs doing"),
    }),
  },
  async ({ title }) => {
    const todo: Todo = { id: randomUUID(), title, done: false };
    todos.set(todo.id, todo);
    return {
      content: [{ type: "text", text: `Created ${todo.id}: ${title}` }],
    };
  }
);

server.registerTool(
  "list_todos",
  {
    description: "List every task and its status",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [
      { type: "text", text: JSON.stringify([...todos.values()], null, 2) },
    ],
  })
);

server.registerTool(
  "complete_todo",
  {
    description: "Mark a task as done",
    inputSchema: z.object({
      id: z.string().describe("The id returned by create_todo"),
    }),
  },
  async ({ id }) => {
    const todo = todos.get(id);
    if (!todo) {
      return {
        content: [{ type: "text", text: `No task with id ${id}` }],
        isError: true,
      };
    }
    todo.done = true;
    return {
      content: [{ type: "text", text: `Done: ${todo.title}` }],
    };
  }
);

// host: "0.0.0.0" binds for deployment. The default binds 127.0.0.1 and
// enables localhost-only DNS rebinding protection, which rejects requests
// arriving through a public domain.
const app = createMcpExpressApp({ host: "0.0.0.0" });

app.post("/mcp", async (req, res) => {
  // A fresh transport per request: stateless, per the 2026-07-28 spec.
  // sessionIdGenerator: undefined opts out of the legacy session mode
  // kept for clients on older spec revisions.
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`MCP server listening on port ${port}`);
});
