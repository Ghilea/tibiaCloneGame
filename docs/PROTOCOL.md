# Protocol

Protocol version is `10`. The first WebSocket message must be `hello`, containing the protocol version, client version, session token, and selected character ID. Incompatible clients and characters outside the authenticated account are rejected.

Character creation requires `name` and one playable `vocation`: `warrior`, `ranger`, `mage`, or `druid`. Character summaries and `PlayerView` include the persisted vocation. The server derives initial health, mana, capacity, skills, training rates, and production permissions from its vocation profile rather than trusting client values.

The client sends `move_request` intentions for adjacent tiles. The server validates floor, distance, collision, and movement speed. The client may predict movement, while `player_moved` confirms the authoritative position and `move_rejected` reconciles it. Held-key movement remains a client input concern and does not weaken server authority.

`MapView.water` identifies blocked water tiles separately from walls. Both are authoritative collision data, while the distinction lets the renderer present swamp pools instead of misleading wall geometry.

`pickup_item` and `drop_item` contain only an item instance ID. The server decides ownership, reach, weight, and final placement. A `GroundItem` may contain children; collecting a child uses the parent ground container's position for reach.

`move_item` has a typed root, container, or equipment destination. `split_item` contains an instance ID and quantity. The server validates container capacity, ancestry, stack rules, and equipment compatibility.

`attack_request` contains only a target entity ID. Target lock repeats this intention until cancelled or the target dies. The server resolves the equipped weapon and owns range, line of sight, ammunition selection and consumption, cooldown, skill training, and damage. Successful distance attacks emit `combat_effect` using the ammunition definition as the effect ID and privately send the authoritative inventory state.

`PlayerView` and `player_stats_changed` include persistent Sword Skill, Distance Skill, Fletching Skill, and Magic Level values plus their current training attempts. Only server-confirmed melee hits, ammunition hits, completed ammunition batches, sigil crafting, and magic-item uses advance these counters.

`CreatureView` includes its current AI state and immunity flag. `creature_state_changed` reports transitions such as chasing, attacking, returning, and idle. Returning creatures reject all incoming attack and item-use intentions server-side.

`use_item` contains an owned item instance ID and target entity ID. The server resolves the item's combat effect, validates ownership, charges, target, range, and cooldown, then atomically persists the consumed charge and any resulting damage, experience, or loot. A successful use broadcasts `combat_effect` with its source, target, effect ID, damage, and cooldown so clients render only confirmed actions.

`start_rune_crafting` currently starts either a sigil or fletching production recipe with 1–20 batches. The server owns vocation permission, input and output quantities, queue duration, combat pause, mana cost, stacking, and skill advancement. Mages and Druids may produce sigils; every vocation may turn Mire Fiber into Rough Arrows. `cancel_rune_crafting` ends the queue, while `rune_crafting_changed` reports its state. Production queues exist only while the character is online.

Direct trade uses `request_trade`, `respond_trade`, `set_trade_offer`, `confirm_trade`, and `cancel_trade`. `trade_state` is private to each participant and presents offers from that player's perspective. Changing either offer clears both confirmations. The second confirmation triggers fresh ownership, distance, item-location, and carrying-capacity validation followed by one atomic two-inventory database transaction. `trade_closed` reports completion, decline, cancellation, or disconnect.

The initial `welcome` includes physical `NpcView` entries with identity, position, dialogue, and basic shop offers. `buy_from_npc` contains only the NPC ID, offer ID, and a bundle count from 1 to 20. The server resolves the offer, requires the player to be beside that NPC, rejects active trades, counts and consumes physical Gold Coins, checks carrying capacity, creates the purchased items, and persists the resulting inventory atomically. Client prices and item definitions are never accepted.

`NpcView.service` distinguishes the initial shop and depot interactions. `welcome` includes the character's Greyhaven depot. `deposit_item` and `withdraw_item` contain only the physical vaultkeeper ID and a root item instance ID. The server requires proximity, rejects trade-locked and invalid locations, moves a container together with its descendants, enforces the 200-root-slot depot limit, checks capacity on withdrawal, and atomically rewrites both item locations. `depot_changed` privately returns the authoritative stored item set alongside the normal inventory update.

`welcome` also includes data-driven spell definitions and the character's persistent learned spell IDs. A spell-trainer `NpcView` names the definitions taught at that physical location. `learn_spell` contains only trainer and spell IDs; the server validates proximity, vocation, duplicate learning, physical Gold Coins, and active trades before atomically committing both payment and `character_spells`. `spells_changed` privately confirms the authoritative learned set. `cast_spell` contains a spell ID and target ID; the server owns learning, vocation, mana, cooldown, range, line of sight, damage, skill progression, and combat persistence.

The prototype uses tagged JSON. Rust definitions in `game-protocol` are authoritative; TypeScript definitions should eventually be generated from a shared schema in CI.
