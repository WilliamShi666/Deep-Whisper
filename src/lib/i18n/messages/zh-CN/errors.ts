
/**
 * 错误 code → 中文兜底文案（键名 = 契约 §6.4 / §6.5 表的 code，**所有者：U7 / t8**）。
 *
 * 三条硬约束（契约 §6.2/H4）：
 *   1. **逐字符**等于服务端 `{ error }` 的既有取值 —— 中文态因此零变化。
 *      唯一例外是 `VALIDATION_FAILED`：checkout 的 `无效的结账请求` 与 change-period 的
 *      `无效的请求` 共用一个 code，字典只能留一条；wire 上的 `error` 仍是各自原文。
 *   2. 一个 code 有多条文案时按 §6.4.1 拆成 `<CODE>.<判别后缀>`（会员族见 §6.4.2）。
 *   3. `UNKNOWN` 是三级回退的最后一级（§6.6 判据 6.6.1）。
 *
 * 命名形态由 `tests/i18n-messages.test.ts` 的 ERROR_KEY 钉住：`errors.<CODE>[.<后缀>]`，
 * 后缀只允许 letters / photo / tts / tts_preview / read_then_save / retry_later / missing / invalid。
 * 另有 4 个**既有小写 legacy code**（`reply_limit` / `opening_limit` / `opening_exists` /
 * `conversation_busy`）：它们是配额通道的既有 code（§6.5 冻结，`chat-shell.tsx` 已在消费），
 * 字典键名逐字符等于该 token，`errorMessageKey` 大小写敏感直查，zh 侧取值 = token 本身
 * （wire 上的 `error` 就是 token，中文态逐字符不变）。
 *
 * 本文件是 `en/errors.ts` 的类型源：那边少一条 key 就 `pnpm ts-check` 红（TS2739）。
 */
export const errors = {
  // ── 通用兜底（三级回退的最后一级） ──
  UNKNOWN: '出了点问题，请稍后重试',
  // U7 / t32（契约 §6 SSE 行）：流式回复中途失败的 code。zh 取值逐字符等于 SSE 里那条兜底。
  CHAT_REPLY_FAILED: '回复生成失败，请稍后再试',
  INTERNAL_ERROR: '服务器开了小差，请稍后重试',
  // §6.4.1 判别后缀（t37）：`/api/profile` 与 `/api/relationship` 的 500 用的是**短文案**，
  // 与上面那条差「，请稍后重试」9 个字符 —— 不拆 key 的话，客户端改走 code 后中文态会多出这 9 字。
  // wire 侧 `code` 仍是 `INTERNAL_ERROR`，另加 `detail: 'brief'`。
  'INTERNAL_ERROR.brief': '服务器开了小差',

  // ── 400：请求体/参数不合法 ──
  VALIDATION_FAILED: '无效的请求',
  EMPTY_PATCH: '没有需要更新的内容',
  GENDER_REQUIRED: '请选择你的性别',
  ORIENTATION_REQUIRED: '请选择你希望 TA 的性别',
  INVALID_UI_THEME: '这个色调不存在',
  INVALID_PALETTE: '这个配色不存在',
  INVALID_LOCALE: '这个语言不存在',
  NEED_PROFILE: '请先完成基础信息',
  INVALID_CHARACTER_TEMPLATE: '请选择一个角色模板',
  INVALID_CREATION_ID: '创建标识无效',
  INVALID_APPEARANCE_STYLE: '形象比例无效',
  'INVALID_APPEARANCE_STYLE.missing': '缺少有效的形象比例',
  'INVALID_APPEARANCE_STYLE.invalid': '形象比例无效',
  INVALID_FEEDBACK: '反馈格式不正确',
  INVALID_FEEDBACK_PAYLOAD: '反馈格式不正确',
  INVALID_PAGE_CURSOR: '分页标识无效',
  INVALID_PREFERENCE_BODY: '偏好内容无效',
  INVALID_PROFILE_VERSION: '画像版本无效',
  INVALID_THEME: '这套背景不存在',
  INVALID_TIME_ZONE: '这个时区不存在',
  INVALID_TITLE: '标题不能为空',
  INVALID_UPLOAD_REFERENCE: '图片不可用，请重新上传后再发送',
  INVALID_VOICE: '音色无效',
  INVALID_INPUT: '请输入性格描述',
  PERSONA_TOO_LONG: '性格描述不能超过 600 个字符',
  IMAGE_TOO_LARGE: '图片不能超过 10MB',
  IMAGE_SAFETY_REJECTED: '图片未通过安全审核：{reason}，换一张试试吧',
  UNSUPPORTED_IMAGE_TYPE: '只支持 JPG/PNG/WebP/GIF 图片',
  MISSING_IMAGE: '请选择图片',
  UNSUPPORTED_PREF_ACTION: '不支持的偏好操作',
  UNSUPPORTED_REVOKE_MODE: '不支持的撤销范围',
  LETTERS_TOGGLE_INVALID: '只能开启或暂停来信',
  MESSAGE_NOT_TTS_CAPABLE: '该消息不支持转语音',
  TTS_CONTENT_UNSUITABLE: '内容不适合转语音',
  TTS_TEXT_EMPTY: '试听文本为空',
  VOICE_NOT_FOUND: '音色不存在',
  MISSING_COMPANION: '缺少陪伴角色',
  MISSING_COMPANION_ID: '缺少 companion_id',
  MISSING_CONVERSATION: '缺少会话',
  MISSING_CONVERSATION_ID: '缺少会话标识',
  MISSING_MESSAGE: '缺少消息',
  MISSING_MESSAGE_CONTENT: '消息不能为空',
  UNKNOWN_FIELD: '不支持的字段：{field}',

  // ── 401：未认证 ──
  AUTH_REQUIRED: '请先登录',
  LETTERS_AUTH_REQUIRED: '登录后才能管理来信',
  VISITOR_NOT_FOUND: '访客不存在',

  // ── 403：无权限（会员 / 来源 / 性别归属） ──
  THEME_GENDER_MISMATCH: '这套背景和当前的 TA 不搭哦',
  UNTRUSTED_ORIGIN: '请求来源不受信任',

  // ── 404：目标不存在 ──
  COMPANION_MISSING: '陪伴角色不存在',
  COMPANION_NOT_FOUND: '角色不存在',
  CONVERSATION_NOT_FOUND: '会话不存在',
  MESSAGE_NOT_FOUND: '消息不存在',
  PREFERENCE_NOT_FOUND: '偏好不存在',

  // ── 409：状态冲突 ──
  MEMORY_BUSY: '记忆正在整理，请稍后再删除',
  MEMORY_BUSY_PREFERENCE: '记忆正在整理，请稍后再试',
  PROFILE_CONFLICT: '画像已在其他页面更新，请重新读取后再保存',
  'PROFILE_CONFLICT.read_then_save': '画像已在其他页面更新，请重新读取后再保存',
  'PROFILE_CONFLICT.retry_later': '画像正在更新，请稍后重试',
  STALE_APPEARANCE: '角色形象已在其他页面改变，请刷新后重试',
  THEME_CONTEXT_REQUIRED: '请在当前会话中设置壁纸',
  TTS_BUSY: '这段语音正在生成，请稍后再试',
  UNKNOWN_CHARACTER: '角色模板缺失，请重新选择角色',
  CHARACTER_TEMPLATE_MISSING: '角色模板缺失',
  LETTERS_NO_EMAIL: '账号没有可用邮箱，暂时不能管理来信',
  LETTERS_DELIVERY_STOPPED: '此邮箱因投递异常已停止来信，请联系支持',
  LETTERS_CONFIRM_REQUIRED: '请验证邮箱，并明确确认重新接收来信',
  LETTERS_PREFERENCE_STALE: '邮箱或来信状态已变化，请刷新后重试',
  LETTERS_STATE_CHANGED: '来信状态已发生变化，请刷新后重试',

  // ── 5xx：服务端故障 / 依赖不可用 ──
  TTS_FAILED: '语音生成失败',
  TTS_PREVIEW_FAILED: '试听生成失败，请稍后再试',
  UPLOAD_FAILED: '图片上传失败，请稍后再试',
  LETTERS_PREFERENCE_READ_FAILED: '读取来信偏好失败',
  LETTERS_PREFERENCE_SAVE_FAILED: '保存来信偏好失败',
  PHOTO_FAILED: '这张照片没能发出来',
  PHOTO_SCAN_BLOCKED: '这个要求不太合适，换个场景再试试？',
  PHOTO_SCAN_REVIEW: '这张照片需要再确认一下，稍后再试或换个场景？',
  PHOTO_SCAN_DEGRADED: '这张照片没能发出来',
  INVALID_OUTPUT: '返回的性格文本格式无效',
  UPSTREAM: '性格完善暂时不可用，请稍后重试',
  TIMEOUT: '性格完善超时，请稍后重试',
  PREFERENCE_MANAGEMENT_UNAVAILABLE: '偏好管理暂不可用',
  PREFERENCE_READ_FAILED: '读取伴侣偏好失败，请重试',
  PREFERENCE_UPDATE_UNCONFIRMED: '偏好更新未能确认完成，请刷新核对后重试',
  PREFERENCE_FEEDBACK_EMPTY: '没有可记录的相处方式，这次没有改动',
  PREFERENCE_FEEDBACK_SAVE_FAILED: '相处方式偏好没能保存，请稍后再试',

  // ── 续费 / 取消提示（§6.5 的 message 类：wire 字段是 `message` 而非 `error`） ──
  // 文案的唯一来源是 `./billing` 的 `renewal.*`（值从那边**派生**，不在这里抄一遍）：
  // 这样 `localizeApiError` 能按这三条 code 直接取到本地化文案，服务端也能用同一份文本。

  // ── 免费额度（既有小写 code，§6.5 冻结，不得改名） ──
  opening_exists: 'opening_exists',
  conversation_busy: 'conversation_busy',
  INVALID_JSON: '请求格式无效，请重试。',
  INVALID_GENDER: '请选择你的性别。',
  INVALID_ORIENTATION: '请选择你希望 TA 的性别。',
  INVALID_PROFILE: '画像信息格式无效，请检查后重试。',
  INVALID_MILESTONES: '关系记录格式无效，请检查后重试。',
  MESSAGE_TOO_LONG: '消息内容过长，请缩短后再发送。',
  NO_UPDATE_FIELDS: '没有需要更新的内容。',
  PHOTO_BUSY: '照片正在生成，请稍后再试。',
  INVALID_HOST: '此访问地址未获允许，请使用配置的应用地址。',
  INVALID_ORIGIN: '请求来源无效，请从应用页面重新操作。',
  CROSS_SITE_REQUEST: '跨站请求未获允许，请从应用页面重新操作。',
  SESSION_ERROR: '会话检查失败，请重试。',
  LOGIN_RATE_LIMITED: '尝试次数过多，请 15 分钟后重试。',
  FEATURE_NOT_CONFIGURED: '此功能尚未配置，请填写相应环境变量后重启。',
  OWNER_AUTH_REQUIRED: '请先使用主人密码解锁。',
} as const;
