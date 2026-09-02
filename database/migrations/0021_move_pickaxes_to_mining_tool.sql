UPDATE item_instances
SET equipped_slot = 'mining_tool'
WHERE definition_id = 'iron_pickaxe'
  AND equipped_slot = 'weapon';
