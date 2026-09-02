ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS secondary_skills TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE characters
    DROP CONSTRAINT IF EXISTS character_secondary_skills_valid;

ALTER TABLE characters
    ADD CONSTRAINT character_secondary_skills_valid CHECK (
        cardinality(secondary_skills) <= 2
        AND secondary_skills <@ ARRAY['alchemy', 'mining', 'woodcutting', 'fishing', 'cooking']::TEXT[]
    );
