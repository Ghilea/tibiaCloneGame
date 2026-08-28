CREATE TABLE character_spells (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    spell_id TEXT NOT NULL,
    learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (character_id, spell_id)
);
