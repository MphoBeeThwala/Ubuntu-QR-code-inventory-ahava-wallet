-- DropExtension
DROP EXTENSION "timescaledb";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "timescaledb" WITH SCHEMA "timescale";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid_ossp";
