CREATE TABLE character_discoveries (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    discovery_id TEXT NOT NULL,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (character_id, discovery_id)
);
