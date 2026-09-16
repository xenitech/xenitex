import { useTranslation } from 'react-i18next';
import type { Asset } from '../api/types.js';
import styles from './AssetRow.module.css';

export interface AssetRowProps {
  readonly asset: Asset;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

function currentLabel(asset: Asset): string {
  const hostname = asset.hostnames.find((h) => h.isCurrent) ?? asset.hostnames[0];
  if (hostname) return hostname.hostnameUntrusted;
  return asset.addresses.find((a) => a.isCurrent)?.address ?? asset.addresses[0]?.address ?? '—';
}

export function AssetRow({ asset, isSelected, onSelect }: AssetRowProps) {
  const { t } = useTranslation();
  return (
    <button type="button" className={styles.row} data-selected={isSelected} onClick={onSelect}>
      <div className={styles.main}>
        {/* SEC-17: hostname/address is scanner-derived, untrusted — plain text only. */}
        <span className={styles.label}>{currentLabel(asset)}</span>
        <span className={styles.tags}>{asset.tags.join(', ')}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.badge} data-criticality={asset.businessCriticality}>
          {t(`common.criticality.${asset.businessCriticality}`)}
        </span>
        <span>{t(`common.exposure.${asset.exposureClassification}`)}</span>
        {asset.isFragile && <span className={styles.fragile}>{t('assets.detail.fragile')}</span>}
      </div>
    </button>
  );
}
