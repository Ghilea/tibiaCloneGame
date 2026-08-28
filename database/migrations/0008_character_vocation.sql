ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS vocation TEXT NOT NULL DEFAULT 'adventurer';

ALTER TABLE characters
    ADD CONSTRAINT character_vocation_valid CHECK (
        vocation IN ('adventurer', 'warrior', 'ranger', 'mage', 'druid')
    );
