import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

const cwd = new URL('..', import.meta.url);

test('development entry serves Vue and Web API on the same origin without exposing MCP credentials', { timeout: 20_000 }, async (t) => {
  const secret = 'test-secret-which-must-never-appear-in-the-browser';
  const child = spawn(process.execPath, ['src/index.ts', '--dev'], {
    cwd, env: { ...process.env, PORT: '0', MCP_AUTH_TOKEN: secret }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let url: string | undefined;
  for await (const line of createInterface({ input: child.stdout })) {
    if (line.startsWith('{')) { url = (JSON.parse(line) as { url: string }).url; break; }
  }
  assert.ok(url, stderr);
  const origin = new URL(url).origin;
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /同游/);
  assert.match(html, /\/main.ts/);
  assert.equal(html.includes(secret), false);
  const module = await fetch(`${origin}/main.ts`);
  assert.equal(module.status, 200);
  const games = await fetch(`${origin}/api/games`);
  assert.equal(games.status, 200);
  assert.equal((await games.json()).games[0].id, 'sandbox');
  const missing = await fetch(`${origin}/api/missing`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type')!, /application\/json/);
});
