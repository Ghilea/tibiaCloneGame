ALTER TABLE characters DROP CONSTRAINT IF EXISTS character_vocation_valid;

UPDATE characters
SET vocation = 'adventurer',
    health = LEAST(health, 150),
    mana = LEAST(mana, 50),
    max_mana = 50;

ALTER TABLE characters
    ADD CONSTRAINT character_vocation_valid CHECK (vocation = 'adventurer');
