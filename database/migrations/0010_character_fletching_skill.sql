ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS fletching_skill INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fletching_tries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
    ADD CONSTRAINT character_fletching_skill_non_negative CHECK (
        fletching_skill >= 0 AND fletching_tries >= 0
    );
