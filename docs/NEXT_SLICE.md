# Nästa spelbara slice: Greyhaven–Mire-upptäckandet

## Beslut

Spelets riktning låses till ett klasslöst MMORPG med modern interaktion och
old-school upptäckande. Spelaren ska utvecklas genom användning, utrustning,
kunskap och val av sekundära färdigheter — inte genom en permanent vocation.

README och äldre designtext som beskriver Warrior, Ranger, Mage och Druid ska
betraktas som övergångsmaterial tills de har ersatts av den klasslösa modellen.

## Målet med nästa milstolpe

En ny spelare ska kunna göra en sammanhängande 30–60 minuters upptäcktsfärd:

```text
Greyhaven → ledtråd → Mire-utkanten → jakt → material → produktion →
djupare Mire → loot/överlevnad → egen slutsats → Greyhaven/depot/handel
```

Milstolpen är klar när loopen känns meningsfull utan markörer, checklistor
eller utvecklarinstruktioner. Spelaren ska kunna välja att följa en ledtråd,
men aldrig känna sig ledd längs en föreskriven rutt.

## Minsta innehåll

1. Greyhaven behöver minst två oberoende, motsägelsefria ledtrådar om Mires
   faror: en NPC-rad och ett fysiskt spår i världen, exempelvis en övergiven
   driven provianttunna, en anteckning eller en förändrad väg.
2. Ledtrådarna ska peka mot en plats eller ett fenomen, aldrig uttrycka ett
   mål, kräva en återrapportering eller visa en objektivmarkör.
3. Mire ska belöna nyfikenhet med användbar information, en dold passage,
   ovanligt material eller ett recept. Belöningen måste gå att missa.
4. Servern får spara upptäckt kunskap när den behövs för att reagera på
   spelarens handlingar, men klienten ska inte visa en questlogg eller
   procentuell progression.
5. Mire-zonen ska ha minst en tydlig risk/reward-plats som spelaren kan se men
   inte säkert förstå från början.

## Implementationsordning

### 1. Upptäcktstillstånd

Lägg vid behov till ett litet, osynligt knowledge-state-system per karaktär.
Det ska endast lagra sådant världen behöver komma ihåg, som att en spelare har
läst en särskild anteckning eller öppnat en dold passage. Börja med en enda
Mire-hemlighet; bygg inget generellt questsystem, dialogträd eller quest-editor.

### 2. Världshändelser

Knyt en Mire-hemlighet till redan auktoritativa händelser:

- läsning eller interaktion med ett fysiskt objekt
- entré i en svårfunnen del av Mire
- relevant creature kill eller resource discovery
- en förändring i världen som bara blir möjlig efter upptäckten

Alla relevanta interaktioner ska valideras av servern och eventuellt sparas
atomiskt tillsammans med karaktärens övriga progression.

### 3. Klientfeedback

Visa inga uppdragskort, aktiva steg eller nästa ledtråd. Klienten ska i stället
ge återhållsam, diegetisk feedback: en undersökt anteckning öppnas, ett
ovanligt föremål får en beskrivning eller en miljöförändring blir synlig.

### 4. Test och speltest

Lägg till servertester för:

- låst och upplåst interaktion
- reconnect efter en upptäckt
- fel plats eller fel föremål
- att en belöning bara kan tas en gång
- atomisk sparning av upptäckt kunskap

Speltesta därefter tre saker: väcker ledtråden nyfikenhet, känns Mire farlig,
och förstår spelaren i efterhand vad den upptäckte?

## Det vi inte bygger ännu

- fler städer eller kontinenter
- guilds, PvP eller housing
- ett traditionellt questsystem eller questlogg
- fler vocations
- full 35 000 × 35 000 värld
- avancerad endgame-ekonomi

Nästa kodändring efter detta beslut bör alltså vara en liten Mire-hemlighet
som går att upptäcka i världen, med ett eventuellt osynligt knowledge-state
och en diegetisk belöning.
