CREATE TABLE item_instances (
    id UUID PRIMARY KEY,
    definition_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    charges INTEGER CHECK (charges IS NULL OR charges >= 0),
    owner_character_id UUID REFERENCES characters(id),
    ground_x INTEGER,
    ground_y INTEGER,
    ground_z SMALLINT,
    CONSTRAINT item_location_valid CHECK (
        (owner_character_id IS NOT NULL AND ground_x IS NULL AND ground_y IS NULL AND ground_z IS NULL)
        OR
        (owner_character_id IS NULL AND ground_x IS NOT NULL AND ground_y IS NOT NULL AND ground_z IS NOT NULL)
    )
);

CREATE INDEX item_instances_owner_idx ON item_instances(owner_character_id)
    WHERE owner_character_id IS NOT NULL;

