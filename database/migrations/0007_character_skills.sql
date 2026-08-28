ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS sword_skill INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS sword_tries INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS magic_level INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS magic_tries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
    ADD CONSTRAINT character_skills_valid CHECK (
        sword_skill >= 0 AND sword_tries >= 0
        AND magic_level >= 0 AND magic_tries >= 0
    );
