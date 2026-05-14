-- Bootstrap: ensure required Postgres extensions exist.
-- On managed databases where the app user lacks CREATE privilege,
-- ask your database administrator to run these as superuser first:
--
--   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--
-- This migration uses gen_random_uuid() (built-in since PG 13) as a
-- fallback: if uuid-ossp cannot be created, we install a compatibility
-- function so existing uuid_generate_v4() defaults still work.

-- Try creating uuid-ossp (requires CREATE privilege)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not create uuid-ossp extension (insufficient_privilege) — installing gen_random_uuid fallback';
END $$;

-- Try creating pgcrypto (requires CREATE privilege)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not create pgcrypto extension (insufficient_privilege) — skipping';
END $$;

-- Fallback: if uuid_generate_v4() still doesn't exist, create a shim
-- that delegates to the built-in gen_random_uuid().
DO $$ BEGIN
  -- Test if uuid_generate_v4() is callable
  PERFORM uuid_generate_v4();
EXCEPTION WHEN undefined_function THEN
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid
    LANGUAGE sql AS 'SELECT gen_random_uuid()';
  RAISE NOTICE 'Created uuid_generate_v4() shim using gen_random_uuid()';
END $$;
