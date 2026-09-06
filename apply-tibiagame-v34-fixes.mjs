#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const MARKER = "TIBIAGAME_V34_FIXSET_1";
const checkOnly = process.argv.includes("--check");

const replacements = [
  {
    "path": "apps/client/src/main.tsx",
    "before": "import \"./styles.css\";\n",
    "after": "import \"./styles.css\";\nimport \"./v34.css\";\n",
    "label": "Import V34 stylesheet"
  },
  {
    "path": "apps/client/src/game/InputController.ts",
    "before": "    if (resource) {\n      if (!resource.available) {\n        this.world.addSystemMessage(\"That resource is depleted.\");\n        return;\n      }\n      const nativeCanvas = document.querySelector<HTMLCanvasElement>(\n        \"[data-native-world-renderer]\",\n      );\n",
    "after": "    if (resource) {\n      const nearby = player.position.z === resource.position.z\n        && Math.abs(player.position.x - resource.position.x) <= 1\n        && Math.abs(player.position.y - resource.position.y) <= 1;\n      if (!nearby) {\n        this.world.addSystemMessage(\"Move closer to gather that resource.\");\n        return;\n      }\n      if (!resource.available) {\n        this.world.addSystemMessage(\"That resource is depleted.\");\n        return;\n      }\n      const nativeCanvas = document.querySelector<HTMLCanvasElement>(\n        \"[data-native-world-renderer]\",\n      );\n",
    "label": "Reject gathering when too far away on client"
  },
  {
    "path": "apps/client/src/game/NativeWorldRenderer.tsx",
    "before": "  playerVisualPosition(playerId: string | null) {\n    if (!playerId) return null;\n    return this.players.get(playerId)?.visualPosition ?? null;\n  }\n",
    "after": "  pickCreature(raycaster: THREE.Raycaster) {\n    let nearest: { id: string; distance: number } | null = null;\n\n    for (const [id, actor] of this.creatures) {\n      if (!actor.root.visible) continue;\n      const hit = raycaster.intersectObject(actor.root, true)[0];\n      if (!hit) continue;\n      if (!nearest || hit.distance < nearest.distance) {\n        nearest = { id, distance: hit.distance };\n      }\n    }\n\n    return nearest?.id ?? null;\n  }\n\n  playerVisualPosition(playerId: string | null) {\n    if (!playerId) return null;\n    return this.players.get(playerId)?.visualPosition ?? null;\n  }\n",
    "label": "Add creature body raycast"
  },
  {
    "path": "apps/client/src/game/NativeWorldRenderer.tsx",
    "before": "      const activatePointerTarget = (\n        target: PointerTarget,\n        event: PointerEvent | MouseEvent,\n      ) => {\n",
    "after": "      const targetAtPointer = (\n        event: PointerEvent | MouseEvent,\n      ): PointerTarget | null => {\n        const rect = canvas.getBoundingClientRect();\n        const ndc = new THREE.Vector2(\n          ((event.clientX - rect.left) / rect.width) * 2 - 1,\n          -(((event.clientY - rect.top) / rect.height) * 2 - 1),\n        );\n        raycaster.setFromCamera(ndc, camera);\n\n        const creatureId = activeActorManager.pickCreature(raycaster);\n        if (creatureId) {\n          const creature = world.creatures.get(creatureId);\n          if (creature) {\n            return {\n              kind: \"creature\",\n              position: creature.position,\n              id: creature.id,\n              label: `${creature.name} · Attack`,\n            };\n          }\n        }\n\n        const position = pointerTile(event);\n        return position ? targetAt(position) : null;\n      };\n\n      const activatePointerTarget = (\n        target: PointerTarget,\n        event: PointerEvent | MouseEvent,\n      ) => {\n",
    "label": "Resolve pointer against creature body before ground tile"
  },
  {
    "path": "apps/client/src/game/NativeWorldRenderer.tsx",
    "before": "      const interactAtPointer = (event: PointerEvent | MouseEvent) => {\n        const position = pointerTile(event);\n        if (!position) return;\n        activatePointerTarget(targetAt(position), event);\n      };\n",
    "after": "      const interactAtPointer = (event: PointerEvent | MouseEvent) => {\n        const target = targetAtPointer(event);\n        if (!target) return;\n        activatePointerTarget(target, event);\n      };\n",
    "label": "Use body-aware pointer target for interaction"
  },
  {
    "path": "apps/client/src/game/NativeWorldRenderer.tsx",
    "before": "      const onPointerMove = (event: PointerEvent) => {\n        const position = pointerTile(event);\n        if (!position) {\n          hideHover();\n          return;\n        }\n\n        const target = targetAt(position);\n        if (target.kind === \"ground\") {\n",
    "after": "      const onPointerMove = (event: PointerEvent) => {\n        const target = targetAtPointer(event);\n        if (!target) {\n          hideHover();\n          return;\n        }\n\n        if (target.kind === \"ground\") {\n",
    "label": "Use body-aware pointer target for hover"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "import { GameMinimap } from \"./game/GameMinimap\";\n",
    "after": "import { GameMinimap } from \"./game/GameMinimap\";\nimport { WorldMap } from \"./game/WorldMap\";\n",
    "label": "Import full world map"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "        <ServerStatusIndicator online={serverOnline} />\n",
    "after": "        <ServerStatusIndicator online={serverOnline} />\n        <UpdaterStatusPanel />\n",
    "label": "Render updater status inside login"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "function ServerStatusIndicator({ online }: { online: boolean | null }) {\n",
    "after": "type UpdaterStatus = {\n  phase:\n    | \"checking\"\n    | \"up_to_date\"\n    | \"available\"\n    | \"downloading\"\n    | \"installing\"\n    | \"restarting\"\n    | \"error\";\n  currentVersion?: string;\n  version?: string;\n  downloaded?: number;\n  total?: number;\n  progress?: number;\n  message?: string;\n};\n\ntype UpdaterWindow = Window & {\n  __ALDORIA_UPDATER_STATUS__?: UpdaterStatus;\n};\n\nfunction formatUpdateBytes(value: number | undefined) {\n  if (!value || value <= 0) return \"—\";\n  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;\n  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;\n  return `${value} B`;\n}\n\nfunction UpdaterStatusPanel() {\n  const [status, setStatus] = useState<UpdaterStatus | null>(\n    () => (window as UpdaterWindow).__ALDORIA_UPDATER_STATUS__ ?? null,\n  );\n\n  useEffect(() => {\n    const listener = (event: Event) => {\n      const next = (event as CustomEvent<UpdaterStatus>).detail;\n      if (next) setStatus(next);\n    };\n    window.addEventListener(\"aldoria-updater-status\", listener);\n    setStatus((window as UpdaterWindow).__ALDORIA_UPDATER_STATUS__ ?? null);\n    return () => window.removeEventListener(\"aldoria-updater-status\", listener);\n  }, []);\n\n  if (!status || status.phase === \"up_to_date\") return null;\n\n  const percent = Math.max(\n    0,\n    Math.min(\n      100,\n      status.total && status.downloaded\n        ? status.downloaded / status.total * 100\n        : status.progress ?? 0,\n    ),\n  );\n\n  const label = {\n    checking: \"Checking for client update…\",\n    available: status.version\n      ? `Updating to ${status.version}…`\n      : \"Client update available…\",\n    downloading: \"Downloading client update…\",\n    installing: \"Verifying and installing update…\",\n    restarting: \"Update installed. Restarting…\",\n    error: status.message ?? \"Could not update the client.\",\n    up_to_date: \"\",\n  }[status.phase];\n\n  return (\n    <section className={`updater-status updater-${status.phase}`} aria-live=\"polite\">\n      <header>\n        <span><small>Client updater</small><strong>{label}</strong></span>\n        {status.phase === \"downloading\" && <b>{Math.round(percent)}%</b>}\n      </header>\n      {[\"available\", \"downloading\", \"installing\"].includes(status.phase) && (\n        <div className=\"updater-progress\" aria-label={`Update ${Math.round(percent)} percent`}>\n          <i style={{ width: `${status.phase === \"downloading\" ? percent : status.phase === \"installing\" ? 100 : 2}%` }} />\n        </div>\n      )}\n      {status.phase === \"downloading\" && (\n        <footer>\n          <span>{formatUpdateBytes(status.downloaded)} / {formatUpdateBytes(status.total)}</span>\n          {status.currentVersion && status.version && <span>{status.currentVersion} → {status.version}</span>}\n        </footer>\n      )}\n    </section>\n  );\n}\n\nfunction ServerStatusIndicator({ online }: { online: boolean | null }) {\n",
    "label": "Add updater status React component"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "  const [panel, setPanel] = useState<Panel | null>(null);\n",
    "after": "  const [panel, setPanel] = useState<Panel | null>(null);\n  const [worldMapOpen, setWorldMapOpen] = useState(false);\n",
    "label": "Add world map state"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "  const [actionSkills, setActionSkills] = useState<Record<number, string | null>>(() => loadActionSkills());\n",
    "after": "  const actionSkillsStorageKey = `aldoria.action-skills.${world.localPlayerId ?? \"unknown\"}`;\n  const [actionSkills, setActionSkills] = useState<Record<number, string | null>>(\n    () => loadActionSkills(world.localPlayerId),\n  );\n",
    "label": "Scope actionbar storage per character"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "  const emberBolt = world.spells.get(\"ember_bolt\");\n  const knowsEmberBolt = world.learnedSpellIds.has(\"ember_bolt\");\n  const castEmberBolt = () => {\n    if (knowsEmberBolt) network.castSpell(\"ember_bolt\");\n    else\n      world.addSystemMessage(\n        \"Learn Ember Bolt from Seraphine in Greyhaven first.\",\n      );\n  };\n  const activateActionSlot = (slot: number) => {\n    const actionId = actionSkills[slot];\n    if (actionId === \"ember_sigil\") useEmberSigil();\n    else if (actionId === \"ember_bolt\") castEmberBolt();\n    else if (actionId && actionSkillDefinition(actionId)) setPanel(\"skills\");\n  };\n",
    "after": "  const activateActionSlot = (slot: number) => {\n    const actionId = actionSkills[slot];\n    if (!actionId) return;\n    if (actionId === \"ember_sigil\") {\n      useEmberSigil();\n      return;\n    }\n    if (world.learnedSpellIds.has(actionId) && world.spells.has(actionId)) {\n      network.castSpell(actionId);\n    }\n  };\n",
    "label": "Make learned spells generic actionbar actions"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "    localStorage.setItem(\"aldoria.action-skills\", JSON.stringify(actionSkills));\n",
    "after": "    localStorage.setItem(actionSkillsStorageKey, JSON.stringify(actionSkills));\n",
    "label": "Save actionbar per character"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "  }, [actionSkills]);\n  useEffect(() => localStorage.setItem(\"aldoria.show-performance\", String(showPerformance)), [showPerformance]);\n",
    "after": "  }, [actionSkills, actionSkillsStorageKey]);\n  useEffect(() => localStorage.setItem(\"aldoria.show-performance\", String(showPerformance)), [showPerformance]);\n",
    "label": "Update actionbar persistence dependencies"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "    if (panel || escapeMenu || world.trade || world.incomingTrade || world.activeNpcId)\n      input.releaseAll();\n",
    "after": "    if (panel || worldMapOpen || escapeMenu || world.trade || world.incomingTrade || world.activeNpcId)\n      input.releaseAll();\n",
    "label": "Release movement input while world map is open"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "    panel,\n    escapeMenu,\n    Boolean(world.trade),\n",
    "after": "    panel,\n    worldMapOpen,\n    escapeMenu,\n    Boolean(world.trade),\n",
    "label": "Track world map in movement release effect"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "      if (event.key === \"Escape\") {\n        event.preventDefault();\n        event.stopPropagation();\n        if (panel) {\n",
    "after": "      if (event.key === \"Escape\") {\n        event.preventDefault();\n        event.stopPropagation();\n        if (worldMapOpen) {\n          setWorldMapOpen(false);\n          return;\n        }\n        if (panel) {\n",
    "label": "Escape closes world map first"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "      const actionHotkey = /^Digit([1-8])$/.exec(event.code);\n",
    "after": "      if (\n        event.code === \"KeyM\"\n        && !escapeMenu\n        && !world.trade\n        && !world.incomingTrade\n        && !world.activeNpcId\n      ) {\n        event.preventDefault();\n        event.stopPropagation();\n        setPanel(null);\n        setWorldMapOpen((current) => !current);\n        return;\n      }\n\n      const actionHotkey = /^Digit([1-8])$/.exec(event.code);\n",
    "label": "Add M world-map hotkey"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "  }, [actionSkills, emberSigil?.instanceId, escapeMenu, knowsEmberBolt, panel, world.attackTargetId, world.revision]);\n",
    "after": "  }, [actionSkills, emberSigil?.instanceId, escapeMenu, panel, world.attackTargetId, world.revision, worldMapOpen]);\n",
    "label": "Update hotkey dependencies"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "      <GameMinimap world={world} />\n      <BattleList />\n",
    "after": "      <GameMinimap world={world} />\n      {worldMapOpen && <WorldMap world={world} onClose={() => setWorldMapOpen(false)} />}\n      <BattleList />\n",
    "label": "Render full world map overlay"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "          const isSigil = actionId === \"ember_sigil\";\n          const isBolt = actionId === \"ember_bolt\";\n          const unavailable = isSigil\n            ? !emberSigil || !world.attackTargetId\n            : isBolt\n              ? !knowsEmberBolt || !world.attackTargetId || (local?.mana ?? 0) < (emberBolt?.manaCost ?? 0)\n              : false;\n          const detail = isSigil\n            ? emberCharges\n            : isBolt\n              ? knowsEmberBolt ? emberBolt?.manaCost ?? 0 : \"—\"\n              : action?.name;\n",
    "after": "          const isSigil = actionId === \"ember_sigil\";\n          const spell = actionId ? world.spells.get(actionId) : undefined;\n          const isSpell = Boolean(\n            actionId\n            && spell\n            && world.learnedSpellIds.has(actionId),\n          );\n          const unavailable = isSigil\n            ? !emberSigil || !world.attackTargetId\n            : isSpell\n              ? !world.attackTargetId || (local?.mana ?? 0) < (spell?.manaCost ?? 0)\n              : false;\n          const detail = isSigil\n            ? emberCharges\n            : isSpell\n              ? `${spell?.manaCost ?? 0} mana`\n              : action?.name;\n",
    "label": "Generalize action slot display to learned spells"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "            className={`ability-slot ${isSigil ? \"ember-sigil\" : isBolt ? \"ember-bolt\" : action ? \"skill-ability\" : \"empty-ability\"} ${unavailable ? \"unavailable\" : \"\"}`}\n",
    "after": "            className={`ability-slot ${isSigil ? \"ember-sigil\" : isSpell ? \"spell-action\" : action ? \"skill-ability\" : \"empty-ability\"} ${unavailable ? \"unavailable\" : \"\"}`}\n",
    "label": "Use generic spell action slot class"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const skillValue = event.dataTransfer.getData(\"application/x-aldoria-skill\") || event.dataTransfer.getData(\"text/plain\"); if (skillValue && actionSkillDefinitions.some((entry) => entry.id === skillValue)) assignActionSkill(slot, skillValue); }}\n",
    "after": "            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const skillValue = event.dataTransfer.getData(\"application/x-aldoria-skill\") || event.dataTransfer.getData(\"text/plain\"); if (skillValue && actionBarDefinition(skillValue)) assignActionSkill(slot, skillValue); }}\n",
    "label": "Accept learned spell drops on actionbar"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "            {isBolt && world.spellCooldownUntil > Date.now() && <i key={world.spellCooldownUntil} className=\"cooldown-sweep\" style={{ animationDuration: `${world.spellCooldownMs}ms` }} />}\n",
    "after": "            {isSpell && world.spellCooldownUntil > Date.now() && <i key={world.spellCooldownUntil} className=\"cooldown-sweep\" style={{ animationDuration: `${world.spellCooldownMs}ms` }} />}\n",
    "label": "Show cooldown on any learned spell"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "    <p className=\"drag-hint\">Drag a skill to action bar slots 1–8. Drag it out of the bar or right-click to remove it.</p>\n    <ActionSkillList player={player} />\n",
    "after": "    <p className=\"drag-hint\">Drag a learned ability to action bar slots 1–8. Drag it out of the bar or right-click to remove it.</p>\n    <ActionSkillList />\n",
    "label": "Describe abilities rather than passive skills"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "type ActionSkill = { id: string; name: string; glyph: string; description: string };\nconst actionSkillDefinitions: ActionSkill[] = [\n  { id: \"melee\", name: \"Melee\", glyph: \"M\", description: \"Melee weapon skill\" },\n  { id: \"distance\", name: \"Distance\", glyph: \"D\", description: \"Distance weapon skill\" },\n  { id: \"fletching\", name: \"Fletching\", glyph: \"F\", description: \"Ammunition crafting skill\" },\n  { id: \"magic\", name: \"Magic\", glyph: \"✦\", description: \"Magic level\" },\n  { id: \"alchemy\", name: \"Alchemy\", glyph: \"A\", description: \"Potions, extracts and reagents\" },\n  { id: \"mining\", name: \"Mining\", glyph: \"M\", description: \"Ore, stone and rare minerals\" },\n  { id: \"woodcutting\", name: \"Woodcutting\", glyph: \"W\", description: \"Timber and uncommon woods\" },\n  { id: \"fishing\", name: \"Fishing\", glyph: \"F\", description: \"Fish and aquatic resources\" },\n  { id: \"cooking\", name: \"Cooking\", glyph: \"C\", description: \"Meals with restorative effects\" },\n  { id: \"smithing\", name: \"Smithing\", glyph: \"S\", description: \"Weapons, armor and metalwork\" },\n  { id: \"leatherworking\", name: \"Leatherworking\", glyph: \"L\", description: \"Hide, scale and flexible armor\" },\n];\nconst fixedActionDefinitions: ActionSkill[] = [\n  { id: \"ember_sigil\", name: \"Ember Sigil\", glyph: \"ES\", description: \"Deal fire damage to the selected target\" },\n  { id: \"ember_bolt\", name: \"Ember Bolt\", glyph: \"EB\", description: \"Cast a mana-powered bolt at the selected target\" },\n];\n",
    "after": "type ActionSkill = { id: string; name: string; glyph: string; description: string };\nconst actionSkillDefinitions: ActionSkill[] = [];\nconst fixedActionDefinitions: ActionSkill[] = [\n  { id: \"ember_sigil\", name: \"Ember Sigil\", glyph: \"ES\", description: \"Deal fire damage to the selected target\" },\n];\n\nfunction spellGlyph(name: string) {\n  const glyph = name\n    .split(/\\s+/)\n    .filter(Boolean)\n    .map((part) => part[0])\n    .join(\"\")\n    .slice(0, 2)\n    .toUpperCase();\n  return glyph || \"✦\";\n}\n\nfunction learnedSpellActionDefinition(id: string): ActionSkill | undefined {\n  if (!world.learnedSpellIds.has(id)) return undefined;\n  const spell = world.spells.get(id);\n  if (!spell) return undefined;\n  return {\n    id: spell.id,\n    name: spell.name,\n    glyph: spellGlyph(spell.name),\n    description: `${spell.description} · ${spell.manaCost} mana · range ${spell.range} · ${(spell.cooldownMs / 1000).toFixed(1)}s cooldown`,\n  };\n}\n\nfunction availableActionDefinitions() {\n  const actions: ActionSkill[] = [];\n  if (world.inventory.some((item) => item.definitionId === \"ember_rune\")) {\n    actions.push(...fixedActionDefinitions);\n  }\n  for (const spellId of world.learnedSpellIds) {\n    const action = learnedSpellActionDefinition(spellId);\n    if (action) actions.push(action);\n  }\n  return actions;\n}\n",
    "label": "Replace passive actionbar skills with learned abilities"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "function actionBarDefinition(id: string) {\n  return fixedActionDefinitions.find((action) => action.id === id) ?? actionSkillDefinition(id);\n}\n",
    "after": "function actionBarDefinition(id: string) {\n  return fixedActionDefinitions.find((action) => action.id === id)\n    ?? learnedSpellActionDefinition(id)\n    ?? actionSkillDefinition(id);\n}\n",
    "label": "Resolve learned spells as actionbar definitions"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "function ActionSkillList({ player }: { player: PlayerView }) {\n  return <section className=\"action-skill-list\">\n    <header><small>Action bar</small><span>Drag skills to slots 1–8 · Drag out or right-click to remove</span></header>\n    <div>{actionSkillDefinitions.map((skill) => <div\n      key={skill.id}\n      className=\"action-skill-source\"\n      draggable={false}\n      title={skill.description}\n      onPointerDown={(event) => beginSkillPointerDrag(event, skill.id)}\n      onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(\"application/x-aldoria-skill\", skill.id); event.dataTransfer.setData(\"text/plain\", skill.id); event.dataTransfer.effectAllowed = \"copy\"; }}\n    >\n      <i>{skill.glyph}</i><span><strong>{skill.name}</strong><small>{skill.description}</small></span>\n      <b>{skill.id === \"melee\" ? player.swordSkill : skill.id === \"distance\" ? player.distanceSkill : skill.id === \"fletching\" ? player.fletchingSkill : skill.id === \"magic\" ? player.magicLevel : world.professionSkills.get(skill.id)?.level ?? 0}</b>\n    </div>)}</div>\n  </section>;\n}\n",
    "after": "function ActionSkillList() {\n  const actions = availableActionDefinitions();\n  return <section className=\"action-skill-list\">\n    <header><small>Abilities</small><span>Only learned/usable actions can be placed on slots 1–8</span></header>\n    {actions.length > 0 ? (\n      <div>{actions.map((action) => <div\n        key={action.id}\n        className=\"action-skill-source\"\n        draggable={false}\n        title={action.description}\n        onPointerDown={(event) => beginSkillPointerDrag(event, action.id)}\n        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(\"application/x-aldoria-skill\", action.id); event.dataTransfer.setData(\"text/plain\", action.id); event.dataTransfer.effectAllowed = \"copy\"; }}\n      >\n        <i>{action.glyph}</i><span><strong>{action.name}</strong><small>{action.description}</small></span>\n        <b>{world.spells.get(action.id)?.manaCost ?? \"item\"}</b>\n      </div>)}</div>\n    ) : (\n      <p className=\"action-skill-empty\">You have not learned any action-bar abilities yet.</p>\n    )}\n  </section>;\n}\n",
    "label": "Render learned abilities in Skills panel"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "function loadActionSkills(): Record<number, string | null> {\n  const defaults: Record<number, string | null> = { 1: \"ember_sigil\", 2: \"ember_bolt\" };\n  try {\n    const value = JSON.parse(localStorage.getItem(\"aldoria.action-skills\") ?? \"{}\");\n    if (!value || typeof value !== \"object\") return defaults;\n    return {\n      ...defaults,\n      ...Object.fromEntries(Object.entries(value).filter(([slot, skill]) =>\n        /^[1-8]$/.test(slot) && (skill === null || typeof skill === \"string\") && (!skill || Boolean(actionBarDefinition(skill))),\n      )),\n    } as Record<number, string | null>;\n  } catch {\n    return defaults;\n  }\n}\n",
    "after": "function emptyActionSkills(): Record<number, string | null> {\n  return { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null };\n}\n\nfunction loadActionSkills(characterId: string | null): Record<number, string | null> {\n  const empty = emptyActionSkills();\n  if (!characterId) return empty;\n  try {\n    const value = JSON.parse(\n      localStorage.getItem(`aldoria.action-skills.${characterId}`) ?? \"{}\",\n    );\n    if (!value || typeof value !== \"object\") return empty;\n    return {\n      ...empty,\n      ...Object.fromEntries(Object.entries(value).filter(([slot, action]) =>\n        /^[1-8]$/.test(slot)\n        && (\n          action === null\n          || (\n            typeof action === \"string\"\n            && Boolean(actionBarDefinition(action))\n          )\n        ),\n      )),\n    } as Record<number, string | null>;\n  } catch {\n    return empty;\n  }\n}\n",
    "label": "New characters start with eight empty actionbar slots"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "      onContextMenu={(event) => onOpenContextMenu(event, item.instanceId)}\n",
    "after": "      onContextMenu={(event) => {\n        if (definition?.foodEffect) {\n          event.preventDefault();\n          event.stopPropagation();\n          network.eat(item.instanceId);\n          return;\n        }\n        onOpenContextMenu(event, item.instanceId);\n      }}\n",
    "label": "Restore reliable right-click eating"
  },
  {
    "path": "apps/client/src/App.tsx",
    "before": "import { PROTOCOL_VERSION, type BuildingView, type CharacterOutfit, type GroundItem, type ItemDefinition, type ItemInstance, type PlayerView, type Position, type SecondarySkill } from \"./protocol\";\n",
    "after": "import { PROTOCOL_VERSION, type BuildingView, type CharacterOutfit, type GroundItem, type ItemDefinition, type ItemInstance, type PlayerView, type Position, type SecondarySkill } from \"./protocol\";\n// TIBIAGAME_V34_FIXSET_1\n",
    "label": "Add V34 marker"
  }
];
const fullReplacements = [
  {
    "path": "apps/client/src-tauri/src/main.rs",
    "before": "fn main() { aldoria_client_lib::run(); }\n",
    "after": "#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]\n\nfn main() { aldoria_client_lib::run(); }\n",
    "label": "Suppress Windows release console window"
  },
  {
    "path": "apps/client/src-tauri/src/lib.rs",
    "before": "// TIBIAGAME_FRIEND_UPDATER_V33\n#[cfg(feature = \"friend-updater\")]\nuse tauri_plugin_updater::UpdaterExt;\n\n#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run() {\n    let builder = tauri::Builder::default();\n\n    #[cfg(feature = \"friend-updater\")]\n    let builder = builder\n        .plugin(tauri_plugin_updater::Builder::new().build())\n        .setup(|app| {\n            let handle = app.handle().clone();\n            tauri::async_runtime::spawn(async move {\n                let updater = match handle.updater() {\n                    Ok(updater) => updater,\n                    Err(error) => {\n                        eprintln!(\"Aldoria updater setup failed: {error}\");\n                        return;\n                    }\n                };\n\n                match updater.check().await {\n                    Ok(Some(update)) => {\n                        eprintln!(\n                            \"Aldoria client update available: {} -> {}\",\n                            update.current_version,\n                            update.version\n                        );\n\n                        match update\n                            .download_and_install(\n                                |_chunk_length, _content_length| {},\n                                || {\n                                    eprintln!(\"Aldoria client update downloaded\");\n                                },\n                            )\n                            .await\n                        {\n                            Ok(()) => {\n                                eprintln!(\"Aldoria client update installed; restarting\");\n                                handle.restart();\n                            }\n                            Err(error) => {\n                                eprintln!(\"Aldoria client update install failed: {error}\");\n                            }\n                        }\n                    }\n                    Ok(None) => {}\n                    Err(error) => {\n                        eprintln!(\"Aldoria updater check failed: {error}\");\n                    }\n                }\n            });\n\n            Ok(())\n        });\n\n    builder\n        .run(tauri::generate_context!())\n        .expect(\"error while running the desktop client\");\n}\n\n",
    "after": "// TIBIAGAME_FRIEND_UPDATER_V33\n// TIBIAGAME_V34_FIXSET_1\n#[cfg(feature = \"friend-updater\")]\nuse serde_json::{Value, json};\n#[cfg(feature = \"friend-updater\")]\nuse tauri::Manager;\n#[cfg(feature = \"friend-updater\")]\nuse tauri_plugin_updater::UpdaterExt;\n\n#[cfg(feature = \"friend-updater\")]\nfn emit_updater_status(handle: &tauri::AppHandle, payload: Value) {\n    let Some(window) = handle.get_webview_window(\"main\") else {\n        return;\n    };\n\n    let payload = payload.to_string();\n    let script = format!(\n        \"window.__ALDORIA_UPDATER_STATUS__={payload};\\\n         window.dispatchEvent(new CustomEvent('aldoria-updater-status',{{detail:{payload}}}));\"\n    );\n    let _ = window.eval(&script);\n}\n\n#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run() {\n    let builder = tauri::Builder::default();\n\n    #[cfg(feature = \"friend-updater\")]\n    let builder = builder\n        .plugin(tauri_plugin_updater::Builder::new().build())\n        .setup(|app| {\n            let handle = app.handle().clone();\n\n            tauri::async_runtime::spawn(async move {\n                emit_updater_status(&handle, json!({ \"phase\": \"checking\" }));\n\n                let updater = match handle.updater() {\n                    Ok(updater) => updater,\n                    Err(error) => {\n                        emit_updater_status(&handle, json!({\n                            \"phase\": \"error\",\n                            \"message\": format!(\"Updater setup failed: {error}\")\n                        }));\n                        return;\n                    }\n                };\n\n                match updater.check().await {\n                    Ok(Some(update)) => {\n                        let current_version = update.current_version.to_string();\n                        let version = update.version.to_string();\n\n                        emit_updater_status(&handle, json!({\n                            \"phase\": \"available\",\n                            \"currentVersion\": current_version,\n                            \"version\": version\n                        }));\n\n                        let progress_handle = handle.clone();\n                        let install_handle = handle.clone();\n                        let mut downloaded = 0_u64;\n\n                        match update\n                            .download_and_install(\n                                move |chunk_length, content_length| {\n                                    downloaded = downloaded.saturating_add(chunk_length as u64);\n                                    let total = content_length.unwrap_or(0);\n                                    let progress = if total > 0 {\n                                        (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0)\n                                    } else {\n                                        0.0\n                                    };\n\n                                    emit_updater_status(&progress_handle, json!({\n                                        \"phase\": \"downloading\",\n                                        \"downloaded\": downloaded,\n                                        \"total\": total,\n                                        \"progress\": progress\n                                    }));\n                                },\n                                move || {\n                                    emit_updater_status(&install_handle, json!({\n                                        \"phase\": \"installing\"\n                                    }));\n                                },\n                            )\n                            .await\n                        {\n                            Ok(()) => {\n                                emit_updater_status(&handle, json!({\n                                    \"phase\": \"restarting\"\n                                }));\n                                handle.restart();\n                            }\n                            Err(error) => {\n                                emit_updater_status(&handle, json!({\n                                    \"phase\": \"error\",\n                                    \"message\": format!(\"Update install failed: {error}\")\n                                }));\n                            }\n                        }\n                    }\n                    Ok(None) => {\n                        emit_updater_status(&handle, json!({\n                            \"phase\": \"up_to_date\"\n                        }));\n                    }\n                    Err(error) => {\n                        emit_updater_status(&handle, json!({\n                            \"phase\": \"error\",\n                            \"message\": format!(\"Update check failed: {error}\")\n                        }));\n                    }\n                }\n            });\n\n            Ok(())\n        });\n\n    builder\n        .run(tauri::generate_context!())\n        .expect(\"error while running the desktop client\");\n}\n",
    "label": "Expose updater progress to React"
  }
];
const newFiles = {
  "apps/client/src/game/WorldMap.tsx": "import {\n  useEffect,\n  useRef,\n  useState,\n  useSyncExternalStore,\n  type PointerEvent as ReactPointerEvent,\n  type WheelEvent,\n} from \"react\";\nimport type { Position } from \"../protocol\";\nimport type { WorldState } from \"./WorldState\";\n\nconst CANVAS_WIDTH = 900;\nconst CANVAS_HEIGHT = 620;\n\ntype DragState = {\n  pointerId: number;\n  x: number;\n  y: number;\n  center: Position;\n};\n\nexport function WorldMap({\n  world,\n  onClose,\n}: {\n  world: WorldState;\n  onClose: () => void;\n}) {\n  const canvasRef = useRef<HTMLCanvasElement>(null);\n  const dragRef = useRef<DragState | null>(null);\n  const player = world.localPlayerId ? world.players.get(world.localPlayerId) : null;\n  const [scale, setScale] = useState(10);\n  const [center, setCenter] = useState<Position>(\n    () => player?.position ?? { x: 0, y: 0, z: 7 },\n  );\n\n  const revision = useSyncExternalStore(\n    (listener) => {\n      const stopWorld = world.subscribe(listener);\n      const stopVisual = world.subscribeVisual(listener);\n      return () => { stopWorld(); stopVisual(); };\n    },\n    () => `${world.revision}:${world.visualRevision}`,\n  );\n\n  useEffect(() => {\n    if (!player) return;\n    setCenter((current) =>\n      current.z === player.position.z\n        ? current\n        : { ...player.position },\n    );\n  }, [player?.position.z]);\n\n  useEffect(() => {\n    const canvas = canvasRef.current;\n    const context = canvas?.getContext(\"2d\");\n    if (!canvas || !context || !player) return;\n    drawWorldMap(context, world, center, scale, player.position);\n  }, [world, revision, center, scale, player?.position.x, player?.position.y, player?.position.z]);\n\n  const reset = () => {\n    if (player) setCenter({ ...player.position });\n  };\n\n  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {\n    event.currentTarget.setPointerCapture(event.pointerId);\n    dragRef.current = {\n      pointerId: event.pointerId,\n      x: event.clientX,\n      y: event.clientY,\n      center: { ...center },\n    };\n  };\n\n  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {\n    const drag = dragRef.current;\n    if (!drag || drag.pointerId !== event.pointerId) return;\n    setCenter({\n      x: drag.center.x - (event.clientX - drag.x) / scale,\n      y: drag.center.y - (event.clientY - drag.y) / scale,\n      z: drag.center.z,\n    });\n  };\n\n  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {\n    if (dragRef.current?.pointerId !== event.pointerId) return;\n    if (event.currentTarget.hasPointerCapture(event.pointerId)) {\n      event.currentTarget.releasePointerCapture(event.pointerId);\n    }\n    dragRef.current = null;\n  };\n\n  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {\n    event.preventDefault();\n    const factor = event.deltaY > 0 ? 0.84 : 1.18;\n    setScale((current) => Math.max(3, Math.min(28, current * factor)));\n  };\n\n  return (\n    <section className=\"world-map-layer\" role=\"dialog\" aria-modal=\"true\" aria-label=\"World map\">\n      <article className=\"world-map-card\">\n        <header>\n          <span>\n            <small>World map</small>\n            <strong>{player?.position.z === 7 ? \"The First Marches\" : `Floor ${player?.position.z ?? center.z}`}</strong>\n          </span>\n          <div>\n            <button type=\"button\" onClick={reset}>Center player</button>\n            <button type=\"button\" className=\"world-map-close\" onClick={onClose} aria-label=\"Close world map\">×</button>\n          </div>\n        </header>\n        <canvas\n          ref={canvasRef}\n          width={CANVAS_WIDTH}\n          height={CANVAS_HEIGHT}\n          onPointerDown={pointerDown}\n          onPointerMove={pointerMove}\n          onPointerUp={pointerUp}\n          onPointerCancel={pointerUp}\n          onWheel={wheel}\n        />\n        <footer>\n          <span>Drag to pan · Mouse wheel to zoom · M / Esc to close</span>\n          <b>{player ? `${player.position.x}, ${player.position.y}, z${player.position.z}` : \"—\"}</b>\n        </footer>\n      </article>\n    </section>\n  );\n}\n\nfunction drawWorldMap(\n  context: CanvasRenderingContext2D,\n  world: WorldState,\n  center: Position,\n  scale: number,\n  player: Position,\n) {\n  const map = world.map;\n  const width = context.canvas.width;\n  const height = context.canvas.height;\n  const halfWidth = width / 2;\n  const halfHeight = height / 2;\n  const floor = player.z;\n\n  const screen = (position: Position) => ({\n    x: halfWidth + (position.x + 0.5 - center.x) * scale,\n    y: halfHeight + (position.y + 0.5 - center.y) * scale,\n  });\n\n  const visible = (position: Position) =>\n    position.z === floor\n    && Math.abs(position.x - center.x) <= width / scale / 2 + 3\n    && Math.abs(position.y - center.y) <= height / scale / 2 + 3;\n\n  const tile = (position: Position, color: string, size = scale + 0.4) => {\n    if (!visible(position)) return;\n    const point = screen(position);\n    context.fillStyle = color;\n    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);\n  };\n\n  const dot = (position: Position, color: string, radius: number) => {\n    if (!visible(position)) return;\n    const point = screen(position);\n    context.beginPath();\n    context.fillStyle = color;\n    context.arc(point.x, point.y, radius, 0, Math.PI * 2);\n    context.fill();\n  };\n\n  context.clearRect(0, 0, width, height);\n  context.fillStyle = \"#070a08\";\n  context.fillRect(0, 0, width, height);\n\n  if (map) {\n    for (const entry of map.terrainMaterials) {\n      tile(\n        entry.position,\n        entry.material === \"mud\"\n          ? \"#5c4939\"\n          : entry.material === \"marsh_grass\"\n            ? \"#435c3b\"\n            : entry.material === \"wood_planks\"\n              ? \"#7b5b3d\"\n              : \"#5d5d4e\",\n      );\n    }\n    for (const position of map.floors) tile(position, \"#6b5948\");\n    for (const position of map.roads) tile(position, \"#8a8376\");\n    for (const position of map.bridges) tile(position, \"#8b623d\");\n    for (const position of map.water) tile(position, \"#225d70\");\n    for (const position of map.blocked) tile(position, \"#303833\", Math.max(2, scale * 0.7));\n\n    for (const building of map.buildings) {\n      if (building.floor !== floor) continue;\n      const topLeft = screen({ x: building.x, y: building.y, z: floor });\n      context.fillStyle = building.kind === \"keep\" ? \"#909998\" : \"#a47450\";\n      context.fillRect(\n        topLeft.x - scale / 2,\n        topLeft.y - scale / 2,\n        building.width * scale,\n        building.height * scale,\n      );\n      if (scale >= 8) {\n        context.fillStyle = \"#f0dfbd\";\n        context.font = `${Math.max(9, Math.min(13, scale))}px system-ui`;\n        context.fillText(building.name, topLeft.x, topLeft.y - 4);\n      }\n    }\n\n    for (const position of map.trees) dot(position, \"#1c4829\", Math.max(1.5, scale * 0.25));\n    for (const door of map.doors) dot(door.position, \"#e5b65e\", Math.max(2, scale * 0.18));\n  }\n\n  for (const node of world.resourceNodes.values()) {\n    if (node.available) dot(node.position, \"#c57c45\", Math.max(2, scale * 0.2));\n  }\n  for (const npc of world.npcs.values()) {\n    dot(npc.position, \"#b997e8\", Math.max(2.5, scale * 0.22));\n  }\n\n  const playerPoint = screen(player);\n  context.beginPath();\n  context.fillStyle = \"#f7e3a8\";\n  context.arc(playerPoint.x, playerPoint.y, Math.max(4, scale * 0.32), 0, Math.PI * 2);\n  context.fill();\n  context.strokeStyle = \"#261d12\";\n  context.lineWidth = 2;\n  context.stroke();\n}\n",
  "apps/client/src/v34.css": "/* TIBIAGAME_V34_FIXSET_1 */\n:root {\n  --aldoria-modal-scale: 1;\n  --aldoria-readable-small: 12px;\n  --aldoria-readable-body: 13px;\n  --aldoria-readable-value: 14px;\n}\n\n@media (max-width: 1280px), (max-height: 760px) {\n  :root { --aldoria-modal-scale: .84; }\n}\n@media (max-width: 1050px), (max-height: 650px) {\n  :root { --aldoria-modal-scale: .74; }\n}\n@media (max-width: 650px) {\n  :root { --aldoria-modal-scale: .70; }\n}\n\n.modal-layer > .game-modal,\n.world-map-card {\n  zoom: var(--aldoria-modal-scale);\n}\n\n.game-modal { font-size: var(--aldoria-readable-body); }\n.game-modal small,\n.game-modal p,\n.game-modal label,\n.game-modal dt,\n.game-modal dd,\n.game-modal .inventory-slot-name,\n.game-modal .action-skill-source strong,\n.game-modal .action-skill-source small {\n  font-size: var(--aldoria-readable-small) !important;\n  line-height: 1.35;\n}\n.game-modal h3,\n.game-modal strong,\n.game-modal b {\n  font-size: var(--aldoria-readable-value);\n}\n.game-modal button,\n.game-modal input,\n.game-modal select {\n  font-size: var(--aldoria-readable-small);\n}\n\n.depot-columns article {\n  display: grid !important;\n  grid-template-columns: 38px minmax(0, 1fr) minmax(190px, auto);\n  align-items: center;\n  justify-content: initial !important;\n}\n.depot-columns article > .item-icon { grid-column: 1; }\n.depot-columns article > span { grid-column: 2; }\n.depot-row-actions {\n  grid-column: 3;\n  display: grid !important;\n  grid-template-columns: 74px 108px;\n  justify-content: end;\n  align-items: end;\n  gap: 8px;\n  min-width: 190px;\n}\n.depot-row-actions > label { grid-column: 1; min-width: 0; }\n.depot-row-actions > button { grid-column: 2; margin: 0; }\n\n.action-skill-empty {\n  margin: 0;\n  padding: 10px;\n  color: #89978f;\n  font-size: 12px;\n  border: 1px dashed #34433a;\n  border-radius: 5px;\n}\n.action-dock .spell-action {\n  background: radial-gradient(circle at 50% 38%, #56406b, #18121f 72%);\n  border-color: #9277aa;\n}\n.action-dock .spell-action small { color: #d8c2ee; }\n\n.updater-status {\n  display: grid;\n  gap: 8px;\n  margin: 12px 0 4px;\n  padding: 11px 12px;\n  background: #0d1511e8;\n  border: 1px solid #4f6658;\n  border-radius: 8px;\n}\n.updater-status header,\n.updater-status footer {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n}\n.updater-status header > span { display: grid; gap: 2px; }\n.updater-status small {\n  color: #9eaf9f;\n  font-size: 10px;\n  text-transform: uppercase;\n  letter-spacing: .08em;\n}\n.updater-status strong { color: #e8ddc2; font-size: 12px; }\n.updater-status b { color: #e0b96c; font-size: 12px; }\n.updater-status footer { color: #8e9b93; font-size: 10px; }\n.updater-progress {\n  height: 8px;\n  overflow: hidden;\n  background: #070b09;\n  border: 1px solid #34433a;\n  border-radius: 999px;\n}\n.updater-progress > i {\n  display: block;\n  height: 100%;\n  min-width: 2px;\n  background: linear-gradient(90deg, #8a6938, #d4ac61);\n  transition: width 120ms linear;\n}\n.updater-error { border-color: #854b45; }\n.updater-error strong { color: #e3aaa1; }\n\n.world-map-layer {\n  position: fixed;\n  z-index: 45;\n  inset: 0;\n  display: grid;\n  place-items: center;\n  padding: 24px;\n  background: #020403a8;\n  backdrop-filter: blur(3px);\n}\n.world-map-card {\n  display: grid;\n  width: min(94vw, 980px);\n  max-height: 92vh;\n  overflow: hidden;\n  background: linear-gradient(145deg, #171d18, #090d0a);\n  border: 1px solid #9d7d49;\n  border-radius: 12px;\n  box-shadow: 0 24px 80px #000d, inset 0 1px #ffffff12;\n}\n.world-map-card > header,\n.world-map-card > footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 12px 15px;\n}\n.world-map-card > header { border-bottom: 1px solid #ffffff16; }\n.world-map-card > header > span { display: grid; gap: 2px; }\n.world-map-card > header small {\n  color: #b69a64;\n  font-size: 11px;\n  text-transform: uppercase;\n  letter-spacing: .1em;\n}\n.world-map-card > header strong {\n  color: #f0dfba;\n  font: 600 18px Cinzel, serif;\n}\n.world-map-card > header > div { display: flex; gap: 8px; }\n.world-map-card > header button { font-size: 11px; }\n.world-map-close { width: 34px; padding-inline: 0 !important; }\n.world-map-card canvas {\n  display: block;\n  width: 100%;\n  min-height: 360px;\n  max-height: calc(92vh - 120px);\n  aspect-ratio: 900 / 620;\n  cursor: grab;\n  touch-action: none;\n  background: #070a08;\n}\n.world-map-card canvas:active { cursor: grabbing; }\n.world-map-card > footer {\n  color: #89968e;\n  font-size: 11px;\n  border-top: 1px solid #ffffff12;\n}\n.world-map-card > footer b {\n  color: #d5ba7b;\n  font: 600 11px ui-monospace, monospace;\n}\n\n@media (max-width: 720px) {\n  .depot-columns article {\n    grid-template-columns: 38px minmax(0, 1fr);\n  }\n  .depot-row-actions {\n    grid-column: 1 / -1;\n    grid-template-columns: minmax(74px, .8fr) minmax(108px, 1fr);\n    width: 100%;\n  }\n}\n"
};

function findRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, "apps/client/src/App.tsx")) &&
      fs.existsSync(path.join(current, "crates/game-server"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    "Could not find tibiaCloneGame repository root. Run this script from inside the cloned Ghilea/tibiaCloneGame repository."
  );
}

function readUtf8(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

const root = findRoot(process.cwd());
const appPath = path.join(root, "apps/client/src/App.tsx");
const currentApp = readUtf8(appPath);

if (currentApp.includes(MARKER)) {
  console.log("V34 fix batch 1 is already applied. Nothing to do.");
  process.exit(0);
}

const protocol = readUtf8(path.join(root, "apps/client/src/protocol.ts"));
if (!protocol.includes("export const PROTOCOL_VERSION = 29;")) {
  throw new Error(
    "This patch targets the inspected protocol V29 main branch. The repository has moved; inspect the new source before applying."
  );
}

const files = new Map();
function get(relative) {
  if (!files.has(relative)) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Missing expected file: ${relative}`);
    }
    files.set(relative, readUtf8(absolute));
  }
  return files.get(relative);
}
function set(relative, value) {
  files.set(relative, value);
}

const planned = [];

for (const operation of [...fullReplacements, ...replacements]) {
  const current = get(operation.path);
  const matches = countOccurrences(current, operation.before);
  if (matches !== 1) {
    throw new Error(
      `${operation.label}: expected exactly one source match in ${operation.path}, found ${matches}. No files were written.`
    );
  }
  set(operation.path, current.replace(operation.before, operation.after));
  planned.push(operation.label);
}

for (const [relative, content] of Object.entries(newFiles)) {
  const absolute = path.join(root, relative);
  if (fs.existsSync(absolute)) {
    const current = readUtf8(absolute);
    if (current === content.replace(/\r\n/g, "\n")) {
      continue;
    }
    throw new Error(
      `Refusing to overwrite existing ${relative} because it is not the expected V34 file.`
    );
  }
  files.set(relative, content);
  planned.push(`Create ${relative}`);
}

// Post-transform sanity.
const patchedApp = files.get("apps/client/src/App.tsx");
const patchedInput = files.get("apps/client/src/game/InputController.ts");
const patchedNative = files.get("apps/client/src/game/NativeWorldRenderer.tsx");

for (const token of [
  MARKER,
  "function UpdaterStatusPanel()",
  "function availableActionDefinitions()",
  "function loadActionSkills(characterId: string | null)",
  "<WorldMap world={world}",
]) {
  if (!patchedApp.includes(token)) {
    throw new Error(`Post-patch App.tsx sanity failed: missing ${token}`);
  }
}
if (!patchedInput.includes("Move closer to gather that resource.")) {
  throw new Error("Post-patch InputController.ts sanity failed.");
}
if (!patchedNative.includes("pickCreature(raycaster: THREE.Raycaster)")) {
  throw new Error("Post-patch NativeWorldRenderer.tsx sanity failed.");
}
if (patchedApp.includes('const knowsEmberBolt')) {
  throw new Error("Hardcoded Ember Bolt action state still remains.");
}

console.log(`Repository: ${root}`);
console.log(checkOnly ? "CHECK MODE - no files will be written." : "APPLY MODE");
console.log();
console.log("Validated changes:");
for (const label of planned) console.log(`  ✓ ${label}`);

if (checkOnly) {
  console.log();
  console.log("Check passed. Run the same command without --check to apply the fixes.");
  process.exit(0);
}

for (const [relative, content] of files) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content.replace(/\n/g, "\r\n"), "utf8");
}

console.log();
console.log("Applied Aldoria V34 fix batch 1.");
console.log();
console.log("Run cheap validation BEFORE a full Tauri build:");
console.log("  npm --prefix apps/client run check");
console.log("  npm --prefix apps/client test");
console.log("  cargo test -p game-types");
console.log("  cargo test -p game-server");
console.log("  cargo check --manifest-path apps/client/src-tauri/Cargo.toml");
console.log("  git diff --check");
console.log("  git diff");
console.log();
console.log("Do not start the long Tauri/package build until those checks are green.");
