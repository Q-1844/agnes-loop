/**
 * AgnesLoop Heartbeat - 健康检测模块
 *
 * 定期检查系统健康状态，识别潜在问题。
 * 借鉴 Aeon 的 heartbeat 技能设计。
 *
 * 检测项目:
 * 1. 状态文件完整性
 * 2. 质量分数异常
 * 3. 连续失败检测
 * 4. 运行时间异常
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = 'ok' | 'watch' | 'degraded';

export interface HealthIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  source?: string;
  timestamp: string;
}

export interface HealthReport {
  status: HealthStatus;
  issues: HealthIssue[];
  checks: {
    stateFile: boolean;
    qualityData: boolean;
    recentLogs: boolean;
  };
  timestamp: string;
}

// ─── 检测函数 (第一部分) ──────────────────────────────────────────────────────

/**
 * 检查状态文件是否健康
 */
function checkStateFile(): { ok: boolean; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const statePath = path.resolve('state.json');

  // 检查文件是否存在
  if (!fs.existsSync(statePath)) {
    issues.push({
      severity: 'high',
      message: 'state.json 不存在 - Agent 可能未正确初始化',
      source: 'state.json',
      timestamp: new Date().toISOString()
    });
    return { ok: false, issues };
  }

  // 检查文件是否可解析
  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content);

    // 检查必要字段
    const requiredFields = ['goal', 'status', 'current_phase', 'current_role', 'plan'];
    for (const field of requiredFields) {
      if (!(field in state)) {
        issues.push({
          severity: 'high',
          message: `state.json 缺少必要字段: ${field}`,
          source: 'state.json',
          timestamp: new Date().toISOString()
        });
      }
    }

    // 检查状态值是否有效
    const validStatuses = ['in_progress', 'paused', 'completed', 'blocked'];
    if (!validStatuses.includes(state.status)) {
      issues.push({
        severity: 'medium',
        message: `state.json 状态值无效: ${state.status}`,
        source: 'state.json',
        timestamp: new Date().toISOString()
      });
    }

  } catch (err) {
    issues.push({
      severity: 'critical',
      message: `state.json 解析失败: ${err}`,
      source: 'state.json',
      timestamp: new Date().toISOString()
    });
    return { ok: false, issues };
  }

  return { ok: issues.length === 0, issues };
}

// ─── 检测函数 (第二部分) ──────────────────────────────────────────────────────

/**
 * 检查质量数据是否健康
 */
function checkQualityData(): { ok: boolean; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const healthDir = path.resolve('memory/skill-health');

  // 检查目录是否存在
  if (!fs.existsSync(healthDir)) {
    // 目录不存在不算错误，只是还没有质量数据
    return { ok: true, issues };
  }

  // 读取所有质量文件
  try {
    const files = fs.readdirSync(healthDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(healthDir, file);
      const skill = file.replace('.json', '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const health = JSON.parse(content);

        // 检查平均分是否过低
        if (health.avg_score && health.avg_score < 2) {
          issues.push({
            severity: 'high',
            message: `${skill} 平均质量分数过低: ${health.avg_score.toFixed(1)}/5`,
            source: `memory/skill-health/${file}`,
            timestamp: new Date().toISOString()
          });
        }

        // 检查最近评分是否连续低分
        if (health.history && health.history.length >= 3) {
          const recentScores = health.history.slice(-3).map((h: { score: number }) => h.score);
          const allLow = recentScores.every((s: number) => s <= 2);
          if (allLow) {
            issues.push({
              severity: 'medium',
              message: `${skill} 最近 3 次评分都较低: [${recentScores.join(', ')}]`,
              source: `memory/skill-health/${file}`,
              timestamp: new Date().toISOString()
            });
          }
        }

      } catch (err) {
        issues.push({
          severity: 'medium',
          message: `质量文件解析失败: ${file}`,
          source: `memory/skill-health/${file}`,
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (err) {
    issues.push({
      severity: 'low',
      message: `读取质量目录失败: ${err}`,
      source: 'memory/skill-health/',
      timestamp: new Date().toISOString()
    });
  }

  return { ok: issues.length === 0, issues };
}

// ─── 检测函数 (第三部分) ──────────────────────────────────────────────────────

/**
 * 检查最近的日志是否有异常
 */
function checkRecentLogs(): { ok: boolean; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const logDir = path.resolve('logs');

  if (!fs.existsSync(logDir)) {
    return { ok: true, issues };
  }

  try {
    // 获取最近 3 天的日志文件
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-3);

    for (const file of files) {
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');

      // 检查是否有错误标记
      const errorPatterns = [
        /fatal error/i,
        /blocked/i,
        /emergency/i,
        /failed after.*retries/i
      ];

      for (const pattern of errorPatterns) {
        if (pattern.test(content)) {
          issues.push({
            severity: 'medium',
            message: `日志 ${file} 包含错误标记: ${pattern.source}`,
            source: `logs/${file}`,
            timestamp: new Date().toISOString()
          });
          break; // 每个文件只报告一次
        }
      }
    }

  } catch (err) {
    issues.push({
      severity: 'low',
      message: `读取日志目录失败: ${err}`,
      source: 'logs/',
      timestamp: new Date().toISOString()
    });
  }

  return { ok: issues.length === 0, issues };
}

// ─── 主检测函数 (第四部分) ────────────────────────────────────────────────────

/**
 * 执行完整的健康检测
 *
 * @returns 健康报告
 *
 * @example
 * ```typescript
 * const report = checkHealth();
 * console.log(`Status: ${report.status}`);
 * console.log(`Issues: ${report.issues.length}`);
 * ```
 */
export function checkHealth(): HealthReport {
  const issues: HealthIssue[] = [];

  // 1. 检查状态文件
  const stateCheck = checkStateFile();
  issues.push(...stateCheck.issues);

  // 2. 检查质量数据
  const qualityCheck = checkQualityData();
  issues.push(...qualityCheck.issues);

  // 3. 检查最近日志
  const logCheck = checkRecentLogs();
  issues.push(...logCheck.issues);

  // 确定整体状态
  let status: HealthStatus = 'ok';
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasHigh = issues.some(i => i.severity === 'high');

  if (hasCritical) {
    status = 'degraded';
  } else if (hasHigh || issues.length > 3) {
    status = 'watch';
  }

  return {
    status,
    issues,
    checks: {
      stateFile: stateCheck.ok,
      qualityData: qualityCheck.ok,
      recentLogs: logCheck.ok
    },
    timestamp: new Date().toISOString()
  };
}

// ─── 报告格式化 (第五部分) ────────────────────────────────────────────────────

/**
 * 格式化健康报告为可读字符串
 *
 * @param report - 健康报告
 * @returns 格式化的字符串
 */
export function formatHealthReport(report: HealthReport): string {
  const icons: Record<HealthStatus, string> = {
    ok: '🟢',
    watch: '🟡',
    degraded: '🔴'
  };

  const lines: string[] = [
    '╔════════════════════════════════════════════════════════════╗',
    '║                   健康检测报告                             ║',
    '╚════════════════════════════════════════════════════════════╝',
    '',
    `状态: ${icons[report.status]} ${report.status.toUpperCase()}`,
    `时间: ${report.timestamp}`,
    ''
  ];

  // 检查项状态
  lines.push('检查项:');
  lines.push(`  ${report.checks.stateFile ? '✅' : '❌'} 状态文件`);
  lines.push(`  ${report.checks.qualityData ? '✅' : '❌'} 质量数据`);
  lines.push(`  ${report.checks.recentLogs ? '✅' : '❌'} 最近日志`);
  lines.push('');

  // 问题列表
  if (report.issues.length === 0) {
    lines.push('✅ 未发现问题');
  } else {
    lines.push(`发现 ${report.issues.length} 个问题:`);
    lines.push('');

    // 按严重程度分组
    const critical = report.issues.filter(i => i.severity === 'critical');
    const high = report.issues.filter(i => i.severity === 'high');
    const medium = report.issues.filter(i => i.severity === 'medium');
    const low = report.issues.filter(i => i.severity === 'low');

    if (critical.length > 0) {
      lines.push('🔴 严重问题:');
      for (const issue of critical) {
        lines.push(`  - ${issue.message}`);
      }
      lines.push('');
    }

    if (high.length > 0) {
      lines.push('🟠 高优先级:');
      for (const issue of high) {
        lines.push(`  - ${issue.message}`);
      }
      lines.push('');
    }

    if (medium.length > 0) {
      lines.push('🟡 中优先级:');
      for (const issue of medium) {
        lines.push(`  - ${issue.message}`);
      }
      lines.push('');
    }

    if (low.length > 0) {
      lines.push('⚪ 低优先级:');
      for (const issue of low) {
        lines.push(`  - ${issue.message}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── 便捷函数 ─────────────────────────────────────────────────────────────────

/**
 * 快速检查系统是否健康
 *
 * @returns true 如果系统健康，false 如果有问题
 */
export function isHealthy(): boolean {
  const report = checkHealth();
  return report.status === 'ok';
}

/**
 * 获取所有问题的摘要
 *
 * @returns 问题摘要数组
 */
export function getIssueSummary(): Array<{ severity: string; message: string }> {
  const report = checkHealth();
  return report.issues.map(i => ({
    severity: i.severity,
    message: i.message
  }));
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

export default {
  checkHealth,
  formatHealthReport,
  isHealthy,
  getIssueSummary
};
