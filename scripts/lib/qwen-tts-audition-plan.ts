import { toVoiceKeySlug } from '@/lib/ai/tts-voice-key';
import { QWEN_VOICES, type QwenVoice } from '@/lib/ai/qwen-voices';

/**
 * 试听样本生成计划（纯函数，离线可测）。
 *
 * 这层存在的意义只有一个：**付费请求数必须与「本次真正要生成的样本数」严格相等**。
 * canary 门禁要求精确申报请求数，所以「已存在就跳过」的判定必须发生在申请额度之前。
 *
 * 语言规则（用户 2026-09-29 第二轮要求）：
 *   中文音色 —— 3 句中文，到此为止；
 *   英文音色 —— 3 句中文**保留**，**再追加** 3 句英文（同一批英文句子给全部英文音色）。
 * 之所以中文那 3 句对英文音色也保留：它们同时是「中文发音是否自然」的观测点。
 *
 * 文件名的中文档位**故意保持旧格式**（`<slug>--N.mp3`），这样已生成的 204 个中文样本
 * 全部复用、不重复计费；新追加的英文档位才用 `<slug>--en-N.mp3`。
 */

/**
 * 三句中文试听文案，覆盖三种说话状态，便于判断音色的表现力：
 *   1. 日常问候（常态语气）
 *   2. 带情绪的关心（情绪起伏）
 *   3. 长一点的叙述（句间连贯与气息）
 * 顺序即播放顺序，不要随意调换（样本按档位命名，换了内容就与旧文件对不上了）。
 */
export const AUDITION_LINES: readonly string[] = [
  '晚上好呀，今天过得怎么样？我在呢。',
  '别急，慢慢说，我一直都在听。',
  '今天路过那家小店，看到一只橘猫趴在窗台上晒太阳，忽然就想起你说过喜欢猫，所以停下来看了好一会儿。',
] as const;

/** 三句英文试听文案，与中文三句一一对应（问候 / 关心 / 叙述），同样给全部英文音色。 */
export const AUDITION_ENGLISH_LINES: readonly string[] = [
  'Good evening. How was your day? I am right here.',
  'Take your time. I am listening, and I am not going anywhere.',
  'I walked past that little shop today and saw a ginger cat sleeping on the windowsill. It reminded me how you once said you liked cats, so I stopped and watched for a while.',
] as const;

export type AuditionLanguage = 'zh' | 'en';

export const AUDITION_LANGUAGE_LABEL: Readonly<Record<AuditionLanguage, string>> = {
  zh: '中文',
  en: '英文',
};

export const AUDITION_SUBDIR = 'tts-preview/qwen-audition';

/** 该音色是否需要英文档位：官方「精品英文音色」组的那 15 个。 */
export function isEnglishAuditionVoice(voice: QwenVoice): boolean {
  return voice.accent !== undefined;
}

export function englishAuditionVoices(): QwenVoice[] {
  return QWEN_VOICES.filter(isEnglishAuditionVoice);
}

export function linesForLanguage(language: AuditionLanguage): readonly string[] {
  return language === 'en' ? AUDITION_ENGLISH_LINES : AUDITION_LINES;
}

/**
 * 样本文件名。中文档位保持旧格式以复用已有样本；英文档位带 `en` 段避免撞名。
 */
export function auditionFileName(
  voiceId: string,
  lineIndex: number,
  language: AuditionLanguage = 'zh',
): string {
  const lines = linesForLanguage(language);
  if (!Number.isInteger(lineIndex) || lineIndex < 1 || lineIndex > lines.length) {
    throw new Error('audition line index out of range for ' + language + ': ' + lineIndex);
  }
  const slug = toVoiceKeySlug(voiceId);
  return language === 'en' ? slug + '--en-' + lineIndex + '.mp3' : slug + '--' + lineIndex + '.mp3';
}

/** 该音色应有的档位清单（中文 3 个 + 英文音色再加 3 个）。 */
export function sampleSpecs(voice: QwenVoice): Array<{ language: AuditionLanguage; index: number; text: string; fileName: string }> {
  const specs: Array<{ language: AuditionLanguage; index: number; text: string; fileName: string }> =
    AUDITION_LINES.map((text, offset) => ({
      language: 'zh' as const,
      index: offset + 1,
      text,
      fileName: auditionFileName(voice.id, offset + 1, 'zh'),
    }));
  if (isEnglishAuditionVoice(voice)) {
    AUDITION_ENGLISH_LINES.forEach((text, offset) => {
      specs.push({
        language: 'en' as const,
        index: offset + 1,
        text,
        fileName: auditionFileName(voice.id, offset + 1, 'en'),
      });
    });
  }
  return specs;
}

export function expectedSampleCount(): number {
  return QWEN_VOICES.reduce((total, voice) => total + sampleSpecs(voice).length, 0);
}

export interface AuditionRun {
  id: string;
  nameZh: string;
  language: AuditionLanguage;
  lineIndex: number;
  text: string;
  fileName: string;
}

export function planAuditionRuns(input: {
  existing: ReadonlySet<string>;
  force: boolean;
}): AuditionRun[] {
  const runs: AuditionRun[] = [];
  for (const voice of QWEN_VOICES) {
    for (const spec of sampleSpecs(voice)) {
      if (!input.force && input.existing.has(spec.fileName)) continue;
      runs.push({
        id: voice.id,
        nameZh: voice.nameZh,
        language: spec.language,
        lineIndex: spec.index,
        text: spec.text,
        fileName: spec.fileName,
      });
    }
  }
  return runs;
}

export interface AuditionSample {
  language: AuditionLanguage;
  index: number;
  text: string;
  fileName: string;
  bytes: number;
  generatedAt: string;
}

export interface AuditionManifestEntry {
  id: string;
  nameZh: string;
  gender: string;
  section: string;
  trait: string;
  scenes: string;
  samples: AuditionSample[];
}

export interface AuditionManifest {
  model: string;
  lines: { zh: string[]; en: string[] };
  generatedAt: string;
  entries: AuditionManifestEntry[];
}

/**
 * 结构校验：试听页只在「新格式且档位齐全」时渲染。
 *   - 每个音色必须有 3 个中文档位（index 1..3）；
 *   - 英文音色必须再有 3 个英文档位，非英文音色必须**没有**英文档位；
 *   - `lines` 必须是 {zh,en} 两栏 —— 旧的「每音色一句」与「只有中文」两种产物都判为无效，
 *     否则页面会对着缺档的字段渲染出空播放器。
 */
export function isAuditionManifest(value: unknown): value is AuditionManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuditionManifest>;
  const lines = candidate.lines;
  if (!lines || typeof lines !== 'object') return false;
  if (!Array.isArray(lines.zh) || lines.zh.length !== AUDITION_LINES.length) return false;
  if (!Array.isArray(lines.en) || lines.en.length !== AUDITION_ENGLISH_LINES.length) return false;
  if (!Array.isArray(candidate.entries)) return false;
  return candidate.entries.every((entry) => {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.samples)) return false;
    const zh = entry.samples.filter((sample) => sample.language === 'zh');
    const en = entry.samples.filter((sample) => sample.language === 'en');
    const englishVoice = entry.section === ENGLISH_SECTION_ID;
    if (en.length !== (englishVoice ? AUDITION_ENGLISH_LINES.length : 0)) return false;
    if (zh.length !== AUDITION_LINES.length) return false;
    const indicesMatch = (samples: readonly AuditionSample[], expected: number) =>
      samples.every((sample, offset) => sample.index === offset + 1
        && typeof sample.fileName === 'string' && sample.fileName.length > 0);
    return indicesMatch(zh, AUDITION_LINES.length) && indicesMatch(en, AUDITION_ENGLISH_LINES.length);
  });
}

/** 官方「精品英文音色」组的标题，manifest 里存的是这一段字符串。 */
export const ENGLISH_SECTION_ID = '精品英文音色';
