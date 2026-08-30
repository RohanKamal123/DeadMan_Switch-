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
