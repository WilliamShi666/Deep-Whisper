/**
 * TTS 音频在对象存储里的 key 形如 `tts/<voice-slug>/<uuid>.<ext>`。
 *
 * 这样 `messages.audio_url` 自带「这段语音是用哪个音色合成的」信息：用户换了音色之后，
 * 前端只靠 URL 就能判断缓存音频是不是旧音色，不需要新增数据库列，也不需要额外往返。
 * 老格式（`tts/<uuid>.mp3`，没有音色段）解析为 null，表示「音色未知」，调用方不得据此报不一致。
 *
 * 历史平台音色 id 带空格与括号（`Chinese (Mandarin)_Gentleman`）会先被 resolveVoiceId()
 * 归一化成 Gemini 音色，所以正常情况下 slug 只会出现 `[a-z0-9._-]`。
 */

const UNSAFE_SLUG_CHARS = /[^a-z0-9._-]+/g;
const COLLAPSED_UNDERSCORES = /_+/g;
const EDGE_SEPARATORS = /^[._-]+|[._-]+$/g;

/** 音色 id → key 里的 slug（小写、只保留 URL 安全字符） */
export function toVoiceKeySlug(voiceId: string | null | undefined): string {
  const slug = (voiceId ?? '')
    .trim()
    .toLowerCase()
    .replace(UNSAFE_SLUG_CHARS, '_')
    .replace(COLLAPSED_UNDERSCORES, '_')
    .replace(EDGE_SEPARATORS, '');
  return slug || 'default';
}

/** 对象存储 key：`<subdir>/<voice-slug>/<id>.<ext>` */
export function buildTtsObjectKey(input: {
  subdir: string;
  voiceId: string;
  id: string;
  extension: string;
}): string {
  return `${input.subdir}/${toVoiceKeySlug(input.voiceId)}/${input.id}.${input.extension}`;
}

/**
 * 从 `audio_url` 取回音色 slug；老格式或非本服务的 URL 返回 null。
 * 只认 `<subdir>/<slug>/<file>` 三段结构，避免把 `/uploads/tts/<uuid>.mp3` 误判成音色。
 */
export function extractVoiceKeySlug(audioUrl: string | null | undefined, subdir = 'tts'): string | null {
  if (!audioUrl) return null;
  const path = audioUrl.split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  const subdirIndex = segments.lastIndexOf(subdir);
  if (subdirIndex < 0 || segments.length - subdirIndex !== 3) return null;
  const slug = segments[subdirIndex + 1].toLowerCase();
  return slug || null;
}
