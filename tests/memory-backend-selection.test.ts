import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMemoryBackend, isMemoryEnabled, getMemoryWorkerOptions } from '../src/lib/memory/dependencies';

test('personal memory persistence stays local and enabled without embedding credentials', () => {
  assert.equal(resolveMemoryBackend({}), 'local');
  assert.equal(isMemoryEnabled({}), true);
  assert.equal(getMemoryWorkerOptions({}).retrievalMode, 'keyword');
  assert.equal(getMemoryWorkerOptions({}).embed, undefined);
});
test('worker and chat share the resolved auto/hybrid configuration', () => {
  assert.equal(getMemoryWorkerOptions({ DASHSCOPE_API_KEY: 'synthetic-key' }).retrievalMode, 'hybrid');
  assert.equal(typeof getMemoryWorkerOptions({ MEMORY_RETRIEVAL_MODE: 'hybrid', DASHSCOPE_API_KEY: 'synthetic-key' }).embed, 'function');
  assert.equal(getMemoryWorkerOptions({ MEMORY_RETRIEVAL_MODE: 'keyword', DASHSCOPE_API_KEY: 'synthetic-key' }).embed, undefined);
  assert.throws(() => getMemoryWorkerOptions({ MEMORY_RETRIEVAL_MODE: 'hybrid' }), /DASHSCOPE_API_KEY/);
});
