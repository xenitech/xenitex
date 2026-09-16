-- P1-07: an administrator-provisioned account's password must be changed on
-- first sign-in. Added after 0001_init because the OpenAPI contract's
-- User.mustChangePassword (added during Step 3's web-panel work) had no
-- backing column yet — the frontend's forced-password-change screen was
-- built against a field the real schema didn't have.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
