import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_CHARACTER_KEY_MAP,
  getCharacter,
} from '../src/lib/characters';

test('every approved legacy mapping preserves gender', () => {
  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_CHARACTER_KEY_MAP)) {
    const legacy = getCharacter(legacyKey);
    const canonical = getCharacter(canonicalKey);
    assert.ok(legacy, legacyKey);
    assert.ok(canonical, canonicalKey);
    assert.equal(legacy.gender, canonical.gender);
  }
});

// The personal edition retains runtime aliases, tested above. Commercial
// Supabase migrations are not distributed; SQLite migration tests live in
// personal-migration.test.ts.
