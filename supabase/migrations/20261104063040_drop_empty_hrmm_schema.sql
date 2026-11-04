-- The legacy hrmm schema is intentionally empty after all ERP objects were
-- moved to daesan. Do not use CASCADE: an unexpected object should stop the
-- migration instead of being deleted silently.
drop schema if exists hrmm;
