import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhotoSafeStreamLength, extractPhotoScene, stripPhotoTags } from '../src/lib/prompts';

test('PHOTO grammar stays hidden at every possible chunk boundary', () => {
  for (const tag of ['[PHOTO:窗边喝茶]', '[ PHOTO:窗边喝茶]', '[ \tPhOtO ：窗边喝茶]', '[\n PHOTO : 窗边喝茶 ]']) {
    const raw = '等我一下。' + tag;
    for (let split = 0; split <= raw.length; split++) {
      let full = '';
      let visible = '';
      let sent = 0;
      for (const chunk of [raw.slice(0, split), ...raw.slice(split)]) {
        full += chunk;
        const safe = getPhotoSafeStreamLength(full);
        visible += full.slice(sent, safe);
        sent = safe;
      }
      assert.equal(visible, '等我一下。', JSON.stringify({ tag, split }));
    }
    assert.equal(extractPhotoScene(raw), '窗边喝茶');
    assert.equal(stripPhotoTags(raw), '等我一下。');
  }
});

test('truncated PHOTO prefixes never become saved or final visible text', () => {
  for (const tail of ['[', '[ ', '[ \tp', '[ PH', '[ PHOT', '[ PHOTO', '[ PHOTO  ', '[ PHOTO :窗边']) {
    const raw = '等我一下。' + tail;
    assert.equal(raw.slice(0, getPhotoSafeStreamLength(raw)), '等我一下。');
    assert.equal(stripPhotoTags(raw), '等我一下。');
    assert.equal(extractPhotoScene(raw), null);
  }
});

test('ordinary bracketed text resumes streaming after a prefix is disproved', () => {
  for (const raw of ['你好[微笑]呀', '[Python] is useful', '[PHOTON]', '[PHOTO album]', '普通文字']) {
    assert.equal(getPhotoSafeStreamLength(raw), raw.length);
    assert.equal(stripPhotoTags(raw), raw);
  }
});
