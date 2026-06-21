/**
 * AgnesLoop Core Type Definitions
 *
 * All shared types for the 24-hour autonomous AI agent system.
 */

// ─── Role System ───────────────────────────────────────────────────────────────

/** Five roles in the one-person company model */
export type RoleName = 'ceo' | 'architect' | 'developer' | 'reviewer' | 'researcher';

/** Role execution phases */
export type AgentPhase = 'planning' | 'development' | 'value_add' | 'wrap_up';

// ─── Plan & Steps ──────────────────────────────────────────────────────────────

/** A single step in the execution plan */
export interface PlanStep {
  step: number;
  task: string;
  role: RoleName;
  status: 'pending' | 'in_progress' | 'reviewing' | 'completed' | 'blocked';
  output: string | null;
  retries: number;
}

// ─── Review System ─────────────────────────────────────────────────────────────

/** Review status summary */
export interface ReviewStatus {
  total_reviews: number;
  passed: number;
  failed: number;
  current_review: string | null;
}

/** A single check item in review criteria */
export interface ReviewCheck {
  id: string;
  description: string;
  execute: string;  // shell command or '__LLM_CHECK__'
  pass_condition: string;
  fail_message: string;
  llm_check_prompt?: string;
}

/** A review dimension (e.g., correctness, security) */
export interface ReviewDimension {
  name: string;
  severity: 'blocker' | 'warning' | 'suggestion';
  checks: ReviewCheck[];
}

/** Review criteria file structure */
export interface ReviewCriteria {
  task_id: string;
  created_at: string;
  dimensions: ReviewDimension[];
  pass_condition: string;
  max_retries: number;
}

/** Result of a single check */
export interface CheckResult {
  check_id: string;
  dimension: string;
  description: string;
  method: 'shell_command' | 'llm_check';
  command?: string;
  exit_code?: number;
  output?: string;
  result: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
  evidence: string;
  fix_suggestion?: string;
}

/** Complete review result */
export interface ReviewResult {
  review_id: string;
  step: number;
  timestamp: string;
  result: 'PASS' | 'FAIL';
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
    blocker_failures: number;
    warning_failures: number;
  };
  failed_checks: CheckResult[];
  passed_checks: CheckResult[];
}

// ─── Value-Add System ──────────────────────────────────────────────────────────

/** A value-add task from checklists */
export interface ValueTask {
  id: string;
  name: string;
  priority: 'high' | 'medium' | 'low';
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Value-add checklist file */
export interface ValueChecklist {
  [category: string]: ValueTask[];
}

// ─── Agent State ───────────────────────────────────────────────────────────────

/** The core state persisted in state.json */
export interface AgentState {
  goal: string;
  goal_id: string;
  status: 'in_progress' | 'paused' | 'completed' | 'blocked';
  current_phase: AgentPhase;
  plan: PlanStep[];
  current_step: number;
  current_role: RoleName;
  review_status: ReviewStatus;
  value_added_tasks: ValueTask[];
  completed_features: string[];
  pending_features: string[];
  last_run_at: string;
  total_runtime_minutes: number;
  runs_count: number;
  next_action: string;
}

// ─── LLM Client ────────────────────────────────────────────────────────────────

/** Message in OpenAI-compatible chat format */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Tool call from LLM */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Tool definition for function calling */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** LLM API response */
export interface LLMResponse {
  content: string;
  tool_calls: ToolCall[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/** LLM client configuration */
export interface LLMConfig {
  provider: 'openai-compatible';
  base_url: string;
  model: string;
  max_tokens: number;
  temperature: number;
  api_key: string;
  enable_thinking?: boolean;  // Enable Agnes thinking mode for better agent performance
}

// ─── Role Context ──────────────────────────────────────────────────────────────

/** Context passed to a role when dispatched */
export interface RoleContext {
  goal: string;
  state_summary: string;
  lessons: string;
  role_specific: Record<string, unknown>;
}

/** A complete role call specification */
export interface RoleCall {
  role: RoleName;
  systemPrompt: string;
  context: RoleContext;
  tools: ToolDefinition[];
}

// ─── Tool Execution ────────────────────────────────────────────────────────────

/** Tool execution result */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Tool handler function */
export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

/** Registered tool with handler */
export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  allowedRoles: RoleName[];
}

// ─── Git Operations ────────────────────────────────────────────────────────────

/** Git configuration */
export interface GitConfig {
  auto_commit: boolean;
  commit_user_name: string;
  commit_user_email: string;
}

// ─── Schedule ──────────────────────────────────────────────────────────────────

/** Resume schedule file (schedule.json) */
export interface ScheduleFile {
  next_run_at: string;
  reason: string;
  created_at: string;
}
