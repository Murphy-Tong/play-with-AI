import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cwd = new URL('..', import.meta.url);

test('entrypoint starts on loopback and prints a usable MCP endpoint', { timeout: 10_000 }, async (t) => {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0' };
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
  let config: { url: string; authorization?: unknown } | undefined;
  for await (const line of lines) {
    config = JSON.parse(line) as { url: string; authorization?: unknown };
    break;
  }
  assert.ok(config, stderr);
  assert.equal(new URL(config.url).hostname, '127.0.0.1');
  assert.equal(config.authorization, undefined);
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
  assert.equal((await client.listTools()).tools.length, 9);
});

test('entrypoint rejects invalid environment values without echoing them', async () => {
  for (const settings of [{ PORT: 'not-a-port' }, { PORT: '65536' }]) {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd, env: { ...process.env, ...settings }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /Invalid configuration/);
    assert.equal(output.includes('not-a-port'), false);
  }
});
