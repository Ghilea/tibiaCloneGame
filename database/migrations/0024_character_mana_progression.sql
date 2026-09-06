-- TIBIAGAME_V35_1_MANA_PERSISTENCE_FIX
-- Runtime max mana is level-derived (50 + 5 per level after level 1).
-- Older rows could retain max_mana=50 while the live player regenerated above
-- that value, causing character_mana_valid to reject every combat/progression
-- transaction. Repair existing rows before the new server starts persisting
-- max_mana together with mana.
UPDATE characters
SET max_mana = GREATEST(
    max_mana,
    mana,
    50 + GREATEST(level - 1, 0) * 5
)
WHERE max_mana < mana
   OR max_mana < 50 + GREATEST(level - 1, 0) * 5;
