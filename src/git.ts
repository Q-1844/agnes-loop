/**
 * AgnesLoop Git Operations
 *
 * Auto-commit, push, and pull with retry logic.
 * All state updates use [skip ci] to prevent recursive triggers.
 */

import { execSync } from 'node:child_process';

export interface GitConfig {
  auto_commit: boolean;
  commit_user_name: string;
  commit_user_email: string;
}

const DEFAULT_GIT_CONFIG: GitConfig = {
  auto_commit: true,
  commit_user_name: 'AgnesLoop Bot',
  commit_user_email: 'bot@agnesloop.local',
};

function runGit(command: string): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(`git ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string };
    return {
      success: false,
      output: execErr.stdout || '',
      error: `git ${command} failed (${execErr.status}): ${execErr.stderr || ''}`,
    };
  }
}

export class GitOps {
  private config: GitConfig;

  constructor(config?: Partial<GitConfig>) {
    this.config = { ...DEFAULT_GIT_CONFIG, ...config };
  }

  /** Initialize git user config (for CI environments) */
  initConfig(): void {
    runGit(`config user.name "${this.config.commit_user_name}"`);
    runGit(`config user.email "${this.config.commit_user_email}"`);
  }

  /** Check if there are uncommitted changes */
  hasChanges(): boolean {
    const result = runGit('status --porcelain');
    return result.success && result.output.length > 0;
  }

  /** Stage all changes and commit with [skip ci] marker */
  commitState(message: string): boolean {
    if (!this.config.auto_commit) return false;

    runGit('add -A');

    if (!this.hasChanges()) {
      console.log('[git] No changes to commit');
      return false;
    }

    const commitMsg = `state: ${message} [skip ci]`;
    const result = runGit(`commit -m "${commitMsg}"`);

    if (result.success) {
      console.log(`[git] Committed: ${commitMsg}`);
      return true;
    } else {
      console.error('[git] Commit failed:', result.error);
      return false;
    }
  }

  /** Commit code changes (without [skip ci]) */
  commitCode(message: string): boolean {
    runGit('add -A');

    if (!this.hasChanges()) {
      console.log('[git] No code changes to commit');
      return false;
    }

    const result = runGit(`commit -m "${message}"`);

    if (result.success) {
      console.log(`[git] Committed code: ${message}`);
      return true;
    } else {
      console.error('[git] Code commit failed:', result.error);
      return false;
    }
  }

  /** Push to remote with retry */
  push(maxRetries: number = 3): boolean {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = runGit('push');
      if (result.success) {
        console.log('[git] Pushed successfully');
        return true;
      }

      console.warn(`[git] Push attempt ${attempt}/${maxRetries} failed: ${result.error}`);

      if (attempt < maxRetries) {
        // Try pull --rebase and retry
        console.log('[git] Attempting pull --rebase...');
        runGit('pull --rebase');
      }
    }

    console.error('[git] Push failed after all retries');
    return false;
  }

  /** Pull with rebase (for resuming after remote changes) */
  pull(): boolean {
    const result = runGit('pull --rebase');
    if (result.success) {
      console.log('[git] Pulled successfully');
      return true;
    }
    console.error('[git] Pull failed:', result.error);
    return false;
  }

  /** Full commit-and-push cycle */
  commitAndPush(message: string, isState: boolean = true): boolean {
    const committed = isState
      ? this.commitState(message)
      : this.commitCode(message);

    if (!committed) return false;
    return this.push();
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let defaultGitOps: GitOps | null = null;

export function getGitOps(config?: Partial<GitConfig>): GitOps {
  if (!defaultGitOps || config) {
    defaultGitOps = new GitOps(config);
  }
  return defaultGitOps;
}
