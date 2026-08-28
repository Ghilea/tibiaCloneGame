ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS distance_skill INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS distance_tries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
    ADD CONSTRAINT character_distance_skill_non_negative CHECK (
        distance_skill >= 0 AND distance_tries >= 0
    );
