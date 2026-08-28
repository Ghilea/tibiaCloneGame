ALTER TABLE item_instances
    ADD COLUMN container_id UUID REFERENCES item_instances(id) ON DELETE CASCADE,
    ADD COLUMN equipped_slot TEXT,
    ADD CONSTRAINT item_sub_location_valid CHECK (
        NOT (container_id IS NOT NULL AND equipped_slot IS NOT NULL)
        AND (ground_x IS NULL OR (container_id IS NULL AND equipped_slot IS NULL))
    );

CREATE UNIQUE INDEX item_instances_equipment_slot_idx
    ON item_instances(owner_character_id, equipped_slot)
    WHERE equipped_slot IS NOT NULL;

