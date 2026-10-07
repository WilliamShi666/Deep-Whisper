import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {loadScriptEnv} from './lib/load-script-env';

import { QwenAudioSpeechProvider } from '@/lib/ai/providers/qwen-audio-speech-provider';
import { QWEN_TTS_MODEL, QWEN_VOICES, getQwenVoice } from '@/lib/ai/qwen-voices';
import { requireLiveCanaryApproval } from './lib/live-canary-guard';
import {
  AUDITION_ENGLISH_LINES,
  AUDITION_LINES,
  AUDITION_SUBDIR,
  expectedSampleCount,
  planAuditionRuns,
  sampleSpecs,
  type AuditionLanguage,
  type AuditionManifest,
  type AuditionManifestEntry,
  type AuditionSample,
} from './lib/qwen-tts-audition-plan';

/**
 * 生成 qwen-audio-3.1-tts-flash 全部音色的试听样本。
 *
 * 语言规则（用户 2026-09-29 第二轮）：**中文 3 句保留**（英文音色也保留，
 * 它们同时是"中文发音是否自然"的观测点），**英文音色再追加 3 句英文**。
 * 于是 53 个中文音色 × 3 + 15 个英文音色 × 6 = **249 档**，其中 45 档是新增的英文。
 *
 * 付费门禁：必须显式声明 AI_PROVIDER_LIVE_CANARY + **精确请求数** + 成本上限。
 * 精确请求数 = 本次真正要生成的档位数（已存在的默认跳过；中文 204 档已生成时只申报 45）。
 *
 * **不依赖上一版 manifest**：已生成的档位由目录里的 mp3 文件名判定，
 * 因此「旧 manifest 形状过期」不会导致中文样本被重付一次费用。
 * 每档的文本与字节数写进 manifest 供试听页渲染。
 *
 * 输出写到 public/<AUDITION_SUBDIR>/（该目录已被 .gitignore 覆盖，不会进仓库）。
 * 报告只打印音色 id / 语言 / 句号 / 字节数 / 耗时，**绝不打印密钥、音频字节与临时 URL**。
 */

// 这是千问专用脚本，先把 provider 钉死**再**读 .env：dotenv 的 override:false 只填
// process.env 里还没有的键，所以先赋值即可保证不会被环境文件里的旧值覆盖。
// （本机 .env 里有一条历史遗留的 AI_TTS_PROVIDER=qwen —— 它不是合法枚举值。）
process.env.AI_TTS_PROVIDER = 'qwen-audio';
process.env.AI_TTS_MODEL = QWEN_TTS_MODEL;
loadScriptEnv();

async function main() {
  const root = path.join(process.cwd(), 'public', ...AUDITION_SUBDIR.split('/'));
  await mkdir(root, { recursive: true });

  const existing = new Set(await readdir(root).catch(() => [] as string[]));
  const force = process.argv.includes('--force');
  const plan = planAuditionRuns({ existing, force });

  if (!plan.length) {
    console.info(JSON.stringify({
      generated: 0,
      expected: expectedSampleCount(),
      note: 'all audition samples already exist; nothing billed',
    }, null, 2));
    return;
  }

  const budget = requireLiveCanaryApproval(process.env, {
    expectedRequests: plan.length,
    // 249 档 × 约 10-60 output token；上限给足余量仍远低于任何实际账单。
    hardCostCeilingUsd: 3,
  });

  const provider = new QwenAudioSpeechProvider(process.env);
  // 上一轮已生成的档位：**按文件是否存在判定**，不看 manifest。
  // （2026-09-29 那一版的 manifest.lines 是数组，结构已过期；若靠它合并，
  //  204 个中文样本会被当成不存在而全部重新计费。）
  const previousSamples = await readPriorSamples(root);
  const fresh = new Map<string, Map<string, AuditionSample>>();
  let characters = 0;
  let reused = 0;

  for (const run of plan) {
    const voice = getQwenVoice(run.id);
    if (!voice) throw new Error('catalog mismatch for ' + run.id);
    const startedAt = Date.now();
    const audio = await provider.synthesize({ text: run.text, voice: run.id });
    const elapsedMs = Date.now() - startedAt;
    await writeFile(path.join(root, run.fileName), audio.bytes);
    characters += run.text.length;

    const bySlot = fresh.get(run.id) ?? new Map<string, AuditionSample>();
    bySlot.set(sampleKey(run.language, run.lineIndex), {
      language: run.language,
      index: run.lineIndex,
      text: run.text,
      fileName: run.fileName,
      bytes: audio.bytes.byteLength,
      generatedAt: new Date().toISOString(),
    });
    fresh.set(run.id, bySlot);

    console.info(JSON.stringify({
      voice: run.id,
      language: run.language,
      line: run.lineIndex,
      bytes: audio.bytes.byteLength,
      mediaType: audio.mediaType,
      elapsedMs,
    }));
  }

  const entries: AuditionManifestEntry[] = [];
  for (const voice of QWEN_VOICES) {
    const generated = fresh.get(voice.id);
    const samples: AuditionSample[] = [];
    for (const spec of sampleSpecs(voice)) {
      const key = sampleKey(spec.language, spec.index);
      const produced = generated?.get(key);
      if (produced) { samples.push(produced); continue; }
      const prior = previousSamples.get(voice.id)?.get(key);
      if (prior) { samples.push(prior); reused += 1; }
    }
    if (samples.length !== sampleSpecs(voice).length) {
      throw new Error(
        'incomplete sample set for ' + voice.id + ': ' + samples.length
        + '/' + sampleSpecs(voice).length + ' (rerun the generator to fill the gaps)',
      );
    }
    entries.push({
      id: voice.id,
      nameZh: voice.nameZh,
      gender: voice.gender,
      section: voice.section,
      trait: voice.trait,
      scenes: voice.scenes,
      samples,
    });
  }

  const manifest: AuditionManifest = {
    model: QWEN_TTS_MODEL,
    lines: { zh: [...AUDITION_LINES], en: [...AUDITION_ENGLISH_LINES] },
    generatedAt: new Date().toISOString(),
    entries,
  };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.info(JSON.stringify({
    generated: plan.length,
    reused,
    characters,
    voices: entries.length,
    samples: entries.reduce((total, entry) => total + entry.samples.length, 0),
    maxRequests: budget.maxRequests,
    maxCostUsd: budget.maxCostUsd,
    manifest: 'public/' + AUDITION_SUBDIR + '/manifest.json',
  }, null, 2));
}

function sampleKey(language: AuditionLanguage, index: number): string {
  return language + ':' + index;
}

/**
 * 从磁盘上已有的 mp3 文件名反推「哪些档位已经生成过」，文本取自当前计划
 * （档位序号 ⇔ 文本是一一对应的固定映射，不依赖任何历史 manifest）。
 */
async function readPriorSamples(root: string): Promise<Map<string, Map<string, AuditionSample>>> {
  const files = new Set(await readdir(root).catch(() => [] as string[]));
  const byVoice = new Map<string, Map<string, AuditionSample>>();
  const generatedAt = 'reused';
  for (const voice of QWEN_VOICES) {
    const slots = new Map<string, AuditionSample>();
    for (const spec of sampleSpecs(voice)) {
      if (!files.has(spec.fileName)) continue;
      const stat = await stat_size(path.join(root, spec.fileName));
      slots.set(sampleKey(spec.language, spec.index), {
        language: spec.language,
        index: spec.index,
        text: spec.text,
        fileName: spec.fileName,
        bytes: stat,
        generatedAt,
      });
    }
    if (slots.size) byVoice.set(voice.id, slots);
  }
  return byVoice;
}

async function stat_size(target: string): Promise<number> {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(target)).size;
  } catch {
    return 0;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qwen TTS audition generator failed');
  process.exitCode = 1;
});
