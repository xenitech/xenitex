import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { SkeletonRow } from '../components/SkeletonRow/SkeletonRow.js';
import { ApiError } from '../api/error.js';
import { flattenPages } from '../api/pagination.js';
import { AssetRow } from './AssetRow.js';
import { AssetDetailPanel } from './AssetDetailPanel.js';
import { useAssetsQuery } from './useAssetsQueries.js';
import { useAssetsUrlState } from './useAssetsUrlState.js';
import styles from './AssetsPage.module.css';

export function AssetsPage() {
  const { t } = useTranslation();
  const { filters, setFilters, selectedAssetId, setSelectedAssetId } = useAssetsUrlState();
  const query = useAssetsQuery(filters);
  const scrollRef = useRef<HTMLDivElement>(null);

  const assets = useMemo(() => flattenPages(query.data?.pages), [query.data]);

  const virtualizer = useVirtualizer({
    count: query.hasNextPage ? assets.length + 1 : assets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index;
  useEffect(() => {
    if (
      lastVirtualIndex !== undefined &&
      lastVirtualIndex >= assets.length - 1 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [
    lastVirtualIndex,
    assets.length,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.fetchNextPage,
  ]);

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

  if (!query.isLoading && assets.length === 0) {
    return (
      <EmptyState title={t('assets.empty.title')} description={t('assets.empty.description')} />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('assets.title')}</h1>
      </div>
      <div className={styles.filters}>
        <input
          type="search"
          placeholder={t('common.search')}
          value={filters.q ?? ''}
          onChange={(e) => setFilters({ q: e.target.value || undefined })}
        />
        <label>
          <input
            type="checkbox"
            checked={filters.isFragile === true}
            onChange={(e) => setFilters({ isFragile: e.target.checked || undefined })}
          />{' '}
          {t('assets.detail.fragile')}
        </label>
      </div>
      <div className={styles.splitView}>
        <div ref={scrollRef} className={styles.list}>
          {query.isLoading ? (
            <>
              <SkeletonRow columnWidths={[2, 1]} />
              <SkeletonRow columnWidths={[2, 1]} />
              <SkeletonRow columnWidths={[2, 1]} />
            </>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((virtualRow) => {
                const asset = assets[virtualRow.index];
                if (!asset) return null;
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
                    <AssetRow
                      asset={asset}
                      isSelected={asset.id === selectedAssetId}
                      onSelect={() => setSelectedAssetId(asset.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className={styles.detail}>
          {selectedAssetId ? (
            <AssetDetailPanel assetId={selectedAssetId} />
          ) : (
            <EmptyState title={t('assets.title')} description="" />
          )}
        </div>
      </div>
    </div>
  );
}
