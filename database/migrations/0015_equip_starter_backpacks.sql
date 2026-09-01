UPDATE item_instances AS backpack
SET equipped_slot = 'backpack', container_id = NULL
WHERE backpack.definition_id = 'field_backpack'
  AND backpack.owner_character_id IS NOT NULL
  AND backpack.equipped_slot IS NULL
  AND backpack.id = (
    SELECT candidate.id
    FROM item_instances AS candidate
    WHERE candidate.owner_character_id = backpack.owner_character_id
      AND candidate.definition_id = 'field_backpack'
      AND candidate.equipped_slot IS NULL
    ORDER BY candidate.id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM item_instances AS equipped
    WHERE equipped.owner_character_id = backpack.owner_character_id
      AND equipped.equipped_slot = 'backpack'
  );
