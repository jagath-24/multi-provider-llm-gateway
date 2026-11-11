import type { CircuitState } from "@shared/gateway";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  private threshold: number;
  private recoveryMs: number;

  constructor(threshold = 3, recoverySeconds = 30) {
    this.threshold = threshold;
    this.recoveryMs = recoverySeconds * 1000;
  }

  configure(threshold: number, recoverySeconds: number) {
    this.threshold = Math.max(1, threshold);
    this.recoveryMs = Math.max(1, recoverySeconds) * 1000;
  }

  allowRequest(now = Date.now()) {
    if (this.state !== "OPEN") return true;
    if (now - this.openedAt >= this.recoveryMs) {
      this.state = "HALF_OPEN";
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.state = "CLOSED";
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "OPEN";
      this.openedAt = now;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount() {
    return this.failures;
  }
}
