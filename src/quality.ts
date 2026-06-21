/**
 * AgnesLoop Quality Monitoring System
 *
 * 借鉴 Aeon 框架的质量评分机制，为每个角色输出自动评分 (1-5分)，
 * 并追踪历史趋势，帮助识别低质量输出和改进方向。
 *
 * Features:
 * - 基于规则的快速评分
 * - 历史趋势追踪 (最近 30 次)
 * - 自动标记低质量输出
 * - 支持自定义评分规则
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RoleName } from './types.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface QualityScore {
  /** 评分 (1-5) */
  score: number;
  /** 评估描述 */
  assessment: string;
  /** 标记的问题 */
  flags: string[];
  /** 时间戳 */
  timestamp: string;
  /** 角色 */
  role: RoleName;
  /** 输出长度 */
  outputLength: number;
}

export interface SkillHealth {
  /** 技能/角色名称 */
  skill: string;
  /** 最后分析时间 */
  last_analyzed: string;
  /** 最后一次评分 */
  quality_score: number;
  /** 平均分 */
  avg_score: number;
  /** 评分历史 */
  history: Array<{
    date: string;
    score: number;
    flags: string[];
  }>;
  /** 总运行次数 */
  total_runs: number;
  /** 成功次数 */
  successful_runs: number;
}

export interface QualityConfig {
  /** 最小输出长度 (低于此值扣分) */
  minOutputLength: number;
  /** 最大输出长度 (超过此值可能需要截断) */
  maxOutputLength: number;
  /** 必须包含的模式 (正则表达式) */
  requiredPatterns?: RegExp[];
  /** 禁止的模式 (正则表达式) */
  forbiddenPatterns?: RegExp[];
  /** 自定义评分权重 */
  weights?: {
    length: number;
    structure: number;
    errors: number;
    completeness: number;
  };
}

// ─── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: QualityConfig = {
  minOutputLength: 100,
  maxOutputLength: 50000,
  weights: {
    length: 0.2,
    structure: 0.3,
    errors: 0.3,
    completeness: 0.2
  }
};

// Role-specific configurations
const ROLE_CONFIGS: Record<RoleName, Partial<QualityConfig>> = {
  ceo: {
    minOutputLength: 200,
    requiredPatterns: [/plan|step|task|goal/i]
  },
  architect: {
    minOutputLength: 300,
    requiredPatterns: [/architecture|design|component|interface/i]
  },
  developer: {
    minOutputLength: 150,
    forbiddenPatterns: [/todo|fixme|placeholder/i]
  },
  reviewer: {
    minOutputLength: 100,
    requiredPatterns: [/pass|fail|issue|recommend/i]
  },
  researcher: {
    minOutputLength: 200,
    requiredPatterns: [/research|analysis|finding|recommendation/i]
  }
};

// ─── Quality Flags ─────────────────────────────────────────────────────────────

const QUALITY_FLAGS = {
  // 输出质量问题
  EMPTY_OUTPUT: 'empty_output',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
  LOW_QUALITY: 'low_quality',
  GENERIC_CONTENT: 'generic_content',

  // 错误标记
  CONTAINS_ERROR: 'contains_error',
  CONTAINS_TODO: 'contains_todo',
  CONTAINS_FIXME: 'contains_fixme',
  CONTAINS_PLACEHOLDER: 'contains_placeholder',

  // 结构问题
  NO_STRUCTURE: 'no_structure',
  POOR_FORMATTING: 'poor_formatting',

  // 完整性问题
  INCOMPLETE: 'incomplete',
  MISSING_REQUIRED: 'missing_required'
} as const;

// ─── Scoring Functions ─────────────────────────────────────────────────────────

/**
 * 评估输出长度
 */
function scoreLength(output: string, config: QualityConfig): { score: number; flags: string[] } {
  const flags: string[] = [];
  const length = output.length;
  let score = 3; // 默认中等

  if (length === 0) {
    return { score: 1, flags: [QUALITY_FLAGS.EMPTY_OUTPUT] };
  }

  if (length < config.minOutputLength) {
    flags.push(QUALITY_FLAGS.TOO_SHORT);
    score = Math.max(1, score - 2);
  } else if (length < config.minOutputLength * 2) {
    score = Math.max(1, score - 1);
  }

  if (length > config.maxOutputLength) {
    flags.push(QUALITY_FLAGS.TOO_LONG);
    score = Math.max(1, score - 1);
  }

  // 适中长度加分
  if (length >= config.minOutputLength * 3 && length <= config.maxOutputLength * 0.5) {
    score = Math.min(5, score + 1);
  }

  return { score, flags };
}

/**
 * 评估输出结构
 */
function scoreStructure(output: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 3;

  // 检查是否有结构化内容
  const hasHeaders = /^#+\s+/m.test(output);
  const hasLists = /^[-*]\s+/m.test(output) || /^\d+\.\s+/m.test(output);
  const hasCode = /```[\s\S]*?```/.test(output) || /`[^`]+`/.test(output);
  const hasTables = /\|.*\|/.test(output);
  const hasParagraphs = output.split('\n\n').length > 2;

  const structureCount = [hasHeaders, hasLists, hasCode, hasTables, hasParagraphs]
    .filter(Boolean).length;

  if (structureCount === 0) {
    flags.push(QUALITY_FLAGS.NO_STRUCTURE);
    score = Math.max(1, score - 2);
  } else if (structureCount >= 3) {
    score = Math.min(5, score + 1);
  }

  // 检查格式质量
  const lines = output.split('\n');
  const emptyLineRatio = lines.filter(l => l.trim() === '').length / lines.length;
  if (emptyLineRatio > 0.5) {
    flags.push(QUALITY_FLAGS.POOR_FORMATTING);
    score = Math.max(1, score - 1);
  }

  return { score, flags };
}

/**
 * 评估错误标记
 */
function scoreErrors(output: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 5; // 从满分开始扣分

  const outputLower = output.toLowerCase();

  // 检查错误关键词
  const errorPatterns = [
    { pattern: /error|failed|failure|exception/i, flag: QUALITY_FLAGS.CONTAINS_ERROR },
    { pattern: /todo|to-do|to do/i, flag: QUALITY_FLAGS.CONTAINS_TODO },
    { pattern: /fixme|fix-me|fix me/i, flag: QUALITY_FLAGS.CONTAINS_FIXME },
    { pattern: /placeholder|xxx|lorem ipsum/i, flag: QUALITY_FLAGS.CONTAINS_PLACEHOLDER }
  ];

  for (const { pattern, flag } of errorPatterns) {
    if (pattern.test(output)) {
      flags.push(flag);
      score = Math.max(1, score - 1);
    }
  }

  return { score, flags };
}

/**
 * 评估完整性
 */
function scoreCompleteness(output: string, config: QualityConfig): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 3;

  // 检查必须包含的模式
  if (config.requiredPatterns) {
    for (const pattern of config.requiredPatterns) {
      if (!pattern.test(output)) {
        flags.push(QUALITY_FLAGS.MISSING_REQUIRED);
        score = Math.max(1, score - 1);
        break;
      }
    }
  }

  // 检查禁止的模式
  if (config.forbiddenPatterns) {
    for (const pattern of config.forbiddenPatterns) {
      if (pattern.test(output)) {
        flags.push(QUALITY_FLAGS.GENERIC_CONTENT);
        score = Math.max(1, score - 1);
        break;
      }
    }
  }

  // 检查是否截断（以不完整的句子结尾）
  const lastLine = output.trim().split('\n').pop() || '';
  if (lastLine.endsWith('...') || lastLine.endsWith('…') || lastLine.endsWith('-')) {
    flags.push(QUALITY_FLAGS.INCOMPLETE);
    score = Math.max(1, score - 1);
  }

  return { score, flags };
}

// ─── Main Scoring Function ─────────────────────────────────────────────────────

/**
 * 为角色输出评分
 *
 * @param output - 角色输出内容
 * @param role - 角色名称
 * @param config - 自定义配置（可选）
 * @returns 质量评分结果
 *
 * @example
 * ```typescript
 * const score = scoreOutput("这里是一段高质量的输出...", "developer");
 * console.log(score.score); // 4
 * console.log(score.assessment); // "Good - substantive and well-structured"
 * ```
 */
export function scoreOutput(
  output: string,
  role: RoleName,
  config: Partial<QualityConfig> = {}
): QualityScore {
  // 合并配置
  const roleConfig = ROLE_CONFIGS[role] || {};
  const mergedWeights = {
    ...DEFAULT_CONFIG.weights,
    ...roleConfig.weights,
    ...config.weights
  };
  const mergedConfig: QualityConfig = {
    ...DEFAULT_CONFIG,
    ...roleConfig,
    ...config,
    weights: mergedWeights as { length: number; structure: number; errors: number; completeness: number }
  };

  // 计算各维度分数
  const lengthResult = scoreLength(output, mergedConfig);
  const structureResult = scoreStructure(output);
  const errorResult = scoreErrors(output);
  const completenessResult = scoreCompleteness(output, mergedConfig);

  // 收集所有标记
  const allFlags = [
    ...lengthResult.flags,
    ...structureResult.flags,
    ...errorResult.flags,
    ...completenessResult.flags
  ];

  // 计算加权总分
  const weights = mergedConfig.weights!;
  const weightedScore =
    lengthResult.score * weights.length +
    structureResult.score * weights.structure +
    errorResult.score * weights.errors +
    completenessResult.score * weights.completeness;

  // 四舍五入到最接近的整数
  const finalScore = Math.max(1, Math.min(5, Math.round(weightedScore)));

  // 生成评估描述
  const assessments = [
    'Failed - empty or severely flawed output',
    'Poor - low quality, generic, or incomplete',
    'Acceptable - completed the task adequately',
    'Good - substantive, well-structured, and useful',
    'Excellent - insightful, comprehensive, and actionable'
  ];

  return {
    score: finalScore,
    assessment: assessments[finalScore - 1],
    flags: [...new Set(allFlags)], // 去重
    timestamp: new Date().toISOString(),
    role,
    outputLength: output.length
  };
}

// ─── Health File Management ────────────────────────────────────────────────────

const HEALTH_DIR = 'memory/skill-health';

/**
 * 确保健康目录存在
 */
function ensureHealthDir(): void {
  const dirPath = path.resolve(HEALTH_DIR);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 保存质量分数到健康文件
 *
 * @param skill - 技能/角色名称
 * @param score - 质量评分结果
 */
export function saveQualityScore(skill: string, score: QualityScore): void {
  ensureHealthDir();

  const healthFile = path.resolve(path.join(HEALTH_DIR, `${skill}.json`));
  let health: SkillHealth;

  // 读取现有健康数据
  if (fs.existsSync(healthFile)) {
    try {
      health = JSON.parse(fs.readFileSync(healthFile, 'utf-8'));
    } catch {
      health = createEmptyHealth(skill);
    }
  } else {
    health = createEmptyHealth(skill);
  }

  // 更新历史（保留最近 30 条）
  health.history.push({
    date: score.timestamp.slice(0, 10),
    score: score.score,
    flags: score.flags
  });
  health.history = health.history.slice(-30);

  // 更新统计
  health.total_runs += 1;
  if (score.score >= 3) {
    health.successful_runs += 1;
  }

  // 计算平均分
  const avg = health.history.reduce((sum, h) => sum + h.score, 0) / health.history.length;

  // 更新健康数据
  health.last_analyzed = score.timestamp;
  health.quality_score = score.score;
  health.avg_score = Math.round(avg * 100) / 100;

  // 保存到文件
  fs.writeFileSync(healthFile, JSON.stringify(health, null, 2));

  console.log(
    `[quality] ${skill}: score=${score.score}/5, avg=${health.avg_score}, ` +
    `runs=${health.total_runs}, success_rate=${Math.round(health.successful_runs / health.total_runs * 100)}%`
  );
}

/**
 * 创建空的健康数据
 */
function createEmptyHealth(skill: string): SkillHealth {
  return {
    skill,
    last_analyzed: '',
    quality_score: 0,
    avg_score: 0,
    history: [],
    total_runs: 0,
    successful_runs: 0
  };
}

/**
 * 获取技能健康数据
 *
 * @param skill - 技能/角色名称
 * @returns 健康数据，如果不存在返回 null
 */
export function getSkillHealth(skill: string): SkillHealth | null {
  const healthFile = path.resolve(path.join(HEALTH_DIR, `${skill}.json`));

  if (!fs.existsSync(healthFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(healthFile, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 获取所有技能的健康摘要
 *
 * @returns 健康摘要数组
 */
export function getHealthSummary(): Array<{
  skill: string;
  avgScore: number;
  totalRuns: number;
  successRate: number;
  lastAnalyzed: string;
}> {
  ensureHealthDir();

  const dirPath = path.resolve(HEALTH_DIR);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));

  return files.map(file => {
    const skill = file.replace('.json', '');
    const health = getSkillHealth(skill);

    if (!health) {
      return {
        skill,
        avgScore: 0,
        totalRuns: 0,
        successRate: 0,
        lastAnalyzed: 'never'
      };
    }

    return {
      skill,
      avgScore: health.avg_score,
      totalRuns: health.total_runs,
      successRate: health.total_runs > 0
        ? Math.round(health.successful_runs / health.total_runs * 100)
        : 0,
      lastAnalyzed: health.last_analyzed || 'never'
    };
  });
}

// ─── Quality Report ────────────────────────────────────────────────────────────

/**
 * 生成质量报告
 *
 * @returns 格式化的质量报告字符串
 */
export function generateQualityReport(): string {
  const summary = getHealthSummary();

  if (summary.length === 0) {
    return '📊 Quality Report\n\nNo quality data available yet.';
  }

  const lines: string[] = [
    '📊 Quality Report',
    '═'.repeat(50),
    ''
  ];

  // 按平均分排序
  const sorted = [...summary].sort((a, b) => b.avgScore - a.avgScore);

  for (const item of sorted) {
    const icon = item.avgScore >= 4 ? '🟢' : item.avgScore >= 3 ? '🟡' : '🔴';
    lines.push(
      `${icon} ${item.skill}:`,
      `   Avg Score: ${item.avgScore.toFixed(1)}/5`,
      `   Runs: ${item.totalRuns} (Success: ${item.successRate}%)`,
      `   Last: ${item.lastAnalyzed}`,
      ''
    );
  }

  // 计算整体统计
  const totalRuns = summary.reduce((sum, s) => sum + s.totalRuns, 0);
  const avgScore = summary.reduce((sum, s) => sum + s.avgScore * s.totalRuns, 0) / totalRuns;

  lines.push(
    '─'.repeat(50),
    `📈 Overall: ${totalRuns} runs, Avg Score: ${avgScore.toFixed(1)}/5`
  );

  return lines.join('\n');
}

// ─── Trend Analysis ────────────────────────────────────────────────────────────

/**
 * 分析质量趋势
 *
 * @param skill - 技能/角色名称
 * @param windowSize - 分析窗口大小（最近 N 次）
 * @returns 趋势分析结果
 */
export function analyzeTrend(
  skill: string,
  windowSize: number = 10
): {
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  recentAvg: number;
  previousAvg: number;
  change: number;
} {
  const health = getSkillHealth(skill);

  if (!health || health.history.length < windowSize) {
    return {
      trend: 'insufficient_data',
      recentAvg: 0,
      previousAvg: 0,
      change: 0
    };
  }

  const recent = health.history.slice(-windowSize);
  const previous = health.history.slice(-windowSize * 2, -windowSize);

  const recentAvg = recent.reduce((sum, h) => sum + h.score, 0) / recent.length;
  const previousAvg = previous.length > 0
    ? previous.reduce((sum, h) => sum + h.score, 0) / previous.length
    : recentAvg;

  const change = recentAvg - previousAvg;

  let trend: 'improving' | 'stable' | 'declining';
  if (change > 0.5) {
    trend = 'improving';
  } else if (change < -0.5) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  return {
    trend,
    recentAvg: Math.round(recentAvg * 100) / 100,
    previousAvg: Math.round(previousAvg * 100) / 100,
    change: Math.round(change * 100) / 100
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export default {
  scoreOutput,
  saveQualityScore,
  getSkillHealth,
  getHealthSummary,
  generateQualityReport,
  analyzeTrend
};
