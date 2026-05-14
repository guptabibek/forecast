-- Add location_id to marg_branches for branch-Location mapping
ALTER TABLE marg_branches ADD COLUMN IF NOT EXISTS location_id UUID;
CREATE INDEX IF NOT EXISTS idx_marg_branches_location_id ON marg_branches(location_id);
