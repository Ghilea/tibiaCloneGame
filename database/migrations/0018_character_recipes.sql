CREATE TABLE character_recipes (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    recipe_id TEXT NOT NULL,
    learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (character_id, recipe_id)
);
