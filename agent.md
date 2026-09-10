# AGENTS.md — Project Rules for the MMORPG

## 0. Purpose

This file contains the **authoritative project rules for coding agents** working in this repository.

The game is an original online MMORPG inspired by the design philosophy of older tile-based MMORPGs, especially the 2000s era around Tibia 7.6–7.8, but it is **not a Tibia clone**.

The project has its own:
- world
- lore
- creatures
- items
- spells
- progression
- visuals
- systems
- implementation

When a task conflicts with this file, follow this file unless the user explicitly gives a newer instruction.

User instructions in the current task always override older project assumptions.

---

# 1. Agent operating rules — IMPORTANT

These rules exist to keep agent work focused, reliable, and token-efficient.

## Scope

- Solve **only the requested task**.
- Prefer the smallest robust implementation that fully solves it.
- Do not perform unrelated refactors.
- Do not make opportunistic improvements outside scope.
- If you discover an unrelated issue, report it briefly instead of fixing it automatically.
- Do not redesign working architecture unless the requested task requires it.
- Reuse existing systems, components, utilities, types, and conventions where practical.

## Repository exploration

Do **not** scan the entire repository by default.

Use this sequence:

1. Locate the subsystem or files named by the task.
2. Search for the relevant types, functions, components, or data definitions.
3. Read only the files required to understand their immediate dependencies.
4. Implement the change.
5. Validate it with targeted checks.

Only broaden the search if the initial implementation cannot safely be completed without additional context.

Avoid:
- recursively reading unrelated directories
- repeatedly reopening unchanged files
- reading generated files or build output unless necessary
- analysing every subsystem "just in case"

## Sub-agents / delegated work

- Do not create sub-agents by default.
- Use delegation only when independent parallel work is genuinely useful.
- Do not delegate simple repository exploration, routine code edits, styling, asset wiring, or ordinary debugging.
- Prefer one focused agent completing one coherent task.

## Testing

Use the narrowest validation that gives reasonable confidence.

Preferred order:

1. relevant unit test
2. affected package/module test
3. targeted type-check
4. targeted lint/check
5. affected application build

Do not repeatedly run the entire test suite or full workspace build after every small change.

Run broader validation only when:
- shared protocol/types changed
- common infrastructure changed
- multiple packages were affected
- targeted validation is insufficient
- the user explicitly asks for full validation

## Stop condition

When the requested task:
- is implemented,
- compiles/type-checks where relevant,
- passes appropriate targeted validation,
- and satisfies the requested behavior,

**stop working.**

Do not continue polishing unrelated code.

---

# 2. Source-of-truth hierarchy

When requirements conflict, use this order:

1. the user's latest explicit instruction
2. this AGENTS.md
3. current repository architecture and implementation
4. project documentation under `/docs`
5. older comments, TODOs, prototypes, or obsolete implementations

Never resurrect an older design simply because old code still exists.

If existing code contradicts an explicit current project rule, migrate the affected code toward the current rule when that is part of the requested task.

---

# 3. Current core game decisions

These decisions are current and must not be reverted without explicit instruction.

## 3.1 Classless character system

The game is **classless**.

There are no fixed player vocations/classes such as:
- Warrior
- Knight
- Ranger
- Paladin
- Mage
- Sorcerer
- Druid

Do not build gameplay around a permanent class selection.

Players shape their character through:
- skills
- equipment
- weapon choices
- magic
- spells
- progression choices
- supplies
- attributes/specialization systems where appropriate
- actual playstyle

A player may become heavily melee-oriented, ranged-oriented, magical, supportive, hybrid, or change direction over time depending on game-system rules.

Do not create:
- `vocationId`
- class-specific character creation
- permanent class restrictions
- hard-coded Warrior/Mage/Druid branches

unless explicitly requested as a new design decision.

Abilities and equipment may still have requirements such as:
- level
- skill
- magic proficiency
- weapon proficiency
- learned knowledge
- quest unlock
- equipment
- resource requirements

Prefer requirements based on progression rather than fixed class identity.

## 3.2 NPC interaction

NPC interaction must **not** use old Tibia-style typed keyword conversations.

Do not require players to type:
- `hi`
- `trade`
- `runes`
- `buy 20`
- hidden keywords

Primary NPC interaction:

1. Player right-clicks or context-interacts with an NPC.
2. Player chooses **Talk** or another available interaction.
3. A modern dialogue interface opens.
4. Player selects topics/options.
5. Dialogue can branch based on state and knowledge.

NPC dialogue should support:
- lore
- rumours
- quests
- trading
- services
- clues
- branching conversation
- reputation/state
- knowledge-based options
- secrets
- previously discovered information
- conditional options

The underlying system may internally use topic IDs/state-machine concepts, but these are not manually typed by the player.

Example internal topic IDs are fine:

```text
town_history
missing_scout
blank_runes
northern_cave
```

The player should see natural clickable dialogue choices, not internal IDs.

## 3.3 2.5D presentation

The current visual direction is **2.5D** rather than fully 3D characters and monsters.

The game remains tile-based with a fixed/supported top-down style.

Characters and creatures should use 2D sprite-based presentation integrated into the renderer.

Movement supports:
- cardinal movement
- diagonal movement

Visual assets should support the directions required by the current sprite/animation pipeline.

Do not reintroduce full 3D creature/character models as the default gameplay representation unless explicitly requested.

Dynamic lighting and modern rendering remain desirable.

---

# 4. Game identity

The main design goal is:

> Players must be able to play alone, but the world should be designed so other players remain economically and socially relevant.

The game should preserve strengths associated with older MMORPG design:

- player-driven economy
- trade
- interdependence
- meaningful supplies
- meaningful loot
- exploration
- dangerous world
- persistent characters
- physical geography
- social towns
- useful crafting/production
- player-created consumables
- hunting knowledge
- cooperation
- long-term progression

Modernize:
- controls
- UI
- rendering
- networking
- performance
- accessibility
- inventory interaction
- hotkeys
- logging
- tooling
- server security
- synchronization

Modernize **friction**, not the underlying depth.

Avoid turning the game into a menu-driven single-player MMO.

---

# 5. Physical world

The world should feel like a real persistent place.

Important consequences:

- towns occupy real map locations
- hunting grounds exist physically in the world
- caves have real entrances
- travel distance matters
- players encounter each other naturally
- NPCs, banks, depots, shops, and houses exist at physical locations
- items exist in the world or inside containers
- loot must normally be transported
- exploration matters
- players should not teleport directly between most activities from menus

---

# 6. Player-driven economy

The economy is a core gameplay system.

NPCs may provide basic necessities, but should not remove the need for other players.

NPC shops may sell things such as:
- starter equipment
- basic weapons
- basic armour
- food
- simple tools
- raw consumable inputs
- blank rune-like materials
- basic ammunition

NPCs should normally not provide unlimited access to:
- high-end equipment
- advanced supplies
- rare items
- best combat consumables
- end-game resources

Important goods should primarily enter the economy through:
- players
- creatures
- crafting
- professions
- quests
- bosses
- exploration
- events

For important consumables, be able to answer:

1. Where does it come from?
2. Who produces it?
3. Who consumes it?
4. What does production cost?
5. What limits production?
6. What removes it from the economy?

If the answer is simply "an NPC sells unlimited amounts", reconsider the system.

---

# 7. Rune / magical consumable economy

Player-produced magical consumables are a central economic loop.

The exact names and spell system may evolve, but the principle remains:

- players obtain raw/blank materials
- production consumes meaningful resources
- mana or another character resource can represent production capacity
- produced consumables can be used or traded
- production takes real time/resources
- the character remains part of the online world
- the system should create player-to-player demand

Avoid both extremes:

Bad:

```text
Manually press the same spell every 30 seconds for four hours.
```

Also bad:

```text
Click "create 500", log out, and receive them later with no meaningful cost.
```

A controlled production queue is acceptable when it:
- consumes actual resources
- respects mana/resource regeneration
- requires appropriate conditions
- remains interruptible
- does not bypass the economy
- does not turn production into offline passive generation

Because the game is classless, rune production must not be hard-coded to a `Mage` or `Druid` class.

Instead use requirements based on progression, learned magic, skills, equipment, knowledge, or equivalent systems.

---

# 8. Character progression

Progression should have multiple dimensions.

Potential dimensions:
- character level
- weapon skills
- defence/shielding
- ranged proficiency
- magical proficiency
- crafting/profession progression
- equipment
- spell/ability knowledge
- player preparation
- supplies
- positioning and player skill

Usage-based progression is appropriate where it improves the game.

Avoid systems where the optimal strategy is meaningless repetitive abuse for many hours.

Use:
- diminishing returns
- eligibility rules
- anti-abuse checks
- meaningful targets/activities

where needed.

Level should matter but should not be the sole determinant of power.

---

# 9. Combat

Combat should be easy to understand and difficult to master.

Core concepts:
- tile positioning
- distance
- line of sight
- movement
- melee
- ranged combat
- magic
- armour
- defence/shielding where applicable
- resistances
- area attacks
- fields
- walls
- chokepoints
- resource management
- preparation

Avoid large modern MMO action bars with dozens of mandatory active abilities.

Prefer fewer meaningful actions used tactically.

---

# 10. Movement and controls

Support modern controls while preserving tile-based gameplay.

Potential controls:
- WASD
- arrow keys
- click-to-move
- click tile
- click target
- target lock
- attack
- interact
- loot
- drag-and-drop
- configurable hotkeys

Diagonal movement should be supported.

Input should feel responsive.

Where safe, use:
- short input buffering
- client-side visual movement prediction
- server reconciliation
- immediate feedback

The server remains authoritative.

---

# 11. Server authority

The client sends intentions.

The server decides outcomes.

The client must never be authoritative for:
- position
- movement validity
- speed
- HP
- mana/resources
- damage
- XP
- skill progression
- inventory
- item creation
- item ownership
- loot
- gold
- trade results
- cooldowns
- spell success
- target validity

Typical client intentions:

```text
Move(direction)
Attack(entityId)
Interact(entityId)
UseItem(itemId, target)
CastAbility(abilityId, target)
MoveItem(...)
TradeAction(...)
DialogueChoice(npcId, topicId)
```

Validate all external input.

Assume the client can be modified or malicious.

---

# 12. Inventory and items

Maintain a physical inventory model.

Items may exist:
- on tiles
- in containers
- inside nested containers
- in equipment slots
- in depots/stashes where supported
- in houses

Modern QoL is encouraged:
- stack movement
- stack splitting
- quick move
- sorting
- configurable loot destinations
- search where appropriate

Avoid unlimited global inventory or automatic teleportation of all loot.

Items have meaningful weight/capacity where that remains part of the current design.

Separate:

```text
ItemDefinition
```

from:

```text
ItemInstance
```

Use stable internal IDs.

Do not build gameplay logic around display names.

All economically important item operations must prevent:
- duplication
- lost items
- negative quantities
- simultaneous ownership
- invalid container state

---

# 13. Trading

Support secure player trading.

Direct trade should:
- show both offers clearly
- reset confirmation if either offer changes
- validate ownership
- validate quantities
- validate capacity/inventory constraints
- execute atomically
- handle disconnects safely
- leave both players in a deterministic final state

Marketplace systems may exist, but must not make direct trade or player interaction irrelevant.

Use database transactions for economically critical persistent operations.

---

# 14. Loot and hunting

Loot should have economic identity.

Different hunting locations can emphasize different rewards:
- XP
- profit
- crafting materials
- rare equipment
- solo efficiency
- party play
- resource gathering

Creature loot is server-side and data-driven.

Support weighted loot tables and explicit probabilities.

Physical corpse/container loot is preferred for ordinary creatures unless another design is intentionally chosen.

---

# 15. World and map model

The world is tile-based and supports multiple floors.

A tile may conceptually contain:

```text
position
ground
items
creatures
players
effects
flags
```

Useful flags may include:

```text
walkable
blockProjectile
blockSight
protectionZone
safeZone
stairs
ladder
door
teleport
```

Use chunks/regions for map streaming and interest management.

Do not send the entire world to every client.

Sessions should receive only relevant:
- map chunks
- players
- creatures
- items
- effects
- projectiles
- nearby communication

---

# 16. Creatures

Creature behavior is server-side.

Typical states may include:

```text
Idle
Roaming
Alert
Chasing
Attacking
Fleeing
Returning
Dead
```

Support extensible behavior for:
- melee
- ranged attacks
- spells
- healing
- summons
- target selection
- distance management
- fleeing
- pack behavior
- bosses

Avoid obvious unlimited pathfinding exploits.

Creature definitions, loot, attacks, stats, and similar content should be data-driven where practical.

---

# 17. Quests and exploration

Avoid generic quest-hub design.

Quests should often be discovered through:
- NPC conversations
- exploration
- books
- rumours
- environmental clues
- other players
- discovered knowledge

A quest log may exist for usability, but it should primarily record what the character has actually learned.

Do not place an icon on the map for every secret or objective.

Reward exploration with:
- hidden passages
- dungeons
- shortcuts
- lore
- rare spawns
- treasures
- resources
- quests

---

# 18. Social systems

Communication is gameplay.

Support systems may include:
- local/say communication
- private messages
- party
- guild
- trade
- help/general channels

Local communication may appear over characters and be proximity-limited.

Party systems should eventually support:
- invite
- join/leave
- leadership
- shared XP
- party communication
- health/status information
- optional shared loot rules

Shared XP should require appropriate participation/proximity to limit abuse.

---

# 19. Houses

Player houses are real parts of the map.

Architecture should permit:
- ownership
- rent
- doors
- access lists
- beds if desired
- decoration
- persistent containers/items
- guild halls

Do not implement unrelated housing features during another task merely because the architecture mentions them.

---

# 20. Technical architecture

## Client

The production desktop client is `crates/game-client`, implemented in Rust with Bevy/wgpu. It owns both gameplay rendering and native UI. Do not reintroduce a Tauri, WebView, React or Three.js gameplay runtime.

The browser-based React code under `apps/world-editor` is an authoring tool only and must not become a gameplay client.

Use the native Bevy renderer already present in the repository unless a task explicitly requires changing it.

Do not replace the renderer/library solely because another technology might also work.

## Game server

The game server is a separate application.

Rust is preferred/current where the repository uses it.

Likely technologies may include:
- Tokio
- Axum where HTTP is required
- WebSocket or the current persistent protocol
- SQLx
- Serde
- tracing

Avoid unnecessary dependencies.

Use a **modular monolith** first.

Do not introduce microservices, Kubernetes, distributed event buses, or similar infrastructure without a demonstrated need.

## Database

PostgreSQL stores persistent information.

Do not use PostgreSQL as the realtime game loop.

Active world state belongs in server memory.

Persist at controlled points such as:
- login/logout
- periodic save
- critical transactions
- relevant state transitions

Use database transactions for persistent economic operations.

---

# 21. Protocol

Separate ordinary HTTP/API concerns from the persistent realtime game connection where appropriate.

Protocol messages should be explicit typed messages rather than arbitrary JSON bags.

Version the game protocol.

Client and server must not silently drift into incompatible schemas.

When shared protocol definitions change, check all direct producers and consumers.

Do not inspect unrelated systems merely because protocol code is shared.

---

# 22. Data-driven content

Prefer data definitions for:
- creatures
- items
- spells/abilities
- loot
- NPC definitions
- NPC dialogue topics
- quests
- spawn definitions

Validate content at load/startup where practical.

Fail clearly on invalid authoritative content rather than silently running corrupted definitions.

Do not overbuild a generic content framework before it is needed by actual content.

---

# 23. Performance

The client should target high FPS on modest hardware.

Important areas:
- batching
- texture atlases where relevant
- sprite/entity updates
- Bevy UI and render-world update cost
- allocations
- network traffic
- map streaming
- interest management

Profile before making large optimization changes.

Do not prematurely rewrite working code based only on theoretical performance concerns.

The initial server architecture should prioritize a well-working single world/server, not hypothetical massive scale.

---

# 24. Server tick and simulation

Use a deliberate simulation/update model.

Not every system must run every world tick.

Possible strategies:
- movement: event-driven / controlled simulation
- AI: lower-frequency updates where sufficient
- conditions: scheduled intervals
- regeneration: scheduled intervals

Exact timings must come from the current implementation and measurements, not copied blindly from examples.

Keep simulation logic independent from rendering.

---

# 25. Testing priorities

High-risk systems deserve strong tests, especially:
- inventory
- item stacking
- item ownership
- movement validation
- combat calculations
- trade
- production/crafting
- XP
- loot
- database transactions
- persistence

Economic duplication bugs are critical.

Combat math should be testable without launching the entire client/server stack where practical.

---

# 26. Logging and debugging

Use structured logging.

Do not log:
- plaintext passwords
- authentication tokens
- private credentials

Useful contextual fields may include:
- player ID
- character ID
- session ID
- action
- entity ID
- map position

Development/debug tooling may expose:
- FPS
- ping
- coordinates
- tile/chunk
- entity count
- server tick statistics
- network traffic

Only build such tooling when relevant to current development work.

---

# 27. Anti-cheat principles

Assume the client is untrusted.

Server checks should cover relevant cases such as:
- impossible movement
- invalid speed
- attack range
- line of sight
- cooldowns
- resource requirements
- item ownership
- target validity
- inventory state
- trade state

Prefer authoritative validation and server-side anomaly detection over invasive client anti-cheat architecture.

Do not automatically ban based on weak heuristics.

---

# 28. Development style

Prefer:
- clear types
- small coherent modules
- explicit errors
- existing project conventions
- vertical slices
- testable logic
- server-side game rules
- explicit validation

Avoid:
- God Objects
- giant files without reason
- duplicated business logic
- silent failure
- speculative abstraction
- dependency sprawl
- placeholder systems presented as complete
- building future systems before the current gameplay slice needs them

Do not create a generalized framework when a small concrete implementation is enough.

---

# 29. Vertical-slice rule

Development should remain playable/testable throughout the project.

For a requested gameplay feature, connect the relevant layers end-to-end when the task requires a real implementation:

```text
UI/input
    ↓
client logic
    ↓
protocol
    ↓
server validation
    ↓
game state
    ↓
persistence (when relevant)
    ↓
response/update
    ↓
client state
    ↓
UI/rendering
```

This does **not** mean every task must touch every layer.

Only modify layers actually required by the requested feature.

---

# 30. Definition of Done

A feature is complete when its requested behavior works, not merely when a UI element exists.

For server-authoritative gameplay, verify the important state transition and failure cases.

Examples:

A trade feature is not "implemented" just because a trade window opens.

Movement is not "fixed" just because the sprite visually moves if the server state still disagrees.

NPC dialogue is not "implemented" if a placeholder window exists but choices have no real state/actions.

A sprite animation is not "implemented" if it works in isolation but the movement system never selects it.

Keep validation proportional to the task.

---

# 31. Priority order

When implementation choices conflict, normally prioritize:

1. correctness
2. server-authoritative gameplay
3. prevention of item/gold duplication and state corruption
4. responsive controls
5. stable multiplayer synchronization
6. maintainable code
7. player-driven economy
8. usable UX
9. performance supported by evidence
10. graphical polish

For tasks specifically about visuals or UX, that task's explicit objective takes priority while still respecting correctness and architecture.

---

# 32. First playable identity

The first meaningful game loop should ultimately allow a player to:

1. launch the client
2. log in
3. select/create a character
4. enter a real town
5. move with modern controls
6. see other players
7. communicate
8. interact with NPCs through context/dialogue choices
9. obtain basic equipment
10. leave town
11. encounter creatures
12. fight
13. gain XP/progression
14. loot corpses
15. return with loot
16. use storage/depot
17. produce useful player-created consumables through learned progression
18. trade them with another player
19. let that other player use those supplies during gameplay

Because characters are classless, this loop must not assume that only a predefined Mage/Druid can produce magical supplies.

---

# 33. Social design check

For major systems, ask:

> Does this create or preserve a reason for players to interact?

Good examples:
- player production
- direct trade
- party hunting
- guilds
- local economy
- scarce resources
- knowledge sharing

Potentially harmful if overused:
- unlimited NPC supplies
- teleportation to every activity
- unlimited inventory
- instant offline production
- fully automated progression
- global systems that remove geography
- mechanics that make every character entirely self-sufficient

---

# 34. Quality-of-life rule

Modernize frustration, not gameplay depth.

Good QoL examples:
- configurable controls
- modern hotkeys
- responsive movement
- stack manipulation
- container sorting
- search
- clear tooltips
- sensible loot interaction
- modern NPC dialogue
- useful minimap
- readable UI
- clear status/error feedback

QoL should reduce unnecessary input, not eliminate meaningful decisions, travel, resource constraints, economy, or risk.

---

# 35. Handling unclear tasks

Do not immediately perform a repository-wide investigation.

First infer the most likely intended scope from:
- the user's wording
- files explicitly referenced
- the subsystem currently being worked on
- existing nearby implementation

If a safe narrow implementation is possible, do it.

If an ambiguity could cause destructive or architecturally incompatible work, stop before making that destructive change and report the specific ambiguity.

Do not use ambiguity as a reason to over-explore the repository.

---

# 36. Required completion report

At the end of implementation, respond concisely with:

- what changed
- important files changed
- validation performed
- any unresolved issue directly relevant to the requested task

Do not produce a long retrospective unless asked.

Do not list every file inspected.

Do not suggest unrelated follow-up work.

---

# 37. Final agent checklist

Before editing:

- What exactly did the user ask for?
- Which subsystem owns it?
- What is the smallest set of files likely involved?
- Does the task conflict with a current rule in this file?

Before finishing:

- Does the requested behavior actually work?
- Did I avoid unrelated refactors?
- Did I preserve server authority?
- Did I preserve the classless design?
- Did I avoid typed-keyword NPC interaction?
- Did I use targeted validation?
- Did I stop once the task was complete?

# V34 – Client UX, progression, combat, updater och world map

Fortsätt från nuvarande implementation. Detta är ett sammanhängande stabiliserings- och feature-pass. Börja med att inspektera befintlig kod och följ befintlig arkitektur. Skapa inte parallella system, duplicerade registries eller nya hårdkodade specialfall när funktionaliteten redan finns någon annanstans.

Viktigt från tidigare milestones:

* Behåll den classless progression-modellen.
* Behåll 2.5D/sprite-pipelinen för creatures.
* `castle_rat` är den tekniska referensen för monster-assets.
* Secondary skills ska ha **två separata begränsningar: max 2 Gathering och max 2 Crafting**. Det är INTE max två secondary skills totalt.
* Förstör inte updater/signing/preflight-arbetet från V33.5.2.
* Kör snabb preflight/typecheck/test innan någon lång Tauri-build. En lång full build ska komma sist när de billiga kontrollerna redan passerat.

---

# 1. BUG – UI scaling måste även omfatta alla modaler

När klientfönstret blir mindre skalas delar av UI:t, men modal/dialog-fönster följer inte samma scaling.

Fixa detta systemiskt.

Kontrollera särskilt:

* modal dialogs
* confirmation dialogs
* inventory/storage windows
* character windows
* skill windows
* crafting/gathering dialogs
* world map
* tooltips
* context menus
* updater-dialog
* andra komponenter renderade via React portals

Misstänkt grundproblem är att portal-renderade element hamnar utanför den DOM-root/CSS-context där UI-scale appliceras.

Vi ska inte lösa varje modal individuellt.

Skapa en gemensam UI scale source/token som även portal-root använder.

Acceptance:

1. Starta klienten stort.
2. Öppna flera olika modaltyper.
3. Förminska klienten kraftigt.
4. All UI ska fortfarande passa på skärmen.
5. Text och kontroller ska fortfarande vara användbara.
6. Ingen modal ska fortsätta använda desktop-scale när resten av HUD:en skalats ned.
7. Tooltip/context menu får inte hamna utanför viewport.

---

# 2. BUG – Updater får ALDRIG öppna ett separat terminalfönster

Nuvarande updater-flow får inte öppna cmd/PowerShell/terminal för spelaren.

Updatern ska vara en del av själva klientupplevelsen.

När klienten startar och användaren kommer till login/startflödet ska klienten automatiskt kontrollera efter uppdateringar.

Om en uppdatering finns ska användaren få ett riktigt updater-UI inne i klienten med exempelvis:

* aktuell version
* ny version
* download state
* progressbar
* procent
* downloaded bytes / total bytes där det finns
* downloading
* verifying
* installing
* restarting
* tydligt felmeddelande vid problem

Själva installations-/replacement-processen får använda den befintliga updater-arkitekturen under huven, men något terminalfönster får inte visas.

Undvik console-window flash även när child processes startas på Windows.

Behåll signing/verifiering.

VIKTIGT:

Rör inte bort tidigare preflight-arbete runt updater signing. Vi ska fortfarande fånga signing/configuration-fel snabbt innan en lång Tauri-build.

---

# 3. BUG – Texten är fortfarande för liten

Öka läsbarheten i klientens UI.

Det är framför allt svårt att snabbt läsa saker som:

* item weight
* stack amount
* stats
* requirements
* inventory information
* storage information
* skills
* crafting information
* tooltip values

Gör inte hundratals lokala `font-size`-patchar.

Skapa eller förbättra gemensamma typography tokens för UI:t.

Vi behöver åtminstone tydlig skillnad mellan:

* secondary/meta text
* normal UI text
* important values
* headings

Texten ska fortfarande fungera tillsammans med responsive UI scaling.

---

# 4. BUG – Storage-layout blir ojämn när ett item inte har amount-input

Storage-rader använder idag olika layout beroende på om itemet har quantity/amount input.

Resultatet är att text, värden och kontroller hamnar på olika horisontella positioner.

Bygg storage-raden med stabila kolumner/grid.

Exempel på logiska kolumner:

item icon | item information | weight/metadata | quantity | action

Om quantity inte är relevant ska kolumnens utrymme fortfarande hanteras så att övrig information ligger på samma position.

Ingen text ska hoppa vänster/höger mellan två items bara för att amount-input saknas.

Testa:

* stackable item
* non-stackable item
* item med amount selector
* item utan amount selector

---

# 5. BUG/FEAT – Gameplay rewards ska skrivas i chatten

När spelaren får saker via gameplay ska relevant information även visas i chat/system-loggen.

Minst:

* experience
* gold
* gathering rewards
* crafting results
* relevanta item rewards
* skill progression där det passar

Exempel på beteende:

`You gained 45 experience.`

`You received 12 gold.`

`You mined 2 Copper Ore.`

Använd befintligt chat/event-system. Skapa inte en separat fake-chatlogg i klienten.

Servern ska helst vara authoritative source för rewards så klienten inte själv gissar vad den fått.

Undvik spam där samma reward skrivs två gånger från två olika event paths.

---

# 6. BUG – Veins får inte användas på avstånd

Det går fortfarande att interagera med mining veins när spelaren befinner sig för långt bort.

Det måste valideras både klient- och serverside.

Client:

* blockera interaction om target är för långt bort
* visa gärna korrekt disabled cursor/highlight/state
* spelaren ska förstå varför interaction inte sker

Server:

* validera spelarens position mot veinens position
* kontrollera korrekt interaction range
* ignorera/rejecta requests utanför range

Client validation räcker INTE eftersom requests går att manipulera.

Använd samma distance/range-princip för andra world interactions där den redan är relevant.

---

# 7. FEAT – Enemies ska kunna highlightas

Utöka befintligt hover/selection/highlight-system så monsters/enemies också kan highlightas.

Vi behöver kunna skilja på exempelvis:

* normal enemy
* hovered enemy
* selected/targeted enemy

Det ska fungera med 2.5D creature sprites.

Highlighten får inte:

* förstöra normal maps
* slå ut dynamisk lighting
* skapa en duplicerad monster-sprite
* orsaka märkbart FPS-tapp

Återanvänd befintlig interaction/highlight-arkitektur där det går.

---

# 8. CRITICAL BUG – Gathering och Crafting räknas fortfarande som samma två secondary skills

Det här verkar fortfarande använda den gamla modellen.

KRAVET ÄR:

## Gathering

Spelaren får ha max:

**2 aktiva/valda Gathering professions**

## Crafting

Spelaren får separat ha max:

**2 aktiva/valda Crafting professions**

Det betyder exempelvis att en spelare ska kunna ha:

Mining
Fishing

OCH samtidigt:

Blacksmithing
Alchemy

Detta är giltigt eftersom det är:

2 Gathering + 2 Crafting.

Systemet får INTE behandla detta som fyra secondary skills mot en global cap på två.

Kontrollera hela flödet:

* database/persistence
* server domain models
* profession selection
* validation
* API/messages
* client state
* skills UI
* character loading
* reconnect
* character creation
* gamla characters/migration

Det ska finnas en explicit category/type på skills/professions. Ingen kontroll baserad på namnet på professionen.

Lägg tester som uttryckligen bevisar:

* gathering 1 = OK
* gathering 2 = OK
* gathering 3 = reject
* crafting 1 = OK
* crafting 2 = OK
* crafting 3 = reject
* 2 gathering + 2 crafting = OK

---

# 9. FEAT – Lägg in resterande enemy models/assets

`castle_rat` är fortfarande reference implementation.

Färdigställ och koppla in resterande monster:

* `mireling`
* `mire_skulker`
* `reed_stalker`
* `fen_brute`
* `crypt_guard`
* `bone_acolyte`
* `cellar_warden`

De har tidigare bara haft `ASSET_SPEC.json` medan Castle Rat haft den kompletta tekniska pipelinen.

Följ Castle Rat-strukturen för:

* atlas metadata
* animations
* directions
* sprite loading
* normal map
* foot anchor/origin
* preload
* animation state mapping
* fallback handling
* asset registry

Vi ska fortsätta använda 2.5D creatures i Three.js-världen så dynamisk lighting och depth fortfarande fungerar.

Använd INTE de gamla 3D-creature-modellerna som permanent fallback om respektive monster ska använda sprite-pipelinen.

Ingen enemy ska visas som Castle Rat bara för att dess egna assets saknas.

---

# 10. CRITICAL BUG – Learned abilities/magic går inte att använda från action bar

Det finns ett större arkitekturproblem här.

En karaktär kan lära sig exempelvis magic abilities/spells, men klienten visar inte korrekt vilka abilities karaktären faktiskt känner till. Därför finns inget naturligt sätt att dra dem till action bar.

Bygg ett riktigt character ability system i UI:t.

Det ska finnas en lista/panel med karaktärens upplåsta abilities/spells.

Den ska bygga på authoritative character progression data.

Den får INTE bygga på en hårdkodad lista.

Varje ability behöver kunna exponera relevant metadata såsom:

* id
* name
* icon
* description
* type/category
* cost
* cooldown
* range där relevant
* requirements
* learned/unlocked state

Spelaren ska kunna dra eller lägga en learned ability från denna lista till en action bar slot.

Locked/unlearned abilities får inte gå att använda.

Detta måste fungera med vårt CLASSLESS-system.

Abilities kommer från vad karaktären faktiskt lärt sig genom progressionen, inte från en vocation/class.

---

# 11. BUG – Action bar 1 och 2 är hårdkodade på nya characters

Ta bort detta.

En nyskapad character ska börja med:

**tomma action bars**

Det får inte finnas hårdkodade default skills i slot 1 och slot 2.

Action bar state ska baseras på sparad character state.

Ny character:

alla slots tomma.

Befintlig character:

återställ sparade bindings.

Server/client måste också hantera att en tidigare bunden ability inte längre är giltig.

---

# 12. BUG – Det går inte längre att äta

Återställ food consumption.

Kontrollera hela item-use pathen och ta reda på vad som brutits.

Food ska använda samma generella item interaction/use-system som andra usable items där det är möjligt.

Vid användning:

* server validerar item
* food-effekten appliceras
* korrekt quantity tas bort
* inventory uppdateras
* relevant feedback visas

Duplicera inte food logic i klienten.

Testa både:

* ett food item
* stack med flera food items

och kontrollera att exakt rätt amount konsumeras.

---

# 13. FEAT – Utöka skill-systemet, minst Shielding

Lägg till **Shielding** som riktig character skill.

Shielding ska inte vara en secondary profession och ska därför inte påverka 2 Gathering + 2 Crafting-regeln.

Den ska finnas i samma generella skill/progression-system som andra character skills.

Skillen måste:

* lagras per character
* laddas korrekt
* visas i Skills UI
* kunna få experience/progress
* ha korrekt current level/progress
* kunna användas av combat calculations

Shielding ska utvecklas från relevant defensivt gameplay, inte från ett godtyckligt timer-event.

Auditera samtidigt befintliga combat/magic skills.

Om det redan finns backend-skills som klienten inte visar ska de exponeras genom det gemensamma skill-registret istället för att nya dubletter skapas.

Systemet ska vara data-driven så fler skills senare kan läggas till utan att varje UI-komponent behöver specialkod.

---

# 14. CRITICAL BUG – Spelaren kan inte själv attackera enemies längre

Återställ normal player-initiated combat.

Spelaren ska kunna välja/attackera en enemy även om monstret inte först attackerar spelaren.

Kontrollera hela pathen:

input
→ targeting
→ combat request
→ server validation
→ combat state
→ attack cadence
→ damage
→ animations
→ death/reward

Servern ska fortsätta validera:

* target existerar
* target är attackable
* range
* floor/z-level
* line/rules där det används
* cooldown/attack interval
* character state

Enemy targeting/highlight ska integreras med detta.

Vi ska inte behöva vänta på att monstret aggrar för att kunna slå det.

---

# 15. FEAT – WoW-liknande item tooltips vid hover

När spelaren hovrar ett item ska ett riktigt tooltip visas med item-information.

Tänk World of Warcraft i principen, men använd vårt eget UI.

Tooltip ska läsa från item metadata och bara visa information som faktiskt finns.

Exempel:

Item Name

Item type

Armor / Attack / Defense

Required skill/level där relevant

Weight

Stack amount där relevant

Special modifiers

Description

Övriga stats

Tooltipen ska fungera i minst:

* inventory
* equipment
* storage
* loot/container
* crafting UI
* merchant/trade UI där dessa använder samma items
* world item hover där det är relevant

Undvik separata tooltip-implementationer per fönster.

Skapa en återanvändbar `ItemTooltip`/item inspection model.

Tooltipen ska även följa responsive UI scaling från punkt 1.

Tooltip får inte gå utanför viewport; positionen ska flip/adjust automatiskt nära skärmkanter.

---

# 16. FEAT – World Map, toggle med M

Lägg till en riktig world map.

`M` ska toggla kartan:

M → öppna
M igen → stäng

`Escape` ska också kunna stänga den.

Kartan ska vara ett ordentligt klientfönster/overlay och följa UI scaling.

Minimikrav:

* world map
* current player position
* korrekt current z/floor
* pan
* zoom
* fungerande resize
* öppna/stäng med M
* inga player movement inputs ska läcka igenom när användaren aktivt interagerar med kartan

Använd den riktiga world/map-datan.

Generera inte en separat fake-karta som riskerar att avvika från världen.

Arkitekturen ska senare kunna stödja exempelvis:

* markers
* discovered locations
* POIs
* party members
* custom player markers

men bygg inte onödiga placeholder-system nu.

---

# 17. BUG – Ta bort Drop-knappen/Drop-containern från Character window

Character/equipment-fönstret ska inte ha en separat knapp eller container vars syfte är att droppa items.

Det blir inkonsekvent med inventory-systemet.

Ta bort denna UI-yta.

Dropping ska använda samma interaction model som inventory redan använder.

Det betyder att equipment/character slots ska bete sig som riktiga item slots och följa den gemensamma drag/drop/use/context-menu-logiken.

Skapa inte en separat "character drop"-mekanik.

---

# Arkitekturkrav

Under arbetet ska följande principer följas:

1. Server authoritative för combat, rewards, item use, skills och profession limits.
2. Client får ge omedelbar UI-feedback men får inte vara ensam validator.
3. Ett gemensamt item model/registry ska användas av inventory, storage, tooltips, crafting etc.
4. Ett gemensamt skill/ability model ska användas av character UI och action bars.
5. Ett gemensamt responsive UI scale-system ska användas av vanliga komponenter och portals/modals.
6. Inga nya class/vocation-hardcodes. Systemet är classless.
7. Ingen global `secondarySkills <= 2`-regel får finnas kvar.
8. Ingen hårdkodad action bar för nya characters.
9. Inga terminalfönster från updatern.
10. Undvik klient-only fixes för gameplayregler som går att exploita.

---

# Regression audit

När implementationen är klar, sök explicit efter gammal logik som fortfarande kan ligga kvar.

Sök efter saker motsvarande:

`secondarySkills`

`maxSecondarySkills`

`<= 2`

action bar default slots

default abilities

hardcoded spell IDs

old updater terminal commands

shell/cmd/PowerShell spawning

old food use handlers

old attack handlers

vein interaction range

monster fallback assets

duplicerade item tooltips

duplicerade UI scale values

Det räcker inte att den nya implementationen fungerar om den gamla fortfarande körs parallellt någonstans.

---

# Validation order

Kör INTE direkt en lång Tauri release-build.

Kör i denna ordning:

1. relevanta unit tests
2. server tests
3. frontend typecheck
4. backend/Rust compile/check där relevant
5. lint
6. frontend production build
7. updater/signing preflight
8. targeted runtime tests
9. först därefter full Tauri build/package om alla billiga kontroller passerat

Om ett tidigt steg misslyckas: fixa det innan full build.

---

# Manuell testmatris

Verifiera minst följande i riktig klient:

Small window UI:
alla HUD-delar + modal + tooltip

Updater:
update hittas → progress visas → inget terminalfönster

Storage:
stackable + non-stackable ligger korrekt linjerade

Rewards:
XP + gold + gathering reward visas i chatten

Mining:
för långt bort = reject
nära = fungerar

Enemy:
hover highlight
select target
player initiates attack
enemy dies
XP/reward kommer

Professions:
2 Gathering + 2 Crafting fungerar samtidigt

Abilities:
learned spell syns
kan läggas på action bar
kan användas

New character:
action bars helt tomma

Food:
item kan ätas och quantity minskar korrekt

Shielding:
syns, sparas och progression fungerar

Tooltip:
korrekta item stats och weight visas läsbart

World map:
M öppnar
M stänger
zoom/pan fungerar
player position/floor är korrekt

Character window:
ingen Drop-knapp/container kvar
items använder samma drag/drop-system som inventory

Monsters:
alla åtta creature IDs använder sina avsedda assets och animationsflöden.

---

När allt är färdigt ska du ge en teknisk slutrapport med:

* root cause för varje bug
* filer/system som ändrats
* eventuella DB-migrations
* nya tester
* resultat från tester/typecheck/build
* vilka manuella tester som genomförts
* eventuella kvarvarande problem

Markera inte milestone som klar bara för att projektet kompilerar. Varje acceptance criterion ovan ska verifieras.
