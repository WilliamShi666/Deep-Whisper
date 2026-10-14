import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CHAT_THEMES } from '../src/lib/chat-themes';
import { DEEPSEEK_WALLPAPER_PLAN } from '../tests/support/deepseek-wallpaper-plan';

const errors: string[] = [];
const root = process.cwd();
const backgroundsRoot = path.join(root, 'public', 'backgrounds');
const deepSeekRoot = path.join(backgroundsRoot, 'deepseek');
const thumbnailsRoot = path.join(deepSeekRoot, 'thumbnails');
const desktopRoot = path.join(deepSeekRoot, 'desktop');
const charactersRoot = path.join(root, 'public', 'characters');
const expectedIds = DEEPSEEK_WALLPAPER_PLAN.map((entry) => entry.id);
const expectedIdSet = new Set(expectedIds);

function compareExactSet(label: string, actual: string[], expected: string[]) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((item) => !actualSet.has(item));
  const unexpected = actual.filter((item) => !expectedSet.has(item));
  if (missing.length > 0) errors.push(label + ' missing: ' + missing.join(', '));
  if (unexpected.length > 0) errors.push(label + ' unexpected: ' + unexpected.join(', '));
}

function checkCount(label: string, actual: number, expected: number) {
  if (actual !== expected) errors.push(label + ': expected ' + expected + ', received ' + actual);
}

async function assertWebp(filePath: string, sizeLimit: number, label: string) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size > sizeLimit) errors.push(label + ' exceeds ' + sizeLimit + ' bytes');
    const bytes = await readFile(filePath);
    if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
      errors.push(label + ' is not a RIFF/WEBP file');
    }
    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    errors.push(label + ' unreadable: ' + (error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}

async function assertDesktopJpeg(filePath: string, label: string) {
  try {
    const bytes = await readFile(filePath);
    if (bytes.length > 1_500_000) errors.push(label + ' exceeds 1500000 bytes');
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      errors.push(label + ' is not a JPEG file');
    }
  } catch (error) {
    errors.push(label + ' unreadable: ' + (error instanceof Error ? error.message : String(error)));
  }
}

async function collectCodeFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectCodeFiles(entryPath));
    if (entry.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

async function main() {
  const themeIds = CHAT_THEMES.map((theme) => theme.id);
  checkCount('CHAT_THEMES total', CHAT_THEMES.length, 40);
  checkCount('CHAT_THEMES unique IDs', new Set(themeIds).size, CHAT_THEMES.length);
  compareExactSet('CHAT_THEMES IDs', themeIds, expectedIds);

  for (const gender of ['female', 'male'] as const) {
    const themes = CHAT_THEMES.filter((theme) => theme.gender === gender);
    checkCount(gender + ' theme count', themes.length, 20);
    checkCount(
      gender + ' chibi theme count',
      themes.filter((theme) => DEEPSEEK_WALLPAPER_PLAN.find((entry) => entry.id === theme.id)?.style === 'chibi').length,
      8,
    );
    checkCount(
      gender + ' normal theme count',
      themes.filter((theme) => DEEPSEEK_WALLPAPER_PLAN.find((entry) => entry.id === theme.id)?.style === 'normal').length,
      12,
    );
  }

  const mainIdsByHash = new Map<string, string[]>();
  for (const entry of DEEPSEEK_WALLPAPER_PLAN) {
    const theme = CHAT_THEMES.find((candidate) => candidate.id === entry.id);
    if (!theme) continue;
    const assetName = entry.id.replace(/^deepseek-/, '');
    const expectedImage = '/backgrounds/deepseek/' + assetName + '.webp';
    const expectedThumbnail = '/backgrounds/deepseek/thumbnails/' + assetName + '.webp';
    const expectedDesktop = '/backgrounds/deepseek/desktop/' + assetName + '.jpg';
    if (theme.gender !== entry.gender) errors.push(entry.id + ' has wrong gender');
    if (theme.image !== expectedImage) errors.push(entry.id + ' has wrong image path');
    if (theme.thumbnail !== expectedThumbnail) errors.push(entry.id + ' has wrong thumbnail path');
    if (theme.desktopImage !== expectedDesktop) errors.push(entry.id + ' has wrong desktop image path');
    if (theme.brightness !== 1) errors.push(entry.id + ' brightness must be 1');
    if (theme.saturation !== 1) errors.push(entry.id + ' saturation must be 1');
    if (!theme.mobilePosition?.trim()) errors.push(entry.id + ' is missing mobilePosition');
    if (!theme.desktopPosition?.trim()) errors.push(entry.id + ' is missing desktopPosition');
    const mainHash = await assertWebp(path.join(root, 'public', expectedImage), 1_500_000, entry.id + ' main');
    if (mainHash) mainIdsByHash.set(mainHash, [...(mainIdsByHash.get(mainHash) ?? []), entry.id]);
    await assertWebp(path.join(root, 'public', expectedThumbnail), 100_000, entry.id + ' thumbnail');
    await assertDesktopJpeg(path.join(root, 'public', expectedDesktop), entry.id + ' desktop');
  }
  for (const [hash, ids] of mainIdsByHash) {
    if (ids.length > 1) errors.push('duplicate main image content ' + hash + ': ' + ids.join(', '));
  }

  const plannedFileNames = expectedIds.map((id) => id.replace(/^deepseek-/, '') + '.webp');
  const deepSeekEntries = await readdir(deepSeekRoot, { withFileTypes: true });
  compareExactSet(
    'DeepSeek main assets',
    deepSeekEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    plannedFileNames,
  );
  compareExactSet(
    'DeepSeek asset subdirectories',
    deepSeekEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    ['thumbnails', 'desktop'],
  );
  compareExactSet('DeepSeek thumbnails', await readdir(thumbnailsRoot), plannedFileNames);
  compareExactSet('DeepSeek desktop assets', await readdir(desktopRoot),
    expectedIds.map((id) => id.replace(/^deepseek-/, '') + '.jpg'));

  const legacyBackgroundFiles = (await readdir(backgroundsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  if (legacyBackgroundFiles.length > 0) {
    errors.push('legacy root background files remain: ' + legacyBackgroundFiles.join(', '));
  }

  const characterEntries = await readdir(charactersRoot, { withFileTypes: true });
  compareExactSet(
    'character root files',
    characterEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    [],
  );
  compareExactSet(
    'character asset subdirectories',
    characterEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    ['deepseek'],
  );

  const legacyReferencePattern = /(?:backgrounds\/[fm]-[a-z0-9-]+|characters\/(?!deepseek\/)[a-z0-9-]+)\.jpeg/g;
  for (const codeRoot of ['src', 'scripts', 'e2e', 'tests']) {
    const files = await collectCodeFiles(path.join(root, codeRoot));
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const matches = source.match(legacyReferencePattern);
      if (matches) errors.push(path.relative(root, file) + ' retains legacy asset references: ' + matches.join(', '));
    }
  }

  for (const theme of CHAT_THEMES) {
    if (!expectedIdSet.has(theme.id)) errors.push('legacy or unplanned runtime theme remains: ' + theme.id);
    if (!theme.image.startsWith('/backgrounds/deepseek/')) errors.push('non-DeepSeek runtime image remains: ' + theme.image);
  }

  if (errors.length > 0) {
    console.error('DeepSeek wallpaper finalization gate failed:');
    for (const error of errors) console.error('- ' + error);
    process.exitCode = 1;
  } else {
    console.log('DeepSeek wallpaper finalization gate passed: 40 planned themes and only final runtime assets remain.');
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
