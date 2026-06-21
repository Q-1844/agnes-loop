/**
 * AgnesLoop Notify - 通知模块
 *
 * 支持多种通知渠道:
 * 1. Telegram Bot
 * 2. Discord Webhook
 * 3. 通用 Webhook
 * 4. 本地日志
 *
 * 借鉴 Aeon 的通知系统设计。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface NotifyConfig {
  telegram?: {
    botToken: string;
    chatId: string;
  };
  discord?: {
    webhookUrl: string;
  };
  webhook?: {
    url: string;
    headers?: Record<string, string>;
  };
  /** 是否保存到本地日志 */
  saveToLocal: boolean;
}

export interface NotifyMessage {
  content: string;
  timestamp: string;
  source: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface NotifyResult {
  success: boolean;
  channel: string;
  message: string;
  timestamp: string;
}

// ─── 默认配置 ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NotifyConfig = {
  saveToLocal: true
};

// 从环境变量加载配置
function loadConfigFromEnv(): Partial<NotifyConfig> {
  const config: Partial<NotifyConfig> = {};

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    config.telegram = {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    };
  }

  // Discord
  if (process.env.DISCORD_WEBHOOK_URL) {
    config.discord = {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL
    };
  }

  // 通用 Webhook
  if (process.env.NOTIFY_WEBHOOK_URL) {
    config.webhook = {
      url: process.env.NOTIFY_WEBHOOK_URL
    };
  }

  return config;
}

// ─── 发送函数 (第二部分) ──────────────────────────────────────────────────────

/**
 * 发送 Telegram 通知
 */
async function sendTelegram(
  message: string,
  config: { botToken: string; chatId: string }
): Promise<NotifyResult> {
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

    // Telegram 消息长度限制 4096 字符
    const truncated = message.slice(0, 4000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: truncated,
        parse_mode: 'Markdown'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        channel: 'telegram',
        message: `HTTP ${response.status}: ${error}`,
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      channel: 'telegram',
      message: 'Sent successfully',
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      channel: 'telegram',
      message: String(err),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 发送 Discord Webhook
 */
async function sendDiscord(
  message: string,
  config: { webhookUrl: string }
): Promise<NotifyResult> {
  try {
    // Discord 消息长度限制 2000 字符
    const truncated = message.slice(0, 1900);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: truncated })
    });

    if (!response.ok) {
      return {
        success: false,
        channel: 'discord',
        message: `HTTP ${response.status}`,
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      channel: 'discord',
      message: 'Sent successfully',
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      channel: 'discord',
      message: String(err),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 发送通用 Webhook
 */
async function sendWebhook(
  message: string,
  config: { url: string; headers?: Record<string, string> }
): Promise<NotifyResult> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers
      },
      body: JSON.stringify({
        text: message,
        content: message,
        message: message
      })
    });

    if (!response.ok) {
      return {
        success: false,
        channel: 'webhook',
        message: `HTTP ${response.status}`,
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      channel: 'webhook',
      message: 'Sent successfully',
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      channel: 'webhook',
      message: String(err),
      timestamp: new Date().toISOString()
    };
  }
}

// ─── 本地日志 (第三部分) ──────────────────────────────────────────────────────

/**
 * 保存通知到本地日志
 */
function saveToLocalLog(message: NotifyMessage): void {
  const notifyDir = path.resolve('.pending-notify');
  if (!fs.existsSync(notifyDir)) {
    fs.mkdirSync(notifyDir, { recursive: true });
  }

  const filename = `${Date.now()}.md`;
  const content = [
    `# Notification`,
    '',
    `**Time:** ${message.timestamp}`,
    `**Source:** ${message.source}`,
    `**Priority:** ${message.priority}`,
    '',
    `## Content`,
    '',
    message.content
  ].join('\n');

  fs.writeFileSync(path.join(notifyDir, filename), content);
}

// ─── 主通知函数 (第四部分) ────────────────────────────────────────────────────

/**
 * 发送通知到所有配置的渠道
 *
 * @param content - 通知内容
 * @param source - 来源标识
 * @param priority - 优先级
 * @param config - 自定义配置（可选）
 * @returns 所有渠道的发送结果
 *
 * @example
 * ```typescript
 * // 简单通知
 * await notify('任务完成');
 *
 * // 带优先级的通知
 * await notify('API 调用失败', 'llm.ts', 'high');
 * ```
 */
export async function notify(
  content: string,
  source: string = 'agent',
  priority: NotifyMessage['priority'] = 'medium',
  config?: Partial<NotifyConfig>
): Promise<NotifyResult[]> {
  // 合并配置
  const envConfig = loadConfigFromEnv();
  const mergedConfig: NotifyConfig = {
    ...DEFAULT_CONFIG,
    ...envConfig,
    ...config
  };

  // 创建消息对象
  const message: NotifyMessage = {
    content,
    timestamp: new Date().toISOString(),
    source,
    priority
  };

  const results: NotifyResult[] = [];

  // 添加优先级图标
  const priorityIcons = {
    low: 'ℹ️',
    medium: '📋',
    high: '⚠️',
    critical: '🚨'
  };
  const formattedContent = `${priorityIcons[priority]} [${source}] ${content}`;

  // 保存到本地日志
  if (mergedConfig.saveToLocal) {
    saveToLocalLog(message);
  }

  // 发送到 Telegram
  if (mergedConfig.telegram) {
    const result = await sendTelegram(formattedContent, mergedConfig.telegram);
    results.push(result);
  }

  // 发送到 Discord
  if (mergedConfig.discord) {
    const result = await sendDiscord(formattedContent, mergedConfig.discord);
    results.push(result);
  }

  // 发送到通用 Webhook
  if (mergedConfig.webhook) {
    const result = await sendWebhook(formattedContent, mergedConfig.webhook);
    results.push(result);
  }

  // 如果没有配置任何渠道，只记录本地
  if (results.length === 0) {
    console.log(`[notify] ${formattedContent}`);
  }

  return results;
}

// ─── 便捷函数 (第五部分) ──────────────────────────────────────────────────────

/**
 * 发送成功通知
 */
export async function notifySuccess(content: string, source?: string): Promise<NotifyResult[]> {
  return notify(content, source, 'low');
}

/**
 * 发送警告通知
 */
export async function notifyWarning(content: string, source?: string): Promise<NotifyResult[]> {
  return notify(content, source, 'high');
}

/**
 * 发送错误通知
 */
export async function notifyError(content: string, source?: string): Promise<NotifyResult[]> {
  return notify(content, source, 'critical');
}

/**
 * 格式化状态通知
 */
export function formatStatusNotification(
  status: string,
  step: number,
  totalSteps: number,
  message: string
): string {
  const icons: Record<string, string> = {
    completed: '✅',
    failed: '❌',
    blocked: '🚧',
    in_progress: '⏳',
    paused: '⏸️'
  };

  const icon = icons[status] || '📋';
  const progress = totalSteps > 0 ? ` (${step}/${totalSteps})` : '';

  return `${icon} ${status}${progress}\n${message}`;
}

/**
 * 格式化质量通知
 */
export function formatQualityNotification(
  role: string,
  score: number,
  flags: string[]
): string {
  const icon = score >= 4 ? '⭐' : score >= 3 ? '✅' : '⚠️';
  let content = `${icon} ${role}: ${score}/5`;

  if (flags.length > 0) {
    content += `\n标记: ${flags.join(', ')}`;
  }

  return content;
}

/**
 * 格式化健康报告通知
 */
export function formatHealthNotification(
  status: string,
  issueCount: number,
  criticalCount: number
): string {
  const icons: Record<string, string> = {
    ok: '🟢',
    watch: '🟡',
    degraded: '🔴'
  };

  const icon = icons[status] || '⚪';
  let content = `${icon} 健康状态: ${status.toUpperCase()}`;

  if (issueCount > 0) {
    content += `\n问题数: ${issueCount}`;
    if (criticalCount > 0) {
      content += ` (严重: ${criticalCount})`;
    }
  }

  return content;
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

export default {
  notify,
  notifySuccess,
  notifyWarning,
  notifyError,
  formatStatusNotification,
  formatQualityNotification,
  formatHealthNotification
};
