ALTER TABLE users ADD CONSTRAINT mfa_required_for_privileged_roles
  CHECK (role NOT IN ('operator', 'administrator') OR mfa_enabled);
