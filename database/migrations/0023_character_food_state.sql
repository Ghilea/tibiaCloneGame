-- TIBIAGAME_V35B_PROGRESSION_PERSISTENCE_SIGILS
-- Preserve the active nourishment window across logout/login.
-- Remaining time intentionally pauses while the character is offline.
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS nourishment_remaining_ms BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS food_health_per_tick INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS food_mana_per_tick INTEGER NOT NULL DEFAULT 0;
