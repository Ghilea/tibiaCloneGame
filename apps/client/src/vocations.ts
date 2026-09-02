export const vocations = [
  {
    id: "warrior",
    name: "Warrior",
    icon: "⚔",
    role: "Durable melee fighter",
    detail: "180 health · 130 capacity · trains Melee twice as fast",
  },
  {
    id: "ranger",
    name: "Ranger",
    icon: "➶",
    role: "Mobile weapon specialist",
    detail: "Ashwood Bow · 100 arrows · trains Distance twice as fast",
  },
  {
    id: "mage",
    name: "Mage",
    icon: "✦",
    role: "Offensive sigil crafter",
    detail: "120 mana · Magic Level 2 · trains Magic twice as fast",
  },
  {
    id: "druid",
    name: "Druid",
    icon: "❧",
    role: "Resilient sigil crafter",
    detail: "115 health · 110 mana · trains Magic twice as fast",
  },
] as const;

export type VocationId = (typeof vocations)[number]["id"];

export function vocationName(id: string) {
  return vocations.find((vocation) => vocation.id === id)?.name ?? "Adventurer";
}

export function canCraftSigils(id?: string) {
  return id === "mage" || id === "druid" || id === "adventurer";
}
