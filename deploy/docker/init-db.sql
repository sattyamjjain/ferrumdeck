-- FerrumDeck Database Initialization
-- This script runs when the PostgreSQL container is first created

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schema for better organization (optional)
-- CREATE SCHEMA IF NOT EXISTS ferrumdeck;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE ferrumdeck TO ferrumdeck;

-- Log that initialization completed
DO $$
BEGIN
    RAISE NOTICE 'FerrumDeck database initialized successfully';
END $$;
