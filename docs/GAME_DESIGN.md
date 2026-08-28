# Game design

The working title is **Embers of Aldoria**, and the first city is **Greyhaven**. All visual and narrative content must remain original.

The core is a physical, persistent world where distance, weight, preparation, and cooperation matter. Solo play must work, but other players must remain economically and socially relevant. Quality-of-life features should remove repetitive friction without removing decisions about time, resources, risk, or transport.

The game uses modern controls and a contemporary modal-based MMO interface. The old-school feeling comes from tile positioning, danger, physical items, slow production, scarce resources, and player interdependence—not from recreating an outdated interface.

## First vocation profiles

Vocation is chosen during character creation and persists with the character. Warrior begins with 180 health, 30 mana, 130 capacity, Sword Skill 12, and double Sword training. Ranger begins with 145 health, 45 mana, 110 capacity, Distance Skill 12, and double Distance training. Mage begins with 105 health, 120 mana, Magic Level 2, and double Magic training. Druid begins with 115 health, 110 mana, Magic Level 2, and double Magic training.

Mage and Druid can produce sigils. Warrior and Ranger cannot produce them, but can buy, trade, carry, and use them. This intentionally creates the first asymmetrical economic dependency without making combat supplies unusable outside magical vocations. Existing pre-vocation characters retain a compatible Adventurer profile.

## First distance combat loop

A new Ranger receives an equipped Ashwood Bow and 100 Rough Arrows. With a distance weapon equipped, the normal target attack becomes a server-authoritative ranged shot instead of melee. The server requires matching physical ammunition, validates a six-tile range and clear line of sight, consumes one arrow only on a valid shot, applies Distance Skill damage, and persists the remaining stack atomically. A confirmed arrow gets its own projectile presentation rather than reusing the Ember Sigil visual.

Distance weapons are not hard-locked to Ranger. Other vocations can equip and use them, which preserves a physical item economy, but Ranger starts more proficient and advances Distance twice as quickly.

## First ammunition production loop

Mirelings provide Mire Fiber as a physical hunting resource. While online and out of combat, any vocation can queue up to 20 fletching batches. Each batch consumes one Mire Fiber, takes real time, creates ten stackable Rough Arrows, and advances persistent Fletching Skill. Production uses the same interruption and transactional persistence guarantees as sigil crafting but consumes no mana.

Allowing every vocation to begin fletching keeps the early economy playable before professions exist. Hunting effort, production time, transport, and direct trade give ammunition a player-created cost. Mara's small starter bundle is a gold sink and emergency baseline; later balancing and stock limits must keep player-made ammunition preferable. A later profession system can add specialization and higher-grade ammunition, which NPCs must not replace.

## First sigil loop

Creatures and players are selected directly in the world instead of through a permanent battle-list window. Right-clicking another player opens contextual social actions. Character stats and usage-based skills live in a modern Character modal.

Unmarked Sigils are the physical input for magical production. An online character can queue up to 20 Ember Sigils. Each completed sigil consumes one Unmarked Sigil and 35 mana, takes real time, and receives five charges. Mana regenerates slowly while online. The queue waits for mana, pauses while a creature has aggro, and ends when the player leaves the world.

Ember Sigils turn that production into useful combat supplies. Each charge deals 12 ranged fire damage up to five tiles away, with an 800 ms server-owned cooldown. The modern hotbar exposes the first combat action on key 1 while preserving physical inventory, limited charges, and player-made supply value. Confirmed casts show an ember projectile, floating damage, and the remaining cooldown directly on the hotbar.

## First hunting slice

Mirelings react to proximity, chase on the tile grid, attack in melee, award 18 XP, and can drop Mire Fiber and gold. Spawns leash to their hunting area. Death creates a physical Mireling Remains container on the death tile, and players within reach can collect its server-generated contents individually.

Mireling Remains decay after 45 seconds so hunting areas do not fill permanently with corpses. Once the final loot item is collected, the remaining decay time is shortened to at most 10 seconds. Decay is authoritative and persisted; ordinary items deliberately dropped by players do not use the corpse timer.

Creature pursuit uses server-side pathfinding around walls and does not rely on walking directly toward the player. A creature that exceeds its leash or cannot find a route enters Returning: it drops aggro, restores health, becomes immune, and follows a valid path back to its spawn before becoming attackable again. The client labels this state as `Evading · Immune`.

## Greyhaven Mire hunting zone

The first world expansion runs east from Greyhaven along a muddy causeway. Its difficulty rises spatially: familiar Mirelings introduce the outskirts, faster Mire Skulkers add pressure around the shallow pools, Reed Stalkers provide a tougher resource hunt, and slow Fen Brutes threaten the deepest reaches. Water tiles are real server-side obstacles that create routes and chokepoints. Bog Ichor, Reed Hide, and Fen Tusks are physical loot intended for later alchemy, equipment crafting, quests, and player trade rather than immediate NPC conversion.

## Direct trade

Nearby online players can exchange physical items and Gold Coin stacks through a dedicated trade modal. Offered items are locked against movement, use, splitting, and dropping. Both players must confirm the same visible state; changing either offer resets both confirmations. Completion revalidates ownership and carrying capacity and persists both inventories atomically. Decline, cancellation, transaction failure, or disconnect never transfers a partial offer.

## First Greyhaven NPC

Mara, Greyhaven Quartermaster, occupies a real tile beside the arrival point. Clicking her opens a contemporary dialogue and shop modal rather than a permanent legacy panel. Her intentionally narrow inventory contains Unmarked Sigils and starter Rough Arrow bundles. Purchases spend physical Gold Coins and require proximity and carrying capacity, creating an early currency sink without offering advanced equipment, marked sigils, or high-grade supplies. Future economy work should add finite stock or price pressure before expanding this inventory.

## First Greyhaven depot

Aldren, Greyhaven Vaultkeeper, occupies a separate physical location west of the arrival point. Each character has a persistent Greyhaven vault with 200 root-item slots and modern search. Depositing removes carried weight but does not erase physical identity: the exact item UUID moves into city-specific storage, and containers take their complete contents with them. Withdrawal requires enough carrying capacity. Both directions are server-authoritative, proximity-bound, unavailable during trade, and committed as one PostgreSQL transaction. Future cities should receive separate depots or paid transport rather than silently making all storage global.

## First Greyhaven spell trainer

Seraphine, Greyhaven Arcanist, occupies a physical location north of the arrival point and teaches Ember Bolt to Mages and Druids for 15 physical Gold Coins. Learning is permanent and atomic with payment. Ember Bolt costs 18 mana, has a short global-style cooldown and reinforces Magic progression without replacing player-made Ember Sigils: the spell consumes regenerating combat/production capacity, while sigils remain portable, tradeable supplies usable by every vocation.

## First skill progression

Sword Skill gains a legitimate training attempt on successful melee hits. Distance Skill gains attempts when physical ammunition hits a creature. Fletching Skill gains attempts from completed ammunition batches. Magic Level gains attempts from completed sigil crafting and successful magic-item use. The number of uses required increases with each level. Each skill contributes to its corresponding damage type or production discipline; level, equipment, positioning, and supplies remain separate dimensions of character strength.
