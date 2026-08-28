ALTER TABLE item_instances
    ADD COLUMN depot_character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
    ADD COLUMN depot_id TEXT;

ALTER TABLE item_instances
    DROP CONSTRAINT item_location_v2,
    ADD CONSTRAINT item_location_v3 CHECK (
        ((ground_x IS NULL AND ground_y IS NULL AND ground_z IS NULL)
          OR (ground_x IS NOT NULL AND ground_y IS NOT NULL AND ground_z IS NOT NULL))
        AND (
            (owner_character_id IS NOT NULL AND depot_character_id IS NULL AND depot_id IS NULL AND ground_x IS NULL)
            OR
            (owner_character_id IS NULL AND depot_character_id IS NOT NULL AND depot_id IS NOT NULL AND ground_x IS NULL)
            OR
            (owner_character_id IS NULL AND depot_character_id IS NULL AND depot_id IS NULL AND ground_x IS NOT NULL AND container_id IS NULL AND equipped_slot IS NULL)
            OR
            (owner_character_id IS NULL AND depot_character_id IS NULL AND depot_id IS NULL AND ground_x IS NULL AND container_id IS NOT NULL AND equipped_slot IS NULL)
        )
        AND NOT (container_id IS NOT NULL AND equipped_slot IS NOT NULL)
    );

CREATE INDEX item_instances_depot_idx
    ON item_instances(depot_character_id, depot_id)
    WHERE depot_character_id IS NOT NULL;
