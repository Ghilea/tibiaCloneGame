use std::{
    collections::{HashMap, HashSet},
    env,
};

use anyhow::Context;
use game_types::{EntityId, GroundItem, ItemInstance, Position};
use sqlx::{PgPool, Postgres, Transaction, postgres::PgPoolOptions};
use tracing::{info, warn};

type ItemRow = (
    EntityId,
    String,
    i32,
    Option<i32>,
    Option<EntityId>,
    Option<String>,
);
#[derive(sqlx::FromRow)]
struct CharacterRow {
    id: EntityId,
    account_id: EntityId,
    name: String,
    vocation: String,
    level: i32,
    experience: i64,
    health: i32,
    mana: i32,
    max_mana: i32,
    sword_skill: i32,
    sword_tries: i32,
    distance_skill: i32,
    distance_tries: i32,
    fletching_skill: i32,
    fletching_tries: i32,
    magic_level: i32,
    magic_tries: i32,
    position_x: i32,
    position_y: i32,
    position_z: i16,
}
type GroundItemRow = (
    EntityId,
    String,
    i32,
    Option<i32>,
    Option<EntityId>,
    Option<String>,
    i32,
    i32,
    i16,
);

#[derive(Clone)]
pub struct Database {
    #[allow(dead_code)]
    pool: PgPool,
}

#[derive(Debug, Clone)]
pub struct AccountRecord {
    pub id: EntityId,
    pub password_hash: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRecord {
    pub id: EntityId,
    pub account_id: EntityId,
    pub name: String,
    pub vocation: String,
    pub level: i32,
    pub experience: i64,
    pub health: i32,
    pub mana: i32,
    pub max_mana: i32,
    pub sword_skill: i32,
    pub sword_tries: i32,
    pub distance_skill: i32,
    pub distance_tries: i32,
    pub fletching_skill: i32,
    pub fletching_tries: i32,
    pub magic_level: i32,
    pub magic_tries: i32,
    pub position: Position,
}

impl Database {
    pub async fn connect_from_env() -> anyhow::Result<Option<Self>> {
        let Ok(url) = env::var("DATABASE_URL") else {
            warn!("DATABASE_URL is not set; running with ephemeral character state");
            return Ok(None);
        };
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .context("connect to PostgreSQL")?;
        sqlx::migrate!("../../database/migrations")
            .run(&pool)
            .await
            .context("run database migrations")?;
        sqlx::query(
            "INSERT INTO server_state (key, value, updated_at) VALUES ('last_start', $1, NOW()) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        )
        .bind(env!("CARGO_PKG_VERSION"))
        .execute(&pool)
        .await
        .context("write server startup heartbeat")?;
        let stored: String =
            sqlx::query_scalar("SELECT value FROM server_state WHERE key = 'last_start'")
                .fetch_one(&pool)
                .await
                .context("read server startup heartbeat")?;
        info!(version = %stored, "PostgreSQL connected, migrated, and verified");
        Ok(Some(Self { pool }))
    }

    pub async fn create_account(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<EntityId, sqlx::Error> {
        let id = uuid::Uuid::new_v4();
        sqlx::query("INSERT INTO accounts (id, username, password_hash) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(username)
            .bind(password_hash)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    pub async fn account_by_username(
        &self,
        username: &str,
    ) -> Result<Option<AccountRecord>, sqlx::Error> {
        let row: Option<(EntityId, String)> =
            sqlx::query_as("SELECT id, password_hash FROM accounts WHERE username = $1")
                .bind(username)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(id, password_hash)| AccountRecord { id, password_hash }))
    }

    pub async fn characters_for_account(
        &self,
        account_id: EntityId,
    ) -> Result<Vec<CharacterRecord>, sqlx::Error> {
        let rows: Vec<CharacterRow> = sqlx::query_as(
            "SELECT id, account_id, name, vocation, level, experience, health, mana, max_mana, sword_skill, sword_tries, distance_skill, distance_tries, fletching_skill, fletching_tries, magic_level, magic_tries, position_x, position_y, position_z \
             FROM characters WHERE account_id = $1 ORDER BY created_at, name",
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(character_from_row).collect())
    }

    pub async fn create_character(
        &self,
        account_id: EntityId,
        name: &str,
        vocation: &str,
    ) -> Result<CharacterRecord, sqlx::Error> {
        let profile = game_types::playable_vocation(vocation)
            .ok_or_else(|| sqlx::Error::Protocol("invalid vocation".into()))?;
        let id = uuid::Uuid::new_v4();
        let mut transaction = self.pool.begin().await?;
        let row: CharacterRow = sqlx::query_as(
            "INSERT INTO characters (id, account_id, name, vocation, health, mana, max_mana, sword_skill, distance_skill, magic_level) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9) \
             RETURNING id, account_id, name, vocation, level, experience, health, mana, max_mana, sword_skill, sword_tries, distance_skill, distance_tries, fletching_skill, fletching_tries, magic_level, magic_tries, position_x, position_y, position_z",
        )
        .bind(id)
        .bind(account_id)
        .bind(name)
        .bind(vocation)
        .bind(i32::from(profile.max_health))
        .bind(i32::from(profile.max_mana))
        .bind(i32::from(profile.sword_skill))
        .bind(i32::from(profile.distance_skill))
        .bind(i32::from(profile.magic_level))
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, owner_character_id) VALUES ($1, 'field_backpack', 1, $2)")
            .bind(uuid::Uuid::new_v4()).bind(id).execute(&mut *transaction).await?;
        if vocation == "ranger" {
            sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, owner_character_id, equipped_slot) VALUES ($1, 'ashwood_bow', 1, $2, 'weapon')")
                .bind(uuid::Uuid::new_v4()).bind(id).execute(&mut *transaction).await?;
            sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, owner_character_id) VALUES ($1, 'rough_arrow', 100, $2)")
                .bind(uuid::Uuid::new_v4()).bind(id).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(character_from_row(row))
    }

    pub async fn delete_character(
        &self,
        account_id: EntityId,
        character_id: EntityId,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let owned = sqlx::query_scalar::<_, EntityId>(
            "SELECT id FROM characters WHERE id = $1 AND account_id = $2 FOR UPDATE",
        )
        .bind(character_id)
        .bind(account_id)
        .fetch_optional(&mut *transaction)
        .await?
        .is_some();
        if !owned {
            return Ok(false);
        }
        // Root inventory/depot items own their nested container trees through
        // ON DELETE CASCADE. Spells cascade from the character itself.
        sqlx::query(
            "DELETE FROM item_instances WHERE owner_character_id = $1 OR depot_character_id = $1",
        )
        .bind(character_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM characters WHERE id = $1 AND account_id = $2")
            .bind(character_id)
            .bind(account_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn character_for_account(
        &self,
        account_id: EntityId,
        character_id: EntityId,
    ) -> Result<Option<CharacterRecord>, sqlx::Error> {
        let row: Option<CharacterRow> = sqlx::query_as(
            "SELECT id, account_id, name, vocation, level, experience, health, mana, max_mana, sword_skill, sword_tries, distance_skill, distance_tries, fletching_skill, fletching_tries, magic_level, magic_tries, position_x, position_y, position_z \
             FROM characters WHERE id = $1 AND account_id = $2",
        )
        .bind(character_id)
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(character_from_row))
    }

    pub async fn save_position(
        &self,
        character_id: EntityId,
        position: Position,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE characters SET position_x = $2, position_y = $3, position_z = $4, updated_at = NOW() WHERE id = $1",
        )
        .bind(character_id)
        .bind(position.x)
        .bind(position.y)
        .bind(position.z)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_progression(
        &self,
        character_id: EntityId,
        level: u32,
        experience: u64,
        health: u16,
        mana: u16,
        sword_skill: u16,
        sword_tries: u32,
        distance_skill: u16,
        distance_tries: u32,
        fletching_skill: u16,
        fletching_tries: u32,
        magic_level: u16,
        magic_tries: u32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE characters SET level = $2, experience = $3, health = $4, mana = $5, sword_skill = $6, sword_tries = $7, distance_skill = $8, distance_tries = $9, fletching_skill = $10, fletching_tries = $11, magic_level = $12, magic_tries = $13, updated_at = NOW() WHERE id = $1")
            .bind(character_id).bind(i32::try_from(level).unwrap_or(i32::MAX)).bind(i64::try_from(experience).unwrap_or(i64::MAX)).bind(i32::from(health)).bind(i32::from(mana))
            .bind(i32::from(sword_skill)).bind(i32::try_from(sword_tries).unwrap_or(i32::MAX)).bind(i32::from(distance_skill)).bind(i32::try_from(distance_tries).unwrap_or(i32::MAX)).bind(i32::from(fletching_skill)).bind(i32::try_from(fletching_tries).unwrap_or(i32::MAX)).bind(i32::from(magic_level)).bind(i32::try_from(magic_tries).unwrap_or(i32::MAX))
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn load_inventory(
        &self,
        character_id: EntityId,
    ) -> Result<Vec<ItemInstance>, sqlx::Error> {
        let rows: Vec<ItemRow> = sqlx::query_as(
            "SELECT id, definition_id, quantity, charges, container_id, equipped_slot FROM item_instances WHERE owner_character_id = $1 ORDER BY container_id NULLS FIRST, id",
        ).bind(character_id).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().filter_map(item_from_row).collect())
    }

    pub async fn load_spells(&self, character_id: EntityId) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT spell_id FROM character_spells WHERE character_id = $1 ORDER BY spell_id",
        )
        .bind(character_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn load_depot(
        &self,
        character_id: EntityId,
        depot_id: &str,
    ) -> Result<Vec<ItemInstance>, sqlx::Error> {
        let rows: Vec<ItemRow> = sqlx::query_as(
            "SELECT id, definition_id, quantity, charges, container_id, equipped_slot FROM item_instances WHERE depot_character_id = $1 AND depot_id = $2 ORDER BY container_id NULLS FIRST, id",
        )
        .bind(character_id)
        .bind(depot_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().filter_map(item_from_row).collect())
    }

    pub async fn load_ground_items(&self) -> Result<Vec<GroundItem>, sqlx::Error> {
        let rows: Vec<GroundItemRow> = sqlx::query_as(
            "SELECT id, definition_id, quantity, charges, container_id, equipped_slot, ground_x, ground_y, ground_z FROM item_instances WHERE ground_x IS NOT NULL ORDER BY id",
        ).fetch_all(&self.pool).await?;
        let content_rows: Vec<ItemRow> = sqlx::query_as(
            "SELECT id, definition_id, quantity, charges, container_id, equipped_slot FROM item_instances WHERE owner_character_id IS NULL AND depot_character_id IS NULL AND ground_x IS NULL AND container_id IS NOT NULL ORDER BY id",
        ).fetch_all(&self.pool).await?;
        let mut contents_by_parent: HashMap<EntityId, Vec<ItemInstance>> = HashMap::new();
        for row in content_rows {
            let Some(parent_id) = row.4 else { continue };
            if let Some(item) = item_from_row(row) {
                contents_by_parent.entry(parent_id).or_default().push(item);
            }
        }
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let item = item_from_row((row.0, row.1, row.2, row.3, row.4, row.5))?;
                let contents = contents_by_parent
                    .remove(&item.instance_id)
                    .unwrap_or_default();
                Some(GroundItem {
                    item,
                    position: Position {
                        x: row.6,
                        y: row.7,
                        z: row.8,
                    },
                    contents,
                })
            })
            .collect())
    }

    pub async fn persist_item_state(
        &self,
        character_id: EntityId,
        inventory: &[ItemInstance],
        ground_items: &[GroundItem],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        write_items(&mut transaction, character_id, inventory, ground_items).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_ground_items(
        &self,
        ground_items: &[GroundItem],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        clear_ground_items(&mut transaction).await?;
        insert_ground_items(&mut transaction, ground_items).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_depot_state(
        &self,
        character_id: EntityId,
        depot_id: &str,
        inventory: &[ItemInstance],
        depot: &[ItemInstance],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        // Inventory and depot are two locations for the same stable item UUIDs.
        // Clear both before inserting either side of the move.
        clear_inventory(&mut transaction, character_id).await?;
        clear_depot(&mut transaction, character_id, depot_id).await?;
        insert_inventory(&mut transaction, character_id, inventory).await?;
        insert_depot(&mut transaction, character_id, depot_id, depot).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_spell_learning(
        &self,
        character_id: EntityId,
        inventory: &[ItemInstance],
        spell_id: &str,
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        clear_inventory(&mut transaction, character_id).await?;
        insert_inventory(&mut transaction, character_id, inventory).await?;
        sqlx::query("INSERT INTO character_spells (character_id, spell_id) VALUES ($1, $2)")
            .bind(character_id)
            .bind(spell_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_trade_state(
        &self,
        player_a: EntityId,
        inventory_a: &[ItemInstance],
        player_b: EntityId,
        inventory_b: &[ItemInstance],
        ground_items: &[GroundItem],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM item_instances WHERE owner_character_id = $1 OR owner_character_id = $2",
        )
        .bind(player_a)
        .bind(player_b)
        .execute(&mut *transaction)
        .await?;
        // Clear every old location before inserting any new one. An item keeps the
        // same UUID when it moves between the ground and an inventory.
        clear_ground_items(&mut transaction).await?;
        insert_inventory(&mut transaction, player_a, inventory_a).await?;
        insert_inventory(&mut transaction, player_b, inventory_b).await?;
        insert_ground_items(&mut transaction, ground_items).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_combat_state(
        &self,
        player: &game_types::PlayerView,
        inventory: &[ItemInstance],
        ground_items: &[GroundItem],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE characters SET level = $2, experience = $3, health = $4, mana = $5, sword_skill = $6, sword_tries = $7, distance_skill = $8, distance_tries = $9, fletching_skill = $10, fletching_tries = $11, magic_level = $12, magic_tries = $13, updated_at = NOW() WHERE id = $1")
            .bind(player.id).bind(i32::try_from(player.level).unwrap_or(i32::MAX)).bind(i64::try_from(player.experience).unwrap_or(i64::MAX)).bind(i32::from(player.health)).bind(i32::from(player.mana))
            .bind(i32::from(player.sword_skill)).bind(i32::try_from(player.sword_tries).unwrap_or(i32::MAX)).bind(i32::from(player.distance_skill)).bind(i32::try_from(player.distance_tries).unwrap_or(i32::MAX)).bind(i32::from(player.fletching_skill)).bind(i32::try_from(player.fletching_tries).unwrap_or(i32::MAX)).bind(i32::from(player.magic_level)).bind(i32::try_from(player.magic_tries).unwrap_or(i32::MAX))
            .execute(&mut *transaction).await?;
        write_items(&mut transaction, player.id, inventory, ground_items).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn persist_crafting_state(
        &self,
        player: &game_types::PlayerView,
        inventory: &[ItemInstance],
        ground_items: &[GroundItem],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE characters SET mana = $2, sword_skill = $3, sword_tries = $4, distance_skill = $5, distance_tries = $6, fletching_skill = $7, fletching_tries = $8, magic_level = $9, magic_tries = $10, updated_at = NOW() WHERE id = $1")
            .bind(player.id)
            .bind(i32::from(player.mana))
            .bind(i32::from(player.sword_skill))
            .bind(i32::try_from(player.sword_tries).unwrap_or(i32::MAX))
            .bind(i32::from(player.distance_skill))
            .bind(i32::try_from(player.distance_tries).unwrap_or(i32::MAX))
            .bind(i32::from(player.fletching_skill))
            .bind(i32::try_from(player.fletching_tries).unwrap_or(i32::MAX))
            .bind(i32::from(player.magic_level))
            .bind(i32::try_from(player.magic_tries).unwrap_or(i32::MAX))
            .execute(&mut *transaction)
            .await?;
        write_items(&mut transaction, player.id, inventory, ground_items).await?;
        transaction.commit().await?;
        Ok(())
    }
}

async fn write_items(
    transaction: &mut Transaction<'_, Postgres>,
    character_id: EntityId,
    inventory: &[ItemInstance],
    ground_items: &[GroundItem],
) -> Result<(), sqlx::Error> {
    // A pickup/drop is a relocation of one UUID, so both previous location sets
    // must be gone before either new set is inserted.
    clear_inventory(transaction, character_id).await?;
    clear_ground_items(transaction).await?;
    insert_inventory(transaction, character_id, inventory).await?;
    insert_ground_items(transaction, ground_items).await?;
    Ok(())
}

async fn clear_inventory(
    transaction: &mut Transaction<'_, Postgres>,
    character_id: EntityId,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM item_instances WHERE owner_character_id = $1")
        .bind(character_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn insert_inventory(
    transaction: &mut Transaction<'_, Postgres>,
    character_id: EntityId,
    inventory: &[ItemInstance],
) -> Result<(), sqlx::Error> {
    let mut pending = inventory.to_vec();
    let mut inserted = HashSet::new();
    while !pending.is_empty() {
        let before = pending.len();
        let mut index = 0;
        while index < pending.len() {
            if pending[index]
                .container_id
                .is_none_or(|parent| inserted.contains(&parent))
            {
                let item = pending.remove(index);
                sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, charges, owner_character_id, container_id, equipped_slot) VALUES ($1, $2, $3, $4, $5, $6, $7)")
                    .bind(item.instance_id).bind(&item.definition_id).bind(i32::from(item.quantity)).bind(item.charges.map(i32::from)).bind(character_id)
                    .bind(item.container_id).bind(&item.equipped_slot).execute(&mut **transaction).await?;
                inserted.insert(item.instance_id);
            } else {
                index += 1;
            }
        }
        if pending.len() == before {
            return Err(sqlx::Error::Protocol(
                "cyclic or missing container parent".into(),
            ));
        }
    }
    Ok(())
}

async fn clear_depot(
    transaction: &mut Transaction<'_, Postgres>,
    character_id: EntityId,
    depot_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM item_instances WHERE depot_character_id = $1 AND depot_id = $2")
        .bind(character_id)
        .bind(depot_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn insert_depot(
    transaction: &mut Transaction<'_, Postgres>,
    character_id: EntityId,
    depot_id: &str,
    depot: &[ItemInstance],
) -> Result<(), sqlx::Error> {
    let mut pending = depot.to_vec();
    let mut inserted = HashSet::new();
    while !pending.is_empty() {
        let before = pending.len();
        let mut index = 0;
        while index < pending.len() {
            if pending[index]
                .container_id
                .is_none_or(|parent| inserted.contains(&parent))
            {
                let item = pending.remove(index);
                sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, charges, depot_character_id, depot_id, container_id) VALUES ($1, $2, $3, $4, $5, $6, $7)")
                    .bind(item.instance_id)
                    .bind(&item.definition_id)
                    .bind(i32::from(item.quantity))
                    .bind(item.charges.map(i32::from))
                    .bind(character_id)
                    .bind(depot_id)
                    .bind(item.container_id)
                    .execute(&mut **transaction)
                    .await?;
                inserted.insert(item.instance_id);
            } else {
                index += 1;
            }
        }
        if pending.len() == before {
            return Err(sqlx::Error::Protocol(
                "cyclic or missing depot container parent".into(),
            ));
        }
    }
    Ok(())
}

async fn clear_ground_items(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM item_instances WHERE ground_x IS NOT NULL")
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn insert_ground_items(
    transaction: &mut Transaction<'_, Postgres>,
    ground_items: &[GroundItem],
) -> Result<(), sqlx::Error> {
    for ground in ground_items {
        sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, charges, ground_x, ground_y, ground_z) VALUES ($1, $2, $3, $4, $5, $6, $7)")
            .bind(ground.item.instance_id).bind(&ground.item.definition_id).bind(i32::from(ground.item.quantity)).bind(ground.item.charges.map(i32::from))
            .bind(ground.position.x).bind(ground.position.y).bind(ground.position.z).execute(&mut **transaction).await?;
        for item in &ground.contents {
            sqlx::query("INSERT INTO item_instances (id, definition_id, quantity, charges, container_id) VALUES ($1, $2, $3, $4, $5)")
                .bind(item.instance_id).bind(&item.definition_id).bind(i32::from(item.quantity)).bind(item.charges.map(i32::from))
                .bind(ground.item.instance_id).execute(&mut **transaction).await?;
        }
    }
    Ok(())
}

fn item_from_row(row: ItemRow) -> Option<ItemInstance> {
    Some(ItemInstance {
        instance_id: row.0,
        definition_id: row.1,
        quantity: u16::try_from(row.2).ok()?,
        charges: row.3.map(u16::try_from).transpose().ok()?,
        container_id: row.4,
        equipped_slot: row.5,
    })
}

fn character_from_row(row: CharacterRow) -> CharacterRecord {
    CharacterRecord {
        id: row.id,
        account_id: row.account_id,
        name: row.name,
        vocation: row.vocation,
        level: row.level,
        experience: row.experience,
        health: row.health,
        mana: row.mana,
        max_mana: row.max_mana,
        sword_skill: row.sword_skill,
        sword_tries: row.sword_tries,
        distance_skill: row.distance_skill,
        distance_tries: row.distance_tries,
        fletching_skill: row.fletching_skill,
        fletching_tries: row.fletching_tries,
        magic_level: row.magic_level,
        magic_tries: row.magic_tries,
        position: Position {
            x: row.position_x,
            y: row.position_y,
            z: row.position_z,
        },
    }
}
