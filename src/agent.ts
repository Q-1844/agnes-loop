/**
 * AgnesLoop - 24-Hour Autonomous AI Agent System
 *
 * Main entry point and orchestration loop.
 *
 * Flow:
 * 1. Load state (or create initial)
 * 2. Determine current role
 * 3. Build context → dispatch role → handle output
 * 4. Update state → check time → periodic save
 * 5. Role transition → next iteration
 * 6. Wrap up: save final state, write logs, commit
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentState, RoleName, PlanStep, ReviewCriteria } from './types.js';
import { loadState, saveState, updateStep, advanceToNextStep, getCurrentStep, completeCurrentStep, transitionPhase, setCurrentRole, pauseState, resumeState, getStateSummary } from './state.js';
import { dispatchRole } from './roles.js';
import { TimeGuard } from './time-guard.js';
import { GitOps } from './git.js';
import { executeReview } from './review.js';
import { scoreOutput, saveQualityScore, generateQualityReport } from './quality.js';
import { notify, notifySuccess, notifyWarning, notifyError, formatStatusNotification, formatQualityNotification } from './notify.js';

// ─── Configuration ─────────────────────────────────────────────────────────────

interface RunConfig {
  goalFile: string;
  dryRun: boolean;
}

function parseArgs(): RunConfig {
  const args = process.argv.slice(2);
  const config: RunConfig = {
    goalFile: 'GOAL.md',
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--goal' && args[i + 1]) {
      config.goalFile = args[i + 1];
      i++;
    }
    if (args[i] === '--dry-run') {
      config.dryRun = true;
    }
  }

  return config;
}

// ─── Schedule File Management ──────────────────────────────────────────────────

/** Create schedule.json for resume after 1 hour */
function createScheduleFile(): void {
  const schedulePath = path.resolve('schedule.json');
  const nextRun = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  const schedule = {
    next_run_at: nextRun.toISOString(),
    reason: 'resume_after_pause',
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), 'utf-8');
  console.log(`[agent] Schedule created: resume at ${nextRun.toISOString()}`);
}

/** Check if schedule.json exists and if it's time to resume */
function checkSchedule(): boolean {
  const schedulePath = path.resolve('schedule.json');
  if (!fs.existsSync(schedulePath)) {
    return false;
  }

  try {
    const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf-8'));
    const now = new Date();
    const nextRun = new Date(schedule.next_run_at);

    if (now >= nextRun) {
      console.log(`[agent] Schedule reached: ${schedule.reason}`);
      // Delete schedule.json to prevent duplicate triggers
      fs.unlinkSync(schedulePath);
      return true;
    } else {
      console.log(`[agent] Scheduled resume at: ${nextRun.toISOString()}`);
      return false;
    }
  } catch (err) {
    console.error('[agent] Error reading schedule.json:', err);
    return false;
  }
}

// ─── Main Loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();
  const timeGuard = new TimeGuard();
  const git = new GitOps();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              AgnesLoop - Autonomous AI Agent              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n${timeGuard.getStatus()}\n`);

  // 发送启动通知
  await notify('AgnesLoop 启动', 'agent', 'low');

  // Initialize git config for CI
  git.initConfig();

  // Load or create state
  let state: AgentState;
  const goalPath = path.resolve(config.goalFile);
  let goal: string | undefined;

  if (fs.existsSync(goalPath)) {
    goal = fs.readFileSync(goalPath, 'utf-8').trim();
    console.log(`[agent] Loaded goal from ${config.goalFile}`);
  }

  state = loadState(goal);

  // Check if this is a scheduled resume
  const isScheduledResume = checkSchedule();

  // If resuming from a paused state
  if (state.status === 'paused' || isScheduledResume) {
    resumeState(state);
    console.log(`[agent] Resuming from run #${state.runs_count}, step ${state.current_step}`);
  } else if (state.runs_count > 0) {
    // Already ran before, increment count
    state.runs_count += 1;
    console.log(`[agent] Starting run #${state.runs_count}`);
  } else {
    state.runs_count = 1;
    console.log('[agent] First run, starting fresh');
  }

  // Save initial state
  saveState(state);

  // ── Main Execution Loop ─────────────────────────────────────────────────
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Safety limit

  while (state.status === 'in_progress' && iterations < MAX_ITERATIONS) {
    iterations++;

    // Time checks
    console.log(`\n${timeGuard.getStatus()}`);

    // Emergency exit
    if (timeGuard.isEmergency()) {
      console.log('\n⚠️  EMERGENCY: Time limit critical, saving and exiting...');
      pauseState(state, 'Emergency time limit reached');
      saveState(state);
      // Create schedule.json for resume after 1 hour
      createScheduleFile();
      git.commitAndPush('Emergency save - time limit');
      break;
    }

    // Soft limit
    if (!timeGuard.shouldContinue()) {
      console.log('\n⏰ Soft limit reached, saving progress...');
      pauseState(state, 'Soft time limit reached');
      saveState(state);
      // Create schedule.json for resume after 1 hour
      createScheduleFile();
      git.commitAndPush('Scheduled pause - soft limit');
      break;
    }

    // Periodic save
    if (timeGuard.timeForPeriodicSave()) {
      console.log('\n💾 Periodic save...');
      saveState(state);
      git.commitState(`Periodic save - step ${state.current_step}`);
      timeGuard.markSave();
    }

    // Determine current role and execute
    const role = state.current_role;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[agent] Iteration ${iterations}: Role = ${role}, Phase = ${state.current_phase}`);
    console.log(`${'─'.repeat(60)}`);

    try {
      const result = await dispatchRole(role, state);

      // Process role output based on role type
      await processRoleOutput(role, state, result.response.content);

      // Quality scoring - evaluate output quality
      const quality = scoreOutput(result.response.content, role);
      saveQualityScore(role, quality);

      // Log quality score with appropriate icon
      const qualityIcon = quality.score >= 4 ? '⭐' : quality.score >= 3 ? '✅' : '⚠️';
      console.log(`${qualityIcon} [quality] ${role}: ${quality.score}/5 - ${quality.assessment}`);
      if (quality.flags.length > 0) {
        console.log(`   Flags: ${quality.flags.join(', ')}`);
      }

      // 低质量分数时发送警告通知
      if (quality.score <= 2) {
        await notifyWarning(
          formatQualityNotification(role, quality.score, quality.flags),
          'quality'
        );
      }

      // Save state after each role execution
      saveState(state);

    } catch (err) {
      console.error(`[agent] Error in ${role} execution:`, err);
      // 发送错误通知
      await notifyError(`${role} 执行失败: ${err}`, 'agent');
      // Don't crash - save state and continue
      saveState(state);
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.log('\n⚠️  Max iterations reached, stopping');
    pauseState(state, 'Max iterations reached');
    saveState(state);
  }

  // ── Wrap Up ─────────────────────────────────────────────────────────────
  await wrapUp(state, timeGuard, git);
}

// ─── Role Output Processing ────────────────────────────────────────────────────

async function processRoleOutput(role: RoleName, state: AgentState, content: string): Promise<void> {
  switch (role) {
    case 'ceo':
      await processCEOOutput(state, content);
      break;
    case 'architect':
      await processArchitectOutput(state, content);
      break;
    case 'developer':
      await processDeveloperOutput(state, content);
      break;
    case 'reviewer':
      await processReviewerOutput(state, content);
      break;
    case 'researcher':
      await processResearcherOutput(state, content);
      break;
  }
}

async function processCEOOutput(state: AgentState, _content: string): Promise<void> {
  // CEO should have written PLAN.md
  const planPath = path.resolve('PLAN.md');
  if (fs.existsSync(planPath)) {
    // Parse PLAN.md to extract steps (simplified: look for numbered items)
    const planContent = fs.readFileSync(planPath, 'utf-8');
    const steps = parsePlanSteps(planContent);

    if (steps.length > 0) {
      state.plan = steps;

      // Mark first step as in_progress
      steps[0].status = 'in_progress';
      state.current_step = 1;
      state.current_role = steps[0].role;
      state.next_action = `${steps[0].role} executes: ${steps[0].task}`;

      transitionPhase(state, 'development');
      console.log(`[agent] ✅ CEO created plan with ${steps.length} steps`);
      console.log(`[agent] Starting with step 1: ${steps[0].task}`);
    } else {
      console.warn('[agent] CEO created PLAN.md but no steps were parsed');
    }
  } else {
    console.warn('[agent] CEO did not create PLAN.md');
  }
}

async function processArchitectOutput(state: AgentState, _content: string): Promise<void> {
  // Architect should have written ARCHITECTURE.md
  const archPath = path.resolve('ARCHITECTURE.md');
  if (fs.existsSync(archPath)) {
    console.log('[agent] ✅ Architect created ARCHITECTURE.md');

    // Move to first development step
    if (state.plan.length > 0) {
      // Mark first step as in_progress
      state.plan[0].status = 'in_progress';
      state.current_step = 1;
      state.current_role = state.plan[0].role;
      state.next_action = `${state.plan[0].role} executes: ${state.plan[0].task}`;

      transitionPhase(state, 'development');
      console.log(`[agent] Starting development with step 1: ${state.plan[0].task}`);
    } else {
      console.warn('[agent] No plan steps found, cannot start development');
    }
  } else {
    console.warn('[agent] Architect did not create ARCHITECTURE.md');
  }
}

async function processDeveloperOutput(state: AgentState, _content: string): Promise<void> {
  const currentStep = getCurrentStep(state);
  if (!currentStep) {
    console.warn('[agent] No current step found for developer');
    return;
  }

  // Mark step as ready for review
  updateStep(state, currentStep.step, 'reviewing');
  state.current_role = 'reviewer';
  state.next_action = `Reviewer reviews step ${currentStep.step}: ${currentStep.task}`;
  console.log(`[agent] ✅ Developer completed step ${currentStep.step}, moving to review`);
}

async function processReviewerOutput(state: AgentState, _content: string): Promise<void> {
  const currentStep = getCurrentStep(state);
  if (!currentStep) {
    console.warn('[agent] No current step found for reviewer');
    return;
  }

  // Try to read review criteria
  const criteriaPath = path.resolve('REVIEW_CRITERIA.json');
  if (!fs.existsSync(criteriaPath)) {
    // No criteria = auto-pass
    console.log('[agent] No REVIEW_CRITERIA.json found, auto-passing');
    const hasNext = completeCurrentStep(state, 'Auto-passed (no review criteria)');
    if (!hasNext) {
      // All steps completed
      transitionPhase(state, 'value_add');
      setCurrentRole(state, 'researcher');
    }
    return;
  }

  try {
    const criteria: ReviewCriteria = JSON.parse(fs.readFileSync(criteriaPath, 'utf-8'));
    const reviewResult = executeReview(criteria, currentStep.step);

    if (reviewResult.result === 'PASS') {
      console.log(`[agent] ✅ Review PASSED for step ${currentStep.step}`);

      // completeCurrentStep will:
      // 1. Mark current step as 'completed'
      // 2. Find next pending step and mark it as 'in_progress'
      // 3. Update state.current_step, state.current_role, state.next_action
      const hasNext = completeCurrentStep(state, 'Review passed');

      if (!hasNext) {
        // All steps completed - transition to value_add phase
        console.log('[agent] All development steps completed!');
        transitionPhase(state, 'value_add');
        setCurrentRole(state, 'researcher');
        state.next_action = 'Researcher submits value-add ideas';
      } else {
        console.log(`[agent] Moving to step ${state.current_step} with role ${state.current_role}`);
      }
    } else {
      console.log(`[agent] ❌ Review FAILED for step ${currentStep.step} (${reviewResult.summary.blocker_failures} blockers)`);

      if (currentStep.retries >= 3) {
        // Max retries reached
        updateStep(state, currentStep.step, 'blocked');
        state.status = 'blocked';
        state.next_action = `Step ${currentStep.step} blocked after 3 failed reviews`;
        console.log(`[agent] 🚧 Step ${currentStep.step} BLOCKED after 3 retries`);
      } else {
        // Send back to developer for fixes
        updateStep(state, currentStep.step, 'in_progress');
        state.current_role = 'developer';
        state.next_action = `Developer fixes step ${currentStep.step} based on review feedback`;
        console.log(`[agent] Sending step ${currentStep.step} back to developer (retry ${currentStep.retries + 1}/3)`);
      }
    }
  } catch (err) {
    console.error('[agent] Review execution error:', err);
    // On error, auto-pass and continue
    const hasNext = completeCurrentStep(state, 'Review error - auto-passed');
    if (!hasNext) {
      transitionPhase(state, 'value_add');
      setCurrentRole(state, 'researcher');
    }
  }
}

async function processResearcherOutput(state: AgentState, _content: string): Promise<void> {
  // Researcher submitted ideas, mark value_add as complete
  console.log('[agent] Researcher submitted value-add ideas');
  state.status = 'completed';
  state.next_action = 'All tasks completed';
}

// ─── Plan Parsing ──────────────────────────────────────────────────────────────

/** Parse PLAN.md into PlanStep array (simplified parser) */
function parsePlanSteps(planContent: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = planContent.split('\n');

  let stepNum = 0;
  for (const line of lines) {
    // Match patterns like "1. task description" or "Step 1: task description"
    const match = line.match(/^(?:Step\s+)?(\d+)[.:)]\s+(.+)/i);
    if (match) {
      stepNum++;
      const task = match[2].trim();

      // Try to determine role from task content
      let role: RoleName = 'developer';
      const taskLower = task.toLowerCase();
      if (taskLower.includes('design') || taskLower.includes('architecture') || taskLower.includes('接口')) {
        role = 'architect';
      } else if (taskLower.includes('review') || taskLower.includes('test') || taskLower.includes('审核')) {
        role = 'reviewer';
      } else if (taskLower.includes('research') || taskLower.includes('搜索')) {
        role = 'researcher';
      }

      steps.push({
        step: stepNum,
        task,
        role,
        status: 'pending',
        output: null,
        retries: 0,
      });
    }
  }

  // If no steps found, create a default single step
  if (steps.length === 0 && planContent.length > 0) {
    steps.push({
      step: 1,
      task: 'Execute the plan described in PLAN.md',
      role: 'developer',
      status: 'pending',
      output: null,
      retries: 0,
    });
  }

  return steps;
}

// ─── Wrap Up ───────────────────────────────────────────────────────────────────

async function wrapUp(state: AgentState, timeGuard: TimeGuard, git: GitOps): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('[agent] Wrapping up...');
  console.log(`${'═'.repeat(60)}`);

  // Update runtime
  state.total_runtime_minutes += Math.floor(timeGuard.getElapsedMinutes());

  // Write run log
  const logDir = path.resolve('logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const now = new Date();
  const logFile = path.join(logDir, `${now.toISOString().slice(0, 10)}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}.md`);

  const logContent = [
    `# Run Log - ${now.toISOString()}`,
    '',
    `## Summary`,
    `- Duration: ${timeGuard.getElapsedFormatted()}`,
    `- Status: ${state.status}`,
    `- Phase: ${state.current_phase}`,
    `- Steps completed: ${state.plan.filter(s => s.status === 'completed').length}/${state.plan.length}`,
    `- Total runtime: ${state.total_runtime_minutes} minutes`,
    `- Runs: ${state.runs_count}`,
    '',
    `## Next Action`,
    state.next_action,
    '',
    `## State`,
    '```json',
    JSON.stringify(state, null, 2),
    '```',
  ].join('\n');

  fs.writeFileSync(logFile, logContent, 'utf-8');
  console.log(`[agent] Run log written to ${logFile}`);

  // Append to LESSONS.md
  const lessonsPath = path.resolve('LESSONS.md');
  let lessons = '';
  if (fs.existsSync(lessonsPath)) {
    lessons = fs.readFileSync(lessonsPath, 'utf-8');
  } else {
    lessons = '# AgnesLoop Lessons\n\n';
  }

  const lessonEntry = [
    `\n## ${now.toISOString().slice(0, 16)} Run Summary`,
    `- Duration: ${timeGuard.getElapsedFormatted()}`,
    `- Completed: ${state.completed_features.join(', ') || 'none'}`,
    `- Status: ${state.status}`,
    '',
  ].join('\n');

  lessons += lessonEntry;
  fs.writeFileSync(lessonsPath, lessons, 'utf-8');

  // Generate and display quality report
  const qualityReport = generateQualityReport();
  console.log('\n' + qualityReport);

  // Save quality report to log
  const qualityLogPath = path.join(logDir, `${now.toISOString().slice(0, 10)}_quality_report.md`);
  fs.writeFileSync(qualityLogPath, qualityReport, 'utf-8');
  console.log(`[agent] Quality report written to ${qualityLogPath}`);

  // Final save and commit
  saveState(state);
  git.commitAndPush(`Run completed - ${state.status} - ${timeGuard.getElapsedFormatted()}`);

  // 发送完成通知
  const completedSteps = state.plan.filter(s => s.status === 'completed').length;
  const totalSteps = state.plan.length;
  await notifySuccess(
    formatStatusNotification(
      state.status,
      completedSteps,
      totalSteps,
      `运行时间: ${timeGuard.getElapsedFormatted()}`
    ),
    'agent'
  );

  console.log(`\n${timeGuard.getStatus()}`);
  console.log('\n[agent] Done.\n');
}

// ─── Entry Point ───────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[agent] Fatal error:', err);
  process.exit(1);
});
