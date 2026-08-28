ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS max_mana INTEGER NOT NULL DEFAULT 50;

ALTER TABLE characters
    ADD CONSTRAINT character_mana_valid CHECK (mana >= 0 AND max_mana > 0 AND mana <= max_mana);
