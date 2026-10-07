import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHOTO_FALLBACK_NOTICE,
  PHOTO_FALLBACK_SEGMENT,
  buildPhotoObjectKey,
  isFallbackPhotoUrl,
} from '../src/lib/ai/photo-object-key';

test('photo object keys mark fallback output without touching normal output', () => {
  assert.equal(
    buildPhotoObjectKey({ id: 'abc', extension: 'png' }),
    'images/abc.png',
  );
  assert.equal(
    buildPhotoObjectKey({ id: 'abc', extension: 'jpg', fallback: false }),
    'images/abc.jpg',
  );
  assert.equal(
    buildPhotoObjectKey({ id: 'abc', extension: 'png', fallback: true }),
    `images/${PHOTO_FALLBACK_SEGMENT}/abc.png`,
  );
});

test('fallback detection round-trips through stored URLs', () => {
  // 本地对象存储与 R2 都会给出绝对 URL；解析只看路径段。
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/fallback/abc.png'), true);
  assert.equal(isFallbackPhotoUrl('http://127.0.0.1:5100/uploads/images/fallback/abc.png'), true);
  assert.equal(isFallbackPhotoUrl('/uploads/images/fallback/abc.webp'), true);

  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/abc.png'), false);
  assert.equal(isFallbackPhotoUrl('http://127.0.0.1:5100/uploads/images/abc.png'), false);
});

test('fallback detection ignores missing URLs, other assets, and lookalike filenames', () => {
  assert.equal(isFallbackPhotoUrl(null), false);
  assert.equal(isFallbackPhotoUrl(undefined), false);
  assert.equal(isFallbackPhotoUrl(''), false);

  // TTS 音频与老格式照片都不是回退产物
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/tts/Sulafat/abc.mp3'), false);
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/abc.png'), false);

  // 文件名里恰好含 "fallback" 不能误判：只认紧邻 images 的那一段
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/fallback-hero.png'), false);
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/my-fallback.png'), false);
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/fallback/images/abc.png'), false);

  // 查询串/片段不应影响判断
  assert.equal(isFallbackPhotoUrl('https://cdn.example.com/images/fallback/abc.png?v=2'), true);
});

test('the user-facing notice blames no vendor and clears the product of fault', () => {
  // 产品不披露上游供应商：文案里不得出现任何厂商或模型名
  for (const vendor of ['Gemini', 'Google', 'OpenRouter', 'DeepSeek', 'OpenAI']) {
    assert.equal(PHOTO_FALLBACK_NOTICE.includes(vendor), false);
  }
  // 必须说清「不是本产品拒绝的」，并说明这是替代照片
  assert.match(PHOTO_FALLBACK_NOTICE, /自动内容审核/);
  assert.match(PHOTO_FALLBACK_NOTICE, /替代/);
  assert.match(PHOTO_FALLBACK_NOTICE, /不是这边拒绝/);
});
