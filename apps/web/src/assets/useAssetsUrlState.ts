import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AssetCriticality, ExposureClassification } from '../api/types.js';
import type { AssetFilters } from './useAssetsQueries.js';

/** P1-25: filters and the selected asset live in the URL. */
export function useAssetsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(
    (): AssetFilters => ({
      criticality: (searchParams.get('criticality') as AssetCriticality | null) ?? undefined,
      exposure: (searchParams.get('exposure') as ExposureClassification | null) ?? undefined,
      isFragile: searchParams.get('isFragile') === 'true' ? true : undefined,
      q: searchParams.get('q') ?? undefined,
    }),
    [searchParams],
  );

  const selectedAssetId = searchParams.get('selected') ?? undefined;

  const setFilters = useCallback(
    (next: Partial<AssetFilters>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          const merged = { ...filters, ...next };
          for (const key of ['criticality', 'exposure', 'q'] as const) {
            if (merged[key]) params.set(key, merged[key]!);
            else params.delete(key);
          }
          if (merged.isFragile) params.set('isFragile', 'true');
          else params.delete('isFragile');
          return params;
        },
        { replace: true },
      );
    },
    [filters, setSearchParams],
  );

  const setSelectedAssetId = useCallback(
    (assetId: string | undefined) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (assetId) params.set('selected', assetId);
          else params.delete('selected');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilters, selectedAssetId, setSelectedAssetId };
}
