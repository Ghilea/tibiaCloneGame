CREATE TABLE character_profession_skills (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 100),
    tries INTEGER NOT NULL DEFAULT 0 CHECK (tries >= 0),
    PRIMARY KEY (character_id, skill_id)
);
