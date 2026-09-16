import type { Issue } from '../entities/issue.js';

/** EXT-05. Ticketing and SIEM integrations later (v1.1). Local no-op now. */
export interface IssueExporter {
  readonly exporterKey: string;
  export(
    issue: Issue,
  ): Promise<{ readonly exported: boolean; readonly externalReference: string | null }>;
}

export class NoOpIssueExporter implements IssueExporter {
  readonly exporterKey = 'noop';
  async export(
    _issue: Issue,
  ): Promise<{ readonly exported: boolean; readonly externalReference: string | null }> {
    return { exported: false, externalReference: null };
  }
}
