/**
 * AgnesLoop Repair - 自动修复模块
 *
 * 根据 heartbeat 检测到的问题，自动尝试修复。
 * 借鉴 Aeon 的 skill-repair 技能设计。
 *
 * 修复能力:
 * 1. 重置连续失败计数
 * 2. 恢复损坏的状态文件
 * 3. 跳过卡住的任务
 * 4. 清理过期的临时文件
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HealthReport, HealthIssue } from './heartbeat.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RepairActionType = 'reset' | 'recover' | 'skip' | 'clean' | 'notify';

export interface RepairAction {
  type: RepairActionType;
  target: string;
  reason: string;
  issue: HealthIssue;
}

export interface RepairResult {
  success: boolean;
  action: RepairAction;
  message: string;
  timestamp: string;
}

export interface RepairReport {
  totalIssues: number;
  repaired: number;
  skipped: number;
  failed: number;
  results: RepairResult[];
  timestamp: string;
}

// ─── 修复策略 (第一部分) ──────────────────────────────────────────────────────

/**
 * 根据问题类型决定修复动作
 */
function determineRepairAction(issue: HealthIssue): RepairAction | null {
  // 状态文件问题
  if (issue.source === 'state.json') {
    if (issue.message.includes('不存在')) {
      return {
        type: 'recover',
        target: 'state.json',
        reason: '状态文件丢失，创建初始状态',
        issue
      };
    }
    if (issue.message.includes('解析失败')) {
      return {
        type: 'recover',
        target: 'state.json',
        reason: '状态文件损坏，从备份恢复或创建新状态',
        issue
      };
    }
  }

  // 质量分数问题
  if (issue.source?.startsWith('memory/skill-health/')) {
    if (issue.message.includes('平均质量分数过低')) {
      return {
        type: 'reset',
        target: issue.source,
        reason: '重置质量分数历史，重新开始追踪',
        issue
      };
    }
  }

  // 日志问题 - 只需要通知，不需要自动修复
  if (issue.source?.startsWith('logs/')) {
    return {
      type: 'notify',
      target: issue.source,
      reason: '日志中发现错误标记，需要人工检查',
      issue
    };
  }

  return null;
}

// ─── 修复函数 (第二部分) ──────────────────────────────────────────────────────

/**
 * 重置质量分数文件
 */
function resetQualityFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const health = JSON.parse(content);

      // 重置分数，保留历史
      health.quality_score = 0;
      health.avg_score = 0;
      health.last_analyzed = new Date().toISOString();

      fs.writeFileSync(filePath, JSON.stringify(health, null, 2));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 恢复状态文件
 */
function recoverStateFile(): boolean {
  const statePath = path.resolve('state.json');
  const backupPath = path.resolve('state.json.backup');

  // 尝试从备份恢复
  if (fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(backupPath, statePath);
      return true;
    } catch {
      // 备份恢复失败，继续创建新状态
    }
  }

  // 创建初始状态
  try {
    const initialState = {
      goal: 'Recovering from state file loss',
      goal_id: `recovery-${Date.now()}`,
      status: 'in_progress',
      current_phase: 'planning',
      plan: [],
      current_step: 0,
      current_role: 'ceo',
      review_status: { total_reviews: 0, passed: 0, failed: 0, current_review: null },
      value_added_tasks: [],
      completed_features: [],
      pending_features: [],
      last_run_at: new Date().toISOString(),
      total_runtime_minutes: 0,
      runs_count: 0,
      next_action: 'CEO reads GOAL.md and creates execution plan'
    };

    fs.writeFileSync(statePath, JSON.stringify(initialState, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ─── 执行修复 (第三部分) ──────────────────────────────────────────────────────

/**
 * 执行单个修复动作
 */
function executeRepairAction(action: RepairAction): RepairResult {
  let success = false;
  let message = '';

  switch (action.type) {
    case 'reset':
      if (action.target.startsWith('memory/skill-health/')) {
        success = resetQualityFile(action.target);
        message = success ? '质量分数已重置' : '重置失败';
      }
      break;

    case 'recover':
      if (action.target === 'state.json') {
        success = recoverStateFile();
        message = success ? '状态文件已恢复' : '恢复失败';
      }
      break;

    case 'notify':
      // 通知类动作不需要实际修复
      success = true;
      message = '已记录，需要人工检查';
      break;

    case 'skip':
    case 'clean':
      // 暂未实现
      success = false;
      message = '修复类型暂未实现';
      break;
  }

  return {
    success,
    action,
    message,
    timestamp: new Date().toISOString()
  };
}

// ─── 主修复函数 (第四部分) ────────────────────────────────────────────────────

/**
 * 根据健康报告执行自动修复
 *
 * @param report - 健康检测报告
 * @returns 修复报告
 *
 * @example
 * ```typescript
 * const healthReport = checkHealth();
 * const repairReport = autoRepair(healthReport);
 * console.log(`Repaired: ${repairReport.repaired}/${repairReport.totalIssues}`);
 * ```
 */
export function autoRepair(report: HealthReport): RepairReport {
  const results: RepairResult[] = [];
  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  console.log('\n[repair] 开始自动修复...');
  console.log(`[repair] 待处理问题: ${report.issues.length}`);

  for (const issue of report.issues) {
    // 确定修复动作
    const action = determineRepairAction(issue);

    if (!action) {
      console.log(`[repair] 跳过: ${issue.message} (无自动修复方案)`);
      skipped++;
      continue;
    }

    // 低优先级问题只通知不修复
    if (issue.severity === 'low' && action.type !== 'notify') {
      console.log(`[repair] 跳过低优先级: ${issue.message}`);
      skipped++;
      continue;
    }

    // 执行修复
    console.log(`[repair] 修复: ${action.reason}`);
    const result = executeRepairAction(action);
    results.push(result);

    if (result.success) {
      repaired++;
      console.log(`[repair] ✅ ${result.message}`);
    } else {
      failed++;
      console.log(`[repair] ❌ ${result.message}`);
    }
  }

  const repairReport: RepairReport = {
    totalIssues: report.issues.length,
    repaired,
    skipped,
    failed,
    results,
    timestamp: new Date().toISOString()
  };

  // 输出摘要
  console.log('\n[repair] 修复完成:');
  console.log(`  总问题: ${repairReport.totalIssues}`);
  console.log(`  已修复: ${repairReport.repaired}`);
  console.log(`  已跳过: ${repairReport.skipped}`);
  console.log(`  失败: ${repairReport.failed}`);

  return repairReport;
}

// ─── 工具函数 (第五部分) ──────────────────────────────────────────────────────

/**
 * 格式化修复报告为可读字符串
 *
 * @param report - 修复报告
 * @returns 格式化的字符串
 */
export function formatRepairReport(report: RepairReport): string {
  const lines: string[] = [
    '╔════════════════════════════════════════════════════════════╗',
    '║                     自动修复报告                           ║',
    '╚════════════════════════════════════════════════════════════╝',
    '',
    `时间: ${report.timestamp}`,
    '',
    '统计:',
    `  总问题: ${report.totalIssues}`,
    `  ✅ 已修复: ${report.repaired}`,
    `  ⏭️  已跳过: ${report.skipped}`,
    `  ❌ 失败: ${report.failed}`,
    ''
  ];

  // 详细结果
  if (report.results.length > 0) {
    lines.push('详细结果:');
    for (const result of report.results) {
      const icon = result.success ? '✅' : '❌';
      lines.push(`  ${icon} ${result.action.reason}`);
      lines.push(`     ${result.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * 创建状态文件备份
 *
 * @returns true 如果备份成功
 */
export function backupStateFile(): boolean {
  const statePath = path.resolve('state.json');
  const backupPath = path.resolve('state.json.backup');

  try {
    if (fs.existsSync(statePath)) {
      fs.copyFileSync(statePath, backupPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 清理过期的临时文件
 *
 * @param maxAgeHours - 最大保留时间（小时）
 * @returns 清理的文件数
 */
export function cleanTempFiles(maxAgeHours: number = 24): number {
  let cleaned = 0;
  const tempDirs = ['.pending-notify', 'memory/skill-health'];

  for (const dir of tempDirs) {
    const dirPath = path.resolve(dir);
    if (!fs.existsSync(dirPath)) continue;

    try {
      const files = fs.readdirSync(dirPath);
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    } catch {
      // 忽略清理错误
    }
  }

  return cleaned;
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

export default {
  autoRepair,
  formatRepairReport,
  backupStateFile,
  cleanTempFiles
};
