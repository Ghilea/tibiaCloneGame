# Skapa Aldoria-världar med ChatGPT

Det här dokumentet innehåller en färdig prompt för att skapa en `.world.json`-fil som kan importeras i Aldorias World Editor och läsas av spelservern.

## Arbetsflöde

1. Kopiera hela prompten under **Prompt att klistra in i ChatGPT**.
2. Ändra önskemålet längst ned, till exempel kartstorlek, antal städer och vilka jaktområden som ska finnas.
3. Be ChatGPT skapa en mindre karta först, gärna 48–96 tiles per sida. Varje tile måste skrivas ut som ett eget JSON-objekt, så mycket stora kartor blir snabbt större än en chats svarslängd.
4. Spara svaret som exempelvis `northreach.world.json`. Filen får bara innehålla JSON, utan Markdown-staket eller kommentarer.
5. Öppna World Editor från karaktärsmenyn och välj **Import**. Granska kartan och välj sedan **Save As**.
6. Starta servern med filen:

   ```powershell
   $env:WORLD_FILE="D:\maps\northreach.world.json"
   cargo run -p game-server
   ```

Servern validerar kartan före start. Ett felmeddelande anger normalt objektets ID eller den tile som behöver rättas.

## Prompt att klistra in i ChatGPT

Kopiera allt mellan avgränsarna och byt endast ut texten i avsnittet `MIN VÄRLD`.

---

Du är världsdesigner för det engelskspråkiga, isometriska medeltida MMO-spelet **Embers of Aldoria**. Skapa en komplett, maskinläsbar world-fil enligt formatet nedan.

### Absoluta krav på svaret

- Svara enbart med ett giltigt JSON-dokument. Använd inte Markdown, kommentarer, förklaringar eller `...`.
- Alla fält i toppobjektet måste finnas, även när deras värde är en tom array.
- Skriv ut varje position explicit. Intervall, formler, upprepningssyntax och förkortningar är förbjudna.
- Använd exakt camelCase på fältnamnen.
- Använd heltal för `x`, `y`, `z`, `width`, `height`, `quantity` och `price`.
- Kontrollera hela dokumentet mot reglerna innan du svarar.
- All text som syns i spelet, såsom världsnamn, byggnadsnamn, NPC-namn, titlar och dialog, ska vara på engelska.

### Koordinatsystem

- Kartans övre vänstra tile är `x=0, y=0`.
- `x` ökar åt höger och `y` ökar nedåt.
- Alla positioner måste uppfylla `0 <= x < width` och `0 <= y < height`.
- Använd normalt `floor: 7` som marknivå. Editorn stöder våningarna `z=6`, `z=7`, `z=8` och `z=9`.
- En position skrivs alltid som `{ "x": X, "y": Y, "z": Z }`.
- Marknivån är gräs som standard. Lista därför bara tiles som faktiskt har ett annat innehåll eller material.

### Exakt toppstruktur

```json
{
  "version": 1,
  "name": "English World Name",
  "width": 64,
  "height": 64,
  "floor": 7,
  "blocked": [],
  "water": [],
  "bridges": [],
  "trees": [],
  "roads": [],
  "floors": [],
  "houseWalls": [],
  "castleWalls": [],
  "windows": [],
  "torches": [],
  "terrainMaterials": [],
  "buildings": [],
  "doors": [],
  "stairs": [],
  "spawns": [],
  "playerSpawn": { "x": 1, "y": 1, "z": 7 },
  "npcs": []
}
```

Kodblocket visar bara strukturen. Ditt slutliga svar får inte omges av ett kodblock.

### Vad fälten betyder

- `blocked`: tiles med kollision. Vatten, träd, fristående väggar och slottsväggar ska även finnas här. En brotile eller dörrtile får inte finnas här.
- `water`: vatten. Sammanhängande vatten får automatiska strand- eller klippkanter i spelet.
- `bridges`: gångbara brotiles. Varje brotile måste också finnas i `water`, men inte i `blocked`.
- `trees`: ekar. Varje trädtile ska också finnas i `blocked`.
- `roads`: gångbara kullerstensvägar.
- `floors`: synliga och gångbara byggnadsgolv eller tiles på andra våningar. För en byggnad ska normalt hela rektangeln, inklusive dess kant, finnas här.
- `houseWalls`: trä- och putsade husväggar. En dörr ersätter väggen på samma tile och ska därför inte samtidigt ligga i denna array. Ett fönster ersätter inte väggen.
- `castleWalls`: kraftiga sten- och slottsväggar. En dörr ersätter väggen på samma tile.
- `windows`: positioner för öppningsbara träluckor. Placera dem på en kvarvarande husvägg, aldrig på en dörr. Detta är en array med positioner, inte fönsterobjekt.
- `torches`: positioner för facklor och dynamiskt ljus. Detta är en array med positioner.
- `terrainMaterials`: alternativa material. Varje post är `{ "position": Position, "material": MaterialId }`. Tillåtna ID:n är endast `packed_earth`, `moss_stone` och `sandstone`. En tile får högst ha ett material.
- `buildings`: rektangulära byggnader som ger spelet tak och korrekt rendering. En byggnad är `{ "id": "stable_id", "name": "English Name", "kind": "house|keep", "x": X, "y": Y, "width": W, "height": H, "floor": Z }`. Minsta storlek är 3x3 och hela rektangeln måste ligga på kartan.
- `doors`: synkroniserade dörrar. En dörr är `{ "id": "unique_id", "position": Position, "open": false }`.
- `stairs`: våningsövergångar. En trappa är `{ "id": "unique_id", "from": Position, "to": Position }`. Både start- och måltile måste vara gångbara; lägg måltile på en `floors`-tile om den inte är på marknivån.
- `spawns`: fiendespawns. En spawn är `{ "id": "unique_id", "definitionId": "creature_id", "position": Position }`.
- `playerSpawn`: den enda startpositionen för spelare. Den måste vara gångbar och får inte delas med NPC eller fiendespawn.
- `npcs`: NPC-profiler och deras tjänster. Formatet beskrivs nedan.

Det finns inget separat `cities`, `houses` eller `enemies`-fält. En stad skapas av vägar, byggnader, murar, NPC:er och dekorationer. Hus skapas med `buildings` plus deras explicita golv och väggar. Fiender skapas med `spawns`. Lägg inte till okända toppfält.

### Regler för byggnader

För varje rektangulärt hus eller keep med hörn `(x,y)`, bredd `W` och höjd `H`:

1. Lägg en post i `buildings`.
2. Lägg alla tiles från `x` till `x+W-1` och `y` till `y+H-1` i `floors`.
3. Lägg hela rektangelns ytterkant i `houseWalls` för `kind: "house"`, eller `castleWalls` för `kind: "keep"`.
4. Lägg väggtiles i `blocked`. För hus använder servern slutligen tunn kantkollision, men filen ska ändå följa editorns format.
5. Välj minst en ytterkantstile som dörr. Ta bort just den positionen ur väggarrayen och ur `blocked`, och lägg den i `doors`.
6. Ett fönster ska både finnas kvar i `houseWalls` och läggas till i `windows`.
7. Placera inte NPC:er, fiendespawns, träd eller vatten på väggar eller andra blockerade tiles.
8. Låt byggnader ha minst två fria tiles mellan sig när det går, så att spelare och fiender kan navigera.
9. Skapa inga överlappande byggnadsrektanglar.

En fristående mur behöver ingen `buildings`-post. En byggnad som ska ha tak måste alltid ha en `buildings`-post.

### Tillåtna fiender

Använd endast följande `definitionId`:

- `castle_rat`: svag startfiende.
- `mireling`: svag träskfiende.
- `mire_skulker`: snabbare träskfiende.
- `reed_stalker`: medelsvår träskfiende.
- `fen_brute`: stark träskfiende.
- `crypt_guard`: tålig närstridsfiende för kryptor.
- `bone_acolyte`: avståndsfiende för kryptor.
- `cellar_warden`: stark områdesfiende/boss.

Varje spawn-ID måste vara unikt, stabilt och beskrivande, exempelvis `north_crypt_guard_01`. Fiendens position måste vara gångbar, får inte ligga i `blocked`, och får inte delas med playerSpawn eller en NPC. Skapa tydliga svårighetszoner och lämna nybörjarområdet säkert.

### NPC-format

Varje NPC har exakt denna form:

```json
{
  "id": "stable_lowercase_id",
  "name": "English Name",
  "title": "English Title",
  "service": "shop",
  "dialogue": "English dialogue, maximum 500 characters.",
  "position": { "x": 10, "y": 10, "z": 7 },
  "offers": [],
  "spellIds": []
}
```

NPC-ID:n måste vara unika och får bara innehålla gemenerna `a-z`, siffror och understreck. Namn får vara högst 40 tecken, titel högst 80 tecken och dialog högst 500 tecken. Varje NPC måste stå på en unik gångbar tile och får inte överlappa playerSpawn eller en fiendespawn.

Tillåtna tjänster:

- `shop`: får ha `offers`, men måste ha tom `spellIds`.
- `depot`: måste ha tomma `offers` och `spellIds`.
- `spell_trainer`: måste ha tom `offers` och får undervisa `ember_bolt` i `spellIds`.

Ett shop offer har formen:

```json
{
  "id": "unique_offer_id_for_this_npc",
  "itemDefinitionId": "item_id",
  "quantity": 1,
  "price": 2
}
```

`quantity` och `price` måste vara större än noll. Offer-ID:n måste vara unika inom samma NPC.

Tillåtna säljbara `itemDefinitionId` är:

- `blank_rune`
- `ember_rune`
- `traveler_blade`
- `ashwood_bow`
- `rough_arrow`
- `field_backpack`
- `mire_fiber`
- `gold_coin`
- `field_bread`
- `smoked_mire_meat`
- `bog_ichor`
- `reed_hide`
- `fen_tusk`

Följ spelets ekonomi: NPC-butiker ska huvudsakligen sälja enkla startvaror och nödförnödenheter. De ska inte göra spelarnas jakt, crafting eller handel onödig. Sälj aldrig likdelar/remains.

### Designprinciper

- Skapa ett läsbart huvudstråk från `playerSpawn` till stadens centrala plats.
- Ge staden en tydlig identitet med torg, gränder, hus, eventuell ringmur eller keep och funktionellt placerade NPC:er.
- Lägg dörrar mot vägar eller öppna ytor, inte mot vatten, träd eller blockerade tiles.
- Placera depot och grundbutik nära staden, men placera jaktområden utanför bebyggelsen.
- Använd vatten, träd och murar för silhuett och naturliga gränser utan att skapa ofrivilliga instängda gångbara ytor.
- Broar måste bilda en obruten gångbar passage över allt vatten mellan stränderna.
- Lämna minst en gångbar väg från playerSpawn till varje viktig NPC, dörr, bro och jaktzon.
- Undvik en ensam diagonal öppning mellan två blockerade tiles; den kan ge otydlig hörnkollision. Använd minst två tiles breda huvudvägar där det är rimligt.
- Sprid inte starka fiender nära playerSpawn eller civila NPC:er.
- Använd `packed_earth` för slitna gårdar och stigar, `moss_stone` för gamla borgar/kryptor och `sandstone` för varmare torg eller tempelmiljöer.
- Använd facklor sparsamt vid portar, torg, kryptor och byggnadsentréer.

### Slutlig valideringslista

Kontrollera detta tyst innan du svarar:

1. JSON går att tolka och innehåller samtliga toppfält exakt en gång.
2. `version` är 1 och dimensionerna är mellan 1 och 16384.
3. Alla positioner ligger innanför kartan.
4. Det finns inga duplicerade positioner inom samma tile-array.
5. Alla byggnader är minst 3x3, ligger innanför kartan och har kompletta golv och ytterkanter.
6. Dörrtiles saknas i både väggarray och `blocked`; fönstertiles finns kvar i `houseWalls`.
7. Varje brotile finns i `water` men inte i `blocked`.
8. Vatten utan bro, träd, fristående väggar och slottsväggar finns i `blocked`.
9. PlayerSpawn, NPC:er och fiendespawns ligger på gångbara, separata tiles.
10. Alla ID:n är icke-tomma och unika för sin objekttyp; NPC-ID:n följer lowercase-regeln.
11. Bara listade creature-, item-, spell-, material- och service-ID:n används.
12. Alla viktiga platser går att nå via en sammanhängande gångbar rutt.
13. Inga fält använder `null`, kommentarer, intervall eller platshållare.

### MIN VÄRLD

Skapa följande värld:

- Namn: `Northreach Vale`.
- Storlek: `64 x 64`, marknivå `z=7`.
- En trygg medeltida startstad med ett torg, 5–8 hus, ett mindre keep, stadsport och tydliga vägar.
- PlayerSpawn ska ligga inne i staden nära torget.
- Lägg till en shop-NPC för enkla förnödenheter, en depot-NPC och en spell trainer.
- Skapa en flod med minst en komplett bro.
- Skapa ett lätt jaktområde med castle rats eller mirelings nära staden.
- Skapa ett träskområde med stigande svårighet längre bort.
- Skapa en liten krypta eller borgruin med crypt guards, bone acolytes och högst en cellar warden långt från startplatsen.
- Använd träd, alternativa markmaterial, fönster och facklor för att göra världen varierad.
- Säkerställ att hela kartan följer samtliga regler ovan.

---

## Tips för större världar

En 256x256-värld kan vara tekniskt giltig men är olämplig att generera som ett enda chatsvar om många tiles ska listas. Ett bättre arbetssätt är att först skapa en 64x64 kärnregion, importera den i editorn och bygga ut kartan där. Om en AI ska fortsätta en befintlig fil bör du bifoga JSON-filen och be den returnera **hela det sammanslagna dokumentet**, eftersom importen inte slår ihop delkartor automatiskt.

När nya creatures, items, spells eller terrängmaterial läggs till i spelets content-filer måste listorna i denna prompt uppdateras innan ChatGPT får använda de nya ID:na.
