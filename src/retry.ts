/**
 * AgnesLoop - Retry Mechanism with Exponential Backoff
 *
 * 解决 API 500 错误和超时问题，提供稳定的 LLM 调用体验。
 *
 * 特性:
 * - 指数退避 (Exponential Backoff)
 * - 随机抖动 (Jitter) 防止雷群效应
 * - 可配置的重试策略
 * - 详细的日志输出
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 基础延迟 (毫秒) */
  baseDelay: number;
  /** 最大延迟 (毫秒) */
  maxDelay: number;
  /** 可重试的错误模式 */
  retryableErrors: string[];
  /** 是否启用详细日志 */
  verbose: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

// ─── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,    // 1 秒
  maxDelay: 30000,    // 30 秒
  retryableErrors: [
    // HTTP 错误
    '500', '502', '503', '504',
    // 网络错误
    'timeout', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
    'EPIPE', 'ENOTFOUND', 'ENETUNREACH',
    // API 特定错误
    'rate_limit', 'rate limit', 'too many requests',
    'overloaded', 'capacity', 'busy',
    // Agnes API 特定
    'internal server error', 'service unavailable',
    'gateway timeout', 'bad gateway'
  ],
  verbose: true
};

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * 计算延迟时间（指数退避 + 随机抖动）
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // 指数退避: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);

  // 添加随机抖动 (±10%)
  const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);

  // 限制在最大延迟内
  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

/**
 * 检查错误是否可重试
 */
function isRetryableError(error: Error | string, config: RetryConfig): boolean {
  const errorStr = typeof error === 'string' ? error : error.message;
  const errorLower = errorStr.toLowerCase();

  return config.retryableErrors.some(pattern =>
    errorLower.includes(pattern.toLowerCase())
  );
}

/**
 * 格式化延迟时间
 */
function formatDelay(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 格式化总时间
 */
function formatTotalTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// ─── Core Retry Function ──────────────────────────────────────────────────────

/**
 * 带重试机制的函数执行器
 *
 * @example
 * ```typescript
 * // 基本用法
 * const result = await withRetry(() => callLLM(prompt));
 *
 * // 自定义配置
 * const result = await withRetry(() => callLLM(prompt), {
 *   maxRetries: 5,
 *   baseDelay: 2000
 * });
 *
 * // 带类型
 * const result = await withRetry<LLMResponse>(() => callLLM(prompt));
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // 执行函数
      const result = await fn();

      // 成功 - 记录日志
      if (attempt > 0) {
        const totalTime = Date.now() - startTime;
        console.log(
          `[retry] ✅ Succeeded on attempt ${attempt + 1}/${cfg.maxRetries + 1} ` +
          `(total: ${formatTotalTime(totalTime)})`
        );
      }

      return result;

    } catch (err) {
      lastError = err as Error;
      const errStr = String(err);

      // 检查是否可重试
      const canRetry = isRetryableError(errStr, cfg);

      // 最后一次尝试或不可重试的错误
      if (attempt === cfg.maxRetries || !canRetry) {
        const totalTime = Date.now() - startTime;

        if (cfg.verbose) {
          console.error(
            `[retry] ❌ Failed after ${attempt + 1} attempts ` +
            `(total: ${formatTotalTime(totalTime)})`
          );
          console.error(`[retry] Last error: ${errStr.slice(0, 200)}`);
        }

        throw lastError;
      }

      // 计算延迟
      const delay = calculateDelay(attempt, cfg);

      if (cfg.verbose) {
        console.warn(
          `[retry] ⚠️ Attempt ${attempt + 1}/${cfg.maxRetries + 1} failed: ` +
          `${errStr.slice(0, 100)}...`
        );
        console.log(
          `[retry] ⏳ Retrying in ${formatDelay(delay)}...`
        );
      }

      // 等待
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // 不应该到达这里，但为了类型安全
  throw lastError || new Error('Unknown error in retry loop');
}

// ─── Specialized Retry Functions ──────────────────────────────────────────────

/**
 * LLM 调用专用重试（更宽松的配置）
 */
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 5,         // LLM 调用允许更多重试
    baseDelay: 2000,       // 2 秒基础延迟
    maxDelay: 60000,       // 最大 60 秒
    ...config
  });
}

/**
 * API 调用专用重试（标准配置）
 */
export async function withAPIRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    ...config
  });
}

/**
 * 文件操作专用重试（快速重试）
 */
export async function withFileRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 5000,
    retryableErrors: [
      'EBUSY', 'EPERM', 'EACCES', 'ENOENT',
      'EMFILE', 'ENFILE', 'ENOSPC'
    ],
    ...config
  });
}

// ─── Retry with Result ────────────────────────────────────────────────────────

/**
 * 带详细结果的重试执行器
 *
 * @example
 * ```typescript
 * const result = await withRetryResult(() => callLLM(prompt));
 *
 * if (result.success) {
 *   console.log('Result:', result.result);
 *   console.log('Attempts:', result.attempts);
 * } else {
 *   console.error('Failed:', result.error);
 * }
 * ```
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let attempts = 0;

  try {
    const result = await withRetry(fn, {
      ...cfg,
      verbose: false // 内部处理日志
    });

    return {
      success: true,
      result,
      attempts: attempts + 1,
      totalTime: Date.now() - startTime
    };

  } catch (err) {
    return {
      success: false,
      error: err as Error,
      attempts: cfg.maxRetries + 1,
      totalTime: Date.now() - startTime
    };
  }
}

// ─── Circuit Breaker Pattern ──────────────────────────────────────────────────

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  /** 失败阈值 */
  failureThreshold: number;
  /** 重置超时 (毫秒) */
  resetTimeout: number;
  /** 监控窗口 (毫秒) */
  monitoringWindow: number;
}

/**
 * 简单的熔断器实现
 * 当连续失败超过阈值时，暂时停止调用
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(private config: CircuitBreakerConfig) {}

  /**
   * 执行带熔断保护的函数
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查熔断状态
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;

      if (timeSinceLastFailure > this.config.resetTimeout) {
        // 尝试半开状态
        this.state = 'half-open';
        console.log('[circuit-breaker] Entering half-open state');
      } else {
        throw new Error(
          `Circuit breaker is open. Retry after ${formatDelay(this.config.resetTimeout - timeSinceLastFailure)}`
        );
      }
    }

    try {
      const result = await fn();

      // 成功 - 重置计数器
      if (this.state === 'half-open') {
        console.log('[circuit-breaker] Half-open succeeded, closing circuit');
      }
      this.failures = 0;
      this.state = 'closed';

      return result;

    } catch (err) {
      // 失败 - 增加计数器
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.config.failureThreshold) {
        this.state = 'open';
        console.error(
          `[circuit-breaker] Circuit opened after ${this.failures} failures. ` +
          `Will retry after ${formatDelay(this.config.resetTimeout)}`
        );
      }

      throw err;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): { state: string; failures: number } {
    return {
      state: this.state,
      failures: this.failures
    };
  }

  /**
   * 手动重置
   */
  reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export default {
  withRetry,
  withLLMRetry,
  withAPIRetry,
  withFileRetry,
  withRetryResult,
  CircuitBreaker
};
