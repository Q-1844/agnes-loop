/**
 * AgnesLoop Tool System
 *
 * Tool registration, permission control, and core tool implementations.
 * Each tool has a handler, definition, and role-based access control.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolDefinition, ToolResult, ToolHandler, RegisteredTool, RoleName } from './types.js';

// ─── Tool Registry ─────────────────────────────────────────────────────────────

const registry = new Map<string, RegisteredTool>();

/** Register a tool */
export function registerTool(
  name: string,
  description: string,
  parameters: ToolDefinition['function']['parameters'],
  handler: ToolHandler,
  allowedRoles: RoleName[] = ['ceo', 'architect', 'developer', 'reviewer', 'researcher'],
): void {
  registry.set(name, {
    definition: {
      type: 'function',
      function: {
        name,
        description,
        parameters,
      },
    },
    handler,
    allowedRoles,
  });
  console.log(`[tools] Registered tool: ${name} (roles: ${allowedRoles.join(', ')})`);
}

/** Get tool definitions for a specific role */
export function getToolsForRole(role: RoleName): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const [, tool] of registry) {
    if (tool.allowedRoles.includes(role)) {
      tools.push(tool.definition);
    }
  }
  return tools;
}

/** Execute a tool call */
export async function executeTool(
  name: string,
  params: Record<string, unknown>,
  role: RoleName,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: ${name}` };
  }

  if (!tool.allowedRoles.includes(role)) {
    return { success: false, output: '', error: `Role ${role} is not allowed to use tool ${name}` };
  }

  try {
    console.log(`[tools] Executing ${name} as ${role}`);
    const result = await tool.handler(params);
    console.log(`[tools] ${name} ${result.success ? 'succeeded' : 'failed'}`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[tools] ${name} error:`, errorMsg);
    return { success: false, output: '', error: errorMsg };
  }
}

// ─── Core Tool Implementations ─────────────────────────────────────────────────

/** Safely resolve a file path, preventing directory traversal */
function safePath(filePath: string, allowedRoot?: string): string {
  const resolved = path.resolve(filePath);
  if (allowedRoot) {
    const rootResolved = path.resolve(allowedRoot) + path.sep;
    if (!resolved.startsWith(rootResolved)) {
      throw new Error(`Path traversal detected: ${filePath} is outside ${allowedRoot}`);
    }
  }
  return resolved;
}

function registerCoreTools(): void {
  // ── file_read ──────────────────────────────────────────────────────────────
  registerTool(
    'file_read',
    'Read a file or directory listing. For files, returns content with line numbers. For directories, returns listing.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path to read' },
        start_line: { type: 'number', description: 'Start line number (1-based, optional)' },
        count: { type: 'number', description: 'Number of lines to read (optional)' },
      },
      required: ['path'],
    },
    async (params) => {
      const filePath = safePath(params.path as string);

      if (!fs.existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }

      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath);
        const listing = entries.map(e => {
          const s = fs.statSync(path.join(filePath, e));
          return `${s.isDirectory() ? 'd' : 'f'}  ${e}`;
        }).join('\n');
        return { success: true, output: `Directory: ${filePath}\n${listing}` };
      }

      let content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const startLine = (params.start_line as number) || 1;
      const count = (params.count as number) || lines.length;
      const selected = lines.slice(startLine - 1, startLine - 1 + count);

      const numbered = selected.map((line, i) => `${startLine + i}\t${line}`).join('\n');
      return { success: true, output: numbered };
    },
    ['ceo', 'architect', 'developer', 'reviewer', 'researcher'],
  );

  // ── file_write ─────────────────────────────────────────────────────────────
  registerTool(
    'file_write',
    'Create or overwrite a file with the given content. Creates parent directories if needed.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', description: 'If true, append to file instead of overwriting' },
      },
      required: ['path', 'content'],
    },
    async (params) => {
      const filePath = safePath(params.path as string);
      const content = params.content as string;
      const append = params.append as boolean || false;

      // Create parent directory if needed
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (append) {
        fs.appendFileSync(filePath, content, 'utf-8');
      } else {
        fs.writeFileSync(filePath, content, 'utf-8');
      }

      return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
    },
    ['ceo', 'architect', 'developer', 'researcher'],
  );

  // ── file_patch ─────────────────────────────────────────────────────────────
  registerTool(
    'file_patch',
    'Replace a unique string in a file. The old_content must match exactly once.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to patch' },
        old_content: { type: 'string', description: 'Exact string to find (must be unique)' },
        new_content: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_content', 'new_content'],
    },
    async (params) => {
      const filePath = safePath(params.path as string);
      const oldContent = params.old_content as string;
      const newContent = params.new_content as string;

      if (!fs.existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const count = content.split(oldContent).length - 1;

      if (count === 0) {
        return { success: false, output: '', error: 'old_content not found in file' };
      }
      if (count > 1) {
        return { success: false, output: '', error: `old_content found ${count} times (must be unique)` };
      }

      const patched = content.replace(oldContent, newContent);
      fs.writeFileSync(filePath, patched, 'utf-8');

      return { success: true, output: `Patched ${filePath}: replaced ${oldContent.length} chars with ${newContent.length} chars` };
    },
    ['developer'],
  );

  // ── code_run ───────────────────────────────────────────────────────────────
  registerTool(
    'code_run',
    'Execute a shell command or code snippet. Returns stdout, stderr, and exit code.',
    {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
    async (params) => {
      const command = params.command as string;
      const cwd = (params.cwd as string) || process.cwd();
      const timeout = (params.timeout as number) || 30_000;

      try {
        const output = execSync(command, {
          cwd,
          timeout,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024, // 1MB
        });
        return { success: true, output };
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string; stderr?: string };
        return {
          success: false,
          output: execErr.stdout || '',
          error: `Exit code ${execErr.status}: ${execErr.stderr || ''}`,
        };
      }
    },
    ['developer', 'reviewer'],
  );

  // ── terminal ───────────────────────────────────────────────────────────────
  registerTool(
    'terminal',
    'Execute a terminal command (alias for code_run with different permissions).',
    {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
    async (params) => {
      // Delegate to code_run handler
      const codeRunTool = registry.get('code_run');
      if (!codeRunTool) {
        return { success: false, output: '', error: 'code_run tool not available' };
      }
      return codeRunTool.handler(params);
    },
    ['developer', 'reviewer'],
  );

  // ── web_search (placeholder) ───────────────────────────────────────────────
  registerTool(
    'web_search',
    'Search the web for information. Returns mock results (placeholder implementation).',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async (params) => {
      const query = params.query as string;
      // Placeholder: return mock results
      return {
        success: true,
        output: [
          `[web_search] Query: "${query}"`,
          '[web_search] Note: This is a placeholder implementation.',
          '[web_search] Results:',
          '1. [Mock Result] Example article about ' + query,
          '   URL: https://example.com/article-1',
          '2. [Mock Result] Documentation for ' + query,
          '   URL: https://docs.example.com/' + query.toLowerCase().replace(/\s+/g, '-'),
          '3. [Mock Result] Stack Overflow discussion about ' + query,
          '   URL: https://stackoverflow.com/questions/mock',
        ].join('\n'),
      };
    },
    ['ceo', 'researcher'],
  );

  // ── web_fetch ──────────────────────────────────────────────────────────────
  registerTool(
    'web_fetch',
    'Fetch content from a URL. Returns the page content as text.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
    async (params) => {
      const url = params.url as string;
      // Placeholder implementation
      return {
        success: true,
        output: `[web_fetch] Fetched: ${url}\n[web_fetch] Note: Full HTTP fetch not yet implemented. This is a placeholder.`,
      };
    },
    ['researcher'],
  );

  // ── review_submit ──────────────────────────────────────────────────────────
  registerTool(
    'review_submit',
    'Submit a review result for the current step. Updates REVIEW_LOG.json and state.json.',
    {
      type: 'object',
      properties: {
        step: { type: 'number', description: 'Step number being reviewed' },
        result: { type: 'string', enum: ['PASS', 'FAIL'], description: 'Review result' },
        summary: { type: 'string', description: 'Review summary' },
        failed_checks: { type: 'array', description: 'List of failed checks' },
        passed_checks: { type: 'array', description: 'List of passed checks' },
      },
      required: ['step', 'result'],
    },
    async (params) => {
      const reviewLogPath = path.resolve('REVIEW_LOG.json');
      let reviews: unknown[] = [];

      if (fs.existsSync(reviewLogPath)) {
        try {
          reviews = JSON.parse(fs.readFileSync(reviewLogPath, 'utf-8'));
        } catch { reviews = []; }
      }

      const review = {
        review_id: `review-${Date.now()}`,
        step: params.step,
        timestamp: new Date().toISOString(),
        result: params.result,
        summary: params.summary || '',
        failed_checks: params.failed_checks || [],
        passed_checks: params.passed_checks || [],
      };

      reviews.push(review);
      fs.writeFileSync(reviewLogPath, JSON.stringify(reviews, null, 2), 'utf-8');

      return {
        success: true,
        output: `Review submitted: step ${params.step} → ${params.result}`,
      };
    },
    ['reviewer'],
  );

  // ── idea_submit ────────────────────────────────────────────────────────────
  registerTool(
    'idea_submit',
    'Submit value-add ideas to IDEAS.md.',
    {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              description: { type: 'string' },
            },
          },
          description: 'List of value-add ideas',
        },
      },
      required: ['ideas'],
    },
    async (params) => {
      const ideas = params.ideas as Array<{ name: string; priority: string; description: string }>;
      const ideasPath = path.resolve('IDEAS.md');

      let content = '';
      if (fs.existsSync(ideasPath)) {
        content = fs.readFileSync(ideasPath, 'utf-8');
      } else {
        content = '# Value-Add Ideas\n\n';
      }

      content += `\n## ${new Date().toISOString()}\n\n`;
      for (const idea of ideas) {
        content += `- **${idea.name}** [${idea.priority}]: ${idea.description}\n`;
      }

      fs.writeFileSync(ideasPath, content, 'utf-8');
      return { success: true, output: `Submitted ${ideas.length} ideas to IDEAS.md` };
    },
    ['researcher'],
  );
}

// ─── Initialize ────────────────────────────────────────────────────────────────

registerCoreTools();
