import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDITION_ENGLISH_LINES,
  AUDITION_LINES,
  ENGLISH_SECTION_ID,
  auditionFileName,
  englishAuditionVoices,
  expectedSampleCount,
  isAuditionManifest,
  planAuditionRuns,
  sampleSpecs,
} from '../scripts/lib/qwen-tts-audition-plan';
import { QWEN_VOICES, getQwenVoicesForSection } from '../src/lib/ai/qwen-voices';

/**
 * 试听样本生成器是**唯一会批量花钱**的地方。它的计划是纯函数、可离线断言：
 * 请求数必须精确等于「本次真正要生成的样本数」，且已存在的档位一律跳过。
 *
 * 语言规则（用户 2026-09-29 第二轮）：中文 3 句**保留**（英文音色也保留），
 * 英文音色**再追加** 3 句英文。所以英文音色 6 档、其余 3 档。
 */

test('the three Chinese lines stay unchanged and keep their old file names', () => {
  assert.equal(AUDITION_LINES.length, 3);
  assert.equal(new Set(AUDITION_LINES).size, 3);
  // 旧格式必须原样保留：已生成的 204 个中文样本靠文件名复用，改名等于全部重新计费。
  assert.equal(auditionFileName('longanlingxin_v3.1', 1), 'longanlingxin_v3.1--1.mp3');
  assert.equal(auditionFileName('longanlingxin_v3.1', 3), 'longanlingxin_v3.1--3.mp3');
  assert.equal(auditionFileName('Emily_v3.1', 2, 'zh'), 'emily_v3.1--2.mp3');
});

test('three shared English lines were added without touching the Chinese set', () => {
  assert.equal(AUDITION_ENGLISH_LINES.length, 3);
  assert.equal(new Set(AUDITION_ENGLISH_LINES).size, 3);
  for (const line of AUDITION_ENGLISH_LINES) {
    assert.ok(line.length >= 20, line + ' is too short to judge a voice');
    assert.equal(line, line.trim());
    assert.equal(/[\u4e00-\u9fff]/.test(line), false, 'English lines must not contain Chinese characters');
  }
  // 英文档位单独命名，不能与中文档位撞名。
  assert.equal(auditionFileName('Emily_v3.1', 1, 'en'), 'emily_v3.1--en-1.mp3');
  const zhNames = new Set(AUDITION_LINES.map((_, i) => auditionFileName('Emily_v3.1', i + 1, 'zh')));
  for (let i = 1; i <= 3; i += 1) assert.equal(zhNames.has(auditionFileName('Emily_v3.1', i, 'en')), false);
});

test('exactly the 15 official English voices get the extra English lines', () => {
  const english = englishAuditionVoices();
  assert.equal(english.length, 15);
  assert.deepEqual(english.map((v) => v.id), getQwenVoicesForSection(ENGLISH_SECTION_ID).map((v) => v.id));
  for (const voice of QWEN_VOICES) {
    const expected = voice.section === ENGLISH_SECTION_ID ? 6 : 3;
    assert.equal(sampleSpecs(voice).length, expected, voice.id + ' sample count');
  }
  // 每个音色的前 3 档必须永远是中文那 3 句（用户明确要求英文音色也保留中文）。
  for (const voice of english) {
    assert.deepEqual(sampleSpecs(voice).slice(0, 3).map((s) => s.language), ['zh', 'zh', 'zh']);
    assert.deepEqual(sampleSpecs(voice).slice(3).map((s) => s.language), ['en', 'en', 'en']);
    assert.deepEqual(sampleSpecs(voice).slice(0, 3).map((s) => s.text), [...AUDITION_LINES]);
    assert.deepEqual(sampleSpecs(voice).slice(3).map((s) => s.text), [...AUDITION_ENGLISH_LINES]);
  }
});

test('the expected total is 68 voices worth of samples, 15 of them bilingual', () => {
  // 53 个非英文音色 × 3 + 15 个英文音色 × 6 = 159 + 90 = 249
  assert.equal(expectedSampleCount(), 249);
  const plan = planAuditionRuns({ existing: new Set<string>(), force: false });
  assert.equal(plan.length, 249);
  assert.equal(new Set(plan.map((run) => run.fileName)).size, 249, 'file names must be unique');
  assert.equal(plan.filter((run) => run.language === 'en').length, 45);
  assert.equal(plan.filter((run) => run.language === 'zh').length, 204);
});

// 这是本轮最关键的经济性约束：已生成的 204 个中文样本必须被判定为「已存在」，
// 于是冷启动只新增 45 个英文请求，而不是把 249 个全部重生成。
test('an existing Chinese-only sample set only bills the 45 new English samples', () => {
  const existing = new Set(
    QWEN_VOICES.flatMap((voice) =>
      AUDITION_LINES.map((_, offset) => auditionFileName(voice.id, offset + 1, 'zh'))),
  );
  const plan = planAuditionRuns({ existing, force: false });
  assert.equal(plan.length, 45);
  assert.equal(plan.every((run) => run.language === 'en'), true);
  assert.equal(plan.every((run) => run.id && voiceExists(run.id)), true);
});

test('a partially generated English voice only re-bills its missing English lines', () => {
  // Emily 的中文 3 档 + 英文前 2 档已存在，只该补英文第 3 档。
  const existing = new Set([
    auditionFileName('Emily_v3.1', 1, 'zh'),
    auditionFileName('Emily_v3.1', 2, 'zh'),
    auditionFileName('Emily_v3.1', 3, 'zh'),
    auditionFileName('Emily_v3.1', 1, 'en'),
    auditionFileName('Emily_v3.1', 2, 'en'),
  ]);
  const plan = planAuditionRuns({ existing, force: false });
  assert.equal(plan.length, expectedSampleCount() - 5);
  assert.deepEqual(
    plan.filter((run) => run.id === 'Emily_v3.1').map((run) => run.language + run.lineIndex),
    ['en3'],
  );
});

test('a fully generated catalog bills nothing on a warm rerun', () => {
  const existing = new Set(planAuditionRuns({ existing: new Set(), force: false }).map((r) => r.fileName));
  assert.equal(planAuditionRuns({ existing, force: false }).length, 0);
  assert.equal(planAuditionRuns({ existing, force: true }).length, expectedSampleCount());
});

function voiceExists(id: string): boolean {
  return QWEN_VOICES.some((voice) => voice.id === id);
}

// 试听页要能分辨旧 manifest：上一版是 lines: string[] 且英文音色没有 en 档位，
// 那种产物会让页面渲染出缺档/错组的播放器，必须判为无效。
test('manifest validation requires both language slots on English voices', () => {
  const base = (samples: unknown[]) => ({
    model: 'qwen-audio-3.1-tts-flash',
    lines: { zh: [...AUDITION_LINES], en: [...AUDITION_ENGLISH_LINES] },
    generatedAt: 'x',
    entries: [
      { id: 'Emily_v3.1', nameZh: 'Emily', gender: 'female', section: ENGLISH_SECTION_ID,
        trait: '英式女声', scenes: '', samples },
    ],
  });
  const zhSamples = AUDITION_LINES.map((text, o) => ({ language: 'zh', index: o + 1, text, fileName: 'x--' + (o + 1) + '.mp3', bytes: 1, generatedAt: 'x' }));
  const enSamples = AUDITION_ENGLISH_LINES.map((text, o) => ({ language: 'en', index: o + 1, text, fileName: 'x--en-' + (o + 1) + '.mp3', bytes: 1, generatedAt: 'x' }));

  assert.equal(isAuditionManifest(base([...zhSamples, ...enSamples])), true);
  // 缺英文档位的旧产物 → 无效
  assert.equal(isAuditionManifest(base(zhSamples)), false);
  // 英文档位不全 → 无效
  assert.equal(isAuditionManifest(base([...zhSamples, ...enSamples.slice(0, 2)])), false);
  // 缺中文档位 → 无效（用户要求中文保留）
  assert.equal(isAuditionManifest(base(enSamples)), false);
  // 旧的 lines: string[] 形状 → 无效
  assert.equal(isAuditionManifest({ ...base([...zhSamples, ...enSamples]), lines: [...AUDITION_LINES] }), false);
  assert.equal(isAuditionManifest(null), false);
  assert.equal(isAuditionManifest({}), false);
});

// 非英文音色不该拿到英文档位：否则会给 53 个中文音色多付 159 次请求。
test('Chinese-only voices never receive English samples', () => {
  const sample = QWEN_VOICES.find((voice) => voice.section === '精品中文音色');
  assert.ok(sample);
  assert.equal(sampleSpecs(sample).filter((spec) => spec.language === 'en').length, 0);
  const manifest = {
    model: 'qwen-audio-3.1-tts-flash',
    lines: { zh: [...AUDITION_LINES], en: [...AUDITION_ENGLISH_LINES] },
    generatedAt: 'x',
    entries: [{ id: sample.id, nameZh: sample.nameZh, gender: sample.gender, section: sample.section,
      trait: sample.trait, scenes: sample.scenes,
      samples: [
        ...AUDITION_LINES.map((text, o) => ({ language: 'zh', index: o + 1, text, fileName: 'a--' + (o + 1) + '.mp3', bytes: 1, generatedAt: 'x' })),
        ...AUDITION_ENGLISH_LINES.map((text, o) => ({ language: 'en', index: o + 1, text, fileName: 'a--en-' + (o + 1) + '.mp3', bytes: 1, generatedAt: 'x' })),
      ] }],
  };
  assert.equal(isAuditionManifest(manifest), false, 'a Chinese-only voice must not carry English samples');
});
