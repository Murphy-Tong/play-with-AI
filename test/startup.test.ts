import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cwd = new URL('..', import.meta.url);

test('entrypoint starts on loopback and prints a usable generated MCP credential', { timeout: 10_000 }, async (t) => {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0' };
  delete env.MCP_AUTH_TOKEN;
  const child = spawn(process.execPath, ['src/index.ts'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const client = new Client({ name: 'startup-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  let config: { url: string; authorization: string } | undefined;
  for await (const line of lines) {
    config = JSON.parse(line) as { url: string; authorization: string };
    break;
  }
  assert.ok(config, stderr);
  assert.equal(new URL(config.url).hostname, '127.0.0.1');
  assert.ok(config.authorization.startsWith('Bearer '));
  assert.ok(config.authorization.length >= 50);
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { Authorization: config.authorization } },
  }));
  assert.equal((await client.listTools()).tools.length, 7);
});

test('entrypoint rejects invalid environment values without echoing secrets', async () => {
  for (const settings of [{ PORT: 'not-a-port' }, { PORT: '65536' }, { MCP_AUTH_TOKEN: 'weak-secret' }]) {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd, env: { ...process.env, PORT: '0', ...settings }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /Invalid configuration/);
    assert.equal(output.includes('weak-secret'), false);
  }
});
