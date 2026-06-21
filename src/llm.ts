/**
 * AgnesLoop LLM Client
 *
 * OpenAI-compatible API client with function calling support.
 * Handles token estimation and context window management.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Token estimation and context truncation
 * - Support for thinking mode (Agnes 2.0 Flash)
 */

import * as https from 'node:https';
import * as http from 'node:http';
import type { ChatMessage, ToolDefinition, LLMResponse, LLMConfig } from './types.js';
import { withLLMRetry } from './retry.js';

// ─── Default Config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'openai-compatible',
  base_url: 'https://apihub.agnes-ai.com/v1',
  model: 'agnes-2.0-flash',
  max_tokens: 4096,
  temperature: 0.7,
  api_key: process.env.AGNES_API_KEY || '',
};

// Agnes 2.0 Flash supports 256K context, but we budget conservatively
const MAX_CONTEXT_TOKENS = 200000;
const CHARS_PER_TOKEN = 3.5; // Rough estimate for mixed CJK/English

// ─── Token Estimation ──────────────────────────────────────────────────────────

/** Estimate token count for a string (rough heuristic) */
export function estimateTokens(text: string): number {
  // CJK characters ~1.5 tokens each, ASCII ~0.25 tokens per char
  let count = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x2E80) {
      // CJK range
      count += 1.5;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

/** Estimate total tokens for a message array */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // message overhead
    total += estimateTokens(msg.content || '');
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.arguments);
      }
    }
  }
  return total;
}

// ─── Context Truncation ────────────────────────────────────────────────────────

/** Truncate messages to fit within token budget */
export function truncateMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  const result: ChatMessage[] = [];
  let totalTokens = 0;

  // Always keep system message
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    result.push(systemMsg);
    totalTokens += estimateTokens(systemMsg.content || '') + 4;
  }

  // Add messages from newest to oldest until budget
  const nonSystem = messages.filter(m => m.role !== 'system');
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msg = nonSystem[i];
    const msgTokens = estimateTokens(msg.content || '') + 4;
    if (totalTokens + msgTokens > maxTokens) break;
    result.splice(result.length > 0 ? 1 : 0, 0, msg);
    totalTokens += msgTokens;
  }

  return result;
}

// ─── HTTP Request Helper ───────────────────────────────────────────────────────

interface HTTPResponse {
  statusCode: number;
  body: string;
}

function httpRequest(url: string, options: https.RequestOptions, body?: string): Promise<HTTPResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: data,
        });
      });
    });

    req.on('error', reject);
    // Agent tasks can take longer - 5 minute timeout
    req.setTimeout(300_000, () => {
      req.destroy(new Error('Request timeout (300s)'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ─── LLM Client ────────────────────────────────────────────────────────────────

export class LLMClient {
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.api_key) {
      console.warn('[llm] No API key configured. Set AGNES_API_KEY environment variable.');
    }
  }

  /** Send a chat completion request with automatic retry */
  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<LLMResponse> {
    // Truncate if needed
    const truncated = truncateMessages(messages, MAX_CONTEXT_TOKENS - this.config.max_tokens);

    const estimatedInput = estimateMessagesTokens(truncated);
    console.log(`[llm] Sending request: ${truncated.length} messages, ~${estimatedInput} input tokens`);

    // Build request body
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: truncated,
      max_tokens: this.config.max_tokens,
      temperature: this.config.temperature,
    };

    // Enable thinking mode for better agent performance (coding, reasoning, agent workflows)
    if (this.config.enable_thinking) {
      body.chat_template_kwargs = { enable_thinking: true };
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // Make request with retry
    const url = `${this.config.base_url}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.api_key}`,
    };

    try {
      // Use retry mechanism for the HTTP request
      const response = await withLLMRetry(
        () => httpRequest(url, { method: 'POST', headers }, JSON.stringify(body)),
        {
          maxRetries: 5,
          baseDelay: 2000,
          maxDelay: 60000,
          verbose: true
        }
      );

      if (response.statusCode !== 200) {
        const errorMsg = `LLM API returned ${response.statusCode}: ${response.body}`;
        console.error(`[llm] ❌ API error: ${response.statusCode}`, response.body.slice(0, 200));
        throw new Error(errorMsg);
      }

      const data = JSON.parse(response.body);
      const result = this.parseResponse(data);

      // Log token usage
      console.log(
        `[llm] ✅ Response received: ` +
        `${result.usage.input_tokens} input + ${result.usage.output_tokens} output tokens`
      );

      return result;
    } catch (err) {
      console.error('[llm] ❌ Request failed after retries:', err);
      throw err;
    }
  }

  /** Parse OpenAI-compatible response */
  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) {
      throw new Error('No choices in LLM response');
    }

    const choice = choices[0];
    const message = choice.message as Record<string, unknown>;

    const usage = data.usage as Record<string, number> | undefined;

    return {
      content: (message.content as string) || '',
      tool_calls: (message.tool_calls as LLMResponse['tool_calls']) || [],
      usage: {
        input_tokens: usage?.prompt_tokens || 0,
        output_tokens: usage?.completion_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
      },
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let defaultClient: LLMClient | null = null;

/** Get or create the default LLM client */
export function getLLMClient(config?: Partial<LLMConfig>): LLMClient {
  if (!defaultClient || config) {
    defaultClient = new LLMClient(config);
  }
  return defaultClient;
}
