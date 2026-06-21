/**
 * AgnesLoop State Management
 *
 * Handles state.json read/write with atomic saves,
 * state validation, and checkpoint/resume logic.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentState, PlanStep, RoleName, ReviewStatus } from './types.js';

const STATE_FILE = 'state.json';
const STATE_TMP_FILE = 'state.json.tmp';

// ─── Initial State Factory ─────────────────────────────────────────────────────

/** Create a fresh initial state from a goal */
export function createInitialState(goal: string, goalId: string): AgentState {
  return {
    goal,
    goal_id: goalId,
    status: 'in_progress',
    current_phase: 'planning',
    plan: [],
    current_step: 0,
    current_role: 'ceo',
    review_status: {
      total_reviews: 0,
      passed: 0,
      failed: 0,
      current_review: null,
    },
    value_added_tasks: [],
    completed_features: [],
    pending_features: [],
    last_run_at: new Date().toISOString(),
    total_runtime_minutes: 0,
    runs_count: 0,
    next_action: 'CEO reads GOAL.md and creates execution plan',
  };
}

// ─── Load State ────────────────────────────────────────────────────────────────

/** Load state from state.json, create initial if not exists */
export function loadState(goal?: string): AgentState {
  const statePath = path.resolve(STATE_FILE);

  if (fs.existsSync(statePath)) {
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(raw) as AgentState;

      // Validate required fields
      if (!validateState(state)) {
        console.warn('[state] Invalid state.json, creating fresh state');
        return createFreshState(goal);
      }

      console.log(`[state] Loaded state: step ${state.current_step}, role ${state.current_role}, status ${state.status}`);
      return state;
    } catch (err) {
      console.error('[state] Failed to parse state.json:', err);
      return createFreshState(goal);
    }
  }

  console.log('[state] No state.json found, creating initial state');
  return createFreshState(goal);
}

function createFreshState(goal?: string): AgentState {
  if (!goal) {
    // Try to read from GOAL.md
    const goalPath = path.resolve('GOAL.md');
    if (fs.existsSync(goalPath)) {
      goal = fs.readFileSync(goalPath, 'utf-8').trim();
    } else {
      goal = 'No goal defined. Please write GOAL.md.';
    }
  }
  const goalId = `goal-${Date.now()}`;
  return createInitialState(goal, goalId);
}

// ─── Save State ────────────────────────────────────────────────────────────────

/** Atomically save state to state.json (write tmp then rename) */
export function saveState(state: AgentState): void {
  const statePath = path.resolve(STATE_FILE);
  const tmpPath = path.resolve(STATE_TMP_FILE);

  // Update timestamp
  state.last_run_at = new Date().toISOString();

  const json = JSON.stringify(state, null, 2);

  try {
    // Write to tmp file first
    fs.writeFileSync(tmpPath, json, 'utf-8');

    // Atomic rename (on most systems)
    fs.renameSync(tmpPath, statePath);

    console.log(`[state] Saved state: step ${state.current_step}, role ${state.current_role}, status ${state.status}`);
  } catch (err) {
    console.error('[state] Failed to save state:', err);
    // Fallback: direct write
    try {
      fs.writeFileSync(statePath, json, 'utf-8');
      console.log('[state] Saved state via direct write (fallback)');
    } catch (fallbackErr) {
      console.error('[state] Critical: Failed to save state even with fallback:', fallbackErr);
      throw fallbackErr;
    }
  }
}

// ─── State Validation ──────────────────────────────────────────────────────────

/** Validate that a state object has all required fields */
function validateState(state: unknown): state is AgentState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;

  const requiredFields = [
    'goal', 'goal_id', 'status', 'current_phase',
    'plan', 'current_step', 'current_role',
  ];

  for (const field of requiredFields) {
    if (!(field in s)) {
      console.warn(`[state] Missing required field: ${field}`);
      return false;
    }
  }

  // Validate status
  const validStatuses = ['in_progress', 'paused', 'completed', 'blocked'];
  if (!validStatuses.includes(s.status as string)) {
    console.warn(`[state] Invalid status: ${s.status}`);
    return false;
  }

  // Validate phase
  const validPhases = ['planning', 'development', 'value_add', 'wrap_up'];
  if (!validPhases.includes(s.current_phase as string)) {
    console.warn(`[state] Invalid phase: ${s.current_phase}`);
    return false;
  }

  // Validate role
  const validRoles = ['ceo', 'architect', 'developer', 'reviewer', 'researcher'];
  if (!validRoles.includes(s.current_role as string)) {
    console.warn(`[state] Invalid role: ${s.current_role}`);
    return false;
  }

  // Validate plan is array
  if (!Array.isArray(s.plan)) {
    console.warn('[state] plan is not an array');
    return false;
  }

  return true;
}

// ─── State Mutations ───────────────────────────────────────────────────────────

/** Update a specific plan step's status */
export function updateStep(state: AgentState, stepNumber: number, status: PlanStep['status'], output?: string): void {
  const step = state.plan.find(s => s.step === stepNumber);
  if (!step) {
    console.warn(`[state] Step ${stepNumber} not found in plan`);
    return;
  }

  step.status = status;
  if (output !== undefined) {
    step.output = output;
  }

  if (status === 'blocked') {
    step.retries = (step.retries || 0) + 1;
  }

  console.log(`[state] Step ${stepNumber} updated to ${status}`);
}

/** Advance to the next pending step */
export function advanceToNextStep(state: AgentState): boolean {
  const nextStep = state.plan.find(s => s.status === 'pending');
  if (!nextStep) {
    // All steps completed - reset current_step to indicate no active step
    state.current_step = 0;
    state.next_action = 'All steps completed';
    console.log('[state] No more pending steps');
    return false; // No more steps
  }

  // Mark next step as in_progress
  nextStep.status = 'in_progress';
  state.current_step = nextStep.step;
  state.current_role = nextStep.role;
  state.next_action = `${nextStep.role} executes: ${nextStep.task}`;

  console.log(`[state] Advanced to step ${nextStep.step}: ${nextStep.task}`);
  return true;
}

/** Get the current step being executed */
export function getCurrentStep(state: AgentState): PlanStep | null {
  return state.plan.find(s => s.step === state.current_step) || null;
}

/** Mark current step as completed and advance */
export function completeCurrentStep(state: AgentState, output?: string): boolean {
  const currentStep = getCurrentStep(state);
  if (!currentStep) return false;

  updateStep(state, currentStep.step, 'completed', output);
  state.completed_features.push(currentStep.task);

  return advanceToNextStep(state);
}

/** Transition to a new phase */
export function transitionPhase(state: AgentState, phase: AgentState['current_phase']): void {
  state.current_phase = phase;
  console.log(`[state] Phase transitioned to: ${phase}`);
}

/** Set the current role */
export function setCurrentRole(state: AgentState, role: RoleName): void {
  state.current_role = role;
  state.next_action = `${role} is now active`;
  console.log(`[state] Current role set to: ${role}`);
}

/** Pause the agent */
export function pauseState(state: AgentState, reason: string): void {
  state.status = 'paused';
  state.next_action = `Paused: ${reason}`;
  console.log(`[state] Agent paused: ${reason}`);
}

/** Resume the agent */
export function resumeState(state: AgentState): void {
  state.status = 'in_progress';
  state.runs_count += 1;
  console.log(`[state] Agent resumed (run #${state.runs_count})`);
}

/** Get a compact state summary for LLM context (avoid sending full state) */
export function getStateSummary(state: AgentState): string {
  const currentStep = getCurrentStep(state);
  const completedCount = state.plan.filter(s => s.status === 'completed').length;
  const totalCount = state.plan.length;

  return [
    `Goal: ${state.goal}`,
    `Status: ${state.status}`,
    `Phase: ${state.current_phase}`,
    `Current Role: ${state.current_role}`,
    `Progress: ${completedCount}/${totalCount} steps completed`,
    currentStep ? `Current Step: [${currentStep.step}] ${currentStep.task} (${currentStep.status})` : 'No active step',
    `Next Action: ${state.next_action}`,
    `Completed Features: ${state.completed_features.join(', ') || 'none'}`,
    `Runs: ${state.runs_count}, Total Runtime: ${state.total_runtime_minutes} min`,
  ].join('\n');
}
