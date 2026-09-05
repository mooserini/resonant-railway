const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { D1TodoStore } = require('../dist/d1.js');
const { createApp } = require('../dist/app.js');
const { readConfig } = require('../dist/config.js');

const config = {
  accountId: 'a'.repeat(32), databaseId: '00000000-0000-4000-8000-000000000000', apiToken: 'test-cloudflare-secret',
};
const mcpToken = 'test-mcp-secret-'.repeat(4);
const env = {
  CLOUDFLARE_ACCOUNT_ID: config.accountId, CLOUDFLARE_D1_DATABASE_ID: config.databaseId,
  CLOUDFLARE_API_TOKEN: config.apiToken, MCP_AUTH_TOKEN: mcpToken,
};

function sqliteApi(db) {
  return async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`);
    assert.equal(options.headers.Authorization, `Bearer ${config.apiToken}`);
    assert.equal(options.method, 'POST');
    const { sql, params } = JSON.parse(options.body);
    const results = db.prepare(sql).all(...params).map(row => ({ ...row }));
    return Response.json({ success: true, result: [{ success: true, results }] });
  };
}

async function serve(store) {
  const server = createApp(store, mcpToken).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    rpc: async (method, params, authorization = `Bearer ${mcpToken}`) => fetch(`${url}/mcp`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25', ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  };
}

async function call(app, name, args = {}) {
  const response = await app.rpc('tools/call', { name, arguments: args });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body));
  return body.result;
}

test('missing or weak secrets stop startup before database access', () => {
  for (const name of Object.keys(env)) {
    const incomplete = { ...env };
    delete incomplete[name];
    assert.throws(() => readConfig(incomplete), new RegExp(name));
  }
  assert.throws(() => readConfig({ ...env, MCP_AUTH_TOKEN: 'short' }), /MCP_AUTH_TOKEN/);
  assert.throws(() => createApp({}, ''), /MCP_AUTH_TOKEN/);
  const processResult = spawnSync(process.execPath, ['dist/index.js'], { env: {}, encoding: 'utf8' });
  assert.equal(processResult.status, 1);
  assert.match(processResult.stderr, /Missing required environment variable: MCP_AUTH_TOKEN/);
});

test('unauthorized requests cannot reach the store; health reveals no secrets', async t => {
  let queries = 0;
  const store = new D1TodoStore(config, async () => { queries++; throw new Error('unexpected database access'); });
  const app = await serve(store);
  t.after(app.close);
  for (const authorization of [undefined, 'Bearer wrong', mcpToken, `Basic ${mcpToken}`]) {
    const response = await app.rpc('tools/call', { name: 'list_todos', arguments: {} }, authorization ?? '');
    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'Unauthorized');
  }
  assert.equal((await fetch(`${app.url}/mcp`)).status, 401);
  assert.equal((await fetch(`${app.url}/mcp`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 405);
  assert.equal(queries, 0);
  assert.deepEqual(await (await fetch(`${app.url}/healthz`)).json(), { status: 'ok' });
});

test('MCP tools persist across app and SQLite reopen; SQL text stays data', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'resonant-d1-test-'));
  const file = join(folder, 'todos.sqlite');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let db = new DatabaseSync(file);
  let app;
  t.after(async () => { if (app) await app.close(); db.close(); });
  let store = new D1TodoStore(config, sqliteApi(db));
  await store.initialize();
  app = await serve(store);
  const tools = await (await app.rpc('tools/list', {})).json();
  assert.deepEqual(tools.result.tools.map(tool => tool.name).sort(), ['complete_todo', 'create_todo', 'list_todos']);
  const title = "Tom's task'); DROP TABLE todos; --";
  const created = await call(app, 'create_todo', { title });
  assert.equal(created.isError, undefined);
  const id = created.content[0].text.match(/^Created ([\w-]+):/)[1];
  await app.close(); app = undefined; db.close();
  db = new DatabaseSync(file);
  store = new D1TodoStore(config, sqliteApi(db));
  await store.initialize();
  app = await serve(store);
  const listed = JSON.parse((await call(app, 'list_todos')).content[0].text);
  assert.deepEqual(listed, [{ id, title, done: false }]);
  assert.equal((await call(app, 'complete_todo', { id })).content[0].text, `Done: ${title}`);
  assert.equal(JSON.parse((await call(app, 'list_todos')).content[0].text)[0].done, true);
  assert.equal((await call(app, 'complete_todo', { id: config.databaseId })).isError, true);
  assert.equal((await call(app, 'create_todo', { title: '   ' })).isError, true);
  const parallel = await Promise.all(Array.from({ length: 5 }, (_, i) => call(app, 'create_todo', { title: `Parallel ${i}` })));
  assert.ok(parallel.every(result => !result.isError));
  assert.equal(JSON.parse((await call(app, 'list_todos')).content[0].text).length, 6);
});

test('D1 permission, rate limit, malformed, and query failures stay failures without leaking response text', async () => {
  for (const status of [401, 403, 429, 500]) {
    const store = new D1TodoStore(config, async () => new Response('private SQL and credentials', { status }));
    await assert.rejects(store.list(), { message: `D1 request failed (HTTP ${status})` });
  }
  for (const body of [{ success: false }, { success: true, result: [{ success: false, results: [] }] }, { success: true, result: [] }, {}]) {
    const store = new D1TodoStore(config, async () => Response.json(body));
    await assert.rejects(store.create('test'), /unsuccessful or invalid/);
  }
  let attempts = 0;
  const store = new D1TodoStore(config, async () => { attempts++; throw new Error('secret in upstream error'); });
  await assert.rejects(store.create('test'), /a write may have completed/);
  assert.equal(attempts, 1);
});
