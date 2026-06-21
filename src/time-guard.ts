/**
 * AgnesLoop Time Management
 *
 * Four-layer time control:
 * 1. GitHub hard limit (180 min) - enforced by Actions
 * 2. Script soft limit (170 min) - agent self-check
 * 3. Periodic save (15 min) - auto save state + commit
 * 4. Emergency exit (175 min) - stop immediately, save, exit
 */

export interface TimeGuardConfig {
  softLimitMinutes: number;       // 170
  emergencyLimitMinutes: number;  // 175
  periodicSaveMinutes: number;    // 15
  githubHardLimitMinutes: number; // 180
}

const DEFAULT_CONFIG: TimeGuardConfig = {
  softLimitMinutes: 170,
  emergencyLimitMinutes: 175,
  periodicSaveMinutes: 15,
  githubHardLimitMinutes: 180,
};

export class TimeGuard {
  private startTime: number;
  private lastSaveTime: number;
  private config: TimeGuardConfig;

  constructor(config?: Partial<TimeGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
    this.lastSaveTime = Date.now();
  }

  /** Check if we should continue running (soft limit not exceeded) */
  shouldContinue(): boolean {
    return this.getElapsedMinutes() < this.config.softLimitMinutes;
  }

  /** Check if we're in emergency zone (need to stop NOW) */
  isEmergency(): boolean {
    return this.getElapsedMinutes() >= this.config.emergencyLimitMinutes;
  }

  /** Check if it's time for a periodic save */
  timeForPeriodicSave(): boolean {
    const minutesSinceLastSave = (Date.now() - this.lastSaveTime) / (1000 * 60);
    return minutesSinceLastSave >= this.config.periodicSaveMinutes;
  }

  /** Mark that a save was just performed */
  markSave(): void {
    this.lastSaveTime = Date.now();
  }

  /** Get elapsed time in minutes */
  getElapsedMinutes(): number {
    return (Date.now() - this.startTime) / (1000 * 60);
  }

  /** Get elapsed time formatted as HH:MM */
  getElapsedFormatted(): string {
    const minutes = Math.floor(this.getElapsedMinutes());
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /** Get remaining time in minutes before soft limit */
  getRemainingMinutes(): number {
    return Math.max(0, this.config.softLimitMinutes - this.getElapsedMinutes());
  }

  /** Get a status summary string */
  getStatus(): string {
    const elapsed = this.getElapsedFormatted();
    const remaining = Math.floor(this.getRemainingMinutes());

    if (this.isEmergency()) {
      return `⚠️  EMERGENCY: ${elapsed} elapsed, MUST STOP NOW`;
    }
    if (!this.shouldContinue()) {
      return `⏰ Soft limit reached: ${elapsed} elapsed, saving and stopping`;
    }
    return `⏱️  Running: ${elapsed} elapsed, ${remaining} min remaining`;
  }
}
