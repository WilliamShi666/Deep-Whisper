import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { QWEN_VOICE_SECTIONS } from '@/lib/ai/qwen-voices';
import {
  AUDITION_SUBDIR,
  isAuditionManifest,
  type AuditionManifest,
} from '../../../scripts/lib/qwen-tts-audition-plan';
import { QwenAuditionList, type AuditionGroupView } from './audition-list';
import { displayTrait } from './display-trait';

export const dynamic = 'force-dynamic';

/**
 * Qwen-Audio-3.1-TTS-Flash 音色试听页（**临时**，试验期结束后随音色表一起收口）。
 *
 * 只读服务端预生成的样本（scripts/qwen-tts-audition.ts 产出），**不新增任何 API 路由** ——
 * 没有未鉴权的付费代理缺口。manifest 缺失、结构过期或样本不齐时一律显示中文空状态：
 * 生产环境没有这个目录，页面天然为空，不会因为忘删而泄漏任何东西。
 *
 * 中文 3 句对全部音色保留；15 个英文音色再各加 3 句英文。播放完全交给客户端组件，
 * **点一下才播一句**（一次只播一句）。
 */

const GENERATE_COMMAND = [
  'AI_PROVIDER_LIVE_CANARY=I_UNDERSTAND_THIS_IS_PAID \\',
  'AI_PROVIDER_LIVE_MAX_REQUESTS=249 \\',
  'AI_PROVIDER_LIVE_MAX_COST_USD=3.00 \\',
  'pnpm tts:audition:qwen',
].join('\n');

async function loadManifest(): Promise<AuditionManifest | null> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', ...AUDITION_SUBDIR.split('/'), 'manifest.json'),
      'utf8',
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isAuditionManifest(parsed)) return null;
    // **在数据源头抹掉口音标注**。只在下游渲染/传参时过滤是不够的：这份 manifest 会被
    // Next 序列化进 RSC payload 发给浏览器（实测即使只传精简后的 props，原始对象仍会出现），
    // 于是「英式女声」这类词照样能被翻到。源头清洗后，下游怎么序列化都干净。
    return {
      ...parsed,
      entries: parsed.entries.map((entry) => ({ ...entry, trait: displayTrait(entry.trait) })),
    };
  } catch {
    return null;
  }
}

function EmptyState({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <h1 className="text-2xl font-semibold">Qwen 音色试听</h1>
      <p className="mt-4 text-sm text-muted-foreground">{reason}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
        {GENERATE_COMMAND}
      </pre>
    </main>
  );
}

export default async function QwenVoicesPage() {
  const manifest = await loadManifest();
  if (!manifest) {
    return <EmptyState reason="还没有可用的试听样本（或样本是旧格式）。在项目根目录运行下面这条命令生成：" />;
  }

  const groups: AuditionGroupView[] = QWEN_VOICE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    note: section.note,
    voices: manifest.entries
      .filter((entry) => entry.section === section.id)
      .map((entry) => ({
        id: entry.id,
        nameZh: entry.nameZh,
        gender: entry.gender,
        section: entry.section,
        // 上面 loadManifest 已在**数据源头**清洗过 trait，这里直接用即可。
        // 清洗只能发生在服务端：客户端组件 import display-trait 会把口音正则打进浏览器 chunk。
        trait: entry.trait,
        scenes: entry.scenes,
        samples: entry.samples.map((sample) => ({
          language: sample.language,
          index: sample.index,
          text: sample.text,
          fileName: sample.fileName,
        })),
      })),
  })).filter((group) => group.voices.length > 0);

  const voiceCount = manifest.entries.length;
  const female = manifest.entries.filter((entry) => entry.gender === 'female').length;
  const male = manifest.entries.filter((entry) => entry.gender === 'male').length;
  const bilingualCount = manifest.entries.filter((entry) =>
    entry.samples.some((sample) => sample.language === 'en')).length;
  const sampleCount = manifest.entries.reduce((total, entry) => total + entry.samples.length, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16 text-foreground">
      <h1 className="text-2xl font-semibold">Qwen 音色试听</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        模型 <code className="rounded bg-muted px-1">{manifest.model}</code> 的官方系统音色，共
        <strong> {voiceCount} </strong>个（女声 {female} · 男声 {male}）。
        中文音色每个 <strong>{manifest.lines.zh.length}</strong> 句中文；
        <strong> {bilingualCount} </strong>个英文音色另有
        <strong> {manifest.lines.en.length} </strong>句英文（共 {sampleCount} 条样本）。
      </p>
      <QwenAuditionList groups={groups} basePath={'/' + AUDITION_SUBDIR} />
    </main>
  );
}