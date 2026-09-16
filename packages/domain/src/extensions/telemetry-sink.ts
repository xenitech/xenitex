import type { Report } from '../entities/reporting.js';

/**
 * EXT-06. A future central console would consume these. Local no-op now.
 * DATA-07/ANTI-05: no code path in this build transmits anything off-appliance —
 * the NoOp implementations below are not a placeholder pending wiring, they are
 * the permanent behaviour of this release. A real implementation is out of scope
 * until a central-console product exists, which is not on this roadmap.
 */
export interface TelemetrySink {
  record(_event: {
    readonly name: string;
    readonly properties: Record<string, unknown>;
  }): Promise<void>;
}

export interface ReportPublisher {
  publish(_report: Report): Promise<void>;
}

export class NoOpTelemetrySink implements TelemetrySink {
  async record(): Promise<void> {
    /* intentionally does nothing and reaches no network call */
  }
}

export class NoOpReportPublisher implements ReportPublisher {
  async publish(): Promise<void> {
    /* intentionally does nothing and reaches no network call */
  }
}
