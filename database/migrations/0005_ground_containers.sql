ALTER TABLE item_instances
    DROP CONSTRAINT item_location_valid,
    DROP CONSTRAINT item_sub_location_valid,
    ADD CONSTRAINT item_location_v2 CHECK (
        ((ground_x IS NULL AND ground_y IS NULL AND ground_z IS NULL)
          OR (ground_x IS NOT NULL AND ground_y IS NOT NULL AND ground_z IS NOT NULL))
        AND (
            (owner_character_id IS NOT NULL AND ground_x IS NULL)
            OR
            (owner_character_id IS NULL AND ground_x IS NOT NULL AND container_id IS NULL AND equipped_slot IS NULL)
            OR
            (owner_character_id IS NULL AND ground_x IS NULL AND container_id IS NOT NULL AND equipped_slot IS NULL)
        )
        AND NOT (container_id IS NOT NULL AND equipped_slot IS NOT NULL)
    );

