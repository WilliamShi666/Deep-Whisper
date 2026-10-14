/** Public speech behavior only; never include provider voice names or credentials in this DTO. */
export interface SpeechPresentation {
  mode: 'catalog' | 'compatibility' | 'unconfigured';
  fallback: 'gender-compatible' | 'none';
}

export const UNCONFIGURED_SPEECH_PRESENTATION: SpeechPresentation = { mode: 'unconfigured', fallback: 'none' };
