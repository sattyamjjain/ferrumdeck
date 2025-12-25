-- Migration: Add pgvector extension for semantic search and retrieval
-- This enables vector embeddings storage for:
-- - Run history similarity search
-- - Task embedding for intelligent routing
-- - Code snippet retrieval for agents

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table for storing embeddings of run inputs/outputs
-- Used for finding similar runs and debugging
CREATE TABLE IF NOT EXISTS run_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    embedding_type TEXT NOT NULL CHECK (embedding_type IN ('input', 'output', 'combined')),
    embedding vector(1536) NOT NULL, -- OpenAI ada-002 / Claude embedding dimension
    model TEXT NOT NULL,  -- Model used to generate embedding
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for similarity search using HNSW (faster for large datasets)
CREATE INDEX IF NOT EXISTS idx_run_embeddings_vector
    ON run_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Index for filtering by run
CREATE INDEX IF NOT EXISTS idx_run_embeddings_run_id
    ON run_embeddings(run_id);

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_run_embeddings_type
    ON run_embeddings(embedding_type);

-- Table for storing code chunk embeddings
-- Used by agents for code search and understanding
CREATE TABLE IF NOT EXISTS code_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,  -- Links to tenant's project
    repo_url TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_start_line INT NOT NULL,
    chunk_end_line INT NOT NULL,
    content_hash TEXT NOT NULL,  -- SHA256 of chunk content for dedup
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',  -- Language, symbols, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(project_id, repo_url, file_path, chunk_start_line, chunk_end_line)
);

-- Create index for similarity search
CREATE INDEX IF NOT EXISTS idx_code_embeddings_vector
    ON code_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Composite index for filtering before vector search
CREATE INDEX IF NOT EXISTS idx_code_embeddings_project_repo
    ON code_embeddings(project_id, repo_url);

-- Index for content deduplication
CREATE INDEX IF NOT EXISTS idx_code_embeddings_hash
    ON code_embeddings(content_hash);

-- Table for storing task embeddings
-- Used for intelligent task routing and similarity matching
CREATE TABLE IF NOT EXISTS task_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id TEXT NOT NULL,  -- Links to eval task
    embedding_source TEXT NOT NULL CHECK (embedding_source IN ('description', 'input', 'expected')),
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(task_id, embedding_source)
);

-- Create index for similarity search
CREATE INDEX IF NOT EXISTS idx_task_embeddings_vector
    ON task_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Function to find similar runs by embedding
CREATE OR REPLACE FUNCTION find_similar_runs(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.8,
    match_count INT DEFAULT 10,
    filter_project_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    run_id TEXT,
    similarity FLOAT,
    embedding_type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        re.run_id,
        1 - (re.embedding <=> query_embedding) AS similarity,
        re.embedding_type
    FROM run_embeddings re
    JOIN runs r ON re.run_id = r.id
    WHERE
        (filter_project_id IS NULL OR r.project_id = filter_project_id)
        AND 1 - (re.embedding <=> query_embedding) > match_threshold
    ORDER BY re.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar code chunks
CREATE OR REPLACE FUNCTION find_similar_code(
    query_embedding vector(1536),
    filter_project_id TEXT,
    filter_repo_url TEXT DEFAULT NULL,
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    file_path TEXT,
    chunk_start_line INT,
    chunk_end_line INT,
    similarity FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ce.id,
        ce.file_path,
        ce.chunk_start_line,
        ce.chunk_end_line,
        1 - (ce.embedding <=> query_embedding) AS similarity,
        ce.metadata
    FROM code_embeddings ce
    WHERE
        ce.project_id = filter_project_id
        AND (filter_repo_url IS NULL OR ce.repo_url = filter_repo_url)
        AND 1 - (ce.embedding <=> query_embedding) > match_threshold
    ORDER BY ce.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on code_embeddings
CREATE TRIGGER update_code_embeddings_updated_at
    BEFORE UPDATE ON code_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Comment on tables for documentation
COMMENT ON TABLE run_embeddings IS 'Vector embeddings for run inputs/outputs, enables similarity search for debugging and analysis';
COMMENT ON TABLE code_embeddings IS 'Vector embeddings for code chunks, enables semantic code search for agents';
COMMENT ON TABLE task_embeddings IS 'Vector embeddings for eval tasks, enables intelligent task routing';
