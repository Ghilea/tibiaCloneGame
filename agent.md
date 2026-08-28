# Projekt: modernt old-school MMORPG inspirerat av Tibia 7.6–7.8

Du ska utveckla ett online-MMO/MMORPG som hämtar **designfilosofi** från äldre tile-baserade MMORPG-spel, framför allt eran omkring Tibia 7.6–7.8, men projektet ska vara ett **eget spel** med egen värld, grafik, namn, monster, föremål, spells, kartor, lore och implementation.

Spelet ska inte vara en direkt Tibia-klon.

Målet är att kombinera det som gjorde äldre MMORPG-spel bra:

* spelardriven ekonomi
* beroende mellan spelare
* handel
* kommunikation
* farlig värld
* betydelsefull progression
* fysisk värld där avstånd spelar roll
* resurser som faktiskt måste produceras
* runor och förbrukningsvaror skapade av spelare
* jaktplatser som spelare lär sig
* loot som faktiskt har värde
* möjligheten att hjälpa, handla, jaga och samarbeta med andra

med moderna förbättringar:

* bättre rendering
* låg CPU/GPU-belastning
* bättre nätkod
* stabil serverarkitektur
* moderna kontroller
* bättre inventory-hantering
* bra hotkeys
* tydligare UI
* bättre chattsystem
* bättre trading
* bättre quality-of-life
* bra felsökning och logging
* säkrare server-authoritative gameplay
* bättre tillgänglighet
* moderna administrativa verktyg

Spelet ska **inte** följa den moderna MMO-modellen där NPC:er eller en shop gör majoriteten av spelarna oberoende av varandra.

En grundprincip för hela projektet är:

> Spelaren ska kunna spela själv, men världen ska vara designad så att andra spelare alltid är relevanta.

---

# 1. Övergripande spelidentitet

Spelet ska vara:

* top-down/isometriskt eller snett top-down
* tile-baserat
* persistent onlinevärld
* realtidsbaserat
* multiplayer
* server-authoritative
* låg tröskel att förstå
* stort djup över tid
* relativt långsam progression
* byggt kring en permanent karaktär och en persistent ekonomi

Spelvärlden ska kännas fysisk.

Det betyder bland annat att:

* städer ligger på faktiska platser
* jaktmarker ligger ute i världen
* grottor har riktiga ingångar
* transporter har viss betydelse
* spelare möter varandra ute i världen
* banker, depåer, affärer och NPC:er finns på konkreta platser
* föremål existerar som riktiga objekt i världen och inventoryt
* loot behöver transporteras tillbaka
* resurser kommer från världen och andra spelare

Undvik design där spelaren bara öppnar menyer och teleporterar mellan aktiviteter.

---

# 2. Viktig designprincip: social interdependens

Det viktigaste systemmålet är att spelare ska ha anledning att interagera.

Interaktion får inte endast bestå av:

* party finder
* matchmaking
* guild
* PvP

Ekonomin och spelmekaniken ska i sig skapa naturliga möten.

Exempel:

En magiker producerar runor.

En warrior behöver runor för svårare jakt.

Magikern behöver pengar till utrustning.

Warriorn får utrustning och resurser från monster.

En ranger behöver ammunition.

Någon annan producerar ammunition eller materialet till den.

En spelare hittar ett sällsynt vapen som den egna vocationen inte behöver och säljer det till någon annan.

Resultatet ska bli ett ekologiskt nätverk mellan spelare.

---

# 3. Ingen modern convenience-ekonomi

Undvik att bygga bort spelarnas behov av varandra.

Följ därför dessa regler:

NPC-affärer ska **inte** sälja alla viktiga resurser i obegränsad mängd.

NPC:er kan sälja:

* grundläggande startutrustning
* enkla verktyg
* mat
* tomma behållare
* blank runes eller motsvarande råmaterial
* basammunition
* enklare rustningar
* grundläggande vapen

NPC:er ska normalt **inte** sälja:

* de bästa runorna
* stora mängder avancerade combat supplies
* bra utrustning
* rare items
* end-game resources
* allt en spelare behöver för maximal effektivitet

Dessa saker ska huvudsakligen komma från:

* andra spelare
* crafting
* monster
* quests
* bosses
* exploration
* professions
* world events

---

# 4. Rune-systemet är centralt

Rune-systemet ska vara en moderniserad variant av äldre MMORPG-design där magiska karaktärer faktiskt producerar resurser åt andra spelare.

Det här är ett **kärnsystem**, inte en sidofunktion.

Grundloop:

1. Spelaren skaffar tomma runor eller motsvarande material.
2. Karaktären behöver mana.
3. En spell används.
4. Mana och eventuellt en separat begränsad resurs förbrukas.
5. En eller flera laddningar skapas på runan.
6. Runan kan användas av spelaren själv eller säljas till andra.

Exempel på kategorier:

* healing rune
* area damage rune
* single-target damage rune
* field rune
* wall rune
* dispel rune
* utility rune
* support rune

Alla vocations behöver inte kunna använda samtliga runor lika effektivt.

Systemet ska skapa en riktig marknad.

Exempel:

En mage som sitter i staden och regenererar mana kan tillverka runor medan spelaren:

* chattar
* organiserar inventory
* handlar
* väntar på party
* gör enklare aktiviteter

Det ska skapa samma sociala funktion som äldre rune-making hade, men utan att kräva extremt frustrerande repetitiv input.

---

# 5. Modernisera rune-making utan att automatisera bort ekonomin

Undvik två extremer.

Fel:

> Spelaren måste manuellt trycka samma spell var 30:e sekund i fyra timmar.

Också fel:

> Klicka "create 500 runes" och logga ut.

Utforma istället ett system där karaktären fortfarande måste befinna sig i världen och där produktionen använder riktiga resurser.

Exempel:

Spelaren kan välja:

**Rune crafting queue: 20 Heavy Fire Runes**

Systemet kastar automatiskt rätt spell när:

* mana finns
* spelaren inte slåss
* spelaren fortfarande är online
* rätt material finns
* produktionen inte är blockerad

Men:

* mana regenereras i normal takt
* resurser förbrukas
* karaktären är fortfarande fysiskt närvarande
* processen tar riktig tid
* spelaren kan avbryta när som helst

Det bevarar rune-ekonomin utan att uppmuntra makron.

---

# 6. Mana-regeneration och produktionsekonomi

Mana ska vara mer än en combat resource.

Mana representerar även **produktionskapacitet**.

Det betyder att en magisk karaktär måste välja mellan att använda mana för:

* hunting
* healing
* combat spells
* runemaking
* utility

Det skapar alternativkostnad.

Undvik ett system där spelaren omedelbart kan köpa oändlig mana billigt från NPC eftersom det skulle göra mana-baserad produktion meningslös.

Mana-restoration items kan existera, men deras:

* pris
* vikt
* effektivitet
* tillgänglighet

måste balanseras mot ekonomin.

---

# 7. Vocation-system

Utgå från tydliga archetypes men skapa egna namn senare.

Första implementationen kan använda arbetsnamnen:

### Warrior

Styrkor:

* hög HP
* bra melee
* hög defence
* hög carrying capacity
* billigt att jaga enklare monster

Svagheter:

* begränsad range
* mindre magi
* behöver externa supplies för högre effektivitet

### Ranger

Styrkor:

* ranged combat
* bra mobility
* ammunition
* kontroll på avstånd

Svagheter:

* ammunition kostar resurser
* mindre defence än warrior
* positionering är viktig

### Mage

Styrkor:

* offensiv magi
* area damage
* runemaking
* hög magisk progression

Svagheter:

* låg HP
* dyr hunting
* beroende av mana

### Druid / Support Mage

Styrkor:

* healing
* support
* elemental magic
* utility
* runemaking

Svagheter:

* lägre fysisk hållbarhet
* resursberoende

Vocations ska vara asymmetriska.

Undvik design där alla classes till slut har:

* samma DPS
* samma mobility
* samma sustain
* samma utility

med olika animationer.

---

# 8. Skills

Använd ett usage-baserat skillsystem där det är lämpligt.

Exempel:

* sword
* axe
* blunt
* shielding
* distance
* magic
* eventuell crafting/profession progression

Skill progression ska ske genom faktisk användning.

Men implementera diminishing returns och anti-abuse så att optimal progression inte blir att attackera samma värdelösa monster i 15 timmar.

Servern ska kunna avgöra när träning är legitim.

---

# 9. Level och progression

Character level ska påverka exempelvis:

* HP
* mana
* movement
* carrying capacity
* spell requirements
* equipment requirements
* access till content

Men level ska inte vara den enda progressionen.

Karaktärens styrka ska bero på kombinationen av:

* level
* skills
* magic level
* equipment
* player skill
* preparation
* supplies
* positioning

En levelskillnad ska vara betydelsefull utan att göra lägre spelare fullständigt irrelevanta.

---

# 10. Combat

Combat ska vara enkelt att förstå men svårt att bemästra.

Basera systemet runt:

* tile positioning
* line of sight
* distance
* attack speed
* cooldowns
* melee/ranged/magic
* resistances
* armour
* shielding
* movement
* area attacks
* fields
* walls
* chokepoints

Undvik ett modernt MMORPG-system med 30 skills och flera fulla actionbars.

En spelare ska kunna ha relativt få aktiva abilities men använda dem taktiskt.

---

# 11. Modernare kontroller

Spelet behöver inte kopiera äldre kontrollbegränsningar.

Stöd:

* click-to-move
* WASD
* piltangenter
* klicka på tile
* klicka på monster
* target lock
* attack target
* interact
* loot
* drag-and-drop

Hotkeys:

* spells
* runes
* food
* equipment
* consumables
* target functions

Låt spelaren själv konfigurera keybinds.

Exempel:

Q/E kan användas för diagonal movement om spelaren vill.

Alternativt:

WASD + diagonala kombinationer.

Movement måste fortfarande respektera tile-systemet.

---

# 12. Input buffering

Kontrollerna ska kännas betydligt bättre än ett gammalt 2000-talsspel.

Implementera exempelvis:

* kort input buffer
* movement prediction där det är säkert
* server reconciliation
* tydlig feedback
* låg input latency

Clienten får visuellt förutsäga movement, men servern är alltid auktoritativ.

Undvik att varje knapptryckning känns som att klienten väntar på server round-trip innan något händer.

---

# 13. Inventory

Behåll fysisk inventory-känsla.

Items kan finnas:

* på tiles
* i backpacks
* i bags
* i containers
* i equipment slots
* i depot
* i bank/stash där det är designmässigt rimligt

Containers ska kunna innehålla andra containers.

Drag-and-drop ska fungera naturligt.

Modernisera med:

* shift-click
* ctrl-click
* move stack
* split stack
* quick move
* sort container
* search depot
* configurable loot destination

Men undvik:

> All loot teleporteras automatiskt till ett obegränsat globalt inventory.

---

# 14. Weight / capacity

Capacity ska vara relevant.

Items ska ha vikt.

Det gör att spelaren måste prioritera:

* supplies
* loot
* ammunition
* runes
* gold

Men inventory-systemet ska visa detta tydligt.

Visa exempelvis:

**Capacity: 327 / 480**

och korrekt feedback när något är för tungt.

---

# 15. Loot

Monsterloot ska vara ekonomiskt betydelsefull.

Loot kan bestå av:

* gold
* crafting resources
* equipment
* creature products
* rare items
* consumables
* quest resources

Alla monster ska inte bara ge ett standardiserat valutaresultat.

Olika jaktplatser ska vara attraktiva av olika skäl.

Exempel:

område A:

* mycket XP
* dålig profit

område B:

* låg XP
* mycket craftingmaterial

område C:

* svårare
* rare equipment

område D:

* bra solo

område E:

* kräver party

---

# 16. Loot tables

Loot måste vara server-side.

Använd weighted loot tables.

Exempel:

```text
Rat
gold: 0-3, 40%
meat: 1, 25%
rat_tail: 1, 3%
```

Stöd:

* min/max quantity
* probability
* nested loot groups
* unique loot
* boss loot
* personal/shared loot där det behövs

Vanliga monster bör huvudsakligen använda fysisk corpse/container-loot.

---

# 17. Player trading

Trading är ett centralt system.

Implementera två former.

## Direkt handel

Player A skickar trade request.

Båda får ett separat trade window.

Båda lägger in items/gold.

Båda ser exakt innehåll.

När någon ändrar sitt erbjudande:

* bådas confirmation resetas.

Sedan:

1. A accepts.
2. B accepts.
3. Servern verifierar allt.
4. Transaktionen sker atomiskt.

Duplication bugs får aldrig kunna uppstå.

## Marketplace

Ett marketplace kan också finnas.

Men marketplace ska inte eliminera all social handel.

Lämplig design:

Marketplace:

* listing fee
* tidsbegränsade offers
* buy orders
* sell orders
* price history

Direkt trade:

* ingen eller mycket låg avgift
* möjlighet att förhandla
* snabb affär mellan spelare

---

# 18. Lokal kontra global marknad

Överväg att göra vissa ekonomiska funktioner lokala.

Exempel:

* depots är stadsspecifika
* marketplace kan vara regional
* leverans mellan städer kostar pengar/tid

Det gör geografin viktig.

Implementera dock inte detta innan grundekonomin fungerar.

---

# 19. Chat

Chat är en gameplayfunktion.

Stöd minst:

* Say
* Whisper
* Yell
* Private Message
* Party
* Guild
* Trade
* Help
* World/General

Say ska visas ovanför karaktären och bara vara synligt inom ett område.

Det gör städer sociala.

Trade-channel ska göra det möjligt att skriva exempelvis:

```text
SELL 100 Greater Fire Runes 4k
BUY Knight Armor
```

Modern marketplace får komplettera detta men inte göra kommunikationen meningslös.

---

# 20. Party-system

Implementera:

* invite
* accept
* leave
* kick
* leader
* shared XP
* optional shared loot
* party chat
* party markers
* health display

Shared XP bör kräva:

* närhet
* faktisk aktivitet
* tillräcklig level-range

för att begränsa abuse.

---

# 21. Guilds

Guild-systemet ska senare stödja:

* guild creation
* ranks
* permissions
* guild chat
* guild hall
* guild bank
* alliances
* wars

Men detta ligger efter grundläggande gameplay.

---

# 22. PvP

Arkitekturen ska från början kunna stödja PvP även om hela systemet inte implementeras i första versionen.

Servern måste kunna skilja på:

* creature damage
* player damage
* party
* guild
* aggressor
* retaliation
* kills

Skapa ingen klientlogik som antar att endast PvE existerar.

---

# 23. Death

Döden måste betyda något.

Det kan exempelvis finnas:

* XP loss
* skill loss
* item loss
* death penalty
* blessings/protection

Men straffet behöver inte vara lika extremt som i äldre spel.

Målet är:

> Spelaren ska försöka undvika att dö.

utan att:

> En enda disconnect förstör flera veckors progression.

---

# 24. Monster-AI

Monster ska ha server-side AI.

Grundstates:

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

Stöd senare:

* ranged attacks
* spells
* healing
* summons
* switching target
* maintaining distance
* fleeing
* pack behaviour
* boss mechanics

Monster ska inte kunna manipuleras obegränsat genom uppenbara pathfinding exploits.

---

# 25. Creature aggro

Använd threat/aggro-system som tar hänsyn till exempelvis:

* proximity
* damage
* healing
* taunts
* recent attacker

Men låt inte systemet bli så komplext att det känns som ett raid-MMO.

---

# 26. World architecture

Världen ska byggas som tiles.

Exempel:

```text
x
y
z/floor
ground
items[]
creatures[]
players[]
effects[]
```

Tiles kan ha flags såsom:

```text
walkable
blockProjectile
blockSight
safeZone
protectionZone
swimmable
stairs
ladder
door
teleport
```

Stöd flera våningar.

Exempel:

```text
z = 7 ground
z = 6 first floor
z = 8 underground
```

Exakta värden kan definieras senare.

---

# 27. Map streaming

Ladda inte hela världen till klienten.

Server och klient ska använda chunks/regions.

Exempel:

```text
32x32
64x64
```

Klienten får bara data för relevanta chunks runt spelaren.

Detta gäller:

* map tiles
* players
* monsters
* items
* projectiles
* effects

---

# 28. Interest management

Detta är mycket viktigt för serverprestanda.

En spelare behöver inte få uppdateringar om en råtta som går omkring 2 km bort.

Skapa ett interest-management-system.

Varje session prenumererar på relevanta:

* chunks
* entities
* nearby chat
* effects

När spelaren flyttar uppdateras subscriptions.

---

# 29. Server-authoritative arkitektur

Klienten får aldrig bestämma:

* position
* speed
* damage
* XP
* mana
* HP
* inventory
* loot
* gold
* cooldown
* skill progression
* item creation
* spell success

Klienten skickar intentions.

Exempel:

```text
MoveNorth
Attack(entityId)
UseItem(itemId, target)
CastSpell(spellId, target)
MoveItem(...)
Trade(...)
```

Servern validerar och genomför handlingen.

---

# 30. Teknisk stack

Utgå från:

## Desktop client

* Tauri
* React
* TypeScript

React används främst för:

* UI
* windows
* menus
* inventory
* character panel
* chat
* trade
* settings

Använd **inte React DOM som primär world renderer**.

För själva spelvärlden bör en separat renderingslösning användas, exempelvis:

* PixiJS
* WebGL/WebGPU-baserad renderer

Renderer ska vara separerad från React state.

React ska inte rerendera hela kartan när en creature flyttar.

---

# 31. Tauri

Tauri används som desktop shell.

Ansvarsområden kan vara:

* native executable
* filesystem
* settings
* logging
* launcher/update senare
* window management
* eventuell säker credential storage

Tauri-clienten är **inte game servern**.

---

# 32. Game server

Bygg game server som separat applikation.

Rust rekommenderas eftersom projektet redan använder Tauri/Rust och eftersom vi vill ha:

* hög prestanda
* type safety
* concurrency
* låg memory overhead

Förslag:

```text
server/
    auth/
    world/
    combat/
    creatures/
    items/
    inventory/
    movement/
    spells/
    runes/
    chat/
    trade/
    persistence/
    networking/
```

Lämpliga Rust-komponenter kan exempelvis vara:

* Tokio
* Axum för HTTP/API
* WebSocket initialt för game-session
* SQLx
* Serde
* tracing

Undvik att introducera ett stort antal dependencies utan konkret anledning.

---

# 33. Nätverksprotokoll

Separera:

### REST/HTTP

för exempelvis:

* login
* character list
* account management
* server status

från:

### persistent connection

för:

* movement
* combat
* chat
* map changes
* entities
* inventory
* effects

Initialt kan WebSocket användas.

Designa meddelanden som explicita typer.

Exempel:

```ts
type ClientMessage =
  | MoveRequest
  | AttackRequest
  | UseItemRequest
  | CastSpellRequest
  | ChatMessage
  | MoveItemRequest;
```

Använd inte otydliga godtyckliga JSON-objekt överallt.

---

# 34. Protocol versioning

Alla clients ska skicka:

```text
protocolVersion
clientVersion
```

Servern ska kunna neka inkompatibla clients.

Game protocol ska versionshanteras från början.

---

# 35. PostgreSQL

PostgreSQL används för persistent information.

Exempel på tabeller:

```text
accounts
characters
character_skills
character_spells
items
item_instances
containers
depots
guilds
guild_members
market_orders
transactions
houses
house_owners
quests
quest_progress
deaths
```

Men världen ska inte använda PostgreSQL som realtidsmotor.

Fel:

```text
UPDATE characters
SET x = x + 1
WHERE id = ...
```

för varje movement tile.

Aktiv world state ska ligga i game-serverns minne.

Persistens sker kontrollerat.

---

# 36. Items och item instances

Separera item definition från item instance.

Exempel:

```text
ItemDefinition
id
name
type
weight
stackable
maxStack
attack
defence
armor
attributes
```

och:

```text
ItemInstance
instanceId
definitionId
quantity
charges
containerId
owner
attributes
```

På så sätt kan exempelvis:

```text
Heavy Fire Rune
```

vara ItemDefinition medan varje faktisk rune-stack är en ItemInstance.

---

# 37. Atomic inventory operations

Alla item-transaktioner måste vara säkra.

Exempel:

```text
move item
trade
buy
sell
loot
drop
pickup
bank
market
```

får aldrig kunna resultera i:

* duplicated item
* lost item
* negative quantity
* item existing in two containers

Designa inventory-operationer atomiskt.

---

# 38. Databastransaktioner

Använd PostgreSQL transactions för ekonomiskt kritiska operationer.

Exempel:

Marketplace purchase:

```text
BEGIN

lock order
verify buyer funds
verify seller item
transfer money
transfer item
update order

COMMIT
```

Vid fel:

```text
ROLLBACK
```

---

# 39. Item IDs

Använd stabila interna IDs.

Exempel:

```text
iron_sword
heavy_fire_rune
health_rune
dragon_scale
```

eller integer IDs med separat content definition.

Bygg inte gameplay runt visningsnamn.

---

# 40. Content ska vara data-driven

Monster, items och spells ska i största möjliga utsträckning definieras som data istället för hårdkodad gameplaykod.

Exempel:

```json
{
  "id": "cave_rat",
  "name": "Cave Rat",
  "health": 45,
  "experience": 20,
  "speed": 85,
  "attacks": [
    {
      "type": "melee",
      "minDamage": 0,
      "maxDamage": 12
    }
  ]
}
```

Samma princip för:

* items
* spells
* loot tables
* NPC inventory
* monsters
* quests

Validera contentfiler vid serverstart.

Servern ska fail-fast om data är ogiltig.

---

# 41. NPC-system

NPC:er ska vara mer än shops.

De kan:

* prata
* ge information
* handla
* reagera på keywords
* ge quests
* reagera på reputation
* transportera
* lära ut spells

Dialogsystem kan initialt baseras på keyword/state.

Exempel:

```text
Player: hi
NPC: Greetings.

Player: runes
NPC: I sell blank runes.

Player: buy 20
```

Men erbjud även modern klickbar dialog så att spelaren inte måste känna till exakt syntax.

Båda kan existera samtidigt.

---

# 42. Modern UI

UI ska kännas modernt utan att spela spelet åt användaren.

Planera paneler för:

* game view
* health/mana
* character
* skills
* equipment
* containers
* chat
* battle list
* minimap
* party
* quests
* trade

Fönster ska kunna:

* flyttas
* dockas
* öppnas/stängas
* eventuellt skalas

Spara layout per användare.

---

# 43. Battle list

Battle list visar närliggande:

* creatures
* players

Stöd:

* attack
* follow
* sort/filter
* target indicator

Men servern måste avgöra vilka entities klienten faktiskt får känna till.

---

# 44. Minimap

Minimap ska byggas upp genom exploration.

Servern skickar kartdata för områden spelaren kan se.

Klienten kan lagra explored minimap lokalt.

Senare kan systemet stödja:

* markers
* notes
* shared party markers

---

# 45. Fog/exploration

Spelaren ska inte automatiskt få hela världskartan.

Exploration ska ha värde.

Kartinformation kan sparas per account/client.

---

# 46. Houses

Planera arkitekturen för player housing.

Hus ska vara verkliga delar av kartan.

Möjliga funktioner:

* ownership
* rent
* doors
* access lists
* beds
* decoration
* containers
* guild halls

Items som ligger i hus måste persistieras.

Implementera inte hela systemet i första fasen men undvik datamodeller som gör det omöjligt senare.

---

# 47. Economy sinks

Player economy kräver pengar som både kommer in och försvinner.

Sources:

* monster gold
* quests
* NPC buying

Sinks:

* spell learning
* travel
* housing
* marketplace fees
* repairs om sådant används
* consumable raw materials
* cosmetic services
* death protection
* guild costs

Analysera inflation från början.

---

# 48. Ingen pay-to-win

Om monetization införs senare ska den inte sälja direkt combat power.

Undvik:

* bästa vapen
* XP boosts som förstör progression
* köpta skills
* köpta runor
* köpt gold
* loot boosts

Kosmetiska funktioner och vissa account services är betydligt bättre.

Spelets ekonomi får aldrig bli sekundär till en cash shop.

---

# 49. Anti-cheat

Utgå från att klienten är komprometterad.

Servern måste kontrollera:

* movement speed
* attack distance
* line of sight
* cooldown
* spell requirements
* mana
* item ownership
* inventory
* trade
* target validity

Logga misstänkta handlingar.

Exempel:

```text
movement_violation
impossible_attack
invalid_item_reference
cooldown_violation
inventory_desync
```

---

# 50. Bots

Designa inte spelet runt aggressiv klientbaserad anti-cheat.

Gör istället servern bra på att upptäcka:

* omöjliga actions
* extremt repetitiva mönster
* impossible reaction timing
* suspicious farming patterns

Men automatisera inte bans utan tillräcklig säkerhet.

---

# 51. Server tick

Game world ska ha definierad tick/update-model.

Separera sådant som:

* movement
* creature AI
* combat
* regeneration
* conditions

från rendering.

Exempel:

```text
World tick: 50 ms
```

är en möjlig startpunkt, men benchmarka innan värdet låses.

Allt behöver inte köras varje tick.

Exempel:

```text
movement: event-based
AI: 100–250 ms
conditions: 100–1000 ms
regen: 1000 ms
```

beroende på system.

---

# 52. Deterministisk och testbar combat

Combatlogik ska gå att unit-testa utan att starta hela servern.

Exempel:

```rust
calculate_melee_damage(...)
calculate_spell_damage(...)
calculate_armor_reduction(...)
```

ska vara rena eller nästan rena funktioner där det går.

Skapa tester för:

* minimum damage
* maximum damage
* critical edge cases
* armor
* resistance
* death
* XP distribution

---

# 53. Logging

Använd strukturerad logging.

Log levels:

```text
TRACE
DEBUG
INFO
WARN
ERROR
```

Exempel:

```text
player_id
character_id
session_id
action
entity_id
map_position
```

Men logga aldrig:

* plaintext passwords
* auth tokens
* känsliga credentials

---

# 54. Development commands

Projektet ska ha enkla development-kommandon.

Målet bör vara något i stil med:

```bash
npm run dev
```

för klienten

och:

```bash
cargo run -p game-server
```

för servern.

Helst även:

```bash
docker compose up -d postgres
```

för lokal databas.

---

# 55. Repository layout

En rimlig initial struktur:

```text
/
  apps/
    client/
  crates/
    game-server/
    game-protocol/
    game-types/
  content/
    items/
    creatures/
    spells/
    npcs/
    loot/
  database/
    migrations/
  tools/
  docs/
```

Om monorepo-strukturen behöver justeras får du göra det, men separationen mellan client/server/protocol/content ska vara tydlig.

---

# 56. Shared protocol

Skapa ett gemensamt protocol/schema så att klient och server inte utvecklar inkompatibla strukturer.

Undvik duplicerade manuella definitioner där möjligt.

Versionera protocollet.

---

# 57. Client architecture

Separera klienten i tydliga subsystem:

```text
GameClient
NetworkClient
WorldState
EntityStore
MapRenderer
InputController
InventoryStore
ChatStore
UI
AudioManager
Settings
```

React ska lyssna på relevanta state stores.

World renderer ska inte vara beroende av React-rendercykeln.

---

# 58. Rendering

Renderingsmotorn ska kunna hantera:

* tile map
* floor layers
* creatures
* outfits
* items
* projectiles
* magic effects
* lighting senare
* nameplates
* healthbars

Använd batching där möjligt.

Undvik ett HTML-element per tile.

---

# 59. Camera

Implementera camera som följer spelaren.

Stöd:

* olika upplösningar
* UI scaling
* pixel-perfect rendering om pixelart används
* configurable zoom inom rimliga gränser

Zoom får inte ge gameplayfördel genom att klienten ser entities som servern annars inte skulle skicka.

---

# 60. Gameplay-event system

Undvik att koppla alla subsystem direkt till varandra.

Använd tydliga events/commands där lämpligt.

Exempel:

```text
CreatureMoved
CreatureDamaged
CreatureDied
ItemCreated
ItemMoved
PlayerLeveledUp
SpellCast
TradeCompleted
```

Men skapa inte en överkomplicerad enterprise-eventarkitektur för ett litet projekt.

---

# 61. Conditions

Skapa generiskt condition-system.

Exempel:

* poison
* fire
* energy
* haste
* slow
* regeneration
* shield
* silence senare

Condition kan innehålla:

```text
type
source
duration
interval
magnitude
```

Det gör spells och monster mycket enklare att bygga ut.

---

# 62. Spells

Spell definitions ska innehålla saker som:

```text
id
name
words
vocation
level
magicLevel
mana
cooldown
range
targetType
effect
```

Stöd spellcasting via både:

* hotkey
* text command/incantation

om det passar spelets stil.

Textvarianten är bra för old-school-känslan medan hotkey gör kontrollerna moderna.

---

# 63. Cooldowns

Undvik modern MMO-design där varje spell har ett stort separat cooldown-system.

Använd hellre några begripliga cooldown-grupper:

* attack
* healing
* support
* item

om gameplaytester visar att det fungerar.

Mana och positionering ska vara viktigare än 25 individuella timers.

---

# 64. Rune charges

Runor kan ha charges.

Exempel:

```text
Heavy Fire Rune
Charges: 5
```

När sista laddningen används försvinner itemet eller blir en blank rune beroende på slutlig design.

Stacking måste hantera charges korrekt.

---

# 65. Rune-market

Det ska vara fullt legitimt för en spelare att bygga sin ekonomi runt att:

* skapa runor
* sälja runor
* köpa raw materials
* konkurrera på pris
* bygga kundrelationer

Detta är avsiktlig gameplay.

Systemet får alltså inte balanseras under antagandet:

> Alla ska producera alla supplies själva.

---

# 66. Andra player professions

Rune-making är första systemet.

Arkitekturen ska senare kunna stödja andra player-driven professions.

Exempel:

* alchemy
* cooking
* smithing
* enchanting
* ammunition crafting

Men introducera inte fem stora craftingträd direkt.

Börja med runor och eventuellt ammunition.

---

# 67. Resource economy

Crafting ska inte innebära att alla resurser kommer från en NPC.

Exempel:

```text
monster
    ↓
monster material
    ↓
player crafter
    ↓
consumable/equipment
    ↓
hunter
```

Det skapar efterfrågan mellan olika typer av spelare.

---

# 68. Quests

Undvik questhub-design:

```text
!
?
!
?
```

Quests ska hellre upptäckas genom:

* NPC-dialog
* böcker
* exploration
* rumours
* environment
* andra spelare

Questlog kan finnas för modern usability.

Den ska visa det karaktären faktiskt har upptäckt.

---

# 69. Exploration

Belöna spelare som undersöker världen.

Exempel:

* hidden passages
* rare spawns
* caves
* quests
* shortcuts
* lore
* treasure
* resource areas

Allting ska inte markeras på kartan med en ikon.

---

# 70. Safe zones

Städer kan innehålla protection zones.

Servern ska ha tile flag:

```text
PROTECTION_ZONE
```

som bland annat kan begränsa:

* PvP
* combat
* vissa spells

Reglerna ska ligga server-side.

---

# 71. Respawns

Monster ska komma från spawn definitions.

Exempel:

```text
spawn_area
creature_type
maximum_count
respawn_time
radius
```

Spawn ska inte nödvändigtvis återuppstå exakt på samma tile varje gång.

---

# 72. Dynamiska respawns

Senare kan spawn rate reagera på:

* antal aktiva spelare
* hunting pressure
* world events

Men första implementationen ska vara enkel och förutsägbar.

---

# 73. Experience curve

XP-kurvan ska göra tidiga levels relativt snabba och högre levels successivt långsammare.

Undvik både:

* extrem grind från level 1
* modern progression där spelaren når endgame på några timmar

Det ska finnas känsla av långsiktig karaktärsutveckling.

---

# 74. Endgame

Bygg inte projektet runt "nå endgame och börja spela spelet".

Resan är spelet.

Level 20, 40, 80 och 150 ska alla kunna innehålla meningsfull gameplay.

---

# 75. Performance

Sätt som mål att klienten ska kunna hålla hög FPS även på enklare datorer.

Optimera:

* render batching
* texture atlases
* entity updates
* React rerenders
* network traffic
* allocations

Men gör inte premature optimization innan profiler visar problem.

---

# 76. Scalability

Första målet behöver inte vara 100 000 samtidiga spelare.

Designa först för exempelvis:

```text
100–500 spelare
```

på en game world/server.

När detta fungerar kan arkitekturen vidareutvecklas.

Undvik distributed microservices innan det finns ett verkligt behov.

---

# 77. Modular monolith först

Game server ska initialt vara en **modular monolith**.

Separata moduler:

```text
auth
world
combat
inventory
chat
trade
persistence
```

men de kör i samma serverprocess.

Detta är avsiktligt.

Bygg inte Kubernetes/microservices/event buses för ett projekt som ännu inte har fungerande movement.

---

# 78. Account system

Skapa:

```text
Account
Character
Session
```

separat.

Password storage måste använda en modern password hash.

Lagra aldrig plaintext password.

Implementera:

* login
* logout
* character selection
* session expiration
* duplicate-session handling

---

# 79. Character creation

Första version:

* name
* sex/body type om relevant
* outfit
* color choices
* vocation senare eller direkt beroende på design

Validera namn server-side.

---

# 80. Character save

Persistiera åtminstone:

* position
* level
* XP
* HP
* mana
* skills
* inventory
* equipment
* depot
* spells
* quest state

Spara:

* periodiskt
* vid logout
* vid viktiga transactions

med mekanismer som undviker data corruption.

---

# 81. Graceful shutdown

När servern stängs:

1. stoppa nya logins
2. notifiera sessions
3. spara aktiva characters
4. flush critical transactions
5. stäng DB connections
6. avsluta

Server-crash får inte regelmässigt innebära flera minuters rollback.

---

# 82. Admin tools

Planera tidigt för admin commands.

Exempel:

```text
/goto
/teleport
/spawn
/give
/kick
/ban
/info
/setlevel
```

Alla sådana actions ska loggas.

Adminbehörighet måste kontrolleras server-side.

---

# 83. Debug overlay

Development client bör kunna visa:

* player position
* tile
* chunk
* FPS
* ping
* server tick
* entity count
* network traffic

Detta kommer vara mycket värdefullt under utvecklingen.

---

# 84. Metrics

Game server bör senare kunna mäta:

* online players
* tick duration
* messages/sec
* DB latency
* active monsters
* entity count
* login failures
* world saves

Designa så att metrics kan införas utan att hela arkitekturen behöver ändras.

---

# 85. Testning

Skapa tester för viktiga subsystem.

Särskilt:

* inventory
* item stacking
* movement validation
* combat calculations
* trading
* rune creation
* XP
* loot
* database transactions

Ekonomiska system måste ha särskilt bra tester eftersom duplication bugs kan förstöra hela servern.

---

# 86. Developer documentation

Dokumentera viktiga system i:

```text
/docs
```

Minst:

```text
ARCHITECTURE.md
GAME_DESIGN.md
PROTOCOL.md
DATABASE.md
CONTENT.md
DEVELOPMENT.md
```

Dokumentationen ska uppdateras när större arkitekturbeslut ändras.

---

# 87. Kodkvalitet

Följ dessa regler:

* undvik gigantiska filer
* undvik God Objects
* undvik duplicerad logik
* använd tydliga typer
* håll server och client separerade
* håll game rules server-side
* validera external input
* skriv migrations
* använd errors istället för silent failure

Men överengineera inte.

Prioritera fungerande vertikala slices.

---

# 88. Vertikala slices

Utvecklingen ska ske genom spelbara vertikala slices.

Bygg inte:

* hela databaslagret
* sedan hela servern
* sedan hela klienten
* sedan gameplay

utan att någonsin kunna spela.

Varje större milestone ska resultera i något som går att testa.

---

# 89. Milestone 1 – teknisk grund

Skapa:

* repo structure
* Tauri + React client
* game renderer
* Rust game server
* PostgreSQL
* migrations
* shared protocol
* logging
* development configuration

Acceptanskriterium:

Client och server kan startas lokalt.

Client kan ansluta till servern.

Servern kan läsa/skriva PostgreSQL.

---

# 90. Milestone 2 – första världen

Implementera:

* tile map
* map loader
* player entity
* login
* character
* spawn
* movement
* collision
* camera
* map rendering
* multiplayer synchronization

Acceptanskriterium:

Två klienter kan logga in samtidigt och se varandra gå omkring.

Detta är första riktigt viktiga milestone.

---

# 91. Milestone 3 – items

Implementera:

* item definitions
* item instances
* ground items
* pickup
* drop
* containers
* equipment
* weight
* stacking

Acceptanskriterium:

Två spelare kan lägga ner, plocka upp och flytta items mellan containers utan duplication eller desync.

---

# 92. Milestone 4 – creatures och combat

Implementera:

* creatures
* spawn
* pathfinding
* aggro
* melee
* damage
* health
* death
* corpse
* loot
* XP

Acceptanskriterium:

En spelare kan lämna staden, hitta monster, slåss, döda dem, få XP och plocka upp loot.

---

# 93. Milestone 5 – spells och mana

Implementera:

* mana
* regeneration
* magic level
* spells
* cooldown
* effects
* healing
* offensive magic

Acceptanskriterium:

En mage kan använda mana, kasta spells och regenerera resurser korrekt.

---

# 94. Milestone 6 – runor

Implementera hela rune-loopen.

```text
buy blank rune
→ regenerate mana
→ create rune
→ receive charged rune
→ use rune
```

Sedan:

```text
create rune
→ trade rune to another player
→ other player uses rune
```

Detta är ett av projektets viktigaste milestones.

Acceptanskriterium:

Spelare A kan producera en combat-resource som spelare B faktiskt har nytta av.

---

# 95. Milestone 7 – trading

Implementera:

* player trade
* gold
* secure atomic transaction
* trade chat

Acceptanskriterium:

En mage kan stå i staden och sälja runor till en warrior.

Det ska vara en komplett ekonomisk gameplay-loop.

---

# 96. Milestone 8 – NPC och stad

Implementera:

* NPC
* dialogue
* shops
* bank/depot
* spell trainer
* basic town

Staden ska börja kännas som en social hub.

---

# 97. Milestone 9 – större world slice

Skapa sedan ett begränsat men riktigt spelområde.

Exempel:

```text
1 stad
3–5 hunting areas
1 större dungeon
10–20 monster
30–50 items
10–20 spells/runes
några NPC
några quests
```

Hellre detta är välbalanserat än 500 tomma monsterdefinitionsfiler.

---

# 98. Balancing telemetry

Skapa verktyg för att kunna se:

* XP/hour
* profit/hour
* rune production/hour
* gold generated/hour
* gold destroyed/hour
* monster kill counts
* item drop quantities
* average character level

Det är omöjligt att balansera MMO-ekonomin bra utan data.

---

# 99. Ekonomiskt designmål

För varje viktig consumable ska vi kunna svara:

**Var kommer det ifrån?**

**Vem producerar det?**

**Vem använder det?**

**Vad kostar produktionen?**

**Vad hindrar obegränsad produktion?**

**Vad får föremålet att försvinna ur ekonomin?**

Om svaret bara är:

> NPC säljer det obegränsat.

ska systemet granskas igen.

---

# 100. Socialt designmål

För varje större system ska vi fråga:

> Ger detta spelare anledning att interagera?

Exempel:

Rune crafting:

**Ja.**

Player trading:

**Ja.**

Party hunting:

**Ja.**

Guilds:

**Ja.**

Marketplace:

**Ja, men riskerar att minska direkt kommunikation.**

Instant teleport till all content:

**Nej, riskerar att minska möten ute i världen.**

Automatisk unlimited NPC supply:

**Nej, riskerar att eliminera player economy.**

Använd denna princip kontinuerligt under utvecklingen.

---

# 101. Quality-of-life utan att förstöra gameplay

Modernisera frustrationen, inte spelets djup.

Bra QoL:

* bättre hotkeys
* WASD
* configurable controls
* stack movement
* container sorting
* search
* tydliga tooltips
* bättre trade window
* rune production queue
* bättre minimap
* bättre chat
* bra UI
* ping/FPS
* autowalk

Dålig QoL:

* unlimited inventory
* teleport överallt
* instant rune production
* gratis supplies
* automatic combat
* automatic hunting
* offline resource farming
* NPC som säljer allt
* global access till all loot
* instant resurrection utan konsekvens

Fråga alltid:

> Tar denna QoL-funktion bort irritation eller tar den bort ett faktiskt gameplaybeslut?

Ta bort irritation.

Behåll gameplaybeslut.

---

# 102. Inspirationsprincip

När gamla MMORPG-system analyseras ska du inte fråga:

> Hur kopierar vi exakt hur Tibia 7.6 fungerade?

Fråga istället:

> Varför fungerade den mekaniken?

Exempel:

Gamla runor fungerade inte för att spelaren behövde skriva spell words tusentals gånger.

De fungerade eftersom:

* mana hade värde
* tid hade värde
* spelarna producerade resurser
* vocations behövde varandra
* resurser kunde handlas
* det skapade social aktivitet i städer

Bevara dessa egenskaper.

Modernisera resten.

---

# 103. IP och originalitet

Använd inte Tibias:

* sprites
* kartor
* monsterdesign rakt av
* item artwork
* musik
* ljud
* dialog
* lore
* namn
* source code
* proprietary assets

Detta projekt ska ha eget:

* namn
* universum
* lore
* monsters
* items
* map
* art
* progression
* spells

Det är designprinciperna från den äldre MMO-eran som är inspirationen.

---

# 104. Prioriteringsregel

När du står inför två implementationer ska prioriteringen normalt vara:

1. korrekt server-authoritative gameplay
2. ingen item/gold duplication
3. bra kontrollrespons
4. stabil multiplayer synchronization
5. tydlig kod
6. fungerande player economy
7. bra UX
8. grafik/polish

Grafisk polish ska inte prioriteras före fungerande gameplay-loopar.

---

# 105. Viktig arbetsinstruktion till agenten

Arbeta metodiskt.

Innan större implementation:

1. undersök befintlig kod
2. förstå nuvarande arkitektur
3. identifiera berörda subsystem
4. föreslå minsta robusta implementation
5. implementera
6. kompilera
7. kör tester
8. verifiera funktionaliteten
9. dokumentera större beslut

Byt inte arkitektur utan anledning.

Skriv inte placeholder-system som ser färdiga ut men saknar riktig serverlogik.

När en funktion sägs vara implementerad ska den vara kopplad hela vägen:

```text
UI
↓
client logic
↓
network protocol
↓
server validation
↓
game state
↓
persistence där relevant
↓
response
↓
client state
↓
UI
```

---

# 106. Definition of Done

En gameplayfunktion räknas inte som färdig bara för att UI:t finns.

Exempel:

"Trading implemented" betyder inte:

> Ett trade-window går att öppna.

Det betyder:

* request fungerar
* accept fungerar
* items kan erbjudas
* gold kan erbjudas
* båda ser samma state
* ändring resetar confirmation
* servern validerar ownership
* capacity valideras
* inventory space valideras
* transaktionen är atomisk
* disconnect hanteras
* duplication är testad
* klienterna får korrekt slutstate

Använd samma ambitionsnivå för andra kritiska system.

---

# 107. Första konkreta målbilden

Den första versionen som faktiskt känns som spelet ska låta mig göra följande:

1. Starta klienten.
2. Logga in.
3. Välja min karaktär.
4. Spawn i en liten stad.
5. Gå med WASD eller mus.
6. Se andra spelare.
7. Prata med dem.
8. Köpa grundutrustning.
9. Lämna staden.
10. Döda monster.
11. Loot:a deras corpses.
12. Få XP.
13. Återvända till staden.
14. Lägga loot i depot.
15. Som mage regenerera mana.
16. Köpa blank runes.
17. Skapa combat runes.
18. Skriva i trade chat att jag säljer runor.
19. Genomföra en säker trade med en annan spelare.
20. Den andra spelaren kan gå ut och använda runorna jag skapade.

När den gameplay-loopen fungerar har projektet fått sin identitet.

---

# 108. Den viktigaste visionen

Det här ska inte vara ett nostalgiprojekt som bara ser gammalt ut.

Det ska kännas som:

> Hur hade den här typen av MMORPG utvecklats om man behållit den gamla spelardrivna filosofin men fortsatt förbättra teknik, UI, kontroller och systems design i tjugo år?

Vi vill ha:

**gammal MMO-filosofi**

plus

**modern implementation**

inte:

**gammal irritation**

och inte:

**modern single-player-MMO-design**.

Världen, ekonomin och spelarna ska vara centrum för spelet.
