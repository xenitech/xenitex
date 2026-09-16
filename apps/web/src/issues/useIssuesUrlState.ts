import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IssueState } from '../api/types.js';
import { DEFAULT_ISSUE_FILTERS, type IssueFilters } from './useIssuesQueries.js';

/** P1-25: every filter, sort, and the selected issue live in the URL — this view is shareable and survives a refresh. */
export function useIssuesUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo((): IssueFilters => {
    const stateParam = searchParams.get('state');
    const minRiskScore = searchParams.get('minRiskScore');
    return {
      state: stateParam ? (stateParam.split(',') as IssueState[]) : DEFAULT_ISSUE_FILTERS.state,
      confidenceFloor: Number(
        searchParams.get('confidenceFloor') ?? DEFAULT_ISSUE_FILTERS.confidenceFloor,
      ),
      minRiskScore: minRiskScore ? Number(minRiskScore) : undefined,
      overdue: searchParams.get('overdue') === 'true',
      assetId: searchParams.get('assetId') ?? undefined,
      sort: (searchParams.get('sort') as IssueFilters['sort']) ?? DEFAULT_ISSUE_FILTERS.sort,
    };
  }, [searchParams]);

  const selectedIssueId = searchParams.get('selected') ?? undefined;

  const setFilters = useCallback(
    (next: Partial<IssueFilters>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          const merged = { ...filters, ...next };
          if (merged.state.length) params.set('state', merged.state.join(','));
          else params.delete('state');
          if (merged.confidenceFloor !== DEFAULT_ISSUE_FILTERS.confidenceFloor) {
            params.set('confidenceFloor', String(merged.confidenceFloor));
          } else params.delete('confidenceFloor');
          if (merged.minRiskScore !== undefined)
            params.set('minRiskScore', String(merged.minRiskScore));
          else params.delete('minRiskScore');
          if (merged.overdue) params.set('overdue', 'true');
          else params.delete('overdue');
          if (merged.sort !== DEFAULT_ISSUE_FILTERS.sort) params.set('sort', merged.sort);
          else params.delete('sort');
          return params;
        },
        { replace: true },
      );
    },
    [filters, setSearchParams],
  );

  const setSelectedIssueId = useCallback(
    (issueId: string | undefined) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (issueId) params.set('selected', issueId);
          else params.delete('selected');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilters, selectedIssueId, setSelectedIssueId };
}
