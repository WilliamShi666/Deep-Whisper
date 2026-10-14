'use client';

/**
 * 界面语言的**浏览器边界**（U1 / t5，契约 §3）。
 *
 * 只放三件必须碰浏览器的东西：设备镜像读写（localStorage + cookie 双写）、写库请求、Provider 与 hook。
 * 纯解析逻辑一律在 `./i18n/locale`，本文件不得自行判断优先级。
 *
 * 服务端 route **不得** import 本文件（会把 `apiFetch` 与 React hook 带进 route）。
 *
 * hydration 约定：首帧恒等于「服务端给的 `initialLocale` ?? 默认 zh-CN」（服务端与首帧一致）；
 * localStorage 与访客档案**只在挂载后的 effect 里读** —— 禁止在 render 期访问浏览器全局，
 * 否则服务端渲染的 `zh-CN` 与客户端的 `en` 会在第一帧对不上。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { apiFetch } from '@/lib/api';
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  parseLocale,
  resolveLocale,
  type Locale,
} from '@/lib/i18n/locale';
import { MESSAGES, translate, type MessageKey } from '@/lib/i18n/messages';
import { localizeApiError, type LocalizeOptions } from '@/lib/i18n/errors';

/** 取值：`{name}` 等插值变量。 */
export type TranslateVars = Record<string, string | number>;

/** 读设备级镜像。没有浏览器环境、存储被禁用、值非法，一律回落 `null`，不抛。 */
export function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * **地理默认**（t67）：服务端按可信网络国家推出来的默认语言，客户端也要拿到同一个值 ——
 * 否则「没有服务端语言来源」的页面（`/`、`/onboarding` 按契约 §9.5.1 保持静态）会**永远停在
 * `DEFAULT_LOCALE`（zh-CN）**，而不是「开头中文、随后自动变英文」。
 *
 * 三条口径：
 *   - **规则只有一份实现**：不在这里重写国家集合，只问只读端点 `GET /api/locale-default`
 *     （它复用 `getServerGeoDefault()` → `localeForCountry` + `x-vercel-ip-country`）；
 *   - **每页只问一次**：模块级 in-flight 缓存，多个 Provider（根 + 页面级）共用同一个 Promise；
 *   - **永不抛、永不阻塞**：失败/离线/超时一律回落 `DEFAULT_LOCALE`（与本地开发同口径）。
 *
 * 页面已经拿到服务端语言（`initialLocale`）时**也**要问：客户端需要用它来区分
 * 「页面值只是地理默认（不是声明）」与「页面值是真声明（cookie / `?lang=en`）」—— 见解析 effect。
 */
const GEO_DEFAULT_ENDPOINT = '/api/locale-default';
let geoDefaultInFlight: Promise<Locale> | null = null;

function fetchGeoDefaultOnce(): Promise<Locale> {
  geoDefaultInFlight ??= fetch(GEO_DEFAULT_ENDPOINT, { cache: 'no-store', headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => parseLocale((data as { locale?: unknown } | null)?.locale) ?? DEFAULT_LOCALE)
    .catch(() => DEFAULT_LOCALE);
  return geoDefaultInFlight;
}

/**
 * 读设备级镜像的**另一份副本**：`vl_locale` cookie。
 *
 * 为什么需要它（t44 / O1）：契约 §3.3 规定 locale 的镜像是**双写**的（localStorage + cookie），
 * 因为服务端 SSR 要读 cookie（`getServerLocale()`）。于是「只剩 cookie」是一态真实存在的组合
 * —— 用户清掉站点存储、cookie 保留（或第三方上下文里 localStorage 被隔离）。此前客户端只读
 * localStorage，那一态下只有 `/login`、`/love`（它们把 SSR locale 当 `initialLocale` 传了下来）
 * 能拿到语言，其余页落到默认值**并把 cookie 改写成 zh-CN**（V2 实测的五页不一致）。
 *
 * 口径：这是**同一个「设备镜像」层的另一个来源**（cookie 就是镜像的服务端副本），
 * 不是链条上新插的一层 —— 解析仍是 `档案 > 镜像 > 默认`（契约 §1.3），优先级判定仍只在纯层
 * `resolveLocale` 里。取值顺序 = `localStorage` > 页面传来的 SSR 值（`initialLocale`）> cookie：
 * localStorage 是客户端主副本、页面 SSR 值可能含 `?lang=en` 这类页面级覆盖、cookie 最后兜底。
 */
function readCookieLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(document.cookie);
    return parseLocale(match?.[1]);
  } catch {
    return null;
  }
}

/**
 * 写设备级镜像：**同时**写 localStorage 与 cookie（契约 §3.3，与 palette 的唯一刻意分叉）。
 *
 * cookie 必须是非 httpOnly 的 —— 服务端要用它做 SSR 语言判定（`getServerLocale()`），
 * 而写它的是客户端。两处写入都在 try/catch 内：无痕模式 / 配额满 / 第三方上下文写 cookie 被拦，
 * 都不该打断主流程（语言只是偏好，不是身份）。
 */
export function writeLocale(value: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // 设备镜像写不进去不影响主流程。
  }
  try {
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // 同上：cookie 写不进去时，服务端继续按默认语言渲染，界面仍是客户端语言。
  }
}

/**
 * 写库（唯一写入口 `PATCH /api/visitor`）**成功之后**才写设备镜像与界面状态。
 *
 * 非乐观：失败时抛错，localStorage / cookie / 界面状态都不变（调用方 toast 兜底文案）。
 * 错误消息只取服务端原文或**字典里的兜底文案**（t36）：原先这里硬编码英文 `'locale switch failed'`，
 * 一旦被任何调用方透出，中文界面就会冒出一句英文。这条 Error 本身不上屏 ——
 * 用户可见的提示由调用方（LocaleSwitch）用 `core.locale.switch_failed` 渲染。
 */
export async function saveLocale(value: Locale): Promise<void> {
  const response = await apiFetch('/api/visitor', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: value }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) {
    // 同一套三级回退（已知 code → 字典；否则服务端原文；都没有 → 字典里的兜底文案）。
    throw new Error(localizeApiError(value, data, { fallback: translate(MESSAGES[value], 'core.locale.switch_failed') }));
  }
  writeLocale(value);
}

export interface LocaleContextValue {
  locale: Locale;
  /** 写库中（`persist="server"` 的开关据此 disabled）。 */
  pending: boolean;
  /** 非乐观切语言：先写库，成功后才动界面与设备镜像；失败抛错且什么都不变。 */
  setLocale: (next: Locale) => Promise<void>;
  /** 只写设备镜像，零请求（档案行还没确认时用这一档）。 */
  setLocaleLocally: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * **档案桥**的内部上下文（t36）：把「`visitors.locale` 的当前值」与「谁负责去取」往下传。
 *
 * 为什么不塞进 `LocaleContextValue`：那三个字段是契约 §3.1 逐字符钉住的公开面，档案桥是本层内部实现。
 * 子 Provider（`/login`、`/love` 各包了一层）靠这三个字段知道：① 档案的真实值（自己不必再请求）；
 * ② 上层已经有人负责取（所以自己不重复取）；③ 还没取回来（**先别解析、更别回写镜像**）。
 */
interface VisitorProfileState {
  /** 已解析的 `visitors.locale`；`null` = 还没有值，或访客确实没有语言偏好。 */
  profile: Locale | null;
  /** 已经有 Provider 负责取档案（根 Provider 在 layout 里；子 Provider 复用它）。 */
  owner: boolean;
  /** 档案桥还在请求中：此时不得解析与回写设备镜像。 */
  pending: boolean;
  /**
   * 「页面级 Provider 是否已接管」的交接对象（根 Provider 建、向下共享；可变、不进 state：
   * 它只在同一次 commit 的 effect 之间传递结论 —— 子组件的 effect 先于父组件跑，所以根 Provider
   * 一定读得到）。页面级 Provider 声明了本页语言就置 `page = true`，接管**两件事**：
   *   ① 写 `document.documentElement.lang`（§11.3 的唯一写入点，谁的语言更具体谁写）；
   *   ② 写设备镜像（根 Provider 的解析里没有页面信号，两边都写只会互相打架：t47 的 C 态就是
   *      根 Provider 按默认值把 `zh-CN` 写进镜像，而页面正渲染着 `?lang=en` 的英文）。
   */
  pageClaim: { page: boolean };
}

const NO_BRIDGE: VisitorProfileState = { profile: null, owner: false, pending: false, pageClaim: { page: false } };
const VisitorProfileContext = createContext<VisitorProfileState>(NO_BRIDGE);

/**
 * 取访客语言偏好（**档案桥的第一环**）。
 *
 * 契约 §3.2.1 的解析链是「访客档案 > 设备镜像 > 默认」，但档案值此前**没有任何页面喂给 Provider**
 * —— `profileLocale` 只在 `/login`、`/love` 被传成 `getServerLocale()`（无 cookie 时 = `zh-CN`），
 * 于是「没有偏好」被当成「偏好是中文」插到链首：既压过设备镜像，又把镜像就地改写成中文（t36 的 high 缺陷）。
 *
 * 这里在**挂载后**用 `GET /api/visitor`（`apiFetch` 自带 `X-Visitor-Id` / `x-session`）取真实档案值：
 *   - 取到合法 locale → 作为档案值，压过设备镜像（契约的链首）；
 *   - `null` / 非法 / 请求失败 → **仍然是 null**（档案值这一环「没有」），让设备镜像接力 —— 这是与旧
 *     实现的关键差别：这里的 null 绝不会被写成 `DEFAULT_LOCALE`（那才是本次要修的「把默认值当真实值」）。
 * 只有最外层 Provider 调用它（`enabled`），子 Provider 从上一条 context 拿结果。
 */
function useVisitorProfileLocale(enabled: boolean): { profile: Locale | null; pending: boolean } {
  const [state, setState] = useState<{ profile: Locale | null; pending: boolean }>({
    profile: null,
    pending: enabled,
  });

  useEffect(() => {
    if (!enabled) return;
    let canceled = false;
    // fast refresh / 再次启用时先把「还没落地」标回去，避免用旧档案值做决定。
    setState({ profile: null, pending: true });
    void (async () => {
      let profile: Locale | null = null;
      try {
        const response = await apiFetch('/api/visitor');
        if (response.ok) {
          const data = (await response.json()) as { visitor?: { locale?: unknown } };
          profile = parseLocale(data.visitor?.locale);
        }
      } catch {
        // 读档案失败不是错误路径：链的下一环（设备镜像）接力，界面照常可用。
      }
      if (!canceled) setState({ profile, pending: false });
    })();
    return () => {
      canceled = true;
    };
  }, [enabled]);

  return state;
}

export interface LocaleProviderProps {
  /** SSR 首帧值：服务端解析结果或 `/love?lang=en`；缺省 `DEFAULT_LOCALE`。 */
  initialLocale?: Locale | null;
  /** 访客档案 `visitors.locale`（页面拿到后传进来；拿不到传 `undefined`）。 */
  profileLocale?: unknown;
  children: ReactNode;
}

/**
 * 语言 Provider（契约 §3.1）。
 *
 * - 首帧 = `initialLocale ?? DEFAULT_LOCALE`（与 SSR 一致，不制造 hydration 差异）；
 * - 挂载后按唯一一条链解析：`resolveLocale(档案值, 设备镜像 ?? 页面首帧值)`，并把结果写回设备镜像
 *   （让不读档案的页面也能跟随）；
 * - **档案值只来自 `profileLocale` 或档案桥**（t36）：两者都没有就是 `null` —— 「没有偏好」绝不会
 *   变成「偏好是 `DEFAULT_LOCALE`」；
 * - 设备镜像那一环接受两个来源：`localStorage` 的镜像，或**页面首帧值**（`/login`、`/love` 的服务端
 *   cookie 解析结果 —— 它就是镜像的服务端副本，第三方上下文里 cookie 被拦时以 localStorage 为准）。
 *   优先级判定本身仍在纯层 `resolveLocale` 里，这里只决定「谁进镜像这个槽」；
 * - 档案桥落地前**跳过**解析与回写：否则会先把 `zh-CN` 写进设备镜像，等档案回来再改；
 * - `document.documentElement.lang` 由本组件的 effect 写（唯一写入点），切语言时同步更新，永不删除该属性。
 */
export function LocaleProvider({ initialLocale, profileLocale, children }: LocaleProviderProps): ReactElement {
  const inherited = useContext(VisitorProfileContext);
  /** 根 Provider（无外层）自建这个交接对象；子 Provider 复用外层那一份。 */
  const ownPageClaim = useRef<{ page: boolean }>({ page: false });
  const pageClaim = inherited.owner ? inherited.pageClaim : ownPageClaim.current;
  const ownProfile = parseLocale(profileLocale);
  /** 最外层、且没有人给它档案值 ⇒ 由它自己去取（t36 档案桥）。 */
  const ownsBridge = ownProfile === null && !inherited.owner;
  const bridged = useVisitorProfileLocale(ownsBridge);

  const profile = ownProfile ?? inherited.profile ?? bridged.profile;
  const bridgePending = ownsBridge ? bridged.pending : inherited.pending;
  const pageLocale = parseLocale(initialLocale);

  const [locale, setLocaleState] = useState<Locale>(() => pageLocale ?? DEFAULT_LOCALE);
  const [pending, setPending] = useState(false);
  /**
   * 地理默认（t67）。初始 `DEFAULT_LOCALE`：首帧与服务端一致（静态页的首帧就是 `zh-CN`，
   * 契约 §9.5.1 明文接受「开头闪一下中文」），挂载后再自动落到真实默认。
   * **解析必须等它落地**（与档案桥同一个道理）：否则「页面值 = 地理默认」会被误判成
   * 真声明而压过设备镜像，或把地理默认回写进镜像。
   */
  const [geoDefault, setGeoDefault] = useState<Locale>(DEFAULT_LOCALE);
  const [geoPending, setGeoPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchGeoDefaultOnce().then((value) => {
      if (cancelled) return;
      setGeoDefault(value);
      setGeoPending(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (bridgePending || geoPending) return;
    const stored = readStoredLocale();
    const cookie = readCookieLocale();
    /**
     * **页面声明的语言**（`initialLocale`，契约给这个槽的定义是「`getServerLocale()` 或
     * `/love?lang=en`」）。它是不是**真信号**，由这里判定（t47）：
     *   - 等于客户端看得见的那份 cookie ⇒ 服务端正是解析这份 cookie 得到的 ⇒ cookie 确实存在 ✓；
     *   - 或它既不是 `DEFAULT_LOCALE`、**也不是地理默认** ⇒ 来自 `?lang=en` 这类**显式覆盖** ✓
     *     （t67 补上「也不是地理默认」这一条：美国访客访问 `/love` 无 query 时，服务端下发的
     *     `initialLocale` 就是地理默认 `'en'` —— 那是**默认值**、不是声明，绝不能因此压过设备镜像）。
     * 否则（= 默认值且 cookie 不存在）说明服务端其实**没有任何信号**，那只是兜底 —— 不能当声明，
     * 否则会重演 t36 修的 high 缺陷（把默认值当真实偏好，既压过设备镜像又把它回写成 `zh-CN`）。
     *
     * 真声明要**压过设备镜像**：`/love` 的正文由服务端 `getLandingCopy(locale)` 在渲染期固定，
     * 客户端若改用 localStorage 里那份陈旧镜像，就会渲染出「正文按 cookie 是中文、`lang`/镜像却是英文」
     * 的自相矛盾（t47 的 A 态）；而 `?lang=en`（§9.4 的渲染期覆盖）也必须能压过陈旧镜像（D 态）。
     * 声明缺席时保持 §1.3 的次序：localStorage > cookie > 页面默认。
     */
    const declared =
      pageLocale !== null && (pageLocale === cookie || (pageLocale !== DEFAULT_LOCALE && pageLocale !== geoDefault))
        ? pageLocale
        : null;
    /** 链的顺序不变：档案 > 设备镜像 > cookie > 页面值 > **地理默认**（t67 只换末端）。 */
    const deviceLocale = declared ?? stored ?? cookie ?? pageLocale;
    const resolved = resolveLocale(profile, deviceLocale, geoDefault);
    /**
     * 是否把结果写回设备镜像（契约 §3.1「把结果写回设备镜像」）：页面声明**只在本设备上已是同一个值**
     * 时才写 —— `?lang=en` 是渲染期覆盖、不是持久偏好，URL 参数不得静默改写镜像与 cookie
     * （t47 实测：旧行为会把两者都写成 `en`）。其余情况（档案桥 / 无声明）保持既有语义：写回，
     * 让不读档案的页面也能跟随。`profileLocale`（档案值）始终写回 —— 它的语义是 `visitors.locale`（E8）。
     */
    const backedByDevice = stored === resolved || cookie === resolved;
    /**
     * 设备镜像这份写权：页面级 Provider（`pageLocale !== null`）独占；根 Provider 只在**没有**页面级
     * Provider 时写（否则它按默认值写下去，会和页面正在渲染的语言互相矛盾 —— t47 的 C 态）。
     */
    const ownsDeviceWrite = inherited.owner ? pageLocale !== null : !pageClaim.page;
    /**
     * **地理默认绝不当真实值**（t67）：解析结果若完全来自地理默认（没有档案、没有镜像、没有 cookie、
     * 也没有页面声明），就**不写设备镜像** —— 用户从没选择过，镜像里不该出现「已被选择」的痕迹
     * （这正是本轮反复收的「把默认值当真实值」那类坑，与 E7/E8/E9 同族）。
     */
    const fromGeoDefaultOnly =
      declared === null && stored === null && cookie === null && profile === null && resolved === geoDefault;
    if (ownsDeviceWrite && !fromGeoDefaultOnly && (declared === null || backedByDevice)) writeLocale(resolved);
    setLocaleState(resolved);
  }, [profile, bridgePending, geoPending, geoDefault, pageLocale, inherited.owner, pageClaim]);

  /**
   * 页面级 Provider **一挂载就接管**（与档案桥是否落地无关：它的首帧语言已经是本页语言了）。
   *
   * 这一步必须独立于档案桥的 `pending`：桥没落地时解析 effect 会 early-return，若把接管也放在那里，
   * 根 Provider 会先按默认值写一次 `document.lang`（t47 实测：`?lang=en` 的页面被写成 `zh-CN`），
   * 而页面自己的 state 没变 ⇒ 它的 lang effect 也不会再跑一次把它改回来。
   */
  useEffect(() => {
    if (pageLocale !== null) pageClaim.page = true;
  }, [pageLocale, pageClaim]);

  /**
   * `document.documentElement.lang` 的唯一写入点（契约 §11.3），切语言时同步更新，永不删除该属性。
   *
   * 两层 Provider 都写同一个属性会造成「谁后跑谁赢」的竞态（`/love` 曾出现：页面按 cookie 是英文、
   * 根 Provider 按默认值写回 zh-CN）。规则：**页面级 Provider 领了这份活，根 Provider 就不写** ——
   * 后者比全局更具体，且它的 locale 已经把档案与镜像都算进去了。
   */
  useEffect(() => {
    const writesLang = inherited.owner ? pageLocale !== null : !pageClaim.page;
    if (writesLang) document.documentElement.lang = HTML_LANG[locale];
  }, [locale, inherited.owner, pageLocale, pageClaim]);

  const setLocale = useCallback(async (next: Locale) => {
    setPending(true);
    try {
      await saveLocale(next); // 非乐观：成功之后才动界面
      setLocaleState(next);
    } finally {
      setPending(false);
    }
  }, []);

  const setLocaleLocally = useCallback((next: Locale) => {
    writeLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, pending, setLocale, setLocaleLocally }),
    [locale, pending, setLocale, setLocaleLocally],
  );
  /** 往下的 Provider 复用这一份档案状态：谁都不必再请求一次，也都知道「还没落地」。 */
  const visitorProfile = useMemo<VisitorProfileState>(
    () => ({ profile, owner: inherited.owner || ownsBridge, pending: bridgePending, pageClaim }),
    [profile, inherited.owner, ownsBridge, bridgePending, pageClaim],
  );

  return (
    <VisitorProfileContext.Provider value={visitorProfile}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </VisitorProfileContext.Provider>
  );
}

/** 当前语言与切换入口。必须在 `LocaleProvider` 内使用。 */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside <LocaleProvider>');
  return value;
}

/**
 * 取词函数：`t('chat.status.online')`、`t('core.locale.switch', { name: 'English' })`。
 *
 * 一个组件树内的所有 `t()` 都来自**同一帧的同一语言**（key 是从 context 取的），
 * 不允许各组件自己去读设备镜像。
 */
export function useT(): (key: MessageKey, vars?: TranslateVars) => string {
  const { locale } = useLocale();
  return useCallback((key: MessageKey, vars?: TranslateVars) => translate(MESSAGES[locale], key, vars), [locale]);
}

/**
 * 服务端失败回包 → 本地化文案（契约 §6.6.4，U7 / t8）。
 *
 * **内部**调用纯层的 `localizeApiError`（同一实现、同一三级回退），不复制一份规则。
 * 组件这样用：`const apiError = useApiError(); toast.error(apiError(data))` ——
 * 已知 code 走字典、未知 code 回落服务端原文、都没有再回落通用兜底。
 * 会员族 / 画像冲突 / 形象比例这类分因由调用点按自己的场景给 options。
 */
export function useApiError(): (payload: unknown, options?: LocalizeOptions) => string {
  const { locale } = useLocale();
  return useCallback(
    (payload: unknown, options?: LocalizeOptions) => localizeApiError(locale, payload, options),
    [locale],
  );
}
