/**
 * qwen-audio-3.1-tts-flash 的音色目录（**唯一事实来源**）。
 *
 * 数据出处：阿里云百炼《Qwen-Audio-TTS音色列表》中 `qwen-audio-3.1-tts-flash` 小节，
 * 按表格逐行程序化抽取（脚本与校验见 docs/plans/2026-09-29-qwen-audio-3-1-tts-trial.md）。
 * 抽取时逐项断言：总数 68、四组 4/22/15/27、性别 47 女 / 21 男、id 唯一 —— 官方文档
 * 变动会让断言先失败，不会静默缩小目录。
 *
 * 三条容易踩的坑（都是实测结论）：
 * 1. 千问AI平台那份「Qwen-Audio-TTS 音色列表」**只列 3.0 的音色**；3.1 的音色只在阿里云
 *    百炼那页有。别拿前者当 3.1 的清单。
 * 2. 3.1 必须带 `_v3.1` 后缀：`longanhuan_v3.1` 可用，`longanhuan` 属 3.0，传错拿到
 *    HTTP 400 `InvalidParameter`（`Engine error [411]`）。
 * 3. **voice 参数区分大小写**：英文音色是 `Emily_v3.1`，不是 `emily_v3.1`。
 *
 * 官网上那 500 余个「基础音色」是 3.0-plus / 3.0-flash 专有，3.1 **不提供**，
 * 所以 3.1 的可用集合就是这 68 个。
 *
 * 用途：provider 白名单、试听页、以及产品下拉的选材来源。**不允许再抄第二份清单。**
 */

/** 本目录对应的上游模型 id（`AI_TTS_MODEL` 必须逐字相等）。 */
export const QWEN_TTS_MODEL = 'qwen-audio-3.1-tts-flash' as const;

export type QwenVoiceGender = 'female' | 'male';

export interface QwenVoice {
  /** 上游 `input.voice` 参数，区分大小写。 */
  id: string;
  /** 官方中文名（英文音色为官方英文名）。 */
  nameZh: string;
  gender: QwenVoiceGender;
  section: string;
  /** 声线特质；多语种组为「多语种与方言」。 */
  trait: string;
  /** 官方标注的适用场景；多语种/英文组官方未标注则为空串。 */
  scenes: string;
  /** 多语种与方言组的方言/语言清单。 */
  dialects?: string;
  /** 精品英文音色组的口音标注。 */
  accent?: string;
}

export interface QwenVoiceSection {
  id: string;
  label: string;
  /** 该组在官方文档里的说明，试听页原样展示。 */
  note: string;
}

export const QWEN_VOICE_SECTIONS: QwenVoiceSection[] = [
  {
    id: '多语种与方言音色',
    label: '多语种与方言音色',
    note: '这 4 个音色均支持 8 种方言（上海话、广东话、东北话、重庆话、陕西话、云南话、宁波话、甘肃话）与 8 种语言（日语、韩语、法语、德语、葡萄牙语、意大利语、越南语、印尼语）。',
  },
  {
    id: '精品中文音色',
    label: '精品中文音色',
    note: '官方标注了声线特质与适用场景，是「社交陪伴」类产品最主要的选材池。',
  },
  {
    id: '精品英文音色',
    label: '精品英文音色',
    // 不写「英式/美式」：产品要求不显示英音与美音的区别，而这句 note 会渲染到试听页上。
    note: '英文音色；voice 参数区分大小写。',
  },
  {
    id: '其他系统音色',
    label: '其他系统音色',
    note: '含社交陪伴、角色音、有声书、新闻播报等场景音色。',
  },
];

export const QWEN_VOICES: QwenVoice[] = [
  { id: 'longanhuan_v3.1', nameZh: '龙安欢', gender: 'female', section: '多语种与方言音色', trait: '多语种与方言', scenes: '', dialects: '重庆话 宁波话 韩语 印尼语' },
  { id: 'longanlingxin_v3.1', nameZh: '龙安灵心', gender: 'female', section: '多语种与方言音色', trait: '多语种与方言', scenes: '', dialects: '云南话 陕西话 上海话 法语 意大利语' },
  { id: 'longanfengyue_v3.1', nameZh: '龙安风悦', gender: 'female', section: '多语种与方言音色', trait: '多语种与方言', scenes: '', dialects: '东北话 越南语 日语' },
  { id: 'xunanchuan_v3.1', nameZh: '许南川', gender: 'male', section: '多语种与方言音色', trait: '多语种与方言', scenes: '', dialects: '甘肃话 东北话 法语 葡萄牙语' },
  { id: 'yuxiaoyun_v3.1', nameZh: '于小云', gender: 'female', section: '精品中文音色', trait: '元气、亲切、自然', scenes: '广告营销、广播、客服助手、旁白' },
  { id: 'qiaoxiaojiao_v3.1', nameZh: '乔小娇', gender: 'female', section: '精品中文音色', trait: '俏丽、可爱', scenes: '广告营销、客服助手、有声书' },
  { id: 'xiaxiaochen_v3.1', nameZh: '夏小晨', gender: 'female', section: '精品中文音色', trait: '元气、明亮', scenes: '广告营销、有声书' },
  { id: 'anmingyuan_v3.1', nameZh: '安明远', gender: 'male', section: '精品中文音色', trait: '清亮、自然', scenes: '广告营销、有声书、旁白' },
  { id: 'wenhuaiqing_v3.1', nameZh: '温怀清', gender: 'female', section: '精品中文音色', trait: '清亮、柔和', scenes: '儿童故事、客服助手、广告营销、新闻播报' },
  { id: 'anxiaolan_v3.1', nameZh: '安小岚', gender: 'female', section: '精品中文音色', trait: '清甜、纯净', scenes: '有声书、客服助手、旁白、新闻播报、广告营销' },
  { id: 'xieshurou_v3.1', nameZh: '谢舒柔', gender: 'female', section: '精品中文音色', trait: '柔和、自然、知性', scenes: '有声书、客服助手、旁白' },
  { id: 'baiqinglan_v3.1', nameZh: '白清岚', gender: 'female', section: '精品中文音色', trait: '明亮、清纯', scenes: '语音助手、客服助手' },
  { id: 'xuyuyuan_v3.1', nameZh: '许玉远', gender: 'female', section: '精品中文音色', trait: '知性、成熟、质感', scenes: '广告营销、新闻播报、旁白、客服助手、有声书' },
  { id: 'anruorou_v3.1', nameZh: '安若柔', gender: 'female', section: '精品中文音色', trait: '气声、知性', scenes: '旁白、语音助手' },
  { id: 'wenhuaizhi_v3.1', nameZh: '闻怀之', gender: 'female', section: '精品中文音色', trait: '稳重、成熟', scenes: '有声书、新闻播报、广告营销、客服助手、旁白' },
  { id: 'xiaoxingzhi_v3.1', nameZh: '萧行之', gender: 'female', section: '精品中文音色', trait: '端庄、贵气', scenes: '新闻播报、有声书、旁白、客服助手' },
  { id: 'guyunshu_v3.1', nameZh: '顾云舒', gender: 'female', section: '精品中文音色', trait: '成熟、稳重', scenes: '音乐电台、客服助手、有声书、旁白' },
  { id: 'huozhuoshi_v3.1', nameZh: '霍拙石', gender: 'male', section: '精品中文音色', trait: '清亮', scenes: '有声书、广告营销、旁白' },
  { id: 'yeqinghe_v3.1', nameZh: '叶清禾', gender: 'female', section: '精品中文音色', trait: '亲切、温柔', scenes: '有声书、广告营销、旁白、客服助手' },
  { id: 'yunhuanhuan_v3.1', nameZh: '云欢欢', gender: 'female', section: '精品中文音色', trait: '高亢、热情', scenes: '有声书、旁白、客服助手' },
  { id: 'xuxiaoqiao_v3.1', nameZh: '徐小俏', gender: 'female', section: '精品中文音色', trait: '自然、俏皮', scenes: '有声书、旁白、客服助手' },
  { id: 'baianran_v3.1', nameZh: '白安然', gender: 'female', section: '精品中文音色', trait: '低沉、浑厚、气声', scenes: '配音讲解、有声书、旁白' },
  { id: 'xuyanchu_v3.1', nameZh: '许言初', gender: 'female', section: '精品中文音色', trait: '沉稳、磁性', scenes: '新闻播报、有声书' },
  { id: 'yezhiqing_v3.1', nameZh: '叶知晴', gender: 'female', section: '精品中文音色', trait: '轻快、自然', scenes: '儿童故事、客服助手、语音助手' },
  { id: 'andi_v3.1', nameZh: '安迪', gender: 'male', section: '精品中文音色', trait: 'ABC 口音', scenes: '语音助手' },
  { id: 'anyuqing_v3.1', nameZh: '安语晴', gender: 'female', section: '精品中文音色', trait: '甜妹', scenes: '语音助手、旁白、新闻播报' },
  { id: 'Emily_v3.1', nameZh: 'Emily', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '英式女声' },
  { id: 'Luna_v3.1', nameZh: 'Luna', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '英式女声' },
  { id: 'Eric_v3.1', nameZh: 'Eric', gender: 'male', section: '精品英文音色', trait: '', scenes: '', accent: '英式男声' },
  { id: 'Luca_v3.1', nameZh: 'Luca', gender: 'male', section: '精品英文音色', trait: '', scenes: '', accent: '英式男声' },
  { id: 'Abby_v3.1', nameZh: 'Abby', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Annie_v3.1', nameZh: 'Annie', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Ava_v3.1', nameZh: 'Ava', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Beth_v3.1', nameZh: 'Beth', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Betty_v3.1', nameZh: 'Betty', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Cally_v3.1', nameZh: 'Cally', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Cindy_v3.1', nameZh: 'Cindy', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Donna_v3.1', nameZh: 'Donna', gender: 'female', section: '精品英文音色', trait: '', scenes: '', accent: '美式女声' },
  { id: 'Andy_v3.1', nameZh: 'Andy', gender: 'male', section: '精品英文音色', trait: '', scenes: '', accent: '美式男声' },
  { id: 'Brian_v3.1', nameZh: 'Brian', gender: 'male', section: '精品英文音色', trait: '', scenes: '', accent: '美式男声' },
  { id: 'David_v3.1', nameZh: 'David', gender: 'male', section: '精品英文音色', trait: '', scenes: '', accent: '美式男声' },
  { id: 'longanyuanfei_v3.1', nameZh: '龙安元妃', gender: 'female', section: '其他系统音色', trait: '高傲妃子音', scenes: '社交陪伴' },
  { id: 'longjielidou_v3.1', nameZh: '龙杰力豆', gender: 'male', section: '其他系统音色', trait: '天真男童音', scenes: '儿童陪伴' },
  { id: 'longanlingxi_v3.1', nameZh: '龙安灵希', gender: 'female', section: '其他系统音色', trait: '可爱甜美音', scenes: '社交陪伴（精品中文）' },
  { id: 'longhuohuo_v3.1', nameZh: '龙火火', gender: 'male', section: '其他系统音色', trait: '顽皮少年音', scenes: '角色音' },
  { id: 'longyingtao_v3.1', nameZh: '龙应桃', gender: 'female', section: '其他系统音色', trait: '温柔淡定女', scenes: '客服' },
  { id: 'longanya_v3.1', nameZh: '龙安雅', gender: 'female', section: '其他系统音色', trait: '高雅气质女', scenes: '社交陪伴' },
  { id: 'longwan_v3.1', nameZh: '龙婉', gender: 'female', section: '其他系统音色', trait: '细腻柔声女', scenes: '社交陪伴' },
  { id: 'longxing_v3.1', nameZh: '龙星', gender: 'female', section: '其他系统音色', trait: '温婉邻家女', scenes: '社交陪伴' },
  { id: 'longhua_v3.1', nameZh: '龙华', gender: 'female', section: '其他系统音色', trait: '元气甜美女', scenes: '社交陪伴' },
  { id: 'longhan_v3.1', nameZh: '龙寒', gender: 'male', section: '其他系统音色', trait: '温暖痴情男', scenes: '社交陪伴' },
  { id: 'longanzhi_v3.1', nameZh: '龙安智', gender: 'male', section: '其他系统音色', trait: '睿智轻熟男', scenes: '社交陪伴' },
  { id: 'longzhe_v3.1', nameZh: '龙哲', gender: 'male', section: '其他系统音色', trait: '呆板大暖男', scenes: '社交陪伴' },
  { id: 'longanyang_v3.1', nameZh: '龙安洋', gender: 'male', section: '其他系统音色', trait: '阳光大男孩', scenes: '社交陪伴（标杆音色）' },
  { id: 'libai_v3.1', nameZh: '李白', gender: 'male', section: '其他系统音色', trait: '古代诗仙男', scenes: '诗词朗诵' },
  { id: 'longling_v3.1', nameZh: '龙铃', gender: 'female', section: '其他系统音色', trait: '稚气呆板女', scenes: '童声' },
  { id: 'longniuniu_v3.1', nameZh: '龙牛牛', gender: 'male', section: '其他系统音色', trait: '阳光男童声', scenes: '消费电子-儿童有声书' },
  { id: 'longshanshan_v3.1', nameZh: '龙闪闪', gender: 'male', section: '其他系统音色', trait: '戏剧化童声', scenes: '消费电子-儿童有声书' },
  { id: 'longpaopao_v3.1', nameZh: '龙泡泡', gender: 'female', section: '其他系统音色', trait: '飞天泡泡音', scenes: '消费电子-儿童陪伴' },
  { id: 'loongstella_v3.1', nameZh: 'loongstella', gender: 'female', section: '其他系统音色', trait: '飒爽利落女', scenes: '新闻播报' },
  { id: 'longyuan_v3.1', nameZh: '龙媛', gender: 'female', section: '其他系统音色', trait: '温暖治愈女', scenes: '有声书' },
  { id: 'longmiao_v3.1', nameZh: '龙妙', gender: 'female', section: '其他系统音色', trait: '抑扬顿挫女', scenes: '有声书' },
  { id: 'longsanshu_v3.1', nameZh: '龙三叔', gender: 'male', section: '其他系统音色', trait: '沉稳质感男', scenes: '有声书' },
  { id: 'longanli_v3.1', nameZh: '龙安莉', gender: 'female', section: '其他系统音色', trait: '利落从容女', scenes: '语音助手' },
  { id: 'longanwen_v3.1', nameZh: '龙安温', gender: 'female', section: '其他系统音色', trait: '优雅知性女', scenes: '语音助手' },
  { id: 'longanlang_v3.1', nameZh: '龙安朗', gender: 'male', section: '其他系统音色', trait: '清爽利落男', scenes: '语音助手' },
  { id: 'longxiaoxia_v3.1', nameZh: '龙小夏', gender: 'female', section: '其他系统音色', trait: '沉稳权威女', scenes: '语音助手' },
  { id: 'longanchong_v3.1', nameZh: '龙安冲', gender: 'male', section: '其他系统音色', trait: '激情推销男', scenes: '直播带货' },
];

const QWEN_VOICE_BY_ID = new Map(QWEN_VOICES.map((voice) => [voice.id, voice]));

/** 该 id 是否属于 3.1 的 68 个可用音色（大小写敏感，不做任何规范化）。 */
export function isQwenVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === 'string' && QWEN_VOICE_BY_ID.has(voiceId);
}

export function getQwenVoice(voiceId: string): QwenVoice | undefined {
  return QWEN_VOICE_BY_ID.get(voiceId);
}

export function getQwenVoicesForGender(gender: QwenVoiceGender): QwenVoice[] {
  return QWEN_VOICES.filter((voice) => voice.gender === gender);
}

export function getQwenVoicesForSection(sectionId: string): QwenVoice[] {
  return QWEN_VOICES.filter((voice) => voice.section === sectionId);
}