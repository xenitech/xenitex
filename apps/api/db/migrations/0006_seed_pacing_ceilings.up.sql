-- SAFE-04: pacing_ceilings is a singleton (id=1, no default) that every
-- scan profile's pacing config must be validated against. 0001_init.up.sql
-- created the table but never seeded a row -- without one, the hard
-- ceiling SAFE-04 requires simply doesn't exist yet: GET /pacing-ceilings
-- has nothing to return, and scan-profile creation has nothing to check
-- pacing against. Conservative GATE-1-era defaults, adjustable later via
-- PATCH /pacing-ceilings by an administrator.
INSERT INTO pacing_ceilings (id, max_packets_per_second, max_concurrent_hosts, max_concurrent_ports_per_host, max_timeout_ms, max_retries)
VALUES (1, 1000, 50, 100, 5000, 3)
ON CONFLICT (id) DO NOTHING;
