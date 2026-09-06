-- TIBIAGAME_V35_9_SKILLS_SHIELDING_ABILITIES
-- The runtime/server already allows 2 gathering + 2 crafting skills.
-- Replace the legacy <=2 database constraint that still rejected the 3rd/4th choice.
ALTER TABLE characters
    DROP CONSTRAINT IF EXISTS character_secondary_skills_valid;

ALTER TABLE characters
    ADD CONSTRAINT character_secondary_skills_valid CHECK (
        cardinality(secondary_skills) <= 4
        AND secondary_skills <@ ARRAY[
            'alchemy', 'mining', 'woodcutting', 'fishing',
            'cooking', 'smithing', 'leatherworking'
        ]::TEXT[]
        AND (
            cardinality(secondary_skills)
            - cardinality(
                array_remove(
                    array_remove(
                        array_remove(secondary_skills, 'mining'),
                        'woodcutting'
                    ),
                    'fishing'
                )
            )
        ) <= 2
        AND (
            cardinality(secondary_skills)
            - cardinality(
                array_remove(
                    array_remove(
                        array_remove(
                            array_remove(secondary_skills, 'alchemy'),
                            'cooking'
                        ),
                        'smithing'
                    ),
                    'leatherworking'
                )
            )
        ) <= 2
    );

ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS shielding_skill INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS shielding_tries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
    DROP CONSTRAINT IF EXISTS character_shielding_valid;

ALTER TABLE characters
    ADD CONSTRAINT character_shielding_valid CHECK (
        shielding_skill BETWEEN 0 AND 100
        AND shielding_tries >= 0
    );
