# Content

Content uses stable `snake_case` IDs and separates definitions from item and creature instances. Files under `content/` contain data, while the server implements gameplay rules.

The current names and creatures are project-specific. During startup, the server loads item, creature, and rune recipe definitions and validates unique IDs, weights, stack limits, references, and required fields. `CONTENT_DIR` can select an external content directory during deployment.

Item definitions may declare `containerSlots`, `equipmentSlot`, charges, and pickup behavior. Field Backpack is the first container, Traveler's Blade uses the weapon slot, and Mireling Remains is a non-pickupable ground container.
