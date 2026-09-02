ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS outfit TEXT NOT NULL DEFAULT 'knight';

UPDATE characters
SET outfit = CASE vocation
    WHEN 'ranger' THEN 'ranger'
    WHEN 'mage' THEN 'mage'
    WHEN 'druid' THEN 'mage'
    ELSE 'knight'
END
WHERE outfit = 'knight';

ALTER TABLE characters
    DROP CONSTRAINT IF EXISTS character_outfit_valid;

ALTER TABLE characters
    ADD CONSTRAINT character_outfit_valid
    CHECK (outfit IN ('knight', 'mage', 'ranger', 'rogue'));
