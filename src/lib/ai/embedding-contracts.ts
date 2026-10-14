/**
 * embedding provider 契约（第二阶段：记忆本地化的向量分支）。
 *
 * 为什么需要它：把记忆的存储与检索搬回本机 SQLite 之后，唯一剩下的按次计费依赖
 * 就是 embedding —— 而它正是「检索会不会被第三方配额打断」的关键。因此契约必须和既有
 * provider 同一口径：只返回已校验的向量，绝不把上游 URL 交给调用方，失败必须显式 reject。
 */
export interface EmbeddingRequest {
  /** 待向量化的文本，一次可批量。顺序即返回顺序。 */
  texts: readonly string[];
  /** 调用方信号：provider 必须传递并实现有限超时。 */
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  /** 返回与 `texts` 一一对应、顺序一致的向量。任一不可判定必须 reject。 */
  embed(request: EmbeddingRequest): Promise<number[][]>;
}

/**
 * provider 选择与环境类型**只在 `runtime.ts` 声明一份**（那是「环境与 provider 选择唯一入口」）。
 * 这里用 `export type` 转出，而不是各写一份 —— 两份声明会各自漂移（评审 Standards H3 指出的重复）。
 * 用 `export type` 转出是安全的：类型导入在编译期被擦除，config ↔ contracts 之间不构成运行期循环。
 */
export type { EmbeddingProviderId, RuntimeEnvironment } from '@/lib/config/runtime';
