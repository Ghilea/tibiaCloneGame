import abilityAtlasUrl from "../assets/ability-icons-v35_12.png";

export type AbilityIconKey =
  | "power_strike"
  | "shield_bash"
  | "quick_shot"
  | "healing_pulse"
  | "mana_burst"
  | "fire_bolt"
  | "frost_nova"
  | "poison_toss"
  | "sprint"
  | "parry"
  | "cleave"
  | "war_cry";

const GRID: Record<AbilityIconKey, { col: number; row: number }> = {
  power_strike: { col: 0, row: 0 },
  shield_bash: { col: 1, row: 0 },
  quick_shot: { col: 2, row: 0 },
  healing_pulse: { col: 3, row: 0 },
  mana_burst: { col: 0, row: 1 },
  fire_bolt: { col: 1, row: 1 },
  frost_nova: { col: 2, row: 1 },
  poison_toss: { col: 3, row: 1 },
  sprint: { col: 0, row: 2 },
  parry: { col: 1, row: 2 },
  cleave: { col: 2, row: 2 },
  war_cry: { col: 3, row: 2 },
};

export function getAbilityIconKey(value: string | undefined | null): AbilityIconKey | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, AbilityIconKey> = {
    basic_attack: "power_strike",
    attack: "power_strike",
    power_strike: "power_strike",
    strike: "power_strike",
    heavy_strike: "power_strike",

    shield_guard: "shield_bash",
    shield_bash: "shield_bash",
    guarding: "shield_bash",

    quick_shot: "quick_shot",
    aimed_shot: "quick_shot",
    shot: "quick_shot",

    second_wind: "healing_pulse",
    healing_pulse: "healing_pulse",
    heal: "healing_pulse",
    restore: "healing_pulse",

    mana_burst: "mana_burst",
    mana_surge: "mana_burst",
    focus: "mana_burst",

    ember_sigil: "fire_bolt",
    ember_bolt: "fire_bolt",
    fire_bolt: "fire_bolt",
    fireball: "fire_bolt",

    frost_rune: "frost_nova",
    frost_nova: "frost_nova",
    frost: "frost_nova",

    venom_rune: "poison_toss",
    poison_toss: "poison_toss",
    poison: "poison_toss",

    sprint: "sprint",
    dash: "sprint",
    haste: "sprint",

    parry: "parry",
    riposte: "parry",
    counter: "parry",

    cleave: "cleave",
    sweeping_cleave: "cleave",

    war_cry: "war_cry",
    stun: "war_cry",
    battle_cry: "war_cry",
  };
  return aliases[normalized] ?? null;
}

function gridPos(index: number, total: number) {
  return index === 0 ? "0%" : index === total - 1 ? "100%" : `${(index / (total - 1)) * 100}%`;
}

export function AbilityIcon({
  iconKey,
  title,
  size = 28,
  className = "",
}: {
  iconKey: AbilityIconKey | null;
  title?: string;
  size?: number;
  className?: string;
}) {
  if (!iconKey) {
    return (
      <span
        className={"v3512-ability-icon v3512-ability-icon--fallback " + className}
        title={title}
        style={{ width: size, height: size }}
      />
    );
  }

  const tile = GRID[iconKey];
  const x = gridPos(tile.col, 4);
  const y = gridPos(tile.row, 3);

  return (
    <span
      className={"v3512-ability-icon " + className}
      title={title}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${abilityAtlasUrl})`,
        backgroundSize: "400% 300%",
        backgroundPosition: `${x} ${y}`,
      }}
    />
  );
}
