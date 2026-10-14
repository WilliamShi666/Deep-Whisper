import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CHAT_THEMES,
  getChatTheme,
  getChatThemesForGender,
} from '../src/lib/chat-themes';
import {
  DEEPSEEK_WALLPAPER_PLAN,
  DEEPSEEK_WALLPAPER_PLAN_BY_ID,
} from './support/deepseek-wallpaper-plan';

const samples = {
  'deepseek-fq01': {
    gender: 'female',
    mainSha: '04d66d990bd15910305ce1c3066f3a115859d5e8d047c2fd13ebfacfac5419f2',
    thumbnailSha: 'c7dd9e78c387473f0edb248d2f27e585bc2eaaf60f2848f17af61374f2a1ffca',
  },
  'deepseek-fq02': {
    gender: 'female',
    mainSha: '5802452c86445d85e8d6edb7d14446441d5dbdf2fdafbc68b7c4b16eeaf2ae06',
    thumbnailSha: 'dd33a7273b32566f9195c09cb2f6bd739df85bb10edbfe1ac6f40719b29ae98e',
  },
  'deepseek-fq03': {
    gender: 'female',
    mainSha: 'aede2d29b849e6ce490dfe3b1e73844a2198abb64f5b979622902e472e21522a',
    thumbnailSha: '827475f0c8d94158386e401c0d91984f7686306b9b41316cd75ace34ac9c2801',
  },
  'deepseek-fq04': {
    gender: 'female',
    mainSha: '67a71f5a638afb39b67841a7bcf06569bb6390ca73f0739e99989300cb597c61',
    thumbnailSha: '029e434c0bae03fab7b442230152d2dd94ee319711dd90707982f2f493bd9b89',
  },
  'deepseek-fq05': {
    gender: 'female',
    mainSha: '55d91a3a1adce4c5beb30c10bad3097c8e965e95cdca74755bb9efb1d7686544',
    thumbnailSha: '346e2d5d5edec062ae8185ff1512279915c0bde1a164d8307a5c5f1579f69ff0',
  },
  'deepseek-fq06': {
    gender: 'female',
    mainSha: '5b815253afb0224bdb24af6c8565621ccce28ee4968167a1855e75007c19ffd6',
    thumbnailSha: '8133dd5fd049bdb744f9d3a6b60b92a13ca92a7e6a82858870334190c671cf29',
  },
  'deepseek-fq07': {
    gender: 'female',
    mainSha: '8d94c7290a292ae13e6a3551d40f434c975b028024762188c3ccb43a24db1b78',
    thumbnailSha: '095209758c9635491370b14520e6caa7cafdf4b6a1b53759452a672d866c0669',
  },
  'deepseek-fq08': {
    gender: 'female',
    mainSha: '63ff619d7b1245cf8319ec8a3e016309e576e22fc145ae6df0d670d5cf953493',
    thumbnailSha: 'd7fc0da76de84afb12f9d093363f2dd6912ad5d83924d7a8cf4fbfb30d40e842',
  },
  'deepseek-fn01': {
    gender: 'female',
    mainSha: '2671a834461b14c450457a114518f2e3b32a4b7ea8bfce3bdb2e4637a3f1ae97',
    thumbnailSha: 'a8782e8d95a7bd1738add5b363ab4ac00febc29dbe421e70464f0a55c2e6fa86',
  },
  'deepseek-fn02': {
    gender: 'female',
    mainSha: '81feb047344bd2e4ab203528504d9a71db96a3af051b6e8b107c6945a3060a0e',
    thumbnailSha: '930fb57f4a2bdbb7816564a78ac66b27b5a9d625088e6b0d710e50afe001512e',
  },
  'deepseek-fn03': {
    gender: 'female',
    mainSha: '021857bd7a7de39fcf90435d147ba6a93b32f7455730e0fb61eefb9c2dccb2bb',
    thumbnailSha: '2289429ae31f1d13e7462959ce0c053806a94147d87e5f8f9b263b9d552f4169',
  },
  'deepseek-fn04': {
    gender: 'female',
    mainSha: '661312265aa01f0f234b96ced2fb2c54507ae7db335a2d53a45a024c7c4febca',
    thumbnailSha: '7efa8648b3f190981659b868059b221cec94d2325d5c2f1f0358a7b4498696de',
  },
  'deepseek-fn05': {
    gender: 'female',
    mainSha: '088a86d4e8dd0a92b22991d7d92fec17ba4b11f8b6523df366d7badb5f543993',
    thumbnailSha: 'ca7539ba4504fa1e487fc0c8f88dd916f7f07b1be2f25e02558560b3895e3a02',
  },
  'deepseek-fn06': {
    gender: 'female',
    mainSha: '8f20e0d67fc23f4bab374c4c2af9a26c636045d621a7f660150db7da437bb236',
    thumbnailSha: '2e9a4b7e0d9ca560846a73b755512b3fc14ada26168de9d344fbfd9afd63e2b8',
  },
  'deepseek-fn07': {
    gender: 'female',
    mainSha: '3176d33f6eda159163dca15ef67aba9c339d10f7ef1cbe5987c4ee59d8bd17b6',
    thumbnailSha: 'e8bd741c59cb8201de0969b56e776991f001053a7268504ce355291cec4beed2',
  },
  'deepseek-fn08': {
    gender: 'female',
    mainSha: '53b2a315b5d14a6c59e59d2e03c73793a4cdb08dd6ac07e5e40eefd0c60712f9',
    thumbnailSha: '79ea3aa8e6703148a5b51458e5c0eac68946c469145f53ece3c630d82e6d09bf',
  },
  'deepseek-fn09': {
    gender: 'female',
    mainSha: 'c60207e776657a7532ecd533c5917bc4e32956bc86999985dc713b1d02282522',
    thumbnailSha: '30a9933f83f8cd2f878b228255bfb70aecebe02da3c5e0038210c99a525c3fe9',
  },
  'deepseek-fn10': {
    gender: 'female',
    mainSha: '80b3dcbed29c6caa9e1a46c3081c7795b4a0d2f3461acf995f61f807acbd371f',
    thumbnailSha: 'ef72979cd75845e7f8b9f219f53943d4230698f23e3ef4fbf10e18b818dbd7f3',
  },
  'deepseek-fn11': {
    gender: 'female',
    mainSha: '0c5d1721241e7f7b2f90d5a163883ca2d5abaf75148f2e642ecaf58154c464c9',
    thumbnailSha: '3338bb94a2de244d50382578404e09232f16a6e6e7cb5f66c27558b89bd48312',
  },
  'deepseek-fn12': {
    gender: 'female',
    mainSha: '928e43645155d1d256a0265e4241f4def26c4dfd5c6ee3f8656100098019b526',
    thumbnailSha: '395cbf89a5c5a8b8642075ccae3752c60941d8082f1f82ca8ff4a97d38ed3f61',
  },
  'deepseek-mq01': {
    gender: 'male',
    mainSha: '1cb316fa6a5248bf5ce91663f06696a6f3fa0eb2ff54133d19e05d1e97ca7f84',
    thumbnailSha: '9c3a353f4b3c4e35d38fa7a1672499b8d897329636af593027d2d66108bbfa93',
  },
  'deepseek-mq02': {
    gender: 'male',
    mainSha: '4b94d5bcea79f0875b8d19f13187618dcdc110be3cf04964f12155a7d97226d2',
    thumbnailSha: '50628d4aad4a6c70a7b0ca320090cb919141c872af7326ef61409881fe5f2b5b',
  },
  'deepseek-mq03': {
    gender: 'male',
    mainSha: '89bf77722b7ac5e66bf22fe6c3d0f08f7e8dfbbc62586c7ac4cb0266d85ee84b',
    thumbnailSha: '0642509ee1dfd18f5ed078feaeda126f5a46d9f45923cfdcdac3b6f7b7060066',
  },
  'deepseek-mq04': {
    gender: 'male',
    mainSha: '23b79df3d8f37099ae89e865b4bf6cb76cc2dceada3ef5604e613bcefc50c91e',
    thumbnailSha: '31a70fcca60e8236bff90ab865fce3518324078d364e765fddd0e815fd7b2c39',
  },
  'deepseek-mq05': {
    gender: 'male',
    mainSha: 'e9434a4d14d4427a04dfb56df7ff27617243ba46b26e2f2dc954e45bf0c3c5c3',
    thumbnailSha: '4f0044773a24d040b962bc65e891d9fb3a6cf59ff98bdec541dfb2e5db9b207a',
  },
  'deepseek-mq06': {
    gender: 'male',
    mainSha: 'cea4aca7d0806181d25df06cd1ac9dd78d6a03f94efb4a6b243b1d5ae0bfbc11',
    thumbnailSha: 'd1ca0a0fbe8572b0e7a7701fe8d01f64d5080d5936302e0b3524bf988bc78470',
  },
  'deepseek-mq07': {
    gender: 'male',
    mainSha: '6e8956e6c60e67566e81b496f45751d59b91f7a2011f1a4424b683aeabde6c54',
    thumbnailSha: 'dde35c34d21a82d344fb4207182b98f9ff6ed8381d8f41d42502ba6ab19df021',
  },
  'deepseek-mq08': {
    gender: 'male',
    mainSha: '7190389940870adecd4d2bbaf45c5cac7413ed70a426d3487781e7bb8679efe0',
    thumbnailSha: '75309a8c63bb8bdd70f806fccd7447f381967236ae0d1bdaa16c9a9c9db46358',
  },
  'deepseek-mn01': {
    gender: 'male',
    mainSha: '06db805d1cb36b1883703206b8f774a88d313ef53b4a16b3aeb5e8ae7e9a8da7',
    thumbnailSha: '5b302667d4ae98e7c22f4d29997c3ff96a7756b260a3d524a01837b5e31134d0',
  },
  'deepseek-mn02': {
    gender: 'male',
    mainSha: '5c79462ddacb9b1b4c7d3070b92f2c14326dfead4722ba7c23c92dbc897e1614',
    thumbnailSha: '6e10525762b6452feddda5f44dc495c464658ca95f7cff85a049a901f3a377d1',
  },
  'deepseek-mn03': {
    gender: 'male',
    mainSha: '31614ebd9e065daa64790fc5821c069d07b3b2cff9279ed99e115caef981268c',
    thumbnailSha: '8baa256d77d1bddfa3c6e117c2705910e1856f19c7a103db135999c9343dccc9',
  },
  'deepseek-mn04': {
    gender: 'male',
    mainSha: 'a92d810c3da44b8830a31ecc070656c5cc6143535f853a87fbc0212d51030b93',
    thumbnailSha: '683a90f10062f38bdf59fba0d78e54024ca052551acba23a5a3d3b41984f013f',
  },
  'deepseek-mn05': {
    gender: 'male',
    mainSha: '3f10700417b7426e6e31bb1679e42bc5aef8e720abc2b2fcf89f58864aed7cd1',
    thumbnailSha: 'd6add6e039012ed40e25539b3e469805773c3cf800329e56a8788e157d96edd8',
  },
  'deepseek-mn06': {
    gender: 'male',
    mainSha: '26c14e6b58d5eec9fa2de1ff30c0c7f784135957f21dd23a31d5a6f2cdce5aa7',
    thumbnailSha: '2faf96f5c7b8ce50478a3c6c294af13724940950f33a96b92df7416ef13f2adf',
  },
  'deepseek-mn07': {
    gender: 'male',
    mainSha: '4287701c9cb51b7a31c219db822ffa9c111fba47b951d531ea6e0a283639ffda',
    thumbnailSha: '73e1082fde51f2143b89e0747996e5602825c2e87d0699ebc4ffe288b0c44074',
  },
  'deepseek-mn08': {
    gender: 'male',
    mainSha: '5508fe84a8e323fb5f1ff74faf830f253a394785637b265709d4edf661ef48cb',
    thumbnailSha: 'b8f6d9ea210bed24529ecba03e7952f07f0b30a8d1c52fdd49c2e03ee7cb08db',
  },
  'deepseek-mn09': {
    gender: 'male',
    mainSha: '54d4762d477650da43d8a2d6aa44f7ad4dfe6ea2b2657a546f72c5789a15a3b8',
    thumbnailSha: '61cc404eea3cbd66cf5867009a8b4fb105777491e28d907523a4d97d43a57aeb',
  },
  'deepseek-mn10': {
    gender: 'male',
    mainSha: 'f98e81ef4a152f21dc5e3c9edb33680753e58dd52dc2ba3ced293678488f172a',
    thumbnailSha: '4abb15669a5497adef1bc48a0611f3e447e8a71d3be56e018c0a0d35b182bec5',
  },
  'deepseek-mn11': {
    gender: 'male',
    mainSha: 'eb4b3ebee28179a8c00b66386e8cb5593b98b3c01d5a6d12cad1ab2c24e7148d',
    thumbnailSha: 'eba1dd7fa97ab383df744d4bfba1504bcb1ed6dafdc41e45fe72f512d826b628',
  },
  'deepseek-mn12': {
    gender: 'male',
    mainSha: '0afaf239a519fd8be25b77bfc000140d2fc4ec94a90e58c1f4e5d4b798508177',
    thumbnailSha: '9e9933197f4fc42080958b7029f191e34d97390dd0e86c4ac5faecade23a7913',
  },
} as const;

function publicFile(url: string): string {
  return path.join(process.cwd(), 'public', url.replace(/^\//, ''));
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

test('registers the exact finalized DeepSeek wallpaper pool', async () => {
  const deepSeekThemes = CHAT_THEMES.filter((theme) => theme.id.startsWith('deepseek-'));
  assert.equal(deepSeekThemes.length, Object.keys(samples).length);
  assert.equal(new Set(deepSeekThemes.map((theme) => theme.id)).size, deepSeekThemes.length);
  assert.equal(
    new Set(Object.values(samples).map((sample) => sample.mainSha)).size,
    Object.keys(samples).length,
    'integrated DeepSeek wallpapers must have unique main image hashes',
  );
  assert.equal(CHAT_THEMES.length, DEEPSEEK_WALLPAPER_PLAN.length);
  assert.equal(getChatTheme('f-smile-lamp'), undefined);
  assert.equal(getChatTheme('m-starry'), undefined);

  for (const theme of deepSeekThemes) {
    assert.ok(DEEPSEEK_WALLPAPER_PLAN_BY_ID.has(theme.id), theme.id + ' is not in the final plan');
  }

  for (const gender of ['female', 'male'] as const) {
    for (const style of ['chibi', 'normal'] as const) {
      const integratedCount = deepSeekThemes.filter((theme) => {
        const planned = DEEPSEEK_WALLPAPER_PLAN_BY_ID.get(theme.id);
        return theme.gender === gender && planned?.style === style;
      }).length;
      const finalCount = DEEPSEEK_WALLPAPER_PLAN.filter(
        (entry) => entry.gender === gender && entry.style === style,
      ).length;
      assert.equal(integratedCount, finalCount, gender + ' ' + style + ' must match the final plan');
    }
  }

  for (const [id, expected] of Object.entries(samples)) {
    const theme = getChatTheme(id);
    assert.ok(theme, id);
    assert.equal(theme.gender, expected.gender);
    assert.equal(theme.brightness, 1);
    assert.equal(theme.saturation, 1);
    assert.ok(theme.mobilePosition);
    assert.ok(theme.desktopPosition);
    assert.ok(theme.thumbnail);
    assert.ok(getChatThemesForGender(expected.gender).some((candidate) => candidate.id === id));
    const oppositeGender = expected.gender === 'female' ? 'male' : 'female';
    assert.ok(!getChatThemesForGender(oppositeGender).some((candidate) => candidate.id === id));

    const mainPath = publicFile(theme.image);
    const thumbnailPath = publicFile(theme.thumbnail);
    const [mainStat, thumbnailStat] = await Promise.all([stat(mainPath), stat(thumbnailPath)]);
    assert.ok(mainStat.size <= 1_500_000, id + ' main image exceeds 1.5 MB');
    assert.ok(thumbnailStat.size <= 100_000, id + ' thumbnail exceeds 100 KB');
    assert.equal(await sha256(mainPath), expected.mainSha);
    assert.equal(await sha256(thumbnailPath), expected.thumbnailSha);

    const [mainBytes, thumbnailBytes] = await Promise.all([readFile(mainPath), readFile(thumbnailPath)]);
    assert.equal(mainBytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(mainBytes.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.equal(thumbnailBytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(thumbnailBytes.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});
