-- Early development builds inserted these two test items whenever the ground
-- was empty. World content must now come from authored data or player actions.
DELETE FROM item_instances
WHERE owner_character_id IS NULL
  AND depot_character_id IS NULL
  AND container_id IS NULL
  AND equipped_slot IS NULL
  AND ground_z = 7
  AND (
    (definition_id = 'blank_rune' AND quantity = 20 AND ground_x = 11 AND ground_y = 8)
    OR
    (definition_id = 'traveler_blade' AND quantity = 1 AND ground_x = 12 AND ground_y = 8)
  );
