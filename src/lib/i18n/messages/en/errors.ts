import type { errors as zhErrors } from '../zh-CN/errors';

/**
 * 错误 code → 英文文案（**所有者：U7 / t8**）。
 *
 * 与 `zh-CN/errors.ts` 的 key 集合逐条对齐：`Record<keyof typeof zhErrors, string>`
 * 少一条 key 就 `pnpm ts-check` 红（TS2739），多一条报 TS2353。占位符集合必须与 zh 相同
 * （`tests/i18n-messages.test.ts` 钉住）。
 *
 * 写作要求（不是直译）：英文读起来要像英语母语者写给用户的一句话 —— 短、具体、
 * 有下一步。会员族的四条必须**分因**（letters / photo / tts / tts_preview），不得共用一句。
 */
export const errors: Record<keyof typeof zhErrors, string> = {
  // ── generic fallback ──
  UNKNOWN: 'Something went wrong. Please try again in a moment.',
  // U7 / t32: the streaming reply failed mid-flight (see zh-CN for the note).
  CHAT_REPLY_FAILED: 'The reply could not be finished. Please try again in a moment.',
  INTERNAL_ERROR: 'Our server had a hiccup. Please try again in a moment.',
  // t37: the short variant used by the profile / relationship write paths (see zh-CN).
  'INTERNAL_ERROR.brief': 'Something went wrong on our side.',

  // ── 400: bad request ──
  VALIDATION_FAILED: "That request didn't look right.",
  EMPTY_PATCH: 'There was nothing to update.',
  GENDER_REQUIRED: 'Please choose your gender.',
  ORIENTATION_REQUIRED: "Please choose which gender you'd like them to be.",
  INVALID_UI_THEME: "That colour scheme doesn't exist.",
  INVALID_PALETTE: "That colour scheme doesn't exist.",
  INVALID_LOCALE: "That language doesn't exist.",
  NEED_PROFILE: 'Please finish your basic profile first.',
  INVALID_CHARACTER_TEMPLATE: 'Please pick a character.',
  INVALID_CREATION_ID: 'That creation reference is not valid.',
  INVALID_APPEARANCE_STYLE: 'That art style is not available.',
  'INVALID_APPEARANCE_STYLE.missing': 'Please choose an art style.',
  'INVALID_APPEARANCE_STYLE.invalid': 'That art style is not available.',
  INVALID_FEEDBACK: "That feedback wasn't in a format we can read.",
  INVALID_FEEDBACK_PAYLOAD: "That feedback wasn't in a format we can read.",
  INVALID_PAGE_CURSOR: 'That page marker is not valid.',
  INVALID_PREFERENCE_BODY: "Those preferences weren't in a format we can read.",
  INVALID_PROFILE_VERSION: 'That profile version is not valid.',
  INVALID_THEME: "That background doesn't exist.",
  INVALID_TIME_ZONE: "That time zone doesn't exist.",
  INVALID_TITLE: 'A title is required.',
  INVALID_UPLOAD_REFERENCE: 'That image is no longer available. Please upload it again before sending.',
  INVALID_VOICE: "That voice isn't available.",
  INVALID_INPUT: 'Please describe the personality you want.',
  PERSONA_TOO_LONG: 'The personality description cannot be longer than 600 characters.',
  IMAGE_TOO_LARGE: 'Images must be 10MB or smaller.',
  IMAGE_SAFETY_REJECTED: 'That image did not pass our safety check: {reason}. Please try another one.',
  UNSUPPORTED_IMAGE_TYPE: 'Only JPG, PNG, WebP and GIF images are supported.',
  MISSING_IMAGE: 'Please choose an image.',
  UNSUPPORTED_PREF_ACTION: "That preference action isn't supported.",
  UNSUPPORTED_REVOKE_MODE: "That revoke scope isn't supported.",
  LETTERS_TOGGLE_INVALID: 'Letters can only be turned on or paused.',
  MESSAGE_NOT_TTS_CAPABLE: "This message can't be read aloud.",
  TTS_CONTENT_UNSUITABLE: "This message isn't suitable for text to speech.",
  TTS_TEXT_EMPTY: 'Please enter some text to preview.',
  VOICE_NOT_FOUND: "That voice doesn't exist.",
  MISSING_COMPANION: 'A companion is required.',
  MISSING_COMPANION_ID: 'A companion_id is required.',
  MISSING_CONVERSATION: 'A conversation is required.',
  MISSING_CONVERSATION_ID: 'A conversation id is required.',
  MISSING_MESSAGE: 'A message is required.',
  MISSING_MESSAGE_CONTENT: 'The message cannot be empty.',
  UNKNOWN_FIELD: 'Unsupported field: {field}',

  // ── 401: not signed in ──
  AUTH_REQUIRED: 'Please sign in first.',
  LETTERS_AUTH_REQUIRED: 'Sign in to manage companion letters.',
  VISITOR_NOT_FOUND: 'That visitor no longer exists.',

  // ── 403: no access ──
  THEME_GENDER_MISMATCH: "That background doesn't match the companion you're with right now.",
  UNTRUSTED_ORIGIN: "This request didn't come from a trusted origin.",

  // ── 404: not found ──
  COMPANION_MISSING: "That companion doesn't exist.",
  COMPANION_NOT_FOUND: "That character doesn't exist.",
  CONVERSATION_NOT_FOUND: "That conversation doesn't exist.",
  MESSAGE_NOT_FOUND: "That message doesn't exist.",
  PREFERENCE_NOT_FOUND: "That preference doesn't exist.",

  // ── 409: conflict ──
  MEMORY_BUSY: 'Memories are still being organised. Please try deleting again in a moment.',
  MEMORY_BUSY_PREFERENCE: 'Memories are still being organised. Please try again in a moment.',
  PROFILE_CONFLICT: 'Your profile changed somewhere else. Please reload it before saving again.',
  'PROFILE_CONFLICT.read_then_save': 'Your profile changed somewhere else. Please reload it before saving again.',
  'PROFILE_CONFLICT.retry_later': 'Your profile is already being updated. Please try again in a moment.',
  STALE_APPEARANCE: 'The character art changed on another page. Please refresh and try again.',
  THEME_CONTEXT_REQUIRED: 'Please set the background inside the current conversation.',
  TTS_BUSY: 'This voice clip is already being generated. Please try again in a moment.',
  UNKNOWN_CHARACTER: 'That character template is missing. Please pick the character again.',
  CHARACTER_TEMPLATE_MISSING: 'That character template is missing.',
  LETTERS_NO_EMAIL: 'This account has no usable email address, so letters cannot be managed yet.',
  LETTERS_DELIVERY_STOPPED: 'Letters to this address were stopped after a delivery problem. Please contact support.',
  LETTERS_CONFIRM_REQUIRED: 'Please verify your email and explicitly confirm that you want letters again.',
  LETTERS_PREFERENCE_STALE: 'The email or letter settings changed. Please refresh and try again.',
  LETTERS_STATE_CHANGED: 'Your letter settings just changed. Please refresh and try again.',

  // ── 5xx: server-side / dependency failures ──
  TTS_FAILED: 'Voice generation failed.',
  TTS_PREVIEW_FAILED: 'The preview could not be generated. Please try again in a moment.',
  UPLOAD_FAILED: 'The image could not be uploaded. Please try again in a moment.',
  LETTERS_PREFERENCE_READ_FAILED: 'Could not read your letter settings.',
  LETTERS_PREFERENCE_SAVE_FAILED: 'Could not save your letter settings.',
  PHOTO_FAILED: "That photo didn't go through.",
  PHOTO_SCAN_BLOCKED: "That request isn't something I can do. Want to try a different scene?",
  PHOTO_SCAN_REVIEW: 'That photo needs another check. Try again later, or pick a different scene?',
  PHOTO_SCAN_DEGRADED: "That photo didn't go through.",
  INVALID_OUTPUT: 'The generated personality text was not valid.',
  UPSTREAM: 'Personality refinement is unavailable right now. Please try again in a moment.',
  TIMEOUT: 'Personality refinement timed out. Please try again in a moment.',
  PREFERENCE_MANAGEMENT_UNAVAILABLE: 'Preference management is unavailable right now.',
  PREFERENCE_READ_FAILED: "Couldn't read your companion preferences. Please try again.",
  PREFERENCE_UPDATE_UNCONFIRMED: "Couldn't confirm the preference update. Please refresh and check.",
  PREFERENCE_FEEDBACK_EMPTY: 'There was nothing new to record, so nothing changed.',
  PREFERENCE_FEEDBACK_SAVE_FAILED: "Your communication preferences couldn't be saved. Please try again in a moment.",

  // ── renewal / cancellation notices (derived from the billing dictionary — single source) ──

  // ── free-tier quota (existing lowercase codes, frozen) ──
  opening_exists: 'This conversation already has an opening message.',
  conversation_busy: 'This conversation is busy. Please try again in a moment.',
  INVALID_JSON: 'That request was not a valid JSON object. Please try again.',
  INVALID_GENDER: 'Please select your gender.',
  INVALID_ORIENTATION: 'Please select your companion’s gender.',
  INVALID_PROFILE: 'Those profile details are not valid. Please check and try again.',
  INVALID_MILESTONES: 'Those relationship milestones are not valid. Please check and try again.',
  MESSAGE_TOO_LONG: 'That message is too long. Please shorten it before sending.',
  NO_UPDATE_FIELDS: 'There are no changes to save.',
  PHOTO_BUSY: 'A photo is being created. Please try again in a moment.',
  INVALID_HOST: 'This address is not allowed. Use the configured application address.',
  INVALID_ORIGIN: 'This request origin is not allowed. Please try again from the application page.',
  CROSS_SITE_REQUEST: 'Cross-site requests are not allowed. Please try again from the application page.',
  SESSION_ERROR: 'The session check failed. Please try again.',
  LOGIN_RATE_LIMITED: 'Too many attempts. Please try again in 15 minutes.',
  FEATURE_NOT_CONFIGURED: 'This feature is not configured. Add its environment variables and restart.',
  OWNER_AUTH_REQUIRED: 'Unlock with the owner password first.',
};
