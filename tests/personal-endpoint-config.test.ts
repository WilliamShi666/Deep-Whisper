import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPersonalConfig, getProviderConfig, isE2EMockProviderMode } from '../src/lib/config/runtime';
import { inspectPersonalEnvironment } from '../scripts/personal/doctor';

test('compatible capabilities use independent connections and never inherit vendor credentials', () => {
  const env = { DEEPSEEK_API_KEY: 'legacy-deepseek', OPENROUTER_API_KEY: 'legacy-openrouter', DASHSCOPE_API_KEY: 'legacy-dashscope',
    ...Object.fromEntries(['CHAT', 'IMAGE', 'TTS', 'EMBEDDING'].flatMap(name => [
      [`AI_${name}_PROVIDER`, 'openai-compatible'], [`AI_${name}_BASE_URL`, `http://${name.toLowerCase()}.example/v1///`],
      [`AI_${name}_MODEL`, `${name.toLowerCase()}-model`],
    ])), AI_CHAT_API_KEY: 'chat-only', AI_IMAGE_API_KEY: 'image-only' };
  const config = getPersonalConfig(env);
  assert.equal(config.providers.chat.baseUrl, 'http://chat.example/v1');
  assert.equal(config.providers.chat.apiKey, 'chat-only');
  assert.equal(config.providers.image.apiKey, 'image-only');
  assert.equal(config.providers.speech.apiKey, undefined);
  assert.equal(config.providers.embedding.apiKey, undefined);
  assert.equal(config.memoryRetrievalMode, 'hybrid');
  for (const name of ['chat', 'image', 'speech', 'embedding', 'upload'] as const) assert.equal(config.capabilities[name].enabled, true);
  assert.doesNotMatch(JSON.stringify(config.capabilities), /legacy-|chat-only|image-only/);
});

test('generic vision inherits chat, with explicit override and no credential forwarding to another endpoint', () => {
  const base = { AI_CHAT_PROVIDER: 'openai-compatible', AI_CHAT_BASE_URL: 'https://chat.example/v1', AI_CHAT_MODEL: 'vision-chat', AI_CHAT_API_KEY: 'chat-only' };
  assert.deepEqual(getProviderConfig(base).visionSafety, getProviderConfig(base).chat);
  assert.deepEqual(getProviderConfig({ ...base, AI_VISION_PROVIDER: 'openai-compatible' }).visionSafety, getProviderConfig(base).chat);
  const vision = getProviderConfig({ ...base, AI_VISION_MODEL: 'moderator', AI_VISION_BASE_URL: 'https://vision.example/api', AI_VISION_API_KEY: 'vision-only' }).visionSafety;
  assert.equal(vision.model, 'moderator'); assert.equal(vision.baseUrl, 'https://vision.example/api'); assert.equal(vision.apiKey, 'vision-only');
  assert.equal(getProviderConfig({ ...base, AI_VISION_BASE_URL: 'https://vision.example/api' }).visionSafety.apiKey, undefined);
  const explicitNative = getPersonalConfig({ ...base, AI_VISION_PROVIDER: 'deepseek' });
  assert.equal(explicitNative.providers.visionSafety.model, 'deepseek-flash'); assert.equal(explicitNative.capabilities.upload.enabled, false);
});

test('canonical native connections take precedence while original profiles retain defaults', () => {
  const defaults = getProviderConfig({});
  assert.equal(defaults.chat.baseUrl, 'https://api.deepseek.com');
  assert.equal(defaults.image.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(defaults.speech.baseUrl, 'https://maas.qianwenaiapi.com/api/v1');
  assert.equal(defaults.embedding.dimensions, 1024); assert.equal(defaults.embedding.sendDimensions, true);
  const env = { DEEPSEEK_BASE_URL: 'https://old.example', DEEPSEEK_API_KEY: 'old-key', AI_CHAT_BASE_URL: 'https://new.example/prefix/', AI_CHAT_API_KEY: 'new-key' };
  assert.equal(getProviderConfig(env).chat.baseUrl, 'https://new.example/prefix'); assert.equal(getProviderConfig(env).chat.apiKey, 'new-key');
  assert.equal(getProviderConfig(env).visionSafety.baseUrl, 'https://old.example'); assert.equal(getProviderConfig(env).visionSafety.apiKey, 'old-key');
  assert.equal(getPersonalConfig({ AI_TTS_API_KEY: 'canonical-qwen' }).providers.speech.provider, 'qwen-audio');
});

test('endpoint and dimensional configuration errors fail offline without echoing secrets', () => {
  for (const prefix of ['CHAT', 'VISION', 'IMAGE', 'TTS', 'EMBEDDING']) {
    for (const url of ['ftp://bad.example/v1', 'https://secret:password@bad.example/v1', 'https://bad.example/v1?key=secret', 'https://bad.example/v1#secret']) {
      assert.throws(() => getProviderConfig({ [`AI_${prefix}_BASE_URL`]: url }), error => {
        assert.match(String(error), new RegExp(`AI_${prefix}_BASE_URL`)); assert.doesNotMatch(String(error), /secret|password@/); return true;
      });
    }
    assert.throws(() => getProviderConfig({ [`AI_${prefix}_PROVIDER`]: 'openai-compatible' }), new RegExp(`AI_${prefix}_BASE_URL`));
    assert.throws(() => getProviderConfig({ [`AI_${prefix}_PROVIDER`]: 'openai-compatible', [`AI_${prefix}_BASE_URL`]: 'http://localhost:8000/v1' }), new RegExp(`AI_${prefix}_MODEL`));
  }
  for (const dimensions of ['0', '-1', '1.5', 'NaN', '99999999']) assert.throws(() => getProviderConfig({ AI_EMBEDDING_DIMENSIONS: dimensions }), /AI_EMBEDDING_DIMENSIONS/);
  assert.equal(getProviderConfig({ AI_EMBEDDING_DIMENSIONS: '1536', AI_EMBEDDING_SEND_DIMENSIONS: 'false' }).embedding.dimensions, 1536);
  assert.equal(getProviderConfig({ AI_EMBEDDING_SEND_DIMENSIONS: 'false' }).embedding.sendDimensions, false);
  assert.throws(() => getProviderConfig({ AI_EMBEDDING_SEND_DIMENSIONS: 'yes' }), /AI_EMBEDDING_SEND_DIMENSIONS/);
});

test('doctor accepts an unauthenticated compatible service; mock mode rejects every new key', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dw-compatible-doctor-'));
  try {
    const result = inspectPersonalEnvironment({ APP_DATA_DIR: root, AI_CHAT_PROVIDER: 'openai-compatible', AI_CHAT_BASE_URL: 'http://localhost:8000/v1', AI_CHAT_MODEL: 'local-chat' });
    assert.equal(result.ok, true, result.errors.join('; '));
  } finally { rmSync(root, { recursive: true, force: true }); }
  for (const prefix of ['CHAT', 'VISION', 'IMAGE', 'TTS', 'EMBEDDING']) assert.throws(() => isE2EMockProviderMode({ APP_ENV: 'test', E2E_MOCK_PROVIDERS: '1', [`AI_${prefix}_API_KEY`]: 'synthetic-key' }), /refuse real provider credentials/);
});
