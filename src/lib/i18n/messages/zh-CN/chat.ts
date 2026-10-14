/**
 * 聊天页与 13 个子组件的中文文案（**所有者：U3 / t9**）。
 *
 * 口径：
 *   - 每条 `zh` 值都是改造前源码里的**逐字符原文**（H4：中文态逐像素不变）；
 *     键名遵循契约 §2.2 的 `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,2}$`；
 *   - 插值用 `{name}`，中英同一条 key 的占位符集合必须相同（`tests/i18n-messages.test.ts` 钉住）；
 *   - 音色**代号**不在这里：中文代号是 `characters.ts` 的既有数据，英文代号由
 *     `formatVoiceLabel(option, locale)` 按 id 算式推导（t3），两种语言都不读第二份字符串；
 *   - `chat.dates.type_*` 是**界面上**的类型标签（下拉与列表回显）。它们与
 *     `src/lib/profile/important-dates.ts` 的 `DATE_TYPES[].label` 逐字符相同 —— 后者的
 *     `BIRTHDAY_DESCRIPTION` 是要写进库的存量数据哨兵（零迁移零回填），不能为了翻界面去动它，
 *     所以这里为界面单独持有一份本地化标签；`tests/chat-ux-contract.test.ts` 钉住两边逐字符相等。
 */
export const chat = {
  'config.chat': '聊天尚未配置，请在 .env.local 中填写聊天服务配置后重启服务。',
  'config.speech': '配置语音服务后可试听和播放。',
  'config.speech_play': '配置语音服务后可播放',
  'user.owner': '个人主人',
  // ── 聊天头部状态行 ──
  'status.online': '在线',
  'status.typing': '正在输入…',
  'status.loading': '正在加载消息…',
  'status.photo': '正在生成数字形象照片…',
  'status.missing_character': '角色模板需要重新选择',

  // ── 聊天头部按钮 ──
  'header.back': '返回列表',
  'header.collapse': '收起对话列表',
  'header.expand': '展开对话列表',
  'header.appearance': '聊天装扮',
  'header.settings': '设置',

  // ── 启动链 ──
  'boot.retry': '重试',
  'boot.retrying': '正在重试…',
  'boot.unreachable': '没能连接到服务器，请检查网络后重试。',
  'boot.conversations_failed': '会话没能加载出来，请检查网络后重试。',
  'boot.timeout': '启动超时',
  'boot.visitor_http': '访客接口失败: HTTP {status}',
  'boot.conversations_timeout': '会话加载超时',
  'boot.conversations_error': '会话列表加载失败',
  'boot.create_failed': '新建会话失败',

  // ── 会话列表 ──
  'conversation.new': '开启新话题',
  'conversation.empty': '还没有话题，点上方开启第一段对话吧',
  'conversation.untitled': '新的聊天',
  /** 无文字配图时落库的**哨兵值**（同时是中文态显示文案；英文态显示 'bubble' 的同名 key）。 */
  'message.image_placeholder': '[图片]',
  /** 上游拒图后回退产物的说明（措辞约束见 src/lib/ai/photo-object-key.ts）。 */
  'bubble.photo_fallback_notice': '这张照片是替代方案：你描述的那个画面没能通过图片生成环节的自动内容审核，系统改用了更保守的场景重新生成。不是你的账号或额度出了问题，也不是这边拒绝了你的请求——换一个场景或说法再试一次通常就可以。',
  /**
   * 新建会话的**默认标题**模板（服务端生成、会落库成 conversations.title 并显示在会话列表里）。
   * 判定「标题还是自动生成的」走语言无关的 `isDefaultConversationTitle`（`src/lib/conversation-title.ts`），
   * 因此这一条中文取值逐字符等于改造前的既有形态。
   */
  'conversation.default_title': '和{name}的聊天',
  'conversation.open_aria': '打开会话：{title}',
  'conversation.delete_aria': '删除会话：{title}',
  'conversation.earlier': '查看更早的话题',
  'conversation.earlier_messages': '查看更早的消息',
  'conversation.loading': '正在加载…',
  'conversation.create_failed': '新话题创建失败',
  'conversation.delete_failed': '删除失败',
  /**
   * 删除会话后的**用户可见**文案（AC-15「文案诚实化」，t61）：由 `src/lib/memory/forget-notice.ts`
   * 按遗忘结果选择，中文取值与改造前的中文字面量**逐字符相同**（含 `{failed}` 的拼法与空格）。
   */
  'conversation.forget_cleared': '已删除这段回忆',
  'conversation.forget_partial': '对话已删除，但有 {failed} 条长期记忆没清理掉',
  'conversation.forget_unavailable': '对话已删除，但长期记忆是否清理干净无法确认',
  'conversation.expired': '会话已失效，正在为你重建，请稍后重发',
  'conversation.messages_failed': '消息加载失败',
  'conversation.older_failed': '更早的消息加载失败，请重试',
  'conversation.topics_failed': '更早的话题加载失败，请重试',
  'conversation.invalid_response': '消息响应格式无效',
  'conversation.unknown_title': '这个历史角色模板已不可用',
  'conversation.unknown_body': '聊天记录仍可阅读。为避免借用其他角色的身份、声音或形象，发送、照片和设置已暂停。',
  'conversation.repick': '重新选择角色',
  'conversation.load_failed': '加载失败',

  // ── SSE 流式对话 ──
  'stream.send_failed': '发送失败',
  'stream.send_failed_retry': '发送失败，请重试',
  'stream.invalid_response': '聊天响应格式无效',
  'stream.disconnected': '连接中断，请刷新查看已保存的回复',
  'stream.reply_timeout': '回复等待超时，请刷新查看已保存的回复',
  'stream.opening_failed': '开场白失败',
  'stream.photo_failed': '照片没能送出来，再要一次试试？',

  // ── 语音（朗读条 / 音色设置 / 旧音色提示） ──
  'voice.legacy': '旧版音色',
  'voice.generate_failed': '语音生成失败，请稍后再试',
  'voice.play_failed': '语音播放失败，请重试',
  'voice.wave_loading': '正在生成语音，点击取消',
  'voice.wave_stop': '停止朗读',
  'voice.wave_retry': '重试朗读',
  'voice.wave_play': '播放语音',
  'voice.label_loading': '正在生成语音…',
  'voice.label_playing': '朗读中',
  'voice.label_failed': '朗读失败，点击重试',
  'voice.label_ready': '点击朗读',
  'voice.close': '关闭',
  'voice.stale': '旧音色「{voice}」',
  'voice.regenerate_aria': '用当前音色 {voice} 重新生成这段语音',
  'voice.regenerate': '用「{voice}」重新生成',
  'voice.title': 'TA 的声音',
  'voice.count': '共 {count} 个音色',
  'voice.code_count': '{count} 个音色代号',
  'voice.compatibility': '兼容语音模式：按伴侣性别使用兼容音色；所选代号不代表各自不同的实际声线。',
  'voice.compatible_fallback': '主要语音服务失败时，会按伴侣性别使用兼容音色，实际声线可能变化。',
  'voice.group_zh': '中文音色',
  'voice.group_en': '英文音色',
  'voice.none': '暂无可选音色',
  'voice.generating': '生成中',
  'voice.stop_preview': '停止试听',
  'voice.preview': '试听',
  'voice.retry_preview': '重新试听',
  'voice.preview_loading': '正在生成试听语音…',
  'voice.preview_playing': '正在试听；可随时停止。',
  'voice.preview_failed': '试听失败，请稍后再试。',
  'voice.preview_generate_failed': '试听生成失败，请稍后再试',
  'voice.preview_play_failed': '播放失败，请重试',
  'voice.hint': '语音只在你点击消息上的播放键后才会朗读，不会自动外放；选好后点下面的「保存」生效。',
  /**
   * 英文音色的试听句（用户 2026-10-03：「Qwen voice 也支持英文语音」）。
   *
   * zh 值 = `characters.ts` 的 `VOICE_PREVIEW` / 每个音色的 `preview` 字段（逐字符相同，
   * 由 `tests/chat-ux-contract.test.ts` 断言），所以中文态显式传它得到的是**同一句话**，
   * 请求体与服务端默认路径输出一致 —— 中文态零行为变化。
   */
  'voice.preview_sample': '晚上好呀，今天过得怎么样？我在呢。',

  // ── 消息反馈 ──
  'feedback.helpful': '有帮助',
  'feedback.unhelpful': '没帮助',
  'feedback.edit_note': '改说明',
  'feedback.add_note': '补充说明',
  'feedback.note_aria': '补充说明',
  'feedback.note_placeholder': '想告诉 TA 什么？（可选）',
  'feedback.save': '保存',
  'feedback.save_failed': '反馈没保存成功',
  'feedback.save_failed_retry': '反馈没保存成功，请重试',
  'feedback.skip': '跳过',

  // ── 输入栏 ──
  'input.send': '发送',
  'input.send_image': '发送图片',
  'input.upload_failed': '图片上传失败',
  'input.upload_failed_retry': '图片上传失败，请重试',
  'input.pending_alt': '待发送',
  'input.remove_image': '移除图片',
  'input.placeholder': '说点什么…',
  'input.placeholder_pending': '说点什么…（可不发文字）',

  // ── 消息气泡 ──
  'bubble.sent_alt': '发出的图片',
  'bubble.received_alt': '对方发来的照片',
  'bubble.legacy_character': '历史角色',
  'bubble.unknown_character_aria': '{name}的角色模板不可用',

  // ── 侧栏用户区 ──
  'user.sign_in': '使用主人密码解锁',
  'user.signed_in': '已登录',
  'user.sign_out': '退出登录',
  'user.sign_out_failed': '退出登录失败，请重试',
  'user.sign_out_title': '退出登录？',
  'user.sign_out_body': '退出后会锁定当前浏览器。伴侣和聊天记录保留在此实例中，再次输入主人密码即可回来。',
  'user.sign_out_cancel': '再想想',
  'user.signing_out': '正在退出…',

  // ── 聊天装扮 ──
  'theme.title': '聊天装扮',
  'theme.subtitle': '色调铺满全屏界面；背景装饰聊天窗，气泡颜色仍属于 TA',
  'theme.section_ui': '界面色调',
  'theme.section_background': '聊天背景',
  'theme.no_background': '无背景',
  'theme.default': '默认',
  'theme.default_desc': 'TA 的专属氛围色',
  'theme.list_failed': '装扮列表加载失败，请稍后重试',
  'theme.switch_failed': '切换失败',
  'theme.switch_failed_retry': '切换失败，请重试',
  'theme.ui_missing': '这个色调不存在',
  'theme.restored': '已恢复默认背景',
  'theme.applied': '换上新背景啦',
  'theme.ui_applied': '已切换到「{name}」',

  // ── 恋人设置弹窗 ──
  'settings.title': 'TA 的设定',
  'settings.name': '名字',
  'settings.user_title': 'TA 怎么称呼你',
  'settings.user_title_placeholder': '比如：宝宝 / 阿哲',
  'settings.user_title_hint': '填一个名字，TA 才可能从里面长出一个只属于你们的小叫法',
  'settings.persona': '性格补充',
  'settings.persona_placeholder': '比如：先听我说完，再温柔但直接地回应',
  'settings.appearance': '数字形象',
  'settings.chibi_preview_alt': 'Q版预览',
  'settings.normal_preview_alt': '真人比例版插画预览',
  'settings.chibi': 'Q 版',
  'settings.normal': '真人比例版（插画）',
  'settings.appearance_locked': '照片生成期间不能切换形象。',
  'settings.save': '保存',
  'settings.save_failed': '保存失败',
  'settings.save_failed_retry': '保存失败，请重试',
  'settings.saved': '已更新 TA 的设定',
  'settings.repick_question': '想换个角色模版？',
  'settings.repick_hint': '重新遇见 TA，之前的聊天记录会保留',

  // ── 人格完善 ──
  'persona.enhance': '一键完善',
  'persona.enhance_failed': '完善失败',
  'persona.enhance_failed_retry': '完善失败，请重试',
  'persona.preview': '完善预览',
  'persona.stale_draft': '这份候选基于较早的草稿，不会自动覆盖你刚刚的修改。',
  'persona.adopt': '采用',
  'persona.keep': '保留原文',

  // ── 重要日期 ──
  'dates.title': '重要日期',
  'dates.hint': '生日、纪念日打开「每年重复」，那天我会主动给你写信；考试、面试这类只记一次。',
  'dates.yearly_short': '每年',
  'dates.remove_aria': '删除 {label}',
  'dates.type_aria': '日期类型',
  'dates.description_placeholder': '比如：妈妈生日 / 资格考试',
  'dates.description_aria': '日期说明',
  'dates.yearly': '每年重复',
  'dates.add': '添加',
  'dates.pick_date_first': '先选一个日期',
  'dates.birthday_title': '我的生日',
  'dates.birthday_hint': '填了之后，每年这一天我都会记得，并且主动给你写信。',
  'dates.load_failed': '读取重要日期失败',
  'dates.save_failed': '没能保存重要日期',
  'dates.saved_birthday': '记下了，每年这天我都会记得',
  'dates.cleared_birthday': '已清除生日',
  'dates.saved': '已保存',
  'dates.reload': '重新读取',
  'dates.type_anniversary': '纪念日',
  'dates.type_memorial': '怀念的日子',
  'dates.type_exam': '考试/面试',
  'dates.type_other': '其他',
  'dates.type_birthday': '生日',
  'dates.type_medical': '复诊（历史）',

  // ── 恋人来信 ──
  'letters.title': '恋人来信',
  'letters.locked': '登录并绑定邮箱后，TA 才能给你写信。',
  'letters.status_suppressed': '此邮箱因投递异常已停止来信，请联系支持。',
  'letters.status_unsubscribed': '你已退订，可明确同意重新接收来信。',
  'letters.status_enabled': 'TA 偶尔会把记得的事写进你的邮箱；你随时可以关闭。',
  'letters.status_paused': '已暂停。TA 不会再主动发信，重新打开即可恢复。',
  'letters.switch_aria': '允许恋人来信',
  'letters.restore': '重新接收来信',
  "letters.restore_title": "重新接收邮箱副本？",
  "letters.restore_body": "你明确同意恢复向已保存邮箱转发来信。站内来信开关独立设置。",
  'letters.restore_cancel': '取消',
  "letters.restore_confirm": "我同意恢复邮箱副本",
  'letters.saved_enabled': 'TA 可以给你写信了',
  'letters.saved_paused': '已暂停 TA 的来信',
  'letters.load_failed': '读取来信设置失败',
  'letters.save_failed': '没能保存来信设置',
  'letters.reload': '重新读取',

  // ── 相处方式偏好 ──
  'preference.title': '相处方式偏好',
  'preference.loading': '正在读取…',
  'preference.retry': '重试',
  'preference.manual_section': '手动设置（所有伴侣共享）',
  'preference.manual_hint': '更正会追加新的要求；撤销只清除这里的手动设置。',
  'preference.manual_empty': '暂时没有手动设置。',
  'preference.edit': '更正',
  'preference.revoke_manual': '撤销手动设置',
  'preference.learned_section': '这位伴侣记住的要求',
  'preference.learned_hint': '来自你们的聊天，只属于这位伴侣。可逐条更正或撤销。',
  'preference.learned_empty': '暂时没有可管理的伴侣偏好。',
  'preference.revoke_one': '撤销这一条',
  'preference.more': '查看更多偏好',
  'preference.editor_aria': '更正相处方式偏好',
  'preference.cancel': '取消',
  'preference.save': '保存',
  'preference.empty_text': '请写下希望怎样相处',
  'preference.load_failed': '读取偏好失败，请重试',
  'preference.load_failed_short': '读取失败',
  'preference.more_failed': '更多偏好加载失败，请重试',
  'preference.update_unconfirmed': '更新未能确认完成',
  'preference.update_failed': '更新失败，请刷新核对后重试',
  'preference.revoked': '已撤销所选偏好',
  'preference.updated': '偏好已更新',
  'preference.confirm_title': '撤销所选偏好？',
  'preference.confirm_manual': '清除账号手动设置；这位伴侣的聊天记忆保持独立。',
  'preference.confirm_learned': '删除这位伴侣记住的这一条相处要求。聊天记录与账号手动设置保持独立。',
  'preference.confirm_cancel': '取消',
  'preference.confirm_action': '确认撤销',

  // ── 页面 metadata（契约 §9.5：/chat 的 generateMetadata 读 cookie） ──
  'meta.title': 'Deep Whisper · 你的 AI 恋人',
  "letters.personal_inapp_hint": "开启后，TA 偶尔会把记得的事写成站内来信，无需邮箱。",
  "letters.timezone": "时区",
  "letters.save": "保存",
  "letters.email_copy": "邮箱副本",
  "letters.email_copy_hint": "副本只发往你保存的邮箱。想回复 TA，请回到站内。",
  "letters.email_not_configured": "邮箱转发尚不可用，站内来信仍可使用。",
  "letters.email_stopped": "邮箱副本已停收，重新开启需要你明确确认。",
  "letters.email_placeholder": "你的邮箱地址",
  "letters.inbox": "收件箱",
  "letters.inbox_empty": "还没有来信。开启后，TA 会在有事值得记得时写给你。",
  "letters.personal_saved": "来信设置已保存",
  "letters.read_failed": "没能标记为已读",
} as const;
