import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GET } from '../src/app/api/capabilities/route';
import { SpeechVoiceSettings } from '../src/components/chat/speech-voice-settings';
import { LocaleProvider, type LocaleProviderProps } from '../src/lib/i18n-client';
import type { ReactNode } from 'react';
import type { Locale } from '../src/lib/i18n/locale';

function renderWithLocale(locale: Locale, child: ReactNode) {
  // React supplies the required children through createElement's third argument.
  return renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale } as LocaleProviderProps, child));
}

test('S7 capabilities distinguish public catalog, gender-compatible primary and fallback without leaking names or secrets', async (t) => {
  const previous = process.env;
  t.after(() => { process.env = previous; });
  const base: NodeJS.ProcessEnv = { NODE_ENV: 'test', APP_ENV: 'test', APP_ACCESS_MODE: 'local', APP_BASE_URL: 'http://127.0.0.1:5000', HOST: '127.0.0.1', PORT: '5000' };
  for (const scenario of [
    { vars: {}, mode: 'unconfigured', fallback: 'none' },
    { vars: { OPENROUTER_API_KEY: 'synthetic-openrouter-key' }, mode: 'compatibility', fallback: 'none' },
    { vars: { DASHSCOPE_API_KEY: 'synthetic-qwen-key' }, mode: 'catalog', fallback: 'none' },
    { vars: { DASHSCOPE_API_KEY: 'synthetic-qwen-key', OPENROUTER_API_KEY: 'synthetic-openrouter-key' }, mode: 'catalog', fallback: 'gender-compatible' },
    { vars: { AI_TTS_PROVIDER: 'openai-compatible', AI_TTS_BASE_URL: 'https://private-speech.example/v1', AI_TTS_MODEL: 'private-model', AI_TTS_API_KEY: 'synthetic-compatible-key', AI_TTS_VOICE_FEMALE: 'private-voice' }, mode: 'compatibility', fallback: 'none' },
  ]) {
    process.env = { ...base, ...scenario.vars };
    const response = await GET(new Request('http://127.0.0.1:5000/api/capabilities', { headers: { host: '127.0.0.1:5000' } }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.speechPresentation, { mode: scenario.mode, fallback: scenario.fallback });
    assert.doesNotMatch(JSON.stringify(data), /synthetic|Sulafat|Charon|Cherry|Serena|qwen-audio|openrouter-gemini|private-speech|private-model|private-voice/);
  }
});

test('S7 compatibility settings describe codes instead of promising distinct real voices in both locales', () => {
  for (const locale of ['en', 'zh-CN'] as const) for (const gender of ['female', 'male'] as const) {
    const html = renderWithLocale(locale, createElement(SpeechVoiceSettings, {
      voiceId: null, gender, onVoiceChange: () => undefined,
      speechPresentation: { mode: 'compatibility', fallback: 'none' },
    }));
    assert.match(html, /data-testid="speech-compatibility-notice"/);
    assert.match(html, locale === 'en' ? /do not represent distinct actual voices/ : /不代表各自不同的实际声线/);
    assert.match(html, locale === 'en' ? /(?:12|13) voice codes/ : /(?:12|13) 个音色代号/);
    assert.doesNotMatch(html, /Sulafat|Charon|Cherry|Serena/);
  }
});

test('S7 catalog mode keeps the normal voice count and explains gender-matched fallback', () => {
  const render = (fallback: 'none' | 'gender-compatible') => renderWithLocale('en', createElement(SpeechVoiceSettings, {
    voiceId: null, gender: 'female', onVoiceChange: () => undefined,
    speechPresentation: { mode: 'catalog', fallback },
  }));
  assert.match(render('none'), /13 voices/);
  assert.doesNotMatch(render('none'), /speech-compatibility-notice|speech-fallback-notice/);
  assert.match(render('gender-compatible'), /data-testid="speech-fallback-notice"/);
  assert.match(render('gender-compatible'), /companion.*gender/);
});
