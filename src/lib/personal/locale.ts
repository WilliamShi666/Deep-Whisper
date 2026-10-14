import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
/** Device language is only a default; explicit profile/cookie choice wins above it. */
export function personalDefaultLocale(acceptLanguage: string | null): Locale {
  const preferences = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(';');
      const q = parameters.find((p) => p.trim().startsWith('q='));
      return { tag: tag.toLowerCase(), index, quality: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((item) => Number.isFinite(item.quality) && item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const item of preferences) {
    if (/^en(?:-|$)/.test(item.tag)) return 'en';
    if (/^zh(?:-|$)/.test(item.tag)) return 'zh-CN';
  }
  return DEFAULT_LOCALE;
}
