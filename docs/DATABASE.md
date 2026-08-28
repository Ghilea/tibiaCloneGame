# Database

PostgreSQL stores accounts, characters, and economically important state. Active world state lives in server memory and is persisted deliberately rather than on every movement step.

Passwords use salted Argon2id hashes. Character position loads on world entry and saves on disconnect. Health, progression, mana, items, ground containers, and corpse contents are persistent.

`item_instances` has exactly one location: an owning character, a complete ground position, or an ownerless child whose parent is a ground container. Item mutations run under the world lock, save in a PostgreSQL transaction, and restore the in-memory mutation if the transaction fails.

Container children use a self-referencing `container_id` with cascading deletion. The same relationship stores corpse contents. Equipment uses `equipped_slot`, with a partial unique index preventing duplicate equipment in one character slot. Parents are always written before children.

Character `mana` and `max_mana` satisfy `0 <= mana <= max_mana`. A completed sigil craft writes mana and its item result in one transaction. The production queue itself is deliberately not persistent because crafting requires an online character.
