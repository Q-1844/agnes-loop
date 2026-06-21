/**
 * AgnesLoop Role System
 *
 * Role prompt loading, context building, and role dispatch.
 * Each role is an independent LLM call with its own system prompt and tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RoleName, RoleContext, ChatMessage, LLMResponse, AgentState, ToolCall } from './types.js';
import { getLLMClient, estimateTokens } from './llm.js';
import { getToolsForRole, executeTool } from './tools.js';
import { getStateSummary, getCurrentStep } from './state.js';

// ─── Role Prompt Loading ───────────────────────────────────────────────────────

/** Load role system prompt from roles/{role}.md */
export function loadRolePrompt(role: RoleName): string {
  const promptPath = path.resolve('roles', `${role}.md`);

  if (!fs.existsSync(promptPath)) {
    console.warn(`[roles] Role prompt not found: ${promptPath}, using default`);
    return getDefaultPrompt(role);
  }

  return fs.readFileSync(promptPath, 'utf-8');
}

/** Default prompts if role files don't exist */
function getDefaultPrompt(role: RoleName): string {
  const defaults: Record<RoleName, string> = {
    ceo: `You are the CEO (Chief Executive Agent) of AgnesLoop.
Your job: Read GOAL.md → decompose into steps → write PLAN.md → assign roles.
You do NOT write code. You make decisions and create plans.
Output format: Write your plan to PLAN.md using the file_write tool.`,
    architect: `You are the Architect of AgnesLoop.
Your job: Read PLAN.md → design technical solution → write ARCHITECTURE.md.
You define interfaces, data structures, and technical approach.
You do NOT write implementation code. You design.`,
    developer: `You are the Developer of AgnesLoop.
Your job: Read ARCHITECTURE.md + current step → write code → self-test.
You implement according to the architect's design.
Output: Write code files using file_write/file_patch tools. Run tests with code_run.`,
    reviewer: `You are the Reviewer of AgnesLoop.
Your job: Read REVIEW_CRITERIA.json → execute checks → submit review result.
You execute mechanical checks (shell commands). You do NOT fix code.
Output: Submit review using review_submit tool.`,
    researcher: `You are the Researcher of AgnesLoop.
Your job: Analyze current project → search for improvements → submit ideas.
You are only active when all main tasks are complete.
Output: Submit ideas using idea_submit tool.`,
  };
  return defaults[role];
}

// ─── Context Building ──────────────────────────────────────────────────────────

/** Build context for a role execution */
export function buildRoleContext(
  role: RoleName,
  state: AgentState,
  extraContext?: Record<string, unknown>,
): RoleContext {
  // Read LESSONS.md (last 5 entries)
  let lessons = 'No lessons yet.';
  const lessonsPath = path.resolve('LESSONS.md');
  if (fs.existsSync(lessonsPath)) {
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    // Get last 5 sections (## headers)
    const sections = content.split(/^## /m).filter(Boolean);
    lessons = sections.slice(-5).map(s => `## ${s}`).join('\n');
  }

  // Build role-specific context
  const roleSpecific: Record<string, unknown> = {};

  const currentStep = getCurrentStep(state);

  switch (role) {
    case 'ceo':
      roleSpecific.instruction = 'Read GOAL.md and create an execution plan in PLAN.md';
      roleSpecific.goal_file = 'GOAL.md';
      roleSpecific.output_file = 'PLAN.md';
      if (currentStep) {
        roleSpecific.current_task = currentStep.task;
      }
      break;

    case 'architect':
      roleSpecific.instruction = 'Read PLAN.md and design the technical architecture in ARCHITECTURE.md';
      roleSpecific.plan_file = 'PLAN.md';
      roleSpecific.output_file = 'ARCHITECTURE.md';
      if (currentStep) {
        roleSpecific.current_task = currentStep.task;
      }
      break;

    case 'developer':
      roleSpecific.instruction = 'Implement the current step according to ARCHITECTURE.md';
      roleSpecific.architecture_file = 'ARCHITECTURE.md';
      if (currentStep) {
        roleSpecific.current_step = currentStep;
        roleSpecific.task = currentStep.task;
      }
      break;

    case 'reviewer':
      roleSpecific.instruction = 'Execute review checks and submit result';
      roleSpecific.review_criteria_file = 'REVIEW_CRITERIA.json';
      if (currentStep) {
        roleSpecific.step_to_review = currentStep;
        roleSpecific.step_output = currentStep.output;
      }
      break;

    case 'researcher':
      roleSpecific.instruction = 'Analyze project and suggest value-add features';
      roleSpecific.completed_features = state.completed_features;
      roleSpecific.pending_features = state.pending_features;
      break;
  }

  if (extraContext) {
    Object.assign(roleSpecific, extraContext);
  }

  return {
    goal: state.goal,
    state_summary: getStateSummary(state),
    lessons,
    role_specific: roleSpecific,
  };
}

/** Format context into a user message */
function formatContextMessage(context: RoleContext): string {
  const parts: string[] = [
    '## Current Context',
    '',
    `### Goal\n${context.goal}`,
    '',
    `### State\n${context.state_summary}`,
    '',
    `### Recent Lessons\n${context.lessons}`,
    '',
  ];

  if (context.role_specific && Object.keys(context.role_specific).length > 0) {
    parts.push('### Task-Specific Context');
    parts.push('```json');
    parts.push(JSON.stringify(context.role_specific, null, 2));
    parts.push('```');
  }

  return parts.join('\n');
}

// ─── Role Dispatch ─────────────────────────────────────────────────────────────

/** Maximum tool call rounds per role execution */
const MAX_TOOL_ROUNDS = 15;

/** Dispatch a role: build context → call LLM → handle tool calls → repeat */
export async function dispatchRole(
  role: RoleName,
  state: AgentState,
  extraContext?: Record<string, unknown>,
): Promise<{ response: LLMResponse; toolCallsMade: number }> {
  const client = getLLMClient();
  const systemPrompt = loadRolePrompt(role);
  const context = buildRoleContext(role, state, extraContext);
  const contextMessage = formatContextMessage(context);
  const tools = getToolsForRole(role);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[roles] Dispatching role: ${role}`);
  console.log(`[roles] Tools available: ${tools.map(t => t.function.name).join(', ')}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextMessage },
  ];

  let totalToolCalls = 0;
  let lastResponse: LLMResponse | null = null;

  // Tool call loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat(messages, tools.length > 0 ? tools : undefined);
    lastResponse = response;

    console.log(`[roles] Round ${round + 1}: ${response.usage.total_tokens} tokens`);

    // If no tool calls, we're done
    if (!response.tool_calls || response.tool_calls.length === 0) {
      if (response.content) {
        console.log(`[roles] ${role} output:\n${response.content.slice(0, 500)}${response.content.length > 500 ? '...' : ''}`);
      }
      break;
    }

    // Process tool calls
    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls,
    });

    // Execute each tool call
    for (const toolCall of response.tool_calls) {
      totalToolCalls++;
      const params = JSON.parse(toolCall.function.arguments);
      const result = await executeTool(toolCall.function.name, params, role);

      // Add tool result message
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.success ? result.output : `Error: ${result.error}`,
      });
    }
  }

  if (!lastResponse) {
    throw new Error(`No response from ${role}`);
  }

  console.log(`[roles] ${role} completed: ${totalToolCalls} tool calls made`);
  return { response: lastResponse, toolCallsMade: totalToolCalls };
}

/** Check if a role has pending work in the current state */
export function hasRoleWork(role: RoleName, state: AgentState): boolean {
  switch (role) {
    case 'ceo':
      return state.current_phase === 'planning' && state.plan.length === 0;
    case 'architect':
      return state.current_phase === 'planning' && state.plan.length > 0;
    case 'developer': {
      const step = getCurrentStep(state);
      return step !== null && (step.status === 'pending' || step.status === 'blocked');
    }
    case 'reviewer': {
      const step = getCurrentStep(state);
      return step !== null && step.status === 'reviewing';
    }
    case 'researcher':
      return state.current_phase === 'value_add';
    default:
      return false;
  }
}
