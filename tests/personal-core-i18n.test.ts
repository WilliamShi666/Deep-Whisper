import assert from 'node:assert/strict';
import test from 'node:test';
import { isErrorCode, localizeApiError } from '../src/lib/i18n/errors';
test('OSS-018 personal owner and input errors have Chinese and English copy', () => {
  for (const code of ['INVALID_JSON','INVALID_GENDER','INVALID_ORIENTATION','INVALID_PROFILE','INVALID_MILESTONES','MESSAGE_TOO_LONG','NO_UPDATE_FIELDS','PHOTO_BUSY','INVALID_HOST','INVALID_ORIGIN','CROSS_SITE_REQUEST','SESSION_ERROR','LOGIN_RATE_LIMITED']) {
    assert.ok(isErrorCode(code), code);
    const payload = {code,error:'wire fallback'};
    assert.notEqual(localizeApiError('en',payload),'wire fallback');
    assert.notEqual(localizeApiError('zh-CN',payload),'wire fallback');
  }
});
