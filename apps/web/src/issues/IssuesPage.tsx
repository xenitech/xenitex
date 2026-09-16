import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { SkeletonRow } from '../components/SkeletonRow/SkeletonRow.js';
import { Button } from '../components/form/Button.js';
import { ApiError } from '../api/error.js';
import { rowHeight } from '../design/tokens.js';
import { useTheme } from '../theme/ThemeContext.js';
import { FacetFilterBar } from './FacetFilterBar.js';
import { IssueRow } from './IssueRow.js';
import { IssueDetailPanel } from './IssueDetailPanel.js';
import { flattenPages } from '../api/pagination.js';
import { useIssuesQuery } from './useIssuesQueries.js';
import { useIssuesUrlState } from './useIssuesUrlState.js';
import { exportIssuesAsCsv } from './exportIssuesAsCsv.js';
import styles from './IssuesPage.module.css';

export function IssuesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { density } = useTheme();
  const { filters, setFilters, selectedIssueId, setSelectedIssueId } = useIssuesUrlState();
  const query = useIssuesQuery(filters);
  const scrollRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => flattenPages(query.data?.pages), [query.data]);

  const virtualizer = useVirtualizer({
    count: query.hasNextPage ? issues.length + 1 : issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () =>
      density === 'comfortable' ? rowHeight.comfortable * 2.6 : rowHeight.compact * 2.6,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index;

  // Infinite scroll: fetch the next page once the last virtual row is close to view.
  useEffect(() => {
    if (
      lastVirtualIndex !== undefined &&
      lastVirtualIndex >= issues.length - 1 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [
    lastVirtualIndex,
    issues.length,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.fetchNextPage,
  ]);

  // j/k move a keyboard-only focus cursor; Enter commits it as the selection
  // (which fetches the detail panel) — so a fast j/k scroll through the list
  // doesn't fire a query per row.
  const [focusedIndex, setFocusedIndex] = useState(0);
  useEffect(() => {
    const selectedIndex = issues.findIndex((i) => i.id === selectedIssueId);
    if (selectedIndex >= 0) setFocusedIndex(selectedIndex);
  }, [selectedIssueId, issues]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((i) => Math.min(issues.length - 1, i + 1));
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      const issue = issues[focusedIndex];
      if (issue) setSelectedIssueId(issue.id);
    }
  };

  if (query.isError) {
    const apiErr = query.error instanceof ApiError ? query.error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={apiErr?.detail ?? ''}
        code={apiErr?.code ?? 'unknown'}
        correlationId={apiErr?.correlationId ?? 'unavailable'}
      />
    );
  }

  if (!query.isLoading && issues.length === 0) {
    return (
      <EmptyState
        title={t('issues.empty.title')}
        description={t('issues.empty.description')}
        action={{ label: t('issues.empty.action'), onClick: () => navigate('/scope') }}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('issues.title')}</h1>
        <Button variant="secondary" onClick={() => exportIssuesAsCsv(issues)}>
          {t('common.export')}
        </Button>
      </div>
      <FacetFilterBar filters={filters} onChange={setFilters} />
      <div className={styles.splitView}>
        <div
          ref={scrollRef}
          className={styles.list}
          role="listbox"
          aria-label={t('issues.title')}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {query.isLoading ? (
            <>
              <SkeletonRow columnWidths={[1, 2, 1]} />
              <SkeletonRow columnWidths={[1, 2, 1]} />
              <SkeletonRow columnWidths={[1, 2, 1]} />
            </>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((virtualRow) => {
                const issue = issues[virtualRow.index];
                if (!issue) {
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: 'absolute',
                        top: virtualRow.start,
                        height: virtualRow.size,
                        width: '100%',
                      }}
                    >
                      <SkeletonRow columnWidths={[1, 2, 1]} />
                    </div>
                  );
                }
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: virtualRow.start,
                      height: virtualRow.size,
                      width: '100%',
                    }}
                  >
                    <IssueRow
                      issue={issue}
                      isSelected={issue.id === selectedIssueId}
                      isFocused={virtualRow.index === focusedIndex}
                      onSelect={() => {
                        setFocusedIndex(virtualRow.index);
                        setSelectedIssueId(issue.id);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <p className={styles.keyboardHint}>{t('issues.keyboardHint')}</p>
        </div>
        <div className={styles.detail}>
          {selectedIssueId ? (
            <IssueDetailPanel issueId={selectedIssueId} />
          ) : (
            <EmptyState title={t('issues.title')} description={t('issues.keyboardHint')} />
          )}
        </div>
      </div>
    </div>
  );
}
