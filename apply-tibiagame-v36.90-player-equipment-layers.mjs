#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const MARKER = "TIBIAGAME_V36_90_PLAYER_EQUIPMENT_LAYERS";
const REQUIRED_NPC_MARKER = "TIBIAGAME_V36_89_NPC_SERVICE_VARIANTS";
const layerKeys = ["back","backpack","chest","legs","feet","helmet","amulet","ring","weapon_melee","weapon_ranged","offhand_guard","offhand_light"];
const expectedAtlases = new Map([
  ["assets/players/equipment/back/atlases/back_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/back/atlases/back_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/back/atlases/back_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/back/atlases/back_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/back/atlases/back_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/back/atlases/back_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/back/atlases/back_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/backpack/atlases/backpack_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/backpack/atlases/backpack_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/backpack/atlases/backpack_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/backpack/atlases/backpack_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/backpack/atlases/backpack_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/backpack/atlases/backpack_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/backpack/atlases/backpack_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/chest/atlases/chest_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/chest/atlases/chest_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/chest/atlases/chest_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/chest/atlases/chest_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/chest/atlases/chest_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/chest/atlases/chest_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/chest/atlases/chest_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/legs/atlases/legs_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/legs/atlases/legs_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/legs/atlases/legs_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/legs/atlases/legs_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/legs/atlases/legs_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/legs/atlases/legs_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/legs/atlases/legs_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/feet/atlases/feet_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/feet/atlases/feet_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/feet/atlases/feet_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/feet/atlases/feet_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/feet/atlases/feet_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/feet/atlases/feet_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/feet/atlases/feet_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/helmet/atlases/helmet_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/helmet/atlases/helmet_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/helmet/atlases/helmet_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/helmet/atlases/helmet_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/helmet/atlases/helmet_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/helmet/atlases/helmet_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/helmet/atlases/helmet_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/amulet/atlases/amulet_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/amulet/atlases/amulet_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/amulet/atlases/amulet_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/amulet/atlases/amulet_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/amulet/atlases/amulet_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/amulet/atlases/amulet_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/amulet/atlases/amulet_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/ring/atlases/ring_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/ring/atlases/ring_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/ring/atlases/ring_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/ring/atlases/ring_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/ring/atlases/ring_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/ring/atlases/ring_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/ring/atlases/ring_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_melee/atlases/weapon_melee_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/weapon_ranged/atlases/weapon_ranged_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_guard/atlases/offhand_guard_use_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_idle_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_walk_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_attack_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_hit_8dir_aldoria_v36_90.png", [192,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_death_8dir_aldoria_v36_90.png", [384,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_cast_8dir_aldoria_v36_90.png", [288,512]],
  ["assets/players/equipment/offhand_light/atlases/offhand_light_use_8dir_aldoria_v36_90.png", [288,512]]
]);

const componentsBlock = Buffer.from("CiNbZGVyaXZlKENvbXBvbmVudCldCnB1YihjcmF0ZSkgc3RydWN0IFBsYXllckVxdWlwbWVudExheWVyIHsKICAgIGtleTogU3RyaW5nLAogICAgbWF0ZXJpYWw6IEhhbmRsZTxTdGFuZGFyZE1hdGVyaWFsPiwKfQoKI1tkZXJpdmUoQ29tcG9uZW50KV0KcHViKGNyYXRlKSBzdHJ1Y3QgUGxheWVyRXF1aXBtZW50TGF5ZXJzUmVhZHk7Cgo=", "base64").toString("utf8");
const systemsBlock = Buffer.from("CnB1YihjcmF0ZSkgZm4gZW5zdXJlX2xvY2FsX3BsYXllcl9lcXVpcG1lbnRfbGF5ZXJzKAogICAgbXV0IGNvbW1hbmRzOiBDb21tYW5kcywKICAgIGNhdGFsb2c6IFJlczxQbGF5ZXJTcHJpdGVDYXRhbG9nPiwKICAgIG11dCBtYXRlcmlhbHM6IFJlc011dDxBc3NldHM8U3RhbmRhcmRNYXRlcmlhbD4+LAogICAgcm9vdHM6IFF1ZXJ5PEVudGl0eSwgKFdpdGg8TG9jYWxQbGF5ZXJTcHJpdGU+LCBXaXRob3V0PFBsYXllckVxdWlwbWVudExheWVyc1JlYWR5Pik+LAopIHsKICAgIGZvciByb290IGluICZyb290cyB7CiAgICAgICAgZm9yIGtleSBpbiBFUVVJUE1FTlRfTEFZRVJfT1JERVIgewogICAgICAgICAgICBsZXQgYWN0b3IgPSBjYXRhbG9nCiAgICAgICAgICAgICAgICAuZXF1aXBtZW50CiAgICAgICAgICAgICAgICAuZ2V0KGtleSkKICAgICAgICAgICAgICAgIC51bndyYXBfb3JfZWxzZSh8fCBwYW5pYyEoInZhbGlkYXRlZCBwbGF5ZXIgZXF1aXBtZW50IGNhdGFsb2cgbWlzc2luZyAne2tleX0nIikpOwogICAgICAgICAgICBsZXQgZGVmaW5pdGlvbiA9ICZhY3Rvci5kZWZpbml0aW9uOwogICAgICAgICAgICBsZXQgaWRsZSA9IGRlZmluaXRpb24KICAgICAgICAgICAgICAgIC5zcGVjKEFjdG9yQW5pbWF0aW9uOjpJZGxlKQogICAgICAgICAgICAgICAgLmV4cGVjdCgidmFsaWRhdGVkIGVxdWlwbWVudCBsYXllciBtdXN0IGRlZmluZSBpZGxlIik7CiAgICAgICAgICAgIGxldCBpZGxlX3RleHR1cmUgPSBhY3RvcgogICAgICAgICAgICAgICAgLnRleHR1cmUoQWN0b3JBbmltYXRpb246OklkbGUpCiAgICAgICAgICAgICAgICAuZXhwZWN0KCJ2YWxpZGF0ZWQgZXF1aXBtZW50IGxheWVyIG11c3QgbG9hZCBpZGxlIHRleHR1cmUiKTsKCiAgICAgICAgICAgIGxldCBtYXRlcmlhbCA9IG1hdGVyaWFscy5hZGQoU3RhbmRhcmRNYXRlcmlhbCB7CiAgICAgICAgICAgICAgICBiYXNlX2NvbG9yOiBDb2xvcjo6V0hJVEUsCiAgICAgICAgICAgICAgICBiYXNlX2NvbG9yX3RleHR1cmU6IFNvbWUoaWRsZV90ZXh0dXJlLmNsb25lKCkpLAogICAgICAgICAgICAgICAgbm9ybWFsX21hcF90ZXh0dXJlOiBhY3Rvci5ub3JtYWwoQWN0b3JBbmltYXRpb246OklkbGUpLmNsb25lZCgpLAogICAgICAgICAgICAgICAgdXZfdHJhbnNmb3JtOiBhdGxhc191digKICAgICAgICAgICAgICAgICAgICBpZGxlLmNvbHVtbnMsCiAgICAgICAgICAgICAgICAgICAgZGVmaW5pdGlvbi5hdGxhc19yb3dzLAogICAgICAgICAgICAgICAgICAgIDAsCiAgICAgICAgICAgICAgICAgICAgU3ByaXRlRGlyZWN0aW9uOjpTb3V0aC5hdGxhc19yb3coZGVmaW5pdGlvbi5hdXRob3JlZF9kaXJlY3Rpb25zKSwKICAgICAgICAgICAgICAgICksCiAgICAgICAgICAgICAgICBwZXJjZXB0dWFsX3JvdWdobmVzczogMC45LAogICAgICAgICAgICAgICAgbWV0YWxsaWM6IDAuMCwKICAgICAgICAgICAgICAgIHVubGl0OiB0cnVlLAogICAgICAgICAgICAgICAgYWxwaGFfbW9kZTogQWxwaGFNb2RlOjpNYXNrKDAuMDUpLAogICAgICAgICAgICAgICAgZG91YmxlX3NpZGVkOiB0cnVlLAogICAgICAgICAgICAgICAgY3VsbF9tb2RlOiBOb25lLAogICAgICAgICAgICAgICAgZGVwdGhfYmlhczogZXF1aXBtZW50X2xheWVyX2RlcHRoX2JpYXMoa2V5KSwKICAgICAgICAgICAgICAgIC4uZGVmYXVsdCgpCiAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgY29tbWFuZHMuc3Bhd24oKAogICAgICAgICAgICAgICAgTmFtZTo6bmV3KGZvcm1hdCEoIlBsYXllciBFcXVpcG1lbnQgTGF5ZXIgwrcge2tleX0iKSksCiAgICAgICAgICAgICAgICBQbGF5ZXJFcXVpcG1lbnRMYXllciB7CiAgICAgICAgICAgICAgICAgICAga2V5OiBrZXkudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogbWF0ZXJpYWwuY2xvbmUoKSwKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgICBOb0ZydXN0dW1DdWxsaW5nLAogICAgICAgICAgICAgICAgQ2hpbGRPZihyb290KSwKICAgICAgICAgICAgICAgIE1lc2gzZChjYXRhbG9nLnF1YWQuY2xvbmUoKSksCiAgICAgICAgICAgICAgICBNZXNoTWF0ZXJpYWwzZChtYXRlcmlhbCksCiAgICAgICAgICAgICAgICBUcmFuc2Zvcm06OmRlZmF1bHQoKSwKICAgICAgICAgICAgICAgIFZpc2liaWxpdHk6OkhpZGRlbiwKICAgICAgICAgICAgKSk7CiAgICAgICAgfQogICAgICAgIGNvbW1hbmRzLmVudGl0eShyb290KS5pbnNlcnQoUGxheWVyRXF1aXBtZW50TGF5ZXJzUmVhZHkpOwogICAgfQp9CgpwdWIoY3JhdGUpIGZuIHN5bmNfbG9jYWxfcGxheWVyX2VxdWlwbWVudF9sYXllcnMoCiAgICB0aW1lOiBSZXM8VGltZT4sCiAgICBnYW1lX3N0YXRlOiBSZXM8TmF0aXZlR2FtZVN0YXRlPiwKICAgIGNhdGFsb2c6IFJlczxQbGF5ZXJTcHJpdGVDYXRhbG9nPiwKICAgIG11dCBtYXRlcmlhbHM6IFJlc011dDxBc3NldHM8U3RhbmRhcmRNYXRlcmlhbD4+LAogICAgYm9kaWVzOiBRdWVyeTwmTG9jYWxQbGF5ZXJTcHJpdGU+LAogICAgbXV0IGxheWVyczogUXVlcnk8KCZQbGF5ZXJFcXVpcG1lbnRMYXllciwgJm11dCBWaXNpYmlsaXR5KT4sCikgewogICAgbGV0IFNvbWUoYm9keSkgPSBib2RpZXMuaXRlcigpLm5leHQoKSBlbHNlIHsKICAgICAgICByZXR1cm47CiAgICB9OwogICAgbGV0IG5vdyA9IHRpbWUuZWxhcHNlZF9zZWNzX2Y2NCgpOwoKICAgIGZvciAobGF5ZXIsIG11dCB2aXNpYmlsaXR5KSBpbiAmbXV0IGxheWVycyB7CiAgICAgICAgbGV0IGFjdGl2ZSA9IGdhbWVfc3RhdGUuaW52ZW50b3J5Lml0ZXIoKS5hbnkofGl0ZW18IHsKICAgICAgICAgICAgZXF1aXBtZW50X3Zpc3VhbF9rZXlfZm9yX2l0ZW0oJmdhbWVfc3RhdGUsIGl0ZW0pCiAgICAgICAgICAgICAgICAuaXNfc29tZV9hbmQofGtleXwga2V5ID09IGxheWVyLmtleSkKICAgICAgICB9KTsKCiAgICAgICAgKnZpc2liaWxpdHkgPSBpZiBhY3RpdmUgeyBWaXNpYmlsaXR5OjpWaXNpYmxlIH0gZWxzZSB7IFZpc2liaWxpdHk6OkhpZGRlbiB9OwogICAgICAgIGlmICFhY3RpdmUgewogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CgogICAgICAgIGxldCBTb21lKGFjdG9yKSA9IGNhdGFsb2cuZXF1aXBtZW50LmdldCgmbGF5ZXIua2V5KSBlbHNlIHsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfTsKICAgICAgICBsZXQgZGVmaW5pdGlvbiA9ICZhY3Rvci5kZWZpbml0aW9uOwogICAgICAgIGxldCBhbmltYXRpb24gPSBpZiBkZWZpbml0aW9uLnNwZWMoYm9keS5hbmltYXRpb24pLmlzX3NvbWUoKQogICAgICAgICAgICAmJiBhY3Rvci50ZXh0dXJlKGJvZHkuYW5pbWF0aW9uKS5pc19zb21lKCkKICAgICAgICB7CiAgICAgICAgICAgIGJvZHkuYW5pbWF0aW9uCiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgQWN0b3JBbmltYXRpb246OklkbGUKICAgICAgICB9OwogICAgICAgIGxldCBTb21lKHNwZWMpID0gZGVmaW5pdGlvbi5zcGVjKGFuaW1hdGlvbikgZWxzZSB7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH07CiAgICAgICAgbGV0IFNvbWUodGV4dHVyZSkgPSBhY3Rvci50ZXh0dXJlKGFuaW1hdGlvbikgZWxzZSB7CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH07CgogICAgICAgIGxldCBmcmFtZSA9IHNwZWMuZnJhbWVfYXQoKG5vdyAtIGJvZHkuYW5pbWF0aW9uX3N0YXJ0ZWRfYXQpLm1heCgwLjApKTsKICAgICAgICBsZXQgU29tZShtdXQgbWF0ZXJpYWwpID0gbWF0ZXJpYWxzLmdldF9tdXQoJmxheWVyLm1hdGVyaWFsKSBlbHNlIHsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfTsKICAgICAgICBtYXRlcmlhbC5iYXNlX2NvbG9yX3RleHR1cmUgPSBTb21lKHRleHR1cmUuY2xvbmUoKSk7CiAgICAgICAgbWF0ZXJpYWwubm9ybWFsX21hcF90ZXh0dXJlID0gYWN0b3Iubm9ybWFsKGFuaW1hdGlvbikuY2xvbmVkKCk7CiAgICAgICAgbWF0ZXJpYWwudXZfdHJhbnNmb3JtID0gYXRsYXNfdXYoCiAgICAgICAgICAgIHNwZWMuY29sdW1ucywKICAgICAgICAgICAgZGVmaW5pdGlvbi5hdGxhc19yb3dzLAogICAgICAgICAgICBmcmFtZSwKICAgICAgICAgICAgYm9keS5kaXJlY3Rpb24uYXRsYXNfcm93KGRlZmluaXRpb24uYXV0aG9yZWRfZGlyZWN0aW9ucyksCiAgICAgICAgKTsKICAgIH0KfQoKZm4gZXF1aXBtZW50X3Zpc3VhbF9rZXlfZm9yX2l0ZW0oCiAgICBnYW1lX3N0YXRlOiAmTmF0aXZlR2FtZVN0YXRlLAogICAgaXRlbTogJkl0ZW1JbnN0YW5jZSwKKSAtPiBPcHRpb248JidzdGF0aWMgc3RyPiB7CiAgICBsZXQgc2xvdCA9IGl0ZW0uZXF1aXBwZWRfc2xvdC5hc19kZXJlZigpPy50b19hc2NpaV9sb3dlcmNhc2UoKTsKICAgIG1hdGNoIHNsb3QuYXNfc3RyKCkgewogICAgICAgICJoZWxtZXQiIHwgImhlYWQiID0+IFNvbWUoImhlbG1ldCIpLAogICAgICAgICJjaGVzdCIgfCAiYXJtb3IiIHwgImJvZHkiID0+IFNvbWUoImNoZXN0IiksCiAgICAgICAgImxlZ3MiIHwgInBhbnRzIiA9PiBTb21lKCJsZWdzIiksCiAgICAgICAgImZlZXQiIHwgImJvb3RzIiB8ICJzaG9lcyIgPT4gU29tZSgiZmVldCIpLAogICAgICAgICJiYWNrIiB8ICJjYXBlIiA9PiBTb21lKCJiYWNrIiksCiAgICAgICAgImJhY2twYWNrIiB8ICJiYWciID0+IFNvbWUoImJhY2twYWNrIiksCiAgICAgICAgImFtdWxldCIgfCAibmVjayIgPT4gU29tZSgiYW11bGV0IiksCiAgICAgICAgInJpbmciIHwgInJpbmcxIiB8ICJyaW5nMiIgPT4gU29tZSgicmluZyIpLAogICAgICAgICJ3ZWFwb24iIHwgInJpZ2h0X2hhbmQiIHwgInJpZ2h0aGFuZCIgfCAibWFpbl9oYW5kIiB8ICJtYWluaGFuZCIgPT4gewogICAgICAgICAgICBsZXQgcmFuZ2VkID0gZ2FtZV9zdGF0ZQogICAgICAgICAgICAgICAgLml0ZW1fZGVmaW5pdGlvbnMKICAgICAgICAgICAgICAgIC5nZXQoJml0ZW0uZGVmaW5pdGlvbl9pZCkKICAgICAgICAgICAgICAgIC5pc19zb21lX2FuZCh8ZGVmaW5pdGlvbnwgZGVmaW5pdGlvbi5kaXN0YW5jZV93ZWFwb24uaXNfc29tZSgpKTsKICAgICAgICAgICAgU29tZShpZiByYW5nZWQgeyAid2VhcG9uX3JhbmdlZCIgfSBlbHNlIHsgIndlYXBvbl9tZWxlZSIgfSkKICAgICAgICB9CiAgICAgICAgIm9mZmhhbmQiIHwgIm9mZl9oYW5kIiB8ICJsZWZ0X2hhbmQiIHwgImxlZnRoYW5kIiA9PiB7CiAgICAgICAgICAgIGxldCBsaWdodCA9IGdhbWVfc3RhdGUKICAgICAgICAgICAgICAgIC5pdGVtX2RlZmluaXRpb25zCiAgICAgICAgICAgICAgICAuZ2V0KCZpdGVtLmRlZmluaXRpb25faWQpCiAgICAgICAgICAgICAgICAuaXNfc29tZV9hbmQofGRlZmluaXRpb258IGRlZmluaXRpb24ubGlnaHRfc291cmNlLmlzX3NvbWUoKSk7CiAgICAgICAgICAgIFNvbWUoaWYgbGlnaHQgeyAib2ZmaGFuZF9saWdodCIgfSBlbHNlIHsgIm9mZmhhbmRfZ3VhcmQiIH0pCiAgICAgICAgfQogICAgICAgIF8gPT4gTm9uZSwKICAgIH0KfQoKZm4gZXF1aXBtZW50X2xheWVyX2RlcHRoX2JpYXMoa2V5OiAmc3RyKSAtPiBmMzIgewogICAgbWF0Y2gga2V5IHsKICAgICAgICAiYmFjayIgPT4gLTMwLjAsCiAgICAgICAgImJhY2twYWNrIiA9PiAtMjAuMCwKICAgICAgICAiY2hlc3QiID0+IDEwLjAsCiAgICAgICAgImxlZ3MiID0+IDE0LjAsCiAgICAgICAgImZlZXQiID0+IDE4LjAsCiAgICAgICAgImhlbG1ldCIgPT4gMjIuMCwKICAgICAgICAiYW11bGV0IiA9PiAyOC4wLAogICAgICAgICJyaW5nIiA9PiAzMi4wLAogICAgICAgICJ3ZWFwb25fbWVsZWUiID0+IDQyLjAsCiAgICAgICAgIndlYXBvbl9yYW5nZWQiID0+IDQyLjAsCiAgICAgICAgIm9mZmhhbmRfZ3VhcmQiID0+IDQ2LjAsCiAgICAgICAgIm9mZmhhbmRfbGlnaHQiID0+IDQ2LjAsCiAgICAgICAgXyA9PiA4LjAsCiAgICB9Cn0KCg==", "base64").toString("utf8");

const playerPath=path.join(root,"crates/game-client/src/player_sprites.rs");
const mainPath=path.join(root,"crates/game-client/src/main.rs");
const npcPath=path.join(root,"crates/game-client/src/npc_sprites.rs");
const validatorPath=path.join(root,"scripts/validate-actor-sprites.mjs");
const indexPath=path.join(root,"assets/actors/players/equipment/index.json");

function fail(message){ console.error("\nV36.90 PATCH FAILED: "+message); process.exit(1); }
function count(source,needle){ return source.split(needle).length-1; }
function replaceOnce(source,needle,replacement,label){
  const hits=count(source,needle);
  if(hits!==1) fail(`${label}: expected 1 occurrence, found ${hits}`);
  return source.replace(needle,replacement);
}
function readJson(file,label){
  if(!fs.existsSync(file)) fail(`${label} missing: ${path.relative(root,file)}`);
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}
  catch(error){fail(`${label} invalid JSON: ${error.message}`);}
}
function pngSize(file){
  const b=fs.readFileSync(file);
  const sig=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if(b.length<24 || !b.subarray(0,8).equals(sig) || b.toString("ascii",12,16)!=="IHDR") fail(`invalid PNG: ${path.relative(root,file)}`);
  return [b.readUInt32BE(16),b.readUInt32BE(20)];
}

for(const file of [playerPath,mainPath,npcPath,validatorPath,indexPath]){
  if(!fs.existsSync(file)) fail(`missing ${path.relative(root,file)}; extract the COMPLETE V36.90 ZIP first`);
}

let player=fs.readFileSync(playerPath,"utf8");
let main=fs.readFileSync(mainPath,"utf8");
const npc=fs.readFileSync(npcPath,"utf8");
let validator=fs.readFileSync(validatorPath,"utf8");

if(player.includes(MARKER) && main.includes(MARKER) && validator.includes(MARKER)){
  console.log("V36.90 already applied."); process.exit(0);
}
if(!player.includes("TIBIAGAME_V36_83_PRODUCTION_SPRITE_PIPELINE")) fail("V36.83 player pipeline marker missing");
if(!npc.includes(REQUIRED_NPC_MARKER)) fail("V36.89 NPC Service Variants must be applied before V36.90");
if(!validator.includes(REQUIRED_NPC_MARKER)) fail("V36.89 actor validator hook missing");

for(const [relative,expected] of expectedAtlases){
  const file=path.join(root,relative);
  if(!fs.existsSync(file)) fail(`missing V36.90 atlas: ${relative}`);
  const actual=pngSize(file);
  if(actual[0]!==expected[0] || actual[1]!==expected[1]) fail(`${relative} is ${actual[0]}x${actual[1]}, expected ${expected[0]}x${expected[1]}`);
}

const index=readJson(indexPath,"player equipment index");
if(index.schema!==1 || !Array.isArray(index.actors) || index.actors.length!==layerKeys.length) fail("player equipment index schema/count mismatch");
const columns={idle:4,walk:8,attack:6,hit:4,death:8,cast:6,use:6};
for(const key of layerKeys){
  const entry=index.actors.find(e=>e.game_definition_id===key);
  const expected=`actors/players/equipment/${key}/actor.json`;
  if(!entry || entry.manifest!==expected) fail(`equipment index mapping mismatch for '${key}'`);
  const m=readJson(path.join(root,"assets",...entry.manifest.split("/")),`${key} manifest`);
  if(m.schema!==1 || m.id!==`player.equipment.${key}` || m.authored_directions!==8 || m.atlas_rows!==8 || m.frame_width!==48 || m.frame_height!==64) fail(`${entry.manifest} geometry mismatch`);
  for(const [name,n] of Object.entries(columns)){
    if(!m.animations?.[name] || m.animations[name].columns!==n || m.animations[name].frames!==n) fail(`${entry.manifest} ${name} frame contract mismatch`);
  }
}

const singleAnchor=`            .add_systems(
                Update,
                player_sprites::sync_local_player_outfit
                    .after(pump_network)
                    .run_if(single_window_game_active),
            )
`;
const directAnchor=`        .add_systems(Update, player_sprites::sync_local_player_outfit.after(pump_network))
`;
const validatorAnchor="if (errors.length > 0) {";

if(!player.includes(MARKER)){
  for(const [needle,label] of [
    ['use bevy::{camera::visibility::NoFrustumCulling, prelude::*};',"bevy import"],
    ['use game_types::{EntityId, Position};',"game_types import"],
    ['        billboard_rotation, face_direction,\n',"actor import"],
    ['const PLAYER_MANIFEST: &str = "actors/players/default/actor.json";\n',"player manifest const"],
    ['    material: Handle<StandardMaterial>,\n}\n\n#[derive(Resource)]',"LocalPlayerSprite end"],
    ['    actor: ActorSpriteAssets,\n}',"catalog actor field"],
    ['        Self {\n            quad: meshes.add(quad),\n            actor: ActorSpriteAssets::load(asset_server, PLAYER_MANIFEST),\n        }',"catalog constructor"],
    ['pub fn update_local_player_sprite(',"update function anchor"]
  ]) if(count(player,needle)!==1) fail(`${label} baseline mismatch`);
}
if(!main.includes(MARKER) && (count(main,singleAnchor)!==1 || count(main,directAnchor)!==1)) fail("main.rs player schedule anchors mismatch");
if(!validator.includes(validatorAnchor)) fail("validator final block missing");

if(checkOnly){
  console.log("V36.90 PRECHECK PASSED");
  console.log(`${expectedAtlases.size} overlay atlases match the synchronized player animation contract.`);
  console.log("Will add 12 equipment visual layers driven by authoritative equipped_slot values.");
  console.log("Ranged/melee weapons and light/guard offhands are classified generically from item definitions.");
  console.log("Remote equipment is intentionally unchanged because remote PlayerView has no equipped inventory.");
  process.exit(0);
}

if(!player.includes(MARKER)){
  player=replaceOnce(player,
    "// TIBIAGAME_V36_81_CAST_USE_GATHERING_ACTIONS\n",
    "// TIBIAGAME_V36_81_CAST_USE_GATHERING_ACTIONS\n// "+MARKER+"\n",
    "player marker");
  player=replaceOnce(player,
    "use bevy::{camera::visibility::NoFrustumCulling, prelude::*};\n",
    "use std::collections::HashMap;\n\nuse bevy::{camera::visibility::NoFrustumCulling, prelude::*};\n",
    "HashMap import");
  player=replaceOnce(player,
    "use game_types::{EntityId, Position};\n",
    "use game_types::{EntityId, ItemInstance, Position};\n",
    "ItemInstance import");
  player=replaceOnce(player,
    "        billboard_rotation, face_direction,\n",
    "        billboard_rotation, face_direction, load_actor_index,\n",
    "load_actor_index import");
  player=replaceOnce(player,
    'const PLAYER_MANIFEST: &str = "actors/players/default/actor.json";\n',
    'const PLAYER_MANIFEST: &str = "actors/players/default/actor.json";\nconst PLAYER_EQUIPMENT_INDEX: &str = "actors/players/equipment/index.json";\n\nconst EQUIPMENT_LAYER_ORDER: [&str; 12] = ["back","backpack","chest","legs","feet","helmet","amulet","ring","weapon_melee","weapon_ranged","offhand_guard","offhand_light"];\n',
    "equipment constants");
  player=replaceOnce(player,
    "    material: Handle<StandardMaterial>,\n}\n\n#[derive(Resource)]",
    "    material: Handle<StandardMaterial>,\n}\n\n"+componentsBlock+"#[derive(Resource)]",
    "equipment components");
  player=replaceOnce(player,
    "    actor: ActorSpriteAssets,\n}",
    "    actor: ActorSpriteAssets,\n    equipment: HashMap<String, ActorSpriteAssets>,\n}",
    "catalog equipment field");
  player=replaceOnce(player,
    "        Self {\n            quad: meshes.add(quad),\n            actor: ActorSpriteAssets::load(asset_server, PLAYER_MANIFEST),\n        }",
    `        let mut equipment = HashMap::new();
        for entry in load_actor_index(PLAYER_EQUIPMENT_INDEX) {
            let key = entry.game_definition_id;
            let actor = ActorSpriteAssets::load(asset_server, &entry.manifest);
            equipment.insert(key, actor);
        }

        info!(
            "ALDORIA PLAYER EQUIPMENT · {} synchronized layers · index={}",
            equipment.len(),
            PLAYER_EQUIPMENT_INDEX,
        );

        Self {
            quad: meshes.add(quad),
            actor: ActorSpriteAssets::load(asset_server, PLAYER_MANIFEST),
            equipment,
        }`,
    "catalog constructor");
  player=replaceOnce(player,
    "pub fn update_local_player_sprite(",
    systemsBlock+"pub fn update_local_player_sprite(",
    "equipment systems");
}
player=player.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
fs.writeFileSync(playerPath,player,"utf8");

if(!main.includes(MARKER)){
  main=replaceOnce(main,singleAnchor,singleAnchor+
`            .add_systems(
                Update,
                player_sprites::ensure_local_player_equipment_layers
                    .after(player_sprites::update_local_player_sprite)
                    .run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                player_sprites::sync_local_player_equipment_layers
                    .after(player_sprites::ensure_local_player_equipment_layers)
                    .after(player_sprites::update_local_player_sprite)
                    .run_if(single_window_game_active),
            )
            // ${MARKER}
`,"single-window equipment schedule");
  main=replaceOnce(main,directAnchor,directAnchor+
`        .add_systems(
            Update,
            player_sprites::ensure_local_player_equipment_layers
                .after(player_sprites::update_local_player_sprite),
        )
        .add_systems(
            Update,
            player_sprites::sync_local_player_equipment_layers
                .after(player_sprites::ensure_local_player_equipment_layers)
                .after(player_sprites::update_local_player_sprite),
        )
`,"direct equipment schedule");
}
main=main.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
fs.writeFileSync(mainPath,main,"utf8");

if(!validator.includes(MARKER)){
  const block="\n// "+MARKER+"\n"+
    "const playerEquipmentIndex = path.join(actorsRoot, 'players', 'equipment', 'index.json');\n"+
    "if (!fs.existsSync(playerEquipmentIndex)) fail(relative(playerEquipmentIndex) + ' is missing');\n"+
    "else validateCreatureIndex(playerEquipmentIndex);\n\n";
  validator=validator.replace(validatorAnchor,block+validatorAnchor);
}
validator=validator.replace(/[ \t]*(?:\r?\n)+$/u,"\n");
fs.writeFileSync(validatorPath,validator,"utf8");

try{execFileSync(process.execPath,["scripts/validate-actor-sprites.mjs"],{cwd:root,stdio:"inherit"});}
catch{fail("actor sprite validation failed after applying V36.90");}

console.log("V36.90 PATCH APPLIED");
console.log("Local player equipment now renders as synchronized data-driven actor layers.");
