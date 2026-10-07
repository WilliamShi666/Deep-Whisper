import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');
const coreRoutes = [
  'visitor', 'companions', 'companions/[id]', 'conversations', 'conversations/[id]',
  'conversations/[id]/messages', 'profile', 'relationship', 'themes', 'feedback',
  'chat', 'photo', 'tts', 'tts-preview', 'upload', 'persona-enhance',
];

for (const route of coreRoutes) {
  test(`OSS-002/013 ${route} runs without Supabase or payment dependencies`, () => {
    const text = source(`src/app/api/${route}/route.ts`);
    assert.equal(/supabase-client|lib\/billing|MEMBERSHIP_REQUIRED|reserveAiReply|hasPaidFeature/.test(text), false,
      `${route} must use owner + personal repositories/capabilities`);
  });
}

for (const path of ['src/lib/api.ts', 'src/lib/auth.tsx', 'src/app/layout.tsx']) {
  test(`OSS-008 ${path} does not depend on Supabase accounts`, () => {
    assert.equal(/supabase-browser|supabase-config|supabase\.auth/.test(source(path)), false,
      'single-owner access must use the owner session');
  });
}

for (const path of ['chat-shell.tsx', 'companion-settings.tsx', 'voice-bar.tsx', 'user-panel.tsx']) {
  test(`OSS-004/013 ${path} presents configured features without purchase gates`, () => {
    assert.equal(/membershipPaid|\/pricing|\/api\/billing|voice_locked|letters_locked/.test(source(`src/components/chat/${path}`)), false,
      'personal UI must explain missing capability and offer no payment path');
  });
}

test('OSS-013 billing and obsolete auth routes are removed', () => {
  for (const route of ['billing/status', 'billing/catalog', 'billing/checkout', 'billing/cancel',
    'billing/change-period', 'billing/dev-market', 'billing/local-return', 'supabase-config', 'auth-providers',
    'admin/feedback', 'admin/session']) {
    assert.equal(existsSync(resolve(root, `src/app/api/${route}/route.ts`)), false, `${route} must be removed`);
  }
});

test('OSS-015 chat completes through durable organizer jobs without Next after()', () => {
  const text = source('src/app/api/chat/route.ts');
  assert.equal(/after\(|persistMemory/.test(text), false, 'memory work must be durable, outside the response process');
  assert.equal(/finishReply|persistAssistantWithJob/.test(text), true, 'assistant + organizer job must commit atomically');
});
