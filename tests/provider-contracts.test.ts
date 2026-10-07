import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatProvider } from '../src/lib/ai/contracts';
import { ChatVisionSafetyProvider } from '../src/lib/ai/providers/chat-vision-safety-provider';

test('vision safety fails closed when structured provider output is invalid', async () => {
  const chatProvider = {
    async completeStructured() {
      return {
        content: '{}',
        model: 'fake',
        data: { safe: 'yes' },
      };
    },
  } as unknown as ChatProvider;
  const provider = new ChatVisionSafetyProvider(chatProvider, 'policy');

  await assert.rejects(
    provider.inspect({
      image: { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    }),
    /boolean safe field/,
  );
});
