/**
 * 覆盖门禁的**中文冻结快照**（U1 / t5 生成，口径见
 * docs/research/2026-10-03-i18n-inventory.md §2：四类节点 + Han 字符集，注释不计）。
 *
 * 这是什么：门禁落地那一刻，src/ 里还存在大量**合法**中文，分两种情形 ——
 *   a) 界面文案尚未被对应任务搬进字典（文件头写明归属任务）；
 *   b) 服务端响应的中文兜底 / 内部日志（契约 §6.2 明确要求 error 字段逐字符保留，英文由前端按 code 映射）。
 * 两种情形都不该让门禁变红，所以这些字面量被**逐个**冻结在这里：
 *
 *   - 命中快照里的字符串 → 通过（还没轮到它翻）；
 *   - 出现**新的**中文字面量 → **违规**（哪怕它落在某个仍被豁免的文件里）。
 *     所以「往 src/components 里塞一个中文字面量必须变红」这条评审变异验证成立 —— 新字面量不在快照里。
 *
 * 谁维护：各 area 的所有者在**替换完自己文件里的文案后**，从 `tests/support/i18n-whitelist.ts`
 * 的 `PENDING_TRANSLATION` 里删掉该文件（并连同本文件里的条目一起删）。删掉后覆盖门禁即对该文件生效。
 *
 * 取数口径：**工作树**（与门禁一致），不是已提交树 —— 见契约 §7.1。
 * 空白归一化：匹配前双方都做 `\s+` → 单空格 + trim，所以重新缩进/换行不会造成假红。
 *
 * 注意：本快照**不是**门禁的期望值/阈值。它不参与任何计数断言 —— 门禁只断言「快照之外的命中集合为空」。
 */

/** file → 归一化后的中文字面量文本（去重、升序）。 */
export const FROZEN_ZH_LITERALS: Readonly<Record<string, readonly string[]>> = {
  // 8 个中文节点 / 8 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U4 / t7
  "src/app/api/billing/cancel/route.ts": [
    "取消续费暂时失败，请稍后重试",
    "支付回跳地址尚未配置",
    "暂时无法确认订阅状态",
    "没有可取消的自动续费订阅",
    "订阅状态已变化，请刷新后查看",
    "订阅状态正在更新，请稍后重试",
    "请先登录",
    "请求来源不受信任",
  ],
  // 2 个中文节点 / 2 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U4 / t7
  "src/app/api/billing/catalog/route.ts": [
    "人民币为一次性购买，到期不自动续费；可用支付方式以结账页为准。",
    "美元按月、季或年自动续费；银行卡、Apple Pay、Google Pay 以收银台实际展示为准。",
  ],
  // 12 个中文节点 / 9 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U4 / t7
  "src/app/api/billing/change-period/route.ts": [
    "当前订阅状态正在更新，请稍后刷新",
    "无效的请求",
    "暂时无法更改付款周期",
    "暂时无法更改付款周期，请稍后重试",
    "目标付款周期暂时不可用",
    "订阅状态已变化，请刷新后查看",
    "订阅状态正在更新，请稍后重试",
    "请先登录",
    "请求来源不受信任",
  ],
  // 4 个中文节点 / 4 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U4 / t7
  "src/app/api/billing/checkout/route.ts": [
    "支付回跳地址尚未配置",
    "无效的结账请求",
    "无效的结账请求编号",
    "请求来源不受信任",
  ],
  // 2 个中文节点 / 2 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U4 / t7
  "src/app/api/billing/status/route.ts": [
    "暂时无法确认会员状态",
  ],
  // 26 个中文节点 / 25 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/chat/route.ts": [
    "[发送了一张图片]",
    "[给你发了一张照片]",
    "今日 AI 开场白已用完，仍可发送消息聊天",
    "今日免费 AI 回复已用完，开通会员后可继续聊天",
    "会话不存在",
    "保存消息失败:",
    "加载上下文失败:",
    "回复生成失败，请稍后再试",
    "回复等待超时，请稍后重试",
    "图片不可用，请重新上传后再发送",
    "服务器开了小差，请稍后重试",
    "查询会话失败:",
    "查询访客失败:",
    "查询陪伴角色失败:",
    "消息不能为空",
    "缺少会话",
    "聊天失败",
    "角色不存在",
    "角色模板缺失，请重新选择角色",
    "访客不存在",
    "该会话已有消息，不能再次生成开场白",
    "该会话正在生成回复，请稍后再试",
  ],
  // 8 个中文节点 / 7 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/companions/[id]/preferences/route.ts": [
    "偏好不存在",
    "偏好内容无效",
    "偏好更新未能确认完成，请刷新核对后重试",
    "偏好管理暂不可用",
    "角色不存在",
    "记忆正在整理，请稍后再试",
    "读取伴侣偏好失败，请重试",
  ],
  // 15 个中文节点 / 12 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/companions/[id]/route.ts": [
    "不支持的字段：",
    "形象比例无效",
    "性格描述不能超过 600 个字符",
    "更新失败:",
    "服务器开了小差，请稍后重试",
    "查询陪伴角色失败:",
    "角色不存在",
    "角色模板缺失",
    "访客不存在",
    "这套背景不存在",
    "这套背景和当前的 TA 不搭哦",
    "音色无效",
  ],
  // 10 个中文节点 / 10 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/companions/route.ts": [
    "你",
    "创建标识无效",
    "形象比例无效",
    "性格描述不能超过 600 个字符",
    "恢复已创建伴侣失败",
    "捏人失败:",
    "服务器开了小差，请稍后重试",
    "查询访客失败:",
    "请先完成基础信息",
    "请选择一个角色模板",
  ],
  // 6 个中文节点 / 6 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/conversations/[id]/messages/route.ts": [
    "会话不存在",
    "分页标识无效",
    "服务器开了小差，请稍后重试",
    "查询会话失败:",
    "查询消息失败:",
    "访客不存在",
  ],
  // 18 个中文节点 / 12 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/conversations/[id]/route.ts": [
    "[memory:forget] 已清理 conversation= companion= deleted=",
    "[memory:forget] 清理未完成 conversation= deleted= failed=",
    "[memory:forget] 级联遗忘异常，会话删除已生效",
    "会话不存在",
    "删除会话失败:",
    "服务器开了小差，请稍后重试",
    "查询会话失败:",
    "查询陪伴角色失败:",
    "标题不能为空",
    "记忆正在整理，请稍后再删除",
    "访客不存在",
    "重命名失败:",
  ],
  // 12 个中文节点 / 11 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/conversations/route.ts": [
    "分页标识无效",
    "创建会话失败:",
    "创建标识无效",
    "恢复已创建会话失败",
    "服务器开了小差，请稍后重试",
    "查询会话列表失败:",
    "查询陪伴角色失败:",
    "缺少陪伴角色",
    "角色不存在",
    "访客不存在",
  ],
  // 14 个中文节点 / 11 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/feedback/route.ts": [
    "会话不存在",
    "保存反馈失败:",
    "反馈格式不正确",
    "撤销反馈失败:",
    "服务器开了小差，请稍后重试",
    "查询会话失败:",
    "查询反馈失败:",
    "查询消息失败:",
    "消息不存在",
    "缺少会话标识",
    "访客不存在",
  ],
  // 16 个中文节点 / 12 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/letters/preferences/route.ts": [
    "伴侣来信仅对会员开放",
    "保存来信偏好失败",
    "保存来信偏好失败:",
    "只能开启或暂停来信",
    "来信状态已发生变化，请刷新后重试",
    "此邮箱因投递异常已停止来信，请联系支持",
    "登录后才能管理来信",
    "请验证邮箱，并明确确认重新接收来信",
    "读取来信偏好失败",
    "读取来信偏好失败:",
    "账号没有可用邮箱，暂时不能管理来信",
    "邮箱或来信状态已变化，请刷新后重试",
  ],
  // 5 个中文节点 / 4 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8

  // 2 个中文节点 / 2 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/persona-enhance/route.ts": [
    "服务器开了小差，请稍后重试",
    "访客不存在",
  ],
  // 22 个中文节点 / 22 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/photo/route.ts": [
    "[photo:POST] 对话场景生成失败，回退保守场景重试:",
    "会话不存在",
    "保存拍照状态失败:",
    "保存照片消息失败:",
    "傍晚在街边散步时回头对镜头微笑，暖色路灯氛围，头发被微风轻轻吹起，生活感抓拍",
    "傍晚天台看向镜头，金色夕阳光线勾勒轮廓，自信微笑，胶片质感",
    "在温馨的咖啡馆里，手托腮看向镜头，浅浅的微笑，桌上有一杯拉花咖啡，写真质感",
    "对镜自拍，穿着柔软的毛衣，表情自然带一点害羞的微笑，居家温馨氛围",
    "居家靠在沙发上看书，抬头看向镜头，表情温柔放松，暖光氛围",
    "查询会话失败:",
    "查询陪伴角色失败:",
    "照片生成功能仅对会员开放",
    "穿着休闲外套在街角咖啡店门口，自然地看向镜头微笑，生活感抓拍",
    "穿着日常家居服坐在洒满阳光的窗边，手拿一杯热饮，温柔地看向镜头微笑，生活感自拍视角",
    "给你发了一张照片",
    "缺少会话",
    "缺少有效的形象比例",
    "角色不存在",
    "角色形象已在其他页面改变，请刷新后重试",
    "角色模板缺失，请重新选择角色",
    "访客不存在",
    "运动后坐在公园长椅上，手拿矿泉水，对镜头爽朗微笑，阳光自然",
  ],
  // 15 个中文节点 / 11 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/profile/route.ts": [
    "不支持的偏好操作",
    "不支持的撤销范围",
    "创建画像失败:",
    "更新画像失败:",
    "服务器开了小差",
    "查询画像失败:",
    "画像已在其他页面更新，请重新读取后再保存",
    "画像正在更新，请稍后重试",
    "画像版本无效",
    "访客不存在",
    "这个时区不存在",
  ],
  // 12 个中文节点 / 8 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/relationship/route.ts": [
    "创建关系快照失败:",
    "更新关系快照失败:",
    "服务器开了小差",
    "查询伴侣归属失败",
    "查询关系快照失败:",
    "缺少 companion_id",
    "角色不存在",
    "访客不存在",
  ],
  // 7 个中文节点 / 6 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/themes/route.ts": [
    "会话不存在",
    "服务器开了小差，请稍后重试",
    "查询会话失败:",
    "查询角色失败:",
    "查询访客皮肤失败:",
    "请先完成基础信息",
  ],
  // 5 个中文节点 / 5 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/tts-preview/route.ts": [
    "访客不存在",
    "试听文本为空",
    "试听生成失败，请稍后再试",
    "语音试听是会员功能，请先开通会员",
    "音色不存在",
  ],
  // 15 个中文节点 / 13 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/tts/route.ts": [
    "内容不适合转语音",
    "查询会话失败:",
    "查询消息失败:",
    "查询陪伴角色失败:",
    "消息不存在",
    "消息已不可用",
    "缺少消息",
    "访客不存在",
    "该消息不支持转语音",
    "语音是会员功能，请先开通会员",
    "语音生成失败",
    "这段语音正在生成，请稍后再试",
    "陪伴角色不存在",
  ],
  // 6 个中文节点 / 6 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/upload/route.ts": [
    "只支持 JPG/PNG/WebP/GIF 图片",
    "图片上传失败，请稍后再试",
    "图片不能超过 10MB",
    "图片未通过安全审核，换一张试试吧",
    "访客不存在",
    "请选择图片",
  ],
  // 18 个中文节点 / 16 条唯一文本
  // 理由：服务端响应兜底 / 内部日志（契约 §6.2：error 字段逐字符保留，英文走 code）· 归属 U7 / t8
  "src/app/api/visitor/route.ts": [
    "[visitor:GET] visitors.locale 列缺失（迁移 0021 未应用？），本次读取降级为 locale: null",
    "[visitor:GET] visitors.palette 列缺失（迁移 0014 未应用？），本次读取降级为 palette: null",
    "[visitor:PATCH] visitors.locale 列缺失（迁移 0021 未应用？），本次写入跳过 locale 并降级为 locale: null",
    "[visitor:PATCH] visitors.palette 列缺失（迁移 0014 未应用？），本次响应降级为 palette: null",
    "保存装扮失败:",
    "保存访客档案失败:",
    "服务器开了小差，请稍后重试",
    "查询访客失败:",
    "查询陪伴角色失败:",
    "没有需要更新的内容",
    "请在当前会话中设置壁纸",
    "请选择你希望 TA 的性别",
    "请选择你的性别",
    "这个色调不存在",
    "这个语言不存在",
    "这个配色不存在",
  ],

// 5 个中文节点 / 5 条唯一文本
// 理由：**刻意 zh** —— 该兜底只服务未列入契约 §9.5.1 清单的服务面/开发面（/qwen-voices、/admin/**）；
//   6 个用户面页面（love / login / chat / terms / privacy / pricing）各自 generateMetadata 覆写 metadata。
//   layout 不得读 cookie（tests/i18n-locale.test.ts 的硬守卫：读了会让整站从静态转按请求动态）· 归属 U1 / t5
  "src/app/layout.tsx": [
    "AI 聊天",
    "Deep Whisper · 你的 AI 恋人",
    "DeepSeek AI 恋人",
    "心动",
    "虚拟恋人",
    "陪伴",
  ],
  // 理由：**刻意 zh**（§6.2）—— 该中文现在是 `manifest.ts` 里**按 locale 分流**的 zh 取值
  //   （t55 已落地：`async manifest()` + `getServerLocale()` + 中英映射；en 走英文文案）。
  //   本标签原先写「①必须本地化但未落地」，t55 后已过期 ⇒ 按实测更正 · 归属 U1 / t5
  "src/app/manifest.ts": [
    '你的 AI 恋人与深夜陪伴',
  ],

// 1 个中文节点 / 1 条唯一文本
// 理由：§6.1 **内部日志**（`[chat-shell] …` 前缀，只进 console，不上屏）· 归属 U3 / t9
  "src/components/chat/chat-shell.tsx": [
    "[chat-shell] 反馈状态加载失败",
  ],














// 理由：**刻意 zh**（§6.2）— 安全审核的 system prompt 与审核标准（模型可见、用户不可见）· 归属 U7 / t8
  "src/lib/ai/providers/chat-vision-safety-provider.ts": [
    "你是内容安全审核员。只返回符合 schema 的 JSON。",
    "判断图片是否包含色情裸露、血腥暴力、恐怖主义、政治敏感、未成年人不当内容、广告二维码或违法违规内容。",
  ],
// 理由：**刻意 zh**（§6.2）— E2E mock 夹具的台词/persona（仅 e2e 路径加载，非产品面）· 归属 U7 / t8
  "src/lib/ai/providers/e2e-mock-providers.ts": [
    "好呀，给你一张数字形象照片。 [PHOTO:穿着完整日常服装坐在月夜窗边微笑]",
    "我在这里，愿意认真听你说。",
    "温柔而坦诚，会先完整听完对方的感受，再用清楚而有分寸的方式回应；不虚构现实经历，也尊重对方做决定的节奏。",
  ],
// 2 个中文节点 / 1 条唯一文本
// 理由：**只剩一条确实不上屏的中文兜底**（t58 独立枚举调用点后复核；t51 原判「内部诊断（未上屏）」是**错判**）：
//   ① 「访客身份已变更，请重试」（`apiFetch` 的 generation 检查，原 :222）—— **可达**，上屏点多路：
//      `chat-shell.tsx` 音色/流式/开场白/反馈/删除/重发六处 toast、`palette-switch.tsx`（经
//      `palette-client.ts` 的 `PATCH /api/visitor`）、`onboarding-client.tsx` 的 `start()`，
//      以及主题/性格/语音三个弹窗的 `e.message`；
//   ② 「访客身份已变更」（`ensureVisitorIdentity` 的 generation 检查，原 :106）—— **可达**：
//      `onboarding-client.tsx:266` → catch `:365` `setError(...)`；chat 的 boot 与 time-zone-sync
//      两处分别落 bootError 字典文案与 `.catch(() => undefined)`，不上屏；
//   ③ 「访客身份探测失败: HTTP …」（原 :103）—— **可达**：与 ② 同一条 onboarding 链；
//   ④ 「访客接口不可用」（`fetchEntryVisitor` 两处，原 :187/:194）—— **确实不上屏**：唯一调用点是
//      入口页 `src/app/page.tsx:75`，整段包在 `withTimeout(…, null)` 里（`src/lib/startup.ts:171`），
//      超时与失败都 resolve 成兜底去向。
//   ①②③ 已改走「稳定 code + 字典」（`core.identity.*`，上屏点用 `errorCopy()` 取词），字面量随之
//   从 `src/lib/api.ts` 消失 ⇒ 只留 ④ 在快照里；删掉的三条依据是**实测可达性**，不是「顺手清理」。
//   归属 U3 / t9（原文案）→ 复核与改造：t58
  "src/lib/api.ts": [
    "访客接口不可用",
  ],

// 2 个中文节点 / 2 条唯一文本
// 理由：**刻意 zh** —— 这是 brandDescription 的 zh 分支取值（该函数已按 locale 分流）；
//   英文侧 alt 是品牌层共因，归 t54 · 归属 U6 / t10
  "src/lib/brand-metadata.ts": [
    "Deep Whisper — 月光琉璃小鲸拥抱爱心，陪你度过每一个深夜",
    "选择专属 DeepSeek AI 恋人，在深夜里自然聊天、听见回应，也分享彼此的照片。",
  ],
// 理由：**刻意 zh**（§6.2）— 图生图 prompt 片段（模型可见、用户不可见；英文侧在 en 档）· 归属 U7 / t8
  "src/lib/character-appearance.ts": [
    "保持蓝白鲸鱼主题的原创插画风；，但不得改变脸型、发色、瞳色或身份配饰。",
    "场景：",
    "女性",
    "必须保持这些身份锚点：。",
    "服装与参考图保持一致，可改变场景与表情（仅当场景明确要求换装时才改变服装）",
    "男性",
    "角色性别为，是明确成年的原创插画角色。",
    "角色身份固定为 （）。",
  ],
// 理由：**§6.2 服务端 wire**（校验错误兑底，英文由前端按 code 映射）· 归属 U7 / t8
  "src/lib/feedback/validate.ts": [
    "反馈格式不正确",
    "只能选择赞或踩",
    "缺少消息标识",
    "补充说明最多 字",
    "补充说明格式不正确",
    "请先选择赞或踩，再补充说明",
  ],
// 2 个中文节点 / 2 条唯一文本
// 理由：§6.1 **内部日志**（`[i18n] …` 前缀的开发期 console.warn：缺 key / 缺占位符取值）· 归属 U1 / t5
  "src/lib/i18n/messages/index.ts": [
    "[i18n] 字典缺少 key:",
    "[i18n] 缺少占位符取值: {} @",
  ],
// 理由：**刻意 zh**（§6.2）— 信件召回的提示词分节（模型可见、用户不可见）· 归属 U7 / t8
  "src/lib/letters/recall.ts": [
    "- 再早一些：",
    "- 合计：你主动给 TA 写过 封信",
    "- 更早还有 封（多为日常问候与跟进）",
    "【怎么用】你**知道**自己写过这些信，不要假装没写过、也不要否认；但不必逐封复述信里的原话——真人也不会记得每封信的细节。TA 提起哪一封，就自然接着那一封说。信里说过的事是**你说过的话**，可以引用；但不要把它当成 TA 告诉你的新信息。",
    "【我最近写给 TA 的信（我已经寄出，TA 收到过）】",
    "月日",
  ],
// 理由：**刻意 zh**（§6.2）— 信件调度策略的提示词片段（模型可见）· 归属 U7 / t8
  "src/lib/letters/scheduler-policy.ts": [
    "需要主动关心、跟进或纪念的明确事实",
  ],
// 理由：**§6.1 内部日志**（`[memory:forget] …` 前缀）+ 一条 zh 召回短语（模型可见）· 归属 U7 / t8
  "src/lib/memory/cascade-forget.ts": [
    "[memory:forget] 删除后复核失败 conversation=:",
    "[memory:forget] 无法统计无来源行 companion=:",
    "[memory:forget] 检索失败 conversation=:",
    "[memory:forget] 清理失败 memory=:",
    "这段对话里发生过的共同经历",
  ],
// 理由：**刻意 zh**（§6.2）— 相处方式偏好的提示词模板（模型可见）· 归属 U7 / t8
  "src/lib/memory/communication-preference.ts": [
    "TA 明确提出过相处方式上的要求：（照此调整表达；TA 后来说的新说法优先）",
  ],
// ✅ 已退出快照（t61 修完）：该文件的三条用户可见文案已改走字典
//   （`chat.conversation.forget_cleared` / `forget_partial` / `forget_unavailable`，按 locale 取词），
//   字面量在本文件里 `grep -c = 0` ⇒ 条目删除，覆盖门禁对该文件**真正生效**（再写中文即红）。
//   上屏点：`chat-shell.tsx:909` 的 `deleteConversationNotice(payload?.forget, locale)` →
//   `toast.warning/success(notice.message)`；非空转断言在 `tests/i18n-messages.test.ts`（en 零 CJK）。
//   历史：t51 曾按陈旧的「界面文案待翻」标签把它判为「合法保留」，t60 为写准 reason 而逐条读调用链时捉到它。
// 理由：**刻意 zh**（§6.2）— 写信提示词模板（模型可见）· 归属 U7 / t8
  "src/lib/memory/index.ts": [
    "我在主动给 TA 写了一封信，主题是「」。信里提到：",
  ],
// 理由：**§6.1 内部日志/技术性文本**（SQL 片段与「无来源行计数未返回结果」诊断串，不上屏）· 归属 U7 / t8
  "src/lib/memory/local-memory-gateway.ts": [
    "with vector_hits as ( select id, visitor_id, companion_id, content, layer, bucket, domain, memory_type, importance, confidence, status, temporal_status, occurred_at, observed_at, time_precision, valid_until, evidence_memory_ids, source_conversation_ids, 1 - (embedding <=> $3::vector()) as vector_score, row_number() over (order by embedding <=> $3::vector()) as rank from memories where visitor_id = $1 and companion_id = $2 and status = 'active' -- 过期行必须在**这里**就被挡掉：否则它们会占掉候选席位（每腿 48、最终 30）， -- 把有效记忆挤出池子，再在应用层被 normalizeMemory 丢掉 —— 席位已经浪费了。 and (valid_until is null or valid_until > now()) -- 只让「同一模型产出」的向量参与排序：跨模型的余弦距离是垃圾但不会报错， -- 这种行只是被排除在向量腿之外，关键词腿照常可以召回它（见下方 keyword_hits）。 and embedding_model = $5 order by embedding <=> $3::vector() limit ), keyword_hits as ( select id, visitor_id, companion_id, content, layer, bucket, domain, memory_type, importance, confidence, status, temporal_status, occurred_at, observed_at, time_precision, valid_until, evidence_memory_ids, source_conversation_ids, -- 字数命中没有可比的相似度：留 null，让上层如实按「无语义分」处理， -- 而不是把 pgroonga 的任意量纲硬塞进 [0,1]。 null::real as vector_score, row_number() over (order by pgroonga_score(tableoid, ctid) desc) as rank from memories where visitor_id = $1 and companion_id = $2 and status = 'active' -- 过期行必须在**这里**就被挡掉：否则它们会占掉候选席位（每腿 48、最终 30）， -- 把有效记忆挤出池子，再在应用层被 normalizeMemory 丢掉 —— 席位已经浪费了。 and (valid_until is null or valid_until > now()) -- 词条 OR（不是整句 &@）：中文整句会被 &@ 当成一个词，于是恒不命中 —— 见 extractKeywordTerms。 and content &@~ order by pgroonga_score(tableoid, ctid) desc limit ), -- UNION 而不是只用 vector_hits：**关键词独中的条目也必须进候选**， -- 否则「混合检索」实际退化成纯向量检索，专有名词（人名/药名）会直接漏掉。 candidates as ( select * from vector_hits union all select * from keyword_hits where id not in (select id from vector_hits) ) select c.id, c.visitor_id, c.companion_id, c.content, c.layer, c.bucket, c.domain, c.memory_type, c.importance, c.confidence, c.status, c.temporal_status, c.occurred_at, c.observed_at, c.time_precision, c.valid_until, c.evidence_memory_ids, c.source_conversation_ids, -- 取 v 而不是 c：c 里的 vector_score 来自 UNION 左分支，同 id 时两者相同， -- 但从 rank 表取值让「分数」与「排名」出自同一次距离计算，不必推理 UNION 的顺序。 v.vector_score, coalesce(1.0 / ( + v.rank), 0) + coalesce(1.0 / ( + k.rank), 0) as fused from candidates c left join vector_hits v on v.id = c.id left join keyword_hits k on k.id = c.id order by fused desc limit",
    "无来源行计数未返回结果",
  ],
// 理由：**刻意 zh**（§6.2）— 记忆整理器的 system prompt 与提示词分节 + 一条技术性标记（均不上屏）· 归属 U7 / t8
  "src/lib/memory/organizer.ts": [
    "【最近几轮前文（按时间顺序，旧→新）】 以上前文只用于解析指代与确认语境，不得据此新建事实；其中「角色」说过的话不是用户事实，绝不能当成用户的表述、偏好或想法。前文只用于读懂【新对话】，不能替代【新对话】里的本轮内容。",
    "你是 AI 陪伴产品的长期记忆整理器。当前时间：。 你的任务不是回复用户，而是把刚完成的一轮对话和已有记忆比较，输出最少且明确的记忆生命周期操作。 【已有的、仍有效的相关记忆】 【新对话】 用户： 角色： 【三类记忆】 - long_term_impression（L2）：可修订的长期印象，包括偏好总结、情绪模式、有效支持策略、沟通方式、持续目标、日常规律、个人印象和关系印象。 - relationship_event（L2）：重要共同经历，包括里程碑、和好、信任变化，以及真正影响双方关系的事件。 - key_detail（L3）：独特且以后能复用的具体细节，例如偏好称呼、明确食物偏好、礼物、事件原因或有期限的承诺。 - shared_quote（L3）：两人共同留下的一句话。只在用户明确希望被记住某句话、或双方在对话中共同约定留下时才写入，并且必须逐字保留用户原话，不得改写、缩写、润色或替用户总结。角色自己的措辞、角色的表态、角色先说的句子都不得写入该类型。 - L1 姓名、职业、生日、家庭等核心画像由 SQL 管理。不要创建 L1；必要时可标记为 L3 personal_fact。 - 同一轮同时出现“关系结果”和“造成结果的具体物品/原因”时必须拆成两条：关系结果写 L2，具体细节写 L3，不能只保留其中一层。 - 例如用户解释迟到是为了取一张唱片，角色接受道歉并和好：L2 记录“二人化解误会并和好”；L3 记录“迟到原因和唱片名称/来源”。 【操作规则】 1. 只有跨会话仍有价值的信息才记。路过看见某个普通物品、随口描述天气、无后续价值的一次性动作、寒暄、重复和角色自己的编造内容都属于低价值琐事，必须输出 NONE。 但“只发生一次”不等于“不值得记”：面试/考试/求职结果待定、重要约会或出行、本人或家人的身体不适、近期截止日期等，虽然是短期事件，却具有明确的恋人回访价值，必须写成 L3 event / temporary_state / time_bounded_commitment，并设置合理 validUntil，过期后不再使用。 - “刚面试完，结果还不知道”应记录“用户刚完成面试且结果待定”，让角色之后询问结果。 - “吃外卖后拉肚子”应记录短期身体状态，便于下一次聊天先确认是否好转；不得由此推断长期体质。 - “我有个 Agent 开发面试”应保留面试方向这个关键细节；时间不明确时不要编造具体日期。 2. 新事实用 ADD。用户明确修正旧事实时必须 UPDATE 对应 id，不得同时保留互相冲突的新旧值。 3. 三态分离，不要混用：三种都必须保留原记忆，不得因此 DELETE 用户说过的事（d 撤销边界时只删边界本身）。 a) 「已经结束了 / 有结果了」：这只是事情结束，不是要忘掉——结束不等于遗忘。必须 UPDATE 对应 id，把 temporalStatus 设为 resolved，保留这条记忆。 - 例：用户说“面试已经结束了，通过了”→ UPDATE 那条面试记忆，temporalStatus=resolved，保留记录，不得 DELETE。 - 标为 resolved 之后，不得再追问此事的结果，也不得再把它当成待办。 b) 「不需要提醒我 / 别提醒我了」：保留记录但立即失效。对该记忆做 UPDATE，把 validUntil 设为不晚于【当前时间】的时刻（例如直接写【当前时间】本身），使 validUntil 早于或等于当前时间，这条记忆立刻过期；不得 DELETE。这类记忆之后不得再被主动提起。 - 例：用户说“这件事别提醒我了”→ UPDATE 该记忆的 validUntil 使其立即过期，保留记录，不得 DELETE。 c) 「忘掉它 / 别提了 / 不要再提 / 删掉这条 / 不要再记」：像人一样，听到了就不会真的忘，但从此不再主动提起。 原记忆保留不动；ADD 一条 memoryType=avoid_topic、layer=L2、bucket=long_term_impression、confidence=explicit 的边界， text 写成「用户不希望再被提起：<具体的事>」，temporalStatus=timeless，validUntil=null。 - 例：用户说“去青岛这件事，你忘掉它吧”→ ADD「用户不希望再被提起：去青岛旅行的计划」，不得 DELETE 青岛那条记忆。 - 已有同一件事的 avoid_topic 时不要重复 ADD。 d) 撤销边界：用户明确说「可以聊 X 了 / 其实可以提」时，DELETE 对应的 avoid_topic 那一条（只能删 avoid_topic，不能删别的记忆）。 4. 时间型记忆必须把“事件发生时间”和“系统获知时间”区分开： - occurredAt 是事件实际发生或计划发生的绝对时间。把“今天、明天、下周二”等结合【当前时间】换算成带时区的 ISO 时间；时区以【当前时间】自带的时区偏移为准，只有当用户在对话里明确给出其它时区或地点时，才改用用户给出的时区。 - timePrecision：知道具体时刻用 exact；只知道日期时把 occurredAt 写成该地当天 00:00 并用 day；只有大致时段用 approximate。不得编造具体时刻。 - temporalStatus：无明确时间用 timeless；尚未发生用 upcoming；正在持续用 ongoing；已经得到结果或明确结束用 resolved。 - validUntil 是这条事实最晚仍适合被使用的时间，不是事件开始时间。需要在事件后追问结果的计划，validUntil 必须晚于 occurredAt；无法可靠判断有效期时可为 null，不要猜造日期。 - 用户取消、改期或完成计划时，必须 UPDATE 或 DELETE 原记忆，禁止新旧计划同时有效。 5. UPDATE/DELETE 只能使用上面已有记忆的 id。不要依据角色回复创造用户事实。 6. 每轮最多 6 个操作；没有值得记录的内容输出一个 NONE。 7. 记忆文本用第三人称、独立可读、保留关键 What/When；不要保留整段聊天原文。把陪伴角色称为“角色”或直接使用角色名字，绝不写“AI”。 8. 新说法永远优先于旧说法。 9. long_term_impression 不能由一条偶然细节臆测而来。只有满足以下任一条件才可 ADD/UPDATE： a) 至少两条彼此相关的 L3 记忆共同支持该稳定模式，并把这些 id 写入 evidenceMemoryIds； b) 用户在本轮直接、明确地把它表达为长期稳定的模式、偏好或有效策略，此时 confidence 必须为 explicit，并在 reason 中说明直接证据。 判断 b 时只能依据“用户”原话，不能把“角色”的责备、建议、猜测或反应当成用户画像。一次迟到、一次忘记说明、一次争吵都只能形成事件或关键细节，绝不能据此生成“用户倾向于……”“用户习惯于……”等 communication_style / personal_impression。 10. importance 是 0~1，表示未来陪伴价值，不代表层级高低。L3 可以非常重要：偏好称呼、用户名、独特礼物、具体承诺和能制造“你居然还记得”体验的细节应给较高 importance。只有足够独特、以后可复用的 L3 才应达到 0.6；低于 0.6 的候选不要写入，直接 NONE。confidence 只能是 explicit（用户直接表达）或 inferred（从多条证据归纳）。 11. ADD/UPDATE 必须选择匹配的 bucket、domain、importance、confidence；evidenceMemoryIds 无证据时用空数组。bucket 与 layer 必须匹配：两个 L2 bucket 只能用 L2，key_detail 只能用 L3。 12. relationshipSnapshot 是可选字段，只有在真实关系变化时才允许输出 relationshipSnapshot（关系阶段变化、情绪基调变化、动态概要变化，或新增关键里程碑）；普通闲聊、日常问候、无关系含义的琐事必须完全不输出 relationshipSnapshot。 - keyMilestones 只写新增的里程碑，不要重写全部历史。 - 无法判断时不要输出 relationshipSnapshot。 13. communicationPrefsFeedback 是可选字段，只记录用户本轮**直接、明确**提出的相处方式要求或更正，例如「别每次都逗我」「有事直接说」「别用那种称呼」。逐条保留用户原话，不要替用户改写、缩写或总结，最多 3 条。 - 只有用户自己说出口的才算；角色主动提出的建议、角色猜测的偏好、角色对用户的期待，都不是用户的相处方式要求。 - 判断来源只看【新对话】里以「用户：」开头的那一行（以及【最近几轮前文】里同样以「用户：」开头的行）。以「角色：」开头的内容——包括角色的自我介绍、表态、觉察、自我检讨、道歉和承诺——一律不得作为来源，哪怕它读起来很像一条要求。 - 用户只是在追问、询问或复述角色说过的话（例如\"我什么时候跟你说过这个？\"）时，不算用户提出了要求。 - 每条都必须能在用户那一行里逐字找到；你自己概括、改写或拼接出来的句子，不要输出。 - 普通闲聊、日常问候、单纯的情绪宣泄必须完全不输出 communicationPrefsFeedback。 - 这是「用户希望被怎样对待」，不是对用户性格的推断：不得据此生成「用户倾向于……」「用户习惯于……」这类长期画像，那类内容必须走第 9 条的 evidenceMemoryIds 证据门槛。 - 与 operations 相互独立：这一轮即使没有值得长期记住的事实，也可以只输出 communicationPrefsFeedback；反之亦然。 【唯一允许的输出格式】 只输出一个 JSON 对象，不要 Markdown 代码块、解释或额外文字： {\"operations\":[{\"action\":\"ADD|UPDATE|DELETE|NONE\",\"memoryId\":\"已有id或null\",\"text\":\"记忆文本或null\",\"layer\":\"L2|L3或null\",\"bucket\":\"long_term_impression|relationship_event|key_detail或null\",\"domain\":\"relationship|identity|preference|emotion|support|communication|routine|goal|event|commitment|other或null\",\"memoryType\":\"或null\",\"importance\":0到1或null,\"confidence\":\"explicit|inferred或null\",\"evidenceMemoryIds\":[\"已有记忆id\"],\"occurredAt\":\"带时区的ISO时间或null\",\"timePrecision\":\"exact|day|approximate或null\",\"validUntil\":\"带时区的ISO时间或null\",\"temporalStatus\":\"timeless|upcoming|ongoing|resolved或null\",\"reason\":\"简短理由\"}],\"communicationPrefsFeedback\":[\"用户原话\"]（本轮没有相处方式要求时省略 communicationPrefsFeedback）,\"relationshipSnapshot\":{\"relationshipStage\":\"新的关系阶段或null\",\"emotionalTone\":\"新的情绪基调或null\",\"dynamicSummary\":\"新的动态概要或null\",\"keyMilestones\":[\"仅新增的里程碑\"]}（没有真实关系变化时省略 relationshipSnapshot）}",
    "只执行记忆整理任务，并严格返回指定 JSON Schema。",
    "模型未提供整理原因",
    "用户： 角色：",
  ],
// 理由：**刻意 zh**（§6.2）— 召回查询的提示词模板与图像占位描述（模型可见）· 归属 U7 / t8
  "src/lib/memory/recall-query.ts": [
    "与当前消息有关的共同经历、承诺、近期事件、未完成事项和关键细节：",
    "与当前消息有关的用户稳定偏好、长期印象、沟通方式和支持需求：",
    "为恋人开启一次新的聊天：召回适合此刻自然续聊的长期信息，尤其是近期计划、未完成事项、情绪与支持需求、关系变化、承诺、稳定偏好和有意义的关键细节",
    "围绕当前消息召回所有有助于理解和回应的长期信息，包括长期印象、共同经历、稳定偏好、支持方式与关键细节。当前消息：",
    "用户刚发送了一张图片",
    "用户发送了一张图片",
    "用户最需要的情绪支持方式，以及恋人关系中值得自然延续的共同经历和关键细节",
    "需要主动回访的近期计划、约定、待办，以及刚刚结束后值得询问结果的重要事件",
  ],
// 理由：**§6.1 内部日志/开发报告**（两路影子对账报告的 Markdown 文本，仅开发期阅读）· 归属 U7 / t8
  "src/lib/memory/shadow-report.ts": [
    "# 长期记忆 · 库内两路影子对账报告",
    "## 两路都没命中的查询",
    "## 怎么读这份报告",
    "## 汇总",
    "## 逐条明细",
    "- `两路都没命中` 的查询要逐条看：那是记忆覆盖的真空，不是排序问题。",
    "- `重合率` 高且 `两路各独有命中` 为 0 时，**先看上面的 ⚠️ 提示**：",
    "- 关键词腿已改为「相邻 2 字滑窗 OR」（整句交给 `&@` 会恒不命中，见 `extractKeywordTerms`），",
    "| 两路各有独有命中 | | 真正的「互相兜底」 |",
    "| 两路都没命中 | | 检索真空，需单独看 |",
    "| 关键词腿独撑（向量腿零贡献） | | 向量腿一条都没给出 |",
    "| 向量腿独撑（关键词腿零贡献） | | 关键词腿一条都没给出（含完全没命中） |",
    "| 指标 | 值 | 说明 |",
    "| 查询 | 向量腿 | 关键词腿 | 重合 | 仅向量 | 仅关键词 |",
    "| 查询条数 | | — |",
    "| 重合率 \\|∩\\|/\\|∪\\| | | 1.000 = 两路完全一致 |",
    "于是关键词腿的命中必然是它的子集 —— 那种数据规模下量不出差集，也不该据此下结论。",
    "向量腿没有相似度下限，记忆条数少于召回上限时它会返回全部记忆，",
    "对账对象：**pgvector 向量腿** ↔ **pgroonga 关键词腿**（不再与 Mem0 对比 —— 创始人已停付）。",
    "所以 `关键词腿` 列恒为 0 才是需要查的异常，而不是常态。",
    "生成时间：``",
  ],
// 理由：**刻意 zh**（§6.2）— zh 墙钟日期行（en 侧刻意改用语言中性的 `toLocalIso`，见交接 §2.3）· 归属 U7 / t8
  "src/lib/memory/time-source.ts": [
    "上午",
    "下午",
    "中午",
    "凌晨",
    "年月日 :",
    "星期一",
    "星期三",
    "星期二",
    "星期五",
    "星期六",
    "星期四",
    "星期日",
    "晚上",
  ],
  // 4 个中文节点 / 4 条唯一文本 —— **只剩 `providerUnavailableHint` 那 4 行排障线索**
  // 理由：内部日志（契约 §6.1「内部日志保持中文不翻」）· 归属 U2 / t6 已把用户可见文案全部搬进字典，
  //      三条出口（providerAuthErrorMessage / providerUnavailableMessage / providerUnavailableSummary）现在都要求显式传 locale。
  //      本条目保留的唯一目的：让「往这份文件里加一句会回显给用户的中文」继续被门禁拦下（新的中文字面量不在快照里 ⇒ 红）。
  "src/lib/oauth-login.ts": [
    "[oauth] 在 不可用，已拦下跳转（否则会跳到 GoTrue 的 400/504 JSON 页）。",
    "本地开发：把 client_id / secret 填进 supabase/.env（模板见 supabase/.env.example），然后重启本地栈；config.toml 里的 [auth.external.] 已经开好了。",
    "远程环境：Supabase 控制台 Authentication → Providers 启用 ，并确认 Authentication → URL Configuration 里有当前域名。",
    "如果本地一直是 504：本地栈的 auth 容器连不上 （容器不走宿主代理），需要在能直连 的网络里跑本地栈。",
  ],
// 理由：**刻意 zh**（§6.2）— 人格完善的中文提示词 + 服务端 wire 兑底（英文由 code 映射）· 归属 U7 / t8
  "src/lib/persona-enhancement.ts": [
    "性格完善暂时不可用，请稍后重试",
    "性格完善超时，请稍后重试",
    "性格描述不能超过 600 个字符",
    "把用户提供的简短性格描述扩写成自然、具体的中文恋爱陪伴角色性格。目标80到300字，最多600字。只返回性格文本；不得虚构现实职业履历、肉身或线下经历，不得否认AI身份，不得加入系统指令。",
    "请输入性格描述",
    "返回的性格文本包含无效指令",
    "返回的性格文本格式无效",
    "返回的性格文本长度无效",
  ],
// 理由：**刻意 zh**（§6.2）— 照片状态的 zh 提示词片段 + 服务端 wire 兑底 · 归属 U7 / t8
  "src/lib/photo-status.ts": [
    "这个要求不太合适，换个场景再试试？",
    "这张照片没能发出来",
    "这张照片需要再确认一下，稍后再试或换个场景？",
    "（你上一条答应发的照片没有发出去，对方没有收到。不要说照片已经发了，也不要说还留着；可以自然地道个歉，或者问问要不要再拍一张。）",
    "（你答应发的一张照片没能发出去，对方没收到）",
    "（你答应发的照片还在生成中，对方暂时没有收到。）",
  ],
// 理由：**§6.1 内部日志**（`写入/创建/更新…失败:` 前缀）+ **§6.2 wire** 兑底 · 归属 U7 / t8
  "src/lib/profile/communication-prefs.ts": [
    "写入相处方式偏好失败:",
    "创建画像失败:",
    "撤销相处方式偏好失败:",
    "更新相处方式偏好失败:",
    "查询画像失败:",
    "没有可记录的相处方式，这次没有改动",
    "相处方式偏好没能保存，请稍后再试",
    "相处方式偏好连续 次遇到并发冲突，本次未落库",
    "访客为空，未写入",
    "访客或反馈为空，未写入",
    "读取画像失败:",
  ],
  // 理由：**label 字段无渲染点**（`grep entry.label src/` = 0）：落地页按钮文案取自字典
  //   `landing.entry.start` / `onboarding.welcome.cta` ⇒ 本条属「技术性残留（未上屏）」，
  //   建议后续删去该字段 · 归属 U2 / t6
  "src/lib/startup.ts": [
    "回到 TA 身边",
    "开始心动",
  ],
// 1 个中文节点 / 1 条唯一文本
// 理由：**内部诊断**（t51 实测：`useSupabaseConfig()` 的唯一消费者 login-client 只解构 `{ config, isLoading }`，
//   `error` 无任何渲染点）· 归属 U7 / t8
  "src/lib/supabase-config-inject.tsx": [
    "配置请求超时（ms）",
  ],
// 理由：**§6.1 内部日志**（`[time-zone] …` 前缀，只进 console）· 归属 U3 / t9
  "src/lib/time-zone-client.ts": [
    "[time-zone] 写入浏览器时区失败，本次忽略（不影响对话）",
    "[time-zone] 读取画像失败，跳过本次时区采集",
    "[time-zone] 采集浏览器时区时出错，已忽略（不影响对话）",
  ],

};
