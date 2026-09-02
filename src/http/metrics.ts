// Phase F — request metrics for the SLO surfaces (DECISIONS_PHASE_F_G.md F7).
//
// The cancel surface is the project's highest SLO (DECISIONS.md 6.1), and
// "highest SLO" is meaningless without measurement. A `RequestMetrics` sink
// receives one operational record per request — path, method, status, duration —
// and NOTHING else: never a token, a code, content, or an account identifier
// (invariant 6; DECISIONS.md 5.3). The query string (which carries the cancel
// token as `?t=`) is deliberately excluded; only the pathname is recorded.
//
// A production sink ships these to the ops alerting path so a cancel that errors
// or slows pages the team. `RecordingRequestMetrics` is an in-memory sink for
// tests.

export interface RequestMetric {
  readonly path: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
  readonly at: number;
}

export interface RequestMetrics {
  record(metric: RequestMetric): void;
}

export class RecordingRequestMetrics implements RequestMetrics {
  readonly metrics: RequestMetric[] = [];
  record(metric: RequestMetric): void {
    this.metrics.push(metric);
  }
}

export interface LoggingRequestMetricsOptions {
  /** A prefix identifying which server emitted this (e.g. "cancel"). */
  readonly label: string;
  /**
   * Above this duration, the line is logged as an ops-visible warning rather
   * than routine output — an OPERATIONAL threshold for log severity only
   * (never a domain timer, never gates a transition). Default 1000ms.
   */
  readonly slowMs?: number;
}

/**
 * The real F7 sink: one structured JSON line per request to stdout (every log
 * platform captures stdout — this needs no vendor integration to be a genuinely
 * "shipped to the ops alerting path" signal, DECISIONS.md 6.1/F7). An error
 * status or a slow request additionally logs to stderr with an "ALERT" marker,
 * so a log platform's error-stream / keyword alerting catches it without any
 * further wiring. Still just path/method/status/duration/timestamp — never a
 * token, a code, content, or an account id (invariant 6; 5.3).
 */
export class LoggingRequestMetrics implements RequestMetrics {
  private readonly label: string;
  private readonly slowMs: number;

  constructor(options: LoggingRequestMetricsOptions) {
    this.label = options.label;
    this.slowMs = options.slowMs ?? 1000;
  }

  record(metric: RequestMetric): void {
    const line = JSON.stringify({ server: this.label, ...metric });
    const isError = metric.status >= 500;
    const isSlow = metric.durationMs > this.slowMs;
    if (isError || isSlow) {
      // eslint-disable-next-line no-console
      console.error(`[metrics:ALERT:${this.label}] ${isError ? 'error status' : 'slow request'}: ${line}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[metrics:${this.label}] ${line}`);
    }
  }
}
