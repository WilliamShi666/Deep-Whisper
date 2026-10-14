import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAT_THEMES, UI_THEMES } from '../src/lib/chat-themes';

/**
 * 壁纸与 UI 色调的英文名（契约 t3，依据计划 §2 第 7–9 行 / 决策 D2）。
 *
 * 三条口径：
 *   1. **只新增不改既有**：`id / name / desc / gender / image / desktopImage / thumbnail /
 *      scrim / brightness / saturation / mobilePosition / desktopPosition` 逐字符等于改前基线；
 *      UiTheme 的 `id / mode / swatch / accent / scrim` 同理。
 *   2. 英文名是**诗意重命名**（用户 2026-10-03 选定），与中文原名的意象对齐，不是描述性直译 ——
 *      所以这里把 40 个选定名逐条钉住，防止后续被"顺手改成翻译腔"。
 *   3. **描述里没有编号**（用户 2026-10-04 直接要求）：`desc` / `descEn` 都不得以 `^[A-Z]{2}\d{2} · `
 *      开头、任何位置都不得回显 `[FM][QN]\d{2}`，`·`（U+00B7）分隔符随之退出描述；编号的唯一真源是 `id`。
 */

/** CJK 判定：部首/假名/汉字/兼容表意/全角区段。刻意不含 U+00B7（用户 2026-10-04 后描述里已不允许出现它）。 */
const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/**
 * 基线表：`[id, 中文名, 中文副标题, gender, 选定英文名]`。
 * 手抄基线而不是从实现反推 —— 断言才不可能恒真。
 * 中文副标题是 **2026-10-04 去掉编号前缀后**的取值（原值 = 编号 + ` · ` + 现值，见 t65 的独立快照比对）。
 */
const THEME_TABLE: ReadonlyArray<readonly [string, string, string, 'female' | 'male', string]> = [
  ['deepseek-fq01', '鲸月栈桥', '她在月夜海边安静等你', 'female', 'Whale-Moon Pier'],
  ['deepseek-fq02', '星穹观测', '她在天文台穹顶下校准望远镜，仰望星河', 'female', 'Dome of Stars'],
  ['deepseek-fq03', '雨窗咖啡', '雨夜暖灯下，她捧着热饮等你', 'female', 'Rain at the Café Window'],
  ['deepseek-fq04', '月下花房', '她在花房门边轻轻回眸', 'female', 'Greenhouse Under the Moon'],
  ['deepseek-fq05', '鲸月夜读', '她抱着鲸鱼，在月色里翻开书页', 'female', 'Reading by Whale-Light'],
  ['deepseek-fq06', '花火听风', '她坐在古城屋顶看烟火，折扇轻摇等你', 'female', 'Fireworks, Listening to the Wind'],
  ['deepseek-fq07', '星港灯塔', '她在星空与灯塔之间陪你看海', 'female', 'Lighthouse in the Star Harbor'],
  ['deepseek-fq08', '雪窗守候', '雪落港湾，她在窗边陪你等灯亮', 'female', 'Keeping Watch at the Snow Window'],
  ['deepseek-fn01', '晨海露台', '晨光越过海面，她在露台等你醒来', 'female', 'Morning Sea Terrace'],
  ['deepseek-fn02', '蓝庭回眸', '月光落在玫瑰庭院，她回头看你', 'female', 'Glance in the Blue Courtyard'],
  ['deepseek-fn03', '雨窗暖灯', '雨落窗外，她抱着鲸鱼望向你', 'female', 'Warm Lamp, Rainy Window'],
  ['deepseek-fn04', '雨窗茶语', '雨夜咖啡馆里，她捧着热饮望向你', 'female', 'Tea Talk at the Rainy Window'],
  ['deepseek-fn05', '深蓝书梯', '她坐在深夜书房，为你留着一盏灯', 'female', 'The Deep-Blue Book Stair'],
  ['deepseek-fn06', '蓝港长阶', '蓝小时的港口长阶，她陪你看灯火', 'female', 'Long Steps of the Blue Harbor'],
  ['deepseek-fn07', '月夜阅室', '她在月夜阅读室里，为你翻开一页', 'female', 'Reading Room, Moonlit'],
  ['deepseek-fn08', '花房拾光', '她在夜间花房里，替你拾起一束微光', 'female', 'Gathering Light in the Flower Room'],
  ['deepseek-fn09', '屋顶来信', '她在旧城屋顶，拆开一封写给你的信', 'female', 'A Letter on the Rooftop'],
  ['deepseek-fn10', '雪夜拱廊', '雪落长廊，她在暖灯下等你经过', 'female', 'Arcade on a Snowy Night'],
  ['deepseek-fn11', '暖灯花笺', '她在暖杏灯下，为你插好一枝花', 'female', 'Flower Note Under a Warm Lamp'],
  ['deepseek-fn12', '星城露台', '她倚着城市露台，陪你看灯火入夜', 'female', 'Terrace Over the City of Stars'],
  ['deepseek-mq01', '鲸月书房', '他在海边月色里翻开书页', 'male', 'Whale-Moon Study'],
  ['deepseek-mq02', '雨窗夜读', '雨夜窗边，他捧着鲸鱼书静静等你', 'male', 'Night Reading by the Rain'],
  ['deepseek-mq03', '灯塔夜港', '他在港湾灯火边，把小鲸鱼带给你', 'male', 'Lighthouse Over the Night Harbor'],
  ['deepseek-mq04', '海岸暖饮', '夜海咖啡馆里，他捧着热饮望向你', 'male', 'Warm Drink on the Coast'],
  ['deepseek-mq05', '星台观测', '他在星空天文台，替你守着一颗星', 'male', 'Observatory of Stars'],
  ['deepseek-mq06', '花房来信', '玻璃花房里，他拆开一封写给你的信', 'male', 'Letter from the Greenhouse'],
  ['deepseek-mq07', '鲸光书房', '他在木质书房，捧着发光鲸鱼陪你', 'male', 'Study of Whale-Light'],
  ['deepseek-mq08', '雪岭守候', '雪夜木屋外，他在湖光里等你', 'male', 'Waiting by the Snow Ridge'],
  ['deepseek-mn01', '蓝时温室', '他站在海边温室的蓝色暮光里', 'male', 'Blue Hour Greenhouse'],
  ['deepseek-mn02', '海湾夜茶', '海湾夜色里，他捧着热饮陪你坐一会儿', 'male', 'Night Tea on the Bay'],
  ['deepseek-mn03', '城塔折舟', '他在旧城屋顶，为你折起一只纸船', 'male', 'Paper Boat on the Old Town Roof'],
  ['deepseek-mn04', '夜港守望', '夜港灯塔旁，他回眸等你靠近', 'male', 'Watching Over the Night Harbor'],
  ['deepseek-mn05', '海台微光', '海岸露台上，他低头看着送你的挂饰', 'male', 'Faint Light on the Sea Terrace'],
  ['deepseek-mn06', '晨海栈道', '晨光落上海边栈道，他陪你等日出', 'male', 'Boardwalk at Dawn'],
  ['deepseek-mn07', '海崖温室', '他站在海崖温室外，陪你望向灯塔', 'male', 'Cliffside Greenhouse'],
  ['deepseek-mn08', '暖灯夜读', '暖灯落在书页上，他侧身看向你', 'male', 'Night Reading by the Warm Lamp'],
  ['deepseek-mn09', '花房暮海', '暮色落进花房，他替你整理一束花', 'male', 'Dusk Sea Beyond the Flower Room'],
  ['deepseek-mn10', '星港仰望', '他在星空港城仰望一场流星', 'male', 'Looking Up in the Star Port'],
  ['deepseek-mn11', '雨窗暖饮', '雨落城窗，他捧着热饮回头看你', 'male', 'Warm Drink at the Rainy Window'],
  ['deepseek-mn12', '月海观测', '他在月海观测站，为你守着远方', 'male', 'Lunar Sea Observatory'],
];

const UI_TABLE = [
  { id: 'rose-night', name: '墨夜玫瑰', nameEn: 'Ink Rose Night', mode: 'dark', swatch: '#1b1518', accent: '#c9757f', scrim: '#151014' },
  { id: 'rose-milk', name: '奶雾玫瑰', nameEn: 'Milk-Mist Rose', mode: 'light', swatch: '#faf5f5', accent: '#c9757f', scrim: '#f6f0f0' },
  { id: 'amber-night', name: '焦糖夜话', nameEn: 'Caramel Night', mode: 'dark', swatch: '#1a1510', accent: '#d9a05b', scrim: '#161210' },
  { id: 'amber-milk', name: '奶油杏子', nameEn: 'Cream Apricot', mode: 'light', swatch: '#faf5ec', accent: '#d9a05b', scrim: '#f7f2e9' },
  { id: 'mist-night', name: '雾蓝深夜', nameEn: 'Mist Blue Midnight', mode: 'dark', swatch: '#14181d', accent: '#7d9db5', scrim: '#121519' },
  { id: 'mist-milk', name: '晨雾微光', nameEn: 'Morning Mist Glow', mode: 'light', swatch: '#f2f5f8', accent: '#7d9db5', scrim: '#f1f4f7' },
  { id: 'sage-night', name: '松间月色', nameEn: 'Moon Through Pines', mode: 'dark', swatch: '#151a14', accent: '#97ad8b', scrim: '#131712' },
  { id: 'sage-milk', name: '雨后青提', nameEn: 'Green Grape After Rain', mode: 'light', swatch: '#f4f7f0', accent: '#97ad8b', scrim: '#f3f6ee' },
] as const;

const EXPECTED_THEME_KEYS = [
  'brightness', 'desc', 'descEn', 'desktopImage', 'desktopPosition', 'gender', 'id', 'image',
  'mobilePosition', 'name', 'nameEn', 'saturation', 'scrim', 'thumbnail',
];

test('all 40 wallpapers keep their frozen id / Chinese name / subtitle / gender, plus a new English name', () => {
  assert.equal(CHAT_THEMES.length, 40);
  assert.deepEqual(CHAT_THEMES.map((theme) => theme.id), THEME_TABLE.map(([id]) => id));
  for (const [index, [id, name, desc, gender, nameEn]] of THEME_TABLE.entries()) {
    const theme = CHAT_THEMES[index];
    assert.ok(theme, id);
    assert.equal(theme.id, id);
    assert.equal(theme.name, name, id + ' 中文名不许改');
    assert.equal(theme.desc, desc, id + ' 中文副标题逐字符钉住（编号前缀已按用户要求去掉，正文一字不动）');
    assert.equal(theme.gender, gender, id);
    assert.equal(theme.nameEn, nameEn, id + ' nameEn must be the chosen poetic name');
  }
});

test('every new English field is non-empty and CJK-free', () => {
  for (const theme of CHAT_THEMES) {
    assert.ok(theme.nameEn.trim().length > 0, theme.id + '.nameEn');
    assert.equal(CJK.test(theme.nameEn), false, theme.id + '.nameEn must be English: ' + theme.nameEn);
    assert.ok(theme.descEn.trim().length > 0, theme.id + '.descEn');
    assert.equal(CJK.test(theme.descEn), false, theme.id + '.descEn must be English: ' + theme.descEn);
  }
  for (const theme of UI_THEMES) {
    assert.ok(theme.nameEn.trim().length > 0, theme.id + '.nameEn');
    assert.equal(CJK.test(theme.nameEn), false, theme.id + '.nameEn must be English: ' + theme.nameEn);
  }
});

/**
 * 用户 2026-10-04 直接需求：壁纸副标题**不得再出现编号**（`FQ01 · ` / `MQ01 · `）。
 *
 * 本条**替换**掉旧的「descEn 保留 `FQxx · ` 前缀」断言 —— 那条把当时的现状写成了要求。
 * 新期望是「描述里既没有编号，也没有让它看起来像标题行的中点分隔符」：
 *   · `desc` / `descEn` 开头不得有 `^[A-Z]{2}\d{2} · `，**任何位置**都不得回显 `[FM][QN]\d{2}`；
 *   · `·`（U+00B7）整体退出描述（编号原本就是靠它拼出来的），间隔号 U+30FB 一如既往禁止；
 *   · 编号的**唯一真源仍是 `id`**（`deepseek-fq01`）—— id↔编号的对应关系继续断言；
 *   · 男女两侧、四种系列（FQ / FN / MQ / MN）都必须覆盖（用户只提到女侧，男侧同样在场）。
 *
 * 描述**正文**的逐字覆盖由上面 `THEME_TABLE` 的整串钉住承担；本条负责「形态」。
 */
test('descriptions carry no numbering prefix or separator: the id stays the only source of the number', () => {
  const serials = new Set<string>();
  const sides = new Set<string>();
  const serieses = new Set<string>();

  for (const theme of CHAT_THEMES) {
    const serial = theme.id.replace(/^deepseek-/, '').toUpperCase();
    assert.match(serial, /^[FM][QN]\d{2}$/, theme.id + ' id 必须继续编码编号');
    serials.add(serial);
    sides.add(serial[0]!);
    serieses.add(serial.slice(0, 2));

    assert.doesNotMatch(theme.desc, /^[A-Z]{2}\d{2} · /, theme.id + ' desc 不得以编号前缀开头');
    assert.doesNotMatch(theme.descEn, /^[A-Z]{2}\d{2} · /, theme.id + ' descEn 不得以编号前缀开头');
    assert.equal(theme.desc.includes(serial + ' \u00B7 '), false, theme.id + ' desc 不得含「编号 · 」');
    assert.equal(theme.descEn.includes(serial + ' \u00B7 '), false, theme.id + ' descEn 不得含「编号 · 」');
    assert.equal(/[FM][QN]\d{2}/.test(theme.desc), false, theme.id + ' desc 不得回显编号');
    assert.equal(/[FM][QN]\d{2}/.test(theme.descEn), false, theme.id + ' descEn 不得回显编号');
    assert.equal(theme.desc.includes('\u00B7'), false, theme.id + ' desc 不得再有中点分隔符');
    assert.equal(theme.descEn.includes('\u00B7'), false, theme.id + ' descEn 不得再有中点分隔符');
    assert.equal(theme.desc.includes('\u30FB'), false, theme.id + ' desc must not use the CJK middle dot');
    assert.equal(theme.descEn.includes('\u30FB'), false, theme.id + ' descEn must not use the CJK middle dot');
    assert.ok(theme.desc.trim().length > 0, theme.id + ' desc 不得为空');
    assert.ok(theme.descEn.trim().length > 0, theme.id + ' descEn 不得为空');
    assert.equal(/^\s/.test(theme.desc), false, theme.id + ' desc 不得以空白开头（不能只摘掉正文前面一半）');
    assert.equal(/^\s/.test(theme.descEn), false, theme.id + ' descEn 不得以空白开头');
    assert.equal(/\s{2,}/.test(theme.desc), false, theme.id + ' desc 不得留连续空白');
    assert.equal(/\s{2,}/.test(theme.descEn), false, theme.id + ' descEn 不得留连续空白');
  }

  assert.deepEqual([...sides].sort(), ['F', 'M'], '男女两侧都必须覆盖');
  assert.deepEqual([...serieses].sort(), ['FN', 'FQ', 'MN', 'MQ'], '四种系列（FQ / FN / MQ / MN）都必须在');
  assert.equal(serials.size, 40, '40 个编号必须各不相同');
});

test('the frozen ChatTheme fields are untouched and no unexpected field appeared', () => {
  for (const theme of CHAT_THEMES) {
    assert.deepEqual(Object.keys(theme).sort(), EXPECTED_THEME_KEYS, theme.id + ' key set');
    const short = theme.id.replace(/^deepseek-/, '');
    assert.equal(theme.image, '/backgrounds/deepseek/' + short + '.webp', theme.id + ' image');
    assert.equal(theme.desktopImage, '/backgrounds/deepseek/desktop/' + short + '.jpg', theme.id + ' desktopImage');
    assert.equal(theme.thumbnail, '/backgrounds/deepseek/thumbnails/' + short + '.webp', theme.id + ' thumbnail');
    assert.match(theme.scrim, /^#[0-9a-f]{6}$/, theme.id + ' scrim');
    assert.equal(theme.brightness, 1, theme.id + ' brightness');
    assert.equal(theme.saturation, 1, theme.id + ' saturation');
    assert.match(theme.mobilePosition!, /^\d+% \d+%$/, theme.id + ' mobilePosition');
    assert.match(theme.desktopPosition!, /^\d+% \d+%$/, theme.id + ' desktopPosition');
  }
});

test('the 8 UI themes keep their frozen palette fields and gain only an English name', () => {
  assert.equal(UI_THEMES.length, 8);
  assert.deepEqual(UI_THEMES.map((theme) => theme.id), UI_TABLE.map((theme) => theme.id));
  for (const [index, expected] of UI_TABLE.entries()) {
    const theme = UI_THEMES[index];
    assert.ok(theme, expected.id);
    assert.deepEqual(theme, expected, expected.id + ' 既有字段与选定英文名都必须逐字符一致');
    assert.deepEqual(Object.keys(theme).sort(), ['accent', 'id', 'mode', 'name', 'nameEn', 'scrim', 'swatch']);
  }
});
