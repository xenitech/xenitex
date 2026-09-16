/**
 * EXT-07 (LicenseProvider half; FeatureFlagService lives in entities/reporting.ts
 * next to the other admin-surface types it's most often read alongside).
 *
 * Permissive local implementation now: every capability check returns true.
 * IMPORTANT (per the ADR this requirement calls for): client-side flags in
 * customer-controlled software are NOT an enforcement mechanism. Genuine
 * gating belongs to server-side capability checks (SEC-13) — this interface
 * exists so a future packaging/licensing tier change touches one file, not
 * so the UI can be trusted to hide anything security-relevant.
 */
export interface LicenseProvider {
  hasCapability(capabilityKey: string): Promise<boolean>;
}

export class PermissiveLocalLicenseProvider implements LicenseProvider {
  async hasCapability(_capabilityKey: string): Promise<boolean> {
    return true;
  }
}
