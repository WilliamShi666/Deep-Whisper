import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('voice controls use a semantic high-contrast surface over artwork', async () => {
  const source = await readFile(new URL('../src/components/chat/voice-bar.tsx', import.meta.url), 'utf8');

  assert.match(source, /bg-background\/90/);
  assert.match(source, /text-foreground\/90/);
  assert.match(source, /ring-foreground\/15/);
  assert.match(source, /color-mix\(in oklab, \$\{accent\} 40%, var\(--foreground\)\)/);
  assert.match(source, /data-testid="voice-bar"/);
});

test('timestamps use a semantic local backdrop instead of sitting directly on wallpaper highlights', async () => {
  const source = await readFile(new URL('../src/components/chat/message-bubble.tsx', import.meta.url), 'utf8');

  assert.match(source, /bg-background\/90/);
  assert.match(source, /text-foreground\/90/);
  assert.match(source, /ring-foreground\/10/);
  assert.equal(source.match(/data-testid="message-timestamp"/g)?.length, 2);
});
