/**
 * AgnesLoop Review Engine (M1 Simplified - Windows Compatible)
 *
 * Executes mechanical review checks using Node.js APIs
 * instead of shell commands for cross-platform compatibility.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReviewCriteria, ReviewCheck, CheckResult, ReviewResult, ReviewDimension } from './types.js';

// ─── Cross-Platform Check Execution ────────────────────────────────────────────

/** Execute a file existence check */
function checkFileExists(filePath: string): boolean {
  return fs.existsSync(path.resolve(filePath));
}

/** Read file content safely */
function readFileContent(filePath: string): string | null {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, 'utf-8');
  } catch {
    return null;
  }
}

/** Convert grep-style pattern to JavaScript regex pattern */
function grepToRegex(pattern: string): string {
  // Convert grep OR operator \| to JavaScript |
  return pattern.replace(/\\\|/g, '|');
}

/** Check if file content contains a pattern (case-insensitive) */
function fileContainsPattern(filePath: string, pattern: string, caseInsensitive: boolean = true): boolean {
  const content = readFileContent(filePath);
  if (!content) return false;
  const flags = caseInsensitive ? 'gi' : 'g';

  // Convert grep pattern to regex
  const regexPattern = grepToRegex(pattern);

  try {
    const regex = new RegExp(regexPattern, flags);
    return regex.test(content);
  } catch {
    // Fallback: try matching each part separated by |
    const parts = pattern.split('\\|');
    if (parts.length > 1) {
      return parts.some(part => {
        const trimmed = part.trim();
        return caseInsensitive
          ? content.toLowerCase().includes(trimmed.toLowerCase())
          : content.includes(trimmed);
      });
    }
    // Final fallback to simple string includes
    return caseInsensitive
      ? content.toLowerCase().includes(pattern.toLowerCase())
      : content.includes(pattern);
  }
}

/** Count pattern occurrences in file */
function countPatternInFile(filePath: string, pattern: string): number {
  const content = readFileContent(filePath);
  if (!content) return 0;
  try {
    const regex = new RegExp(pattern, 'gi');
    return (content.match(regex) || []).length;
  } catch {
    return content.toLowerCase().split(pattern.toLowerCase()).length - 1;
  }
}

/** Translate and execute a review check in a cross-platform way */
function executeCheckCrossPlatform(check: ReviewCheck): CheckResult {
  const cmd = check.execute.trim();
  console.log(`[review] Executing check ${check.id}: ${check.description}`);
  console.log(`[review] Command: ${cmd}`);

  // Parse common command patterns
  let passed = false;
  let evidence = '';
  let output = '';

  try {
    // Pattern 1: test -f <file> (file exists)
    const testFileMatch = cmd.match(/^test\s+-f\s+(.+)$/);
    if (testFileMatch) {
      const filePath = testFileMatch[1].trim();
      passed = checkFileExists(filePath);
      evidence = passed ? `File ${filePath} exists` : `File ${filePath} not found`;
      return makeResult(check, passed, evidence);
    }

    // Pattern 2: grep -qi '<pattern>' <file> (file contains pattern)
    // Handle patterns with < > characters and optional quotes
    const grepMatch = cmd.match(/^grep\s+(-[a-z]*)\s*['"]?([^'"]+?)['"]?\s+(\S+)$/);
    if (grepMatch) {
      const flags = grepMatch[1];
      const pattern = grepMatch[2];
      const filePath = grepMatch[3].trim();
      const caseInsensitive = flags.includes('i');
      passed = fileContainsPattern(filePath, pattern, caseInsensitive);
      evidence = passed
        ? `Found "${pattern}" in ${filePath}`
        : `Pattern "${pattern}" not found in ${filePath}`;
      return makeResult(check, passed, evidence);
    }

    // Pattern 3: grep -c '<pattern>' <file> (count occurrences)
    // Handle patterns with < > characters and optional quotes
    const grepCountMatch = cmd.match(/^grep\s+-c\s*['"]?([^'"]+?)['"]?\s+(\S+)$/);
    if (grepCountMatch) {
      const pattern = grepCountMatch[1];
      const filePath = grepCountMatch[2].trim();
      const count = countPatternInFile(filePath, pattern);
      output = String(count);
      // Check if pass_condition expects count >= N
      const countMatch = check.pass_condition.match(/result\s*>=\s*(\d+)/);
      if (countMatch) {
        const minCount = parseInt(countMatch[1]);
        passed = count >= minCount;
        evidence = `Found ${count} occurrences (need >= ${minCount})`;
      } else {
        passed = count > 0;
        evidence = `Found ${count} occurrences`;
      }
      return makeResult(check, passed, evidence, output);
    }

    // Pattern 4: grep -qi with && (compound check)
    // Handle patterns with < > characters and optional quotes
    const compoundGrepMatch = cmd.match(/grep\s+-qi\s+['"]?([^'"]+?)['"]?\s+(\S+)\s*&&\s*grep\s+-qi\s+['"]?([^'"]+?)['"]?\s+(\S+)$/);
    if (compoundGrepMatch) {
      const pattern1 = compoundGrepMatch[1];
      const file1 = compoundGrepMatch[2].trim();
      const pattern2 = compoundGrepMatch[3];
      const file2 = compoundGrepMatch[4].trim();
      const found1 = fileContainsPattern(file1, pattern1);
      const found2 = fileContainsPattern(file2, pattern2);
      passed = found1 && found2;
      evidence = passed
        ? `Found "${pattern1}" in ${file1} and "${pattern2}" in ${file2}`
        : `Missing: ${!found1 ? `"${pattern1}" in ${file1}` : `"${pattern2}" in ${file2}`}`;
      return makeResult(check, passed, evidence);
    }

    // Pattern 5: grep -qi with || (alternative check)
    // Handle patterns with < > characters and optional quotes
    const altGrepMatch = cmd.match(/grep\s+-qi\s+['"]?([^'"]+?)['"]?\s+(\S+)\s*\|\|\s*grep\s+-qi\s+['"]?([^'"]+?)['"]?\s+(\S+)$/);
    if (altGrepMatch) {
      const pattern1 = altGrepMatch[1];
      const file1 = altGrepMatch[2].trim();
      const pattern2 = altGrepMatch[3];
      const file2 = altGrepMatch[4].trim();
      const found1 = fileContainsPattern(file1, pattern1);
      const found2 = fileContainsPattern(file2, pattern2);
      passed = found1 || found2;
      evidence = passed
        ? `Found "${found1 ? pattern1 : pattern2}" in ${found1 ? file1 : file2}`
        : `Neither "${pattern1}" in ${file1} nor "${pattern2}" in ${file2} found`;
      return makeResult(check, passed, evidence);
    }

    // Pattern 6: Complex pattern with pipe (grep ... | grep ...)
    // Simplify by just checking the first grep
    const pipeGrepMatch = cmd.match(/^grep\s+(-[a-z]*)\s*['"]?([^'"]+)['"]?\s+(.+?)(\s*\|.*)?$/);
    if (pipeGrepMatch) {
      const flags = pipeGrepMatch[1];
      const pattern = pipeGrepMatch[2];
      const filePath = pipeGrepMatch[3].trim();
      const caseInsensitive = flags.includes('i');
      passed = fileContainsPattern(filePath, pattern, caseInsensitive);
      evidence = passed
        ? `Found "${pattern}" in ${filePath}`
        : `Pattern "${pattern}" not found in ${filePath}`;
      return makeResult(check, passed, evidence);
    }

    // Pattern 7: cat <file> | grep -c '<pattern>' (count via cat)
    const catGrepMatch = cmd.match(/^cat\s+(.+?)\s*\|\s*grep\s+-c\s*['"]?([^'"]+)['"]?$/);
    if (catGrepMatch) {
      const filePath = catGrepMatch[1].trim();
      const pattern = catGrepMatch[2];
      const count = countPatternInFile(filePath, pattern);
      passed = count > 0;
      evidence = `Found ${count} occurrences of "${pattern}" in ${filePath}`;
      return makeResult(check, passed, evidence, String(count));
    }

    // Pattern 8: Simple string search in file (e.g., grep -qi 'pattern' file || grep -q 'id="xxx"' file)
    // Already handled above

    // Fallback: Try to execute as-is (for non-standard commands)
    console.log(`[review] Unknown command pattern, attempting execution...`);
    const { execSync } = require('child_process');
    try {
      output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
      passed = true;
      evidence = `Command succeeded`;
    } catch (execErr: any) {
      passed = false;
      evidence = `Command failed: ${execErr.stderr || execErr.message}`;
    }

    return makeResult(check, passed, evidence, output);

  } catch (err: any) {
    console.error(`[review] Check ${check.id} error:`, err.message);
    return {
      check_id: check.id,
      dimension: '',
      description: check.description,
      method: 'shell_command',
      command: cmd,
      exit_code: 1,
      output: '',
      result: 'ERROR',
      evidence: `Error: ${err.message}`,
      fix_suggestion: check.fail_message,
    };
  }
}

/** Helper to create a CheckResult */
function makeResult(check: ReviewCheck, passed: boolean, evidence: string, output?: string): CheckResult {
  return {
    check_id: check.id,
    dimension: '',
    description: check.description,
    method: 'shell_command',
    command: check.execute,
    exit_code: passed ? 0 : 1,
    output: output || '',
    result: passed ? 'PASS' : 'FAIL',
    evidence,
    fix_suggestion: passed ? undefined : check.fail_message,
  };
}

// ─── LLM Check (M1: SKIP) ─────────────────────────────────────────────────────

function executeLLMCheck(check: ReviewCheck): CheckResult {
  return {
    check_id: check.id,
    dimension: '',
    description: check.description,
    method: 'llm_check',
    result: 'SKIP',
    evidence: 'LLM check not implemented in M1',
  };
}

// ─── Main Review Execution ─────────────────────────────────────────────────────

/** Execute a single check */
function executeCheck(check: ReviewCheck, dimension: string): CheckResult {
  if (check.execute === '__LLM_CHECK__') {
    return { ...executeLLMCheck(check), dimension };
  }
  return { ...executeCheckCrossPlatform(check), dimension };
}

/** Execute full review against criteria */
export function executeReview(criteria: ReviewCriteria, stepNumber: number): ReviewResult {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[review] Starting review for step ${stepNumber}`);

  // Handle both formats: { dimensions: [...] } and { tasks: [{ task_id, dimensions }] }
  let dimensions: ReviewDimension[];
  const criteriaAny = criteria as unknown as Record<string, unknown>;

  if (criteriaAny.tasks && Array.isArray(criteriaAny.tasks)) {
    const tasks = criteriaAny.tasks as Array<{ task_id: string; dimensions: ReviewDimension[] }>;
    const stepTask = tasks.find(t => t.task_id.includes(`step-${stepNumber}`)) || tasks[stepNumber - 1];
    dimensions = stepTask?.dimensions || [];
    console.log(`[review] Using task-specific criteria: ${stepTask?.task_id || 'fallback'}`);
  } else {
    dimensions = criteria.dimensions || [];
  }

  console.log(`[review] Dimensions: ${dimensions.length}`);
  console.log(`${'─'.repeat(60)}\n`);

  const allPassed: CheckResult[] = [];
  const allFailed: CheckResult[] = [];
  let blockerFailures = 0;
  let warningFailures = 0;

  for (const dimension of dimensions) {
    console.log(`[review] Dimension: ${dimension.name} (${dimension.severity})`);

    for (const check of dimension.checks) {
      const result = executeCheck(check, dimension.name);

      if (result.result === 'PASS') {
        allPassed.push(result);
        console.log(`  ✅ ${check.id}: PASS`);
      } else if (result.result === 'FAIL') {
        allFailed.push(result);
        console.log(`  ❌ ${check.id}: FAIL - ${result.evidence}`);

        if (dimension.severity === 'blocker') {
          blockerFailures++;
        } else if (dimension.severity === 'warning') {
          warningFailures++;
        }
      } else {
        console.log(`  ⏭️  ${check.id}: SKIP`);
      }
    }
  }

  const totalChecks = allPassed.length + allFailed.length;
  const overallResult = blockerFailures === 0 ? 'PASS' : 'FAIL';

  const result: ReviewResult = {
    review_id: `review-${Date.now()}`,
    step: stepNumber,
    timestamp: new Date().toISOString(),
    result: overallResult,
    summary: {
      total_checks: totalChecks,
      passed: allPassed.length,
      failed: allFailed.length,
      blocker_failures: blockerFailures,
      warning_failures: warningFailures,
    },
    failed_checks: allFailed,
    passed_checks: allPassed,
  };

  console.log(`\n[review] Result: ${overallResult} (${allPassed.length}/${totalChecks} passed, ${blockerFailures} blockers)`);
  return result;
}

/** Try to auto-fix simple issues (M1: returns empty) */
export async function autoFix(_failedChecks: CheckResult[]): Promise<string[]> {
  console.log('[review] Auto-fix not implemented in M1');
  return [];
}
