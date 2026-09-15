#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const MARKER = "TIBIAGAME_V36_93_CHARACTER_APPEARANCE_COMPOSER";
const REQUIRED = "TIBIAGAME_V36_92_REMOTE_EQUIPMENT_REPLICATION";

const playerPath = path.join(root, "crates/game-client/src/player_sprites.rs");
const mainPath = path.join(root, "crates/game-client/src/main.rs");
const validatorPath = path.join(root, "scripts/validate-actor-sprites.mjs");
const indexPath = path.join(root, "assets/actors/players/appearance/index.json");

const appearanceDefinitions = Buffer.from("CmNvbnN0IFBMQVlFUl9BUFBFQVJBTkNFX0lOREVYOiAmc3RyID0gImFjdG9ycy9wbGF5ZXJzL2FwcGVhcmFuY2UvaW5kZXguanNvbiI7CmNvbnN0IEFQUEVBUkFOQ0VfTEFZRVJfQ0FURUdPUklFUzogWyZzdHI7IDddID0KICAgIFsiaGVhZCIsICJmYWNlIiwgImhhaXIiLCAiZmFjaWFsX2hhaXIiLCAidG9yc28iLCAibGVncyIsICJmZWV0Il07CgojW2Rlcml2ZShSZXNvdXJjZSwgQ2xvbmUpXQpwdWIoY3JhdGUpIHN0cnVjdCBMb2NhbENoYXJhY3RlckFwcGVhcmFuY2UgewogICAgcHViKGNyYXRlKSBib2R5OiBTdHJpbmcsCiAgICBwdWIoY3JhdGUpIGhlYWQ6IFN0cmluZywKICAgIHB1YihjcmF0ZSkgZmFjZTogU3RyaW5nLAogICAgcHViKGNyYXRlKSBoYWlyOiBTdHJpbmcsCiAgICBwdWIoY3JhdGUpIGZhY2lhbF9oYWlyOiBPcHRpb248U3RyaW5nPiwKICAgIHB1YihjcmF0ZSkgdG9yc286IFN0cmluZywKICAgIHB1YihjcmF0ZSkgbGVnczogU3RyaW5nLAogICAgcHViKGNyYXRlKSBmZWV0OiBTdHJpbmcsCiAgICBwdWIoY3JhdGUpIHNraW5fdG9uZTogU3RyaW5nLAogICAgcHViKGNyYXRlKSBoYWlyX2NvbG9yOiBTdHJpbmcsCiAgICBwdWIoY3JhdGUpIHRvcnNvX2NvbG9yOiBTdHJpbmcsCiAgICBwdWIoY3JhdGUpIGxlZ3NfY29sb3I6IFN0cmluZywKICAgIHB1YihjcmF0ZSkgZmVldF9jb2xvcjogU3RyaW5nLAogICAgcHViKGNyYXRlKSBjdXN0b21pemVkOiBib29sLAogICAgbGFzdF9sZWdhY3lfb3V0Zml0OiBTdHJpbmcsCn0KCmltcGwgTG9jYWxDaGFyYWN0ZXJBcHBlYXJhbmNlIHsKICAgIGZuIGxlZ2FjeV9wcmVzZXQob3V0Zml0OiAmc3RyKSAtPiBTZWxmIHsKICAgICAgICBsZXQgbXV0IHZhbHVlID0gbWF0Y2ggb3V0Zml0IHsKICAgICAgICAgICAgIm1hZ2UiID0+IFNlbGYgewogICAgICAgICAgICAgICAgYm9keTogImJvZHlfMDEiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBoZWFkOiAiaGVhZF8wMyIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZhY2U6ICJmYWNlXzAzIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgaGFpcjogImhhaXJfMDQiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmYWNpYWxfaGFpcjogTm9uZSwKICAgICAgICAgICAgICAgIHRvcnNvOiAidG9yc29fMDMiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBsZWdzOiAibGVnc18wMyIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZlZXQ6ICJmZWV0XzAxIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgc2tpbl90b25lOiAic2tpbl9saWdodCIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGhhaXJfY29sb3I6ICJoYWlyX2JsYWNrIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgdG9yc29fY29sb3I6ICJjbG90aF92aW9sZXQiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBsZWdzX2NvbG9yOiAiY2xvdGhfbmF2eSIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZlZXRfY29sb3I6ICJsZWF0aGVyX2RhcmsiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBjdXN0b21pemVkOiBmYWxzZSwKICAgICAgICAgICAgICAgIGxhc3RfbGVnYWN5X291dGZpdDogU3RyaW5nOjpuZXcoKSwKICAgICAgICAgICAgfSwKICAgICAgICAgICAgInJhbmdlciIgPT4gU2VsZiB7CiAgICAgICAgICAgICAgICBib2R5OiAiYm9keV8wMSIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGhlYWQ6ICJoZWFkXzAyIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgZmFjZTogImZhY2VfMDIiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBoYWlyOiAiaGFpcl8wMyIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZhY2lhbF9oYWlyOiBTb21lKCJiZWFyZF8wMiIudG9fb3duZWQoKSksCiAgICAgICAgICAgICAgICB0b3JzbzogInRvcnNvXzAxIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgbGVnczogImxlZ3NfMDEiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmZWV0OiAiZmVldF8wMiIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIHNraW5fdG9uZTogInNraW5fdGFuIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgaGFpcl9jb2xvcjogImhhaXJfYXVidXJuIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgdG9yc29fY29sb3I6ICJjbG90aF9mb3Jlc3QiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBsZWdzX2NvbG9yOiAiY2xvdGhfZWFydGgiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmZWV0X2NvbG9yOiAibGVhdGhlcl9icm93biIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGN1c3RvbWl6ZWQ6IGZhbHNlLAogICAgICAgICAgICAgICAgbGFzdF9sZWdhY3lfb3V0Zml0OiBTdHJpbmc6Om5ldygpLAogICAgICAgICAgICB9LAogICAgICAgICAgICAicm9ndWUiID0+IFNlbGYgewogICAgICAgICAgICAgICAgYm9keTogImJvZHlfMDEiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBoZWFkOiAiaGVhZF8wMiIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZhY2U6ICJmYWNlXzAyIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgaGFpcjogImhhaXJfMDEiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmYWNpYWxfaGFpcjogTm9uZSwKICAgICAgICAgICAgICAgIHRvcnNvOiAidG9yc29fMDIiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBsZWdzOiAibGVnc18wMyIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZlZXQ6ICJmZWV0XzAxIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgc2tpbl90b25lOiAic2tpbl93YXJtIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgaGFpcl9jb2xvcjogImhhaXJfYmxhY2siLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICB0b3Jzb19jb2xvcjogImNsb3RoX2NoYXJjb2FsIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgbGVnc19jb2xvcjogImNsb3RoX2NoYXJjb2FsIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgZmVldF9jb2xvcjogImxlYXRoZXJfZGFyayIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGN1c3RvbWl6ZWQ6IGZhbHNlLAogICAgICAgICAgICAgICAgbGFzdF9sZWdhY3lfb3V0Zml0OiBTdHJpbmc6Om5ldygpLAogICAgICAgICAgICB9LAogICAgICAgICAgICBfID0+IFNlbGYgewogICAgICAgICAgICAgICAgYm9keTogImJvZHlfMDIiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBoZWFkOiAiaGVhZF8wMSIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGZhY2U6ICJmYWNlXzAxIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgaGFpcjogImhhaXJfMDIiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmYWNpYWxfaGFpcjogU29tZSgiYmVhcmRfMDEiLnRvX293bmVkKCkpLAogICAgICAgICAgICAgICAgdG9yc286ICJ0b3Jzb18wMiIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGxlZ3M6ICJsZWdzXzAyIi50b19vd25lZCgpLAogICAgICAgICAgICAgICAgZmVldDogImZlZXRfMDIiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBza2luX3RvbmU6ICJza2luX3dhcm0iLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBoYWlyX2NvbG9yOiAiaGFpcl9icm93biIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIHRvcnNvX2NvbG9yOiAiY2xvdGhfYnVyZ3VuZHkiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBsZWdzX2NvbG9yOiAiY2xvdGhfY2hhcmNvYWwiLnRvX293bmVkKCksCiAgICAgICAgICAgICAgICBmZWV0X2NvbG9yOiAibGVhdGhlcl9icm93biIudG9fb3duZWQoKSwKICAgICAgICAgICAgICAgIGN1c3RvbWl6ZWQ6IGZhbHNlLAogICAgICAgICAgICAgICAgbGFzdF9sZWdhY3lfb3V0Zml0OiBTdHJpbmc6Om5ldygpLAogICAgICAgICAgICB9LAogICAgICAgIH07CiAgICAgICAgdmFsdWUubGFzdF9sZWdhY3lfb3V0Zml0ID0gb3V0Zml0LnRvX293bmVkKCk7CiAgICAgICAgdmFsdWUKICAgIH0KfQoKI1tkZXJpdmUoQ29tcG9uZW50KV0KcHViKGNyYXRlKSBzdHJ1Y3QgUGxheWVyQXBwZWFyYW5jZUxheWVyIHsKICAgIGNhdGVnb3J5OiBTdHJpbmcsCiAgICBtYXRlcmlhbDogSGFuZGxlPFN0YW5kYXJkTWF0ZXJpYWw+LAp9CgojW2Rlcml2ZShDb21wb25lbnQpXQpwdWIoY3JhdGUpIHN0cnVjdCBQbGF5ZXJBcHBlYXJhbmNlTGF5ZXJzUmVhZHk7Cgo=", "base64").toString("utf8");
const appearanceSystems = Buffer.from("CnB1YihjcmF0ZSkgZm4gc3luY19sb2NhbF9jaGFyYWN0ZXJfYXBwZWFyYW5jZV9yZXNvdXJjZSgKICAgIG11dCBjb21tYW5kczogQ29tbWFuZHMsCiAgICBpZGVudGl0eTogUmVzPExvY2FsSWRlbnRpdHk+LAogICAgYXBwZWFyYW5jZTogT3B0aW9uPFJlc011dDxMb2NhbENoYXJhY3RlckFwcGVhcmFuY2U+PiwKKSB7CiAgICBsZXQgU29tZShtdXQgYXBwZWFyYW5jZSkgPSBhcHBlYXJhbmNlIGVsc2UgewogICAgICAgIGNvbW1hbmRzLmluc2VydF9yZXNvdXJjZShMb2NhbENoYXJhY3RlckFwcGVhcmFuY2U6OmxlZ2FjeV9wcmVzZXQoJmlkZW50aXR5Lm91dGZpdCkpOwogICAgICAgIHJldHVybjsKICAgIH07CgogICAgaWYgIWFwcGVhcmFuY2UuY3VzdG9taXplZCAmJiBhcHBlYXJhbmNlLmxhc3RfbGVnYWN5X291dGZpdCAhPSBpZGVudGl0eS5vdXRmaXQgewogICAgICAgICphcHBlYXJhbmNlID0gTG9jYWxDaGFyYWN0ZXJBcHBlYXJhbmNlOjpsZWdhY3lfcHJlc2V0KCZpZGVudGl0eS5vdXRmaXQpOwogICAgfQp9CgpwdWIoY3JhdGUpIGZuIGVuc3VyZV9sb2NhbF9wbGF5ZXJfYXBwZWFyYW5jZV9sYXllcnMoCiAgICBtdXQgY29tbWFuZHM6IENvbW1hbmRzLAogICAgY2F0YWxvZzogUmVzPFBsYXllclNwcml0ZUNhdGFsb2c+LAogICAgbXV0IG1hdGVyaWFsczogUmVzTXV0PEFzc2V0czxTdGFuZGFyZE1hdGVyaWFsPj4sCiAgICByb290czogUXVlcnk8RW50aXR5LCAoV2l0aDxMb2NhbFBsYXllclNwcml0ZT4sIFdpdGhvdXQ8UGxheWVyQXBwZWFyYW5jZUxheWVyc1JlYWR5Pik+LAopIHsKICAgIGZvciByb290IGluICZyb290cyB7CiAgICAgICAgZm9yIGNhdGVnb3J5IGluIEFQUEVBUkFOQ0VfTEFZRVJfQ0FURUdPUklFUyB7CiAgICAgICAgICAgIGxldCBtYXRlcmlhbCA9IG1hdGVyaWFscy5hZGQoU3RhbmRhcmRNYXRlcmlhbCB7CiAgICAgICAgICAgICAgICBiYXNlX2NvbG9yOiBDb2xvcjo6V0hJVEUsCiAgICAgICAgICAgICAgICBwZXJjZXB0dWFsX3JvdWdobmVzczogMC45LAogICAgICAgICAgICAgICAgbWV0YWxsaWM6IDAuMCwKICAgICAgICAgICAgICAgIHVubGl0OiB0cnVlLAogICAgICAgICAgICAgICAgYWxwaGFfbW9kZTogQWxwaGFNb2RlOjpNYXNrKDAuMDUpLAogICAgICAgICAgICAgICAgZG91YmxlX3NpZGVkOiB0cnVlLAogICAgICAgICAgICAgICAgY3VsbF9tb2RlOiBOb25lLAogICAgICAgICAgICAgICAgZGVwdGhfYmlhczogYXBwZWFyYW5jZV9sYXllcl9kZXB0aF9iaWFzKGNhdGVnb3J5KSwKICAgICAgICAgICAgICAgIC4uZGVmYXVsdCgpCiAgICAgICAgICAgIH0pOwoKICAgICAgICAgICAgY29tbWFuZHMuc3Bhd24oKAogICAgICAgICAgICAgICAgTmFtZTo6bmV3KGZvcm1hdCEoIlBsYXllciBBcHBlYXJhbmNlIExheWVyIMK3IHtjYXRlZ29yeX0iKSksCiAgICAgICAgICAgICAgICBQbGF5ZXJBcHBlYXJhbmNlTGF5ZXIgewogICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeS50b19vd25lZCgpLAogICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiBtYXRlcmlhbC5jbG9uZSgpLAogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgIE5vRnJ1c3R1bUN1bGxpbmcsCiAgICAgICAgICAgICAgICBDaGlsZE9mKHJvb3QpLAogICAgICAgICAgICAgICAgTWVzaDNkKGNhdGFsb2cucXVhZC5jbG9uZSgpKSwKICAgICAgICAgICAgICAgIE1lc2hNYXRlcmlhbDNkKG1hdGVyaWFsKSwKICAgICAgICAgICAgICAgIFRyYW5zZm9ybTo6ZGVmYXVsdCgpLAogICAgICAgICAgICAgICAgVmlzaWJpbGl0eTo6SGlkZGVuLAogICAgICAgICAgICApKTsKICAgICAgICB9CiAgICAgICAgY29tbWFuZHMuZW50aXR5KHJvb3QpLmluc2VydChQbGF5ZXJBcHBlYXJhbmNlTGF5ZXJzUmVhZHkpOwogICAgfQp9CgpwdWIoY3JhdGUpIGZuIHN5bmNfbG9jYWxfcGxheWVyX2FwcGVhcmFuY2VfbGF5ZXJzKAogICAgdGltZTogUmVzPFRpbWU+LAogICAgYXBwZWFyYW5jZTogT3B0aW9uPFJlczxMb2NhbENoYXJhY3RlckFwcGVhcmFuY2U+PiwKICAgIGNhdGFsb2c6IFJlczxQbGF5ZXJTcHJpdGVDYXRhbG9nPiwKICAgIG11dCBtYXRlcmlhbHM6IFJlc011dDxBc3NldHM8U3RhbmRhcmRNYXRlcmlhbD4+LAogICAgYm9kaWVzOiBRdWVyeTwmTG9jYWxQbGF5ZXJTcHJpdGU+LAogICAgbXV0IGxheWVyczogUXVlcnk8KCZQbGF5ZXJBcHBlYXJhbmNlTGF5ZXIsICZtdXQgVmlzaWJpbGl0eSk+LAopIHsKICAgIGxldCBTb21lKGFwcGVhcmFuY2UpID0gYXBwZWFyYW5jZSBlbHNlIHsKICAgICAgICByZXR1cm47CiAgICB9OwogICAgbGV0IFNvbWUoYm9keSkgPSBib2RpZXMuaXRlcigpLm5leHQoKSBlbHNlIHsKICAgICAgICByZXR1cm47CiAgICB9OwoKICAgIGxldCBub3cgPSB0aW1lLmVsYXBzZWRfc2Vjc19mNjQoKTsKCiAgICBpZiBsZXQgU29tZShhY3RvcikgPSBjYXRhbG9nLmFwcGVhcmFuY2VfYWN0b3IoJmFwcGVhcmFuY2UuYm9keSkgewogICAgICAgIGlmIGxldCAoU29tZShzcGVjKSwgU29tZSh0ZXh0dXJlKSkgPSAoCiAgICAgICAgICAgIGFjdG9yLmRlZmluaXRpb24uc3BlYyhib2R5LmFuaW1hdGlvbiksCiAgICAgICAgICAgIGFjdG9yLnRleHR1cmUoYm9keS5hbmltYXRpb24pLAogICAgICAgICkgewogICAgICAgICAgICBpZiBsZXQgU29tZShtdXQgbWF0ZXJpYWwpID0gbWF0ZXJpYWxzLmdldF9tdXQoJmJvZHkubWF0ZXJpYWwpIHsKICAgICAgICAgICAgICAgIGxldCBmcmFtZSA9IHNwZWMuZnJhbWVfYXQoKG5vdyAtIGJvZHkuYW5pbWF0aW9uX3N0YXJ0ZWRfYXQpLm1heCgwLjApKTsKICAgICAgICAgICAgICAgIG1hdGVyaWFsLmJhc2VfY29sb3IgPSBhcHBlYXJhbmNlX2NvbG9yKCZhcHBlYXJhbmNlLnNraW5fdG9uZSk7CiAgICAgICAgICAgICAgICBtYXRlcmlhbC5iYXNlX2NvbG9yX3RleHR1cmUgPSBTb21lKHRleHR1cmUuY2xvbmUoKSk7CiAgICAgICAgICAgICAgICBtYXRlcmlhbC5ub3JtYWxfbWFwX3RleHR1cmUgPSBhY3Rvci5ub3JtYWwoYm9keS5hbmltYXRpb24pLmNsb25lZCgpOwogICAgICAgICAgICAgICAgbWF0ZXJpYWwudXZfdHJhbnNmb3JtID0gYXRsYXNfdXYoCiAgICAgICAgICAgICAgICAgICAgc3BlYy5jb2x1bW5zLAogICAgICAgICAgICAgICAgICAgIGFjdG9yLmRlZmluaXRpb24uYXRsYXNfcm93cywKICAgICAgICAgICAgICAgICAgICBmcmFtZSwKICAgICAgICAgICAgICAgICAgICBib2R5LmRpcmVjdGlvbgogICAgICAgICAgICAgICAgICAgICAgICAuYXRsYXNfcm93KGFjdG9yLmRlZmluaXRpb24uYXV0aG9yZWRfZGlyZWN0aW9ucyksCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGZvciAobGF5ZXIsIG11dCB2aXNpYmlsaXR5KSBpbiAmbXV0IGxheWVycyB7CiAgICAgICAgbGV0IFNvbWUodmFyaWFudCkgPSBhcHBlYXJhbmNlX3ZhcmlhbnQoJmFwcGVhcmFuY2UsICZsYXllci5jYXRlZ29yeSkgZWxzZSB7CiAgICAgICAgICAgICp2aXNpYmlsaXR5ID0gVmlzaWJpbGl0eTo6SGlkZGVuOwogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9OwogICAgICAgIGxldCBTb21lKGFjdG9yKSA9IGNhdGFsb2cuYXBwZWFyYW5jZV9hY3Rvcih2YXJpYW50KSBlbHNlIHsKICAgICAgICAgICAgKnZpc2liaWxpdHkgPSBWaXNpYmlsaXR5OjpIaWRkZW47CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH07CgogICAgICAgIGxldCBhbmltYXRpb24gPSBpZiBhY3Rvci5kZWZpbml0aW9uLnNwZWMoYm9keS5hbmltYXRpb24pLmlzX3NvbWUoKQogICAgICAgICAgICAmJiBhY3Rvci50ZXh0dXJlKGJvZHkuYW5pbWF0aW9uKS5pc19zb21lKCkKICAgICAgICB7CiAgICAgICAgICAgIGJvZHkuYW5pbWF0aW9uCiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgQWN0b3JBbmltYXRpb246OklkbGUKICAgICAgICB9OwoKICAgICAgICBsZXQgU29tZShzcGVjKSA9IGFjdG9yLmRlZmluaXRpb24uc3BlYyhhbmltYXRpb24pIGVsc2UgewogICAgICAgICAgICAqdmlzaWJpbGl0eSA9IFZpc2liaWxpdHk6OkhpZGRlbjsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfTsKICAgICAgICBsZXQgU29tZSh0ZXh0dXJlKSA9IGFjdG9yLnRleHR1cmUoYW5pbWF0aW9uKSBlbHNlIHsKICAgICAgICAgICAgKnZpc2liaWxpdHkgPSBWaXNpYmlsaXR5OjpIaWRkZW47CiAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH07CgogICAgICAgIGxldCBmcmFtZSA9IHNwZWMuZnJhbWVfYXQoKG5vdyAtIGJvZHkuYW5pbWF0aW9uX3N0YXJ0ZWRfYXQpLm1heCgwLjApKTsKICAgICAgICBsZXQgU29tZShtdXQgbWF0ZXJpYWwpID0gbWF0ZXJpYWxzLmdldF9tdXQoJmxheWVyLm1hdGVyaWFsKSBlbHNlIHsKICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgfTsKCiAgICAgICAgbWF0ZXJpYWwuYmFzZV9jb2xvciA9IGFwcGVhcmFuY2VfbGF5ZXJfY29sb3IoJmFwcGVhcmFuY2UsICZsYXllci5jYXRlZ29yeSk7CiAgICAgICAgbWF0ZXJpYWwuYmFzZV9jb2xvcl90ZXh0dXJlID0gU29tZSh0ZXh0dXJlLmNsb25lKCkpOwogICAgICAgIG1hdGVyaWFsLm5vcm1hbF9tYXBfdGV4dHVyZSA9IGFjdG9yLm5vcm1hbChhbmltYXRpb24pLmNsb25lZCgpOwogICAgICAgIG1hdGVyaWFsLnV2X3RyYW5zZm9ybSA9IGF0bGFzX3V2KAogICAgICAgICAgICBzcGVjLmNvbHVtbnMsCiAgICAgICAgICAgIGFjdG9yLmRlZmluaXRpb24uYXRsYXNfcm93cywKICAgICAgICAgICAgZnJhbWUsCiAgICAgICAgICAgIGJvZHkuZGlyZWN0aW9uCiAgICAgICAgICAgICAgICAuYXRsYXNfcm93KGFjdG9yLmRlZmluaXRpb24uYXV0aG9yZWRfZGlyZWN0aW9ucyksCiAgICAgICAgKTsKICAgICAgICAqdmlzaWJpbGl0eSA9IFZpc2liaWxpdHk6OlZpc2libGU7CiAgICB9Cn0KCmZuIGFwcGVhcmFuY2VfdmFyaWFudDwnYT4oCiAgICBhcHBlYXJhbmNlOiAmJ2EgTG9jYWxDaGFyYWN0ZXJBcHBlYXJhbmNlLAogICAgY2F0ZWdvcnk6ICZzdHIsCikgLT4gT3B0aW9uPCYnYSBzdHI+IHsKICAgIG1hdGNoIGNhdGVnb3J5IHsKICAgICAgICAiaGVhZCIgPT4gU29tZSgmYXBwZWFyYW5jZS5oZWFkKSwKICAgICAgICAiZmFjZSIgPT4gU29tZSgmYXBwZWFyYW5jZS5mYWNlKSwKICAgICAgICAiaGFpciIgPT4gU29tZSgmYXBwZWFyYW5jZS5oYWlyKSwKICAgICAgICAiZmFjaWFsX2hhaXIiID0+IGFwcGVhcmFuY2UuZmFjaWFsX2hhaXIuYXNfZGVyZWYoKSwKICAgICAgICAidG9yc28iID0+IFNvbWUoJmFwcGVhcmFuY2UudG9yc28pLAogICAgICAgICJsZWdzIiA9PiBTb21lKCZhcHBlYXJhbmNlLmxlZ3MpLAogICAgICAgICJmZWV0IiA9PiBTb21lKCZhcHBlYXJhbmNlLmZlZXQpLAogICAgICAgIF8gPT4gTm9uZSwKICAgIH0KfQoKZm4gYXBwZWFyYW5jZV9sYXllcl9jb2xvcigKICAgIGFwcGVhcmFuY2U6ICZMb2NhbENoYXJhY3RlckFwcGVhcmFuY2UsCiAgICBjYXRlZ29yeTogJnN0ciwKKSAtPiBDb2xvciB7CiAgICBtYXRjaCBjYXRlZ29yeSB7CiAgICAgICAgImhlYWQiID0+IGFwcGVhcmFuY2VfY29sb3IoJmFwcGVhcmFuY2Uuc2tpbl90b25lKSwKICAgICAgICAiZmFjZSIgPT4gQ29sb3I6OldISVRFLAogICAgICAgICJoYWlyIiB8ICJmYWNpYWxfaGFpciIgPT4gYXBwZWFyYW5jZV9jb2xvcigmYXBwZWFyYW5jZS5oYWlyX2NvbG9yKSwKICAgICAgICAidG9yc28iID0+IGFwcGVhcmFuY2VfY29sb3IoJmFwcGVhcmFuY2UudG9yc29fY29sb3IpLAogICAgICAgICJsZWdzIiA9PiBhcHBlYXJhbmNlX2NvbG9yKCZhcHBlYXJhbmNlLmxlZ3NfY29sb3IpLAogICAgICAgICJmZWV0IiA9PiBhcHBlYXJhbmNlX2NvbG9yKCZhcHBlYXJhbmNlLmZlZXRfY29sb3IpLAogICAgICAgIF8gPT4gQ29sb3I6OldISVRFLAogICAgfQp9CgpwdWIoY3JhdGUpIGZuIGFwcGVhcmFuY2VfY29sb3IoaWQ6ICZzdHIpIC0+IENvbG9yIHsKICAgIG1hdGNoIGlkIHsKICAgICAgICAic2tpbl9saWdodCIgPT4gQ29sb3I6OnNyZ2IoMS4wMCwgMC44MiwgMC42OSksCiAgICAgICAgInNraW5fd2FybSIgPT4gQ29sb3I6OnNyZ2IoMC44OCwgMC42NiwgMC41MCksCiAgICAgICAgInNraW5fdGFuIiA9PiBDb2xvcjo6c3JnYigwLjcyLCAwLjUwLCAwLjM1KSwKICAgICAgICAic2tpbl9kZWVwIiA9PiBDb2xvcjo6c3JnYigwLjQ4LCAwLjMxLCAwLjIzKSwKCiAgICAgICAgImhhaXJfYmxhY2siID0+IENvbG9yOjpzcmdiKDAuMTgsIDAuMTYsIDAuMTcpLAogICAgICAgICJoYWlyX2Jyb3duIiA9PiBDb2xvcjo6c3JnYigwLjM5LCAwLjI1LCAwLjE3KSwKICAgICAgICAiaGFpcl9hdWJ1cm4iID0+IENvbG9yOjpzcmdiKDAuNTIsIDAuMjQsIDAuMTUpLAogICAgICAgICJoYWlyX2Jsb25kZSIgPT4gQ29sb3I6OnNyZ2IoMC43OCwgMC42NiwgMC40MCksCiAgICAgICAgImhhaXJfZ3JheSIgPT4gQ29sb3I6OnNyZ2IoMC41NSwgMC41NSwgMC41NSksCgogICAgICAgICJjbG90aF9idXJndW5keSIgPT4gQ29sb3I6OnNyZ2IoMC41MiwgMC4yMCwgMC4yNSksCiAgICAgICAgImNsb3RoX2ZvcmVzdCIgPT4gQ29sb3I6OnNyZ2IoMC4yNSwgMC40MiwgMC4yNSksCiAgICAgICAgImNsb3RoX3Zpb2xldCIgPT4gQ29sb3I6OnNyZ2IoMC4zOSwgMC4yNywgMC41MyksCiAgICAgICAgImNsb3RoX2NoYXJjb2FsIiA9PiBDb2xvcjo6c3JnYigwLjI1LCAwLjI1LCAwLjI4KSwKICAgICAgICAiY2xvdGhfbmF2eSIgPT4gQ29sb3I6OnNyZ2IoMC4yMiwgMC4zMCwgMC40MyksCiAgICAgICAgImNsb3RoX2VhcnRoIiA9PiBDb2xvcjo6c3JnYigwLjQyLCAwLjMzLCAwLjI0KSwKICAgICAgICAiY2xvdGhfY3JlYW0iID0+IENvbG9yOjpzcmdiKDAuNzUsIDAuNzAsIDAuNTgpLAoKICAgICAgICAibGVhdGhlcl9icm93biIgPT4gQ29sb3I6OnNyZ2IoMC4zOSwgMC4yNiwgMC4xNyksCiAgICAgICAgImxlYXRoZXJfZGFyayIgPT4gQ29sb3I6OnNyZ2IoMC4yMSwgMC4xNywgMC4xNSksCiAgICAgICAgImxlYXRoZXJfdGFuIiA9PiBDb2xvcjo6c3JnYigwLjU1LCAwLjM5LCAwLjIzKSwKICAgICAgICBfID0+IENvbG9yOjpXSElURSwKICAgIH0KfQoKZm4gYXBwZWFyYW5jZV9sYXllcl9kZXB0aF9iaWFzKGNhdGVnb3J5OiAmc3RyKSAtPiBmMzIgewogICAgbWF0Y2ggY2F0ZWdvcnkgewogICAgICAgICJ0b3JzbyIgPT4gMi4wLAogICAgICAgICJsZWdzIiA9PiAzLjAsCiAgICAgICAgImZlZXQiID0+IDQuMCwKICAgICAgICAiaGVhZCIgPT4gNS4wLAogICAgICAgICJmYWNlIiA9PiA2LjAsCiAgICAgICAgImhhaXIiID0+IDcuMCwKICAgICAgICAiZmFjaWFsX2hhaXIiID0+IDguMCwKICAgICAgICBfID0+IDEuMCwKICAgIH0KfQoK", "base64").toString("utf8");

const expectedVariantIds = ["body_01", "body_02", "head_01", "head_02", "head_03", "face_01", "face_02", "face_03", "hair_01", "hair_02", "hair_03", "hair_04", "beard_01", "beard_02", "torso_01", "torso_02", "torso_03", "legs_01", "legs_02", "legs_03", "feet_01", "feet_02"];
const expectedAtlases = new Map([
  ["assets/players/appearance/body/body_01/atlases/body_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/body/body_01/atlases/body_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/body/body_02/atlases/body_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_01/atlases/head_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_02/atlases/head_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/head/head_03/atlases/head_03_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_01/atlases/face_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_02/atlases/face_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/face/face_03/atlases/face_03_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_01/atlases/hair_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_02/atlases/hair_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_03/atlases/hair_03_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/hair/hair_04/atlases/hair_04_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_01/atlases/beard_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/facial_hair/beard_02/atlases/beard_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_01/atlases/torso_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_02/atlases/torso_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/torso/torso_03/atlases/torso_03_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_01/atlases/legs_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_02/atlases/legs_02_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/legs/legs_03/atlases/legs_03_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_01/atlases/feet_01_use_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_idle_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_walk_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_attack_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_hit_8dir_aldoria_v36_93.png", [192,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_death_8dir_aldoria_v36_93.png", [384,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_cast_8dir_aldoria_v36_93.png", [288,512]],
  ["assets/players/appearance/feet/feet_02/atlases/feet_02_use_8dir_aldoria_v36_93.png", [288,512]]
]);

function fail(message) {
  console.error("\nV36.93 PATCH FAILED: " + message);
  process.exit(1);
}
function count(source, needle) {
  return source.split(needle).length - 1;
}
function replaceOnce(source, needle, replacement, label) {
  const hits = count(source, needle);
  if (hits !== 1) fail(`${label}: expected 1 occurrence, found ${hits}`);
  return source.replace(needle, replacement);
}
function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} missing: ${path.relative(root,file)}`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} invalid JSON: ${error.message}`); }
}
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0,8).equals(sig) || bytes.toString("ascii",12,16) !== "IHDR") {
    fail(`invalid PNG: ${path.relative(root,file)}`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
function normalize(source) {
  return source.replace(/[ \t]*(?:\r?\n)+$/u, "\n");
}

for (const file of [playerPath, mainPath, validatorPath, indexPath]) {
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(root,file)}; extract the COMPLETE V36.93 ZIP first`);
  }
}

let player = fs.readFileSync(playerPath, "utf8");
let main = fs.readFileSync(mainPath, "utf8");
let validator = fs.readFileSync(validatorPath, "utf8");

if (player.includes(MARKER) && main.includes(MARKER) && validator.includes(MARKER)) {
  console.log("V36.93 already applied.");
  process.exit(0);
}
if (!player.includes(REQUIRED) || !main.includes(REQUIRED)) {
  fail("V36.92 Remote Equipment Replication must be applied before V36.93.");
}
if (!player.includes("TIBIAGAME_V36_90_PLAYER_EQUIPMENT_LAYERS")) {
  fail("V36.90 equipment-layer baseline missing.");
}

for (const [relative, expected] of expectedAtlases) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`missing V36.93 atlas: ${relative}`);
  const actual = pngSize(absolute);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    fail(`${relative} is ${actual[0]}x${actual[1]}, expected ${expected[0]}x${expected[1]}`);
  }
}

const index = readJson(indexPath, "appearance actor index");
if (index.schema !== 1 || !Array.isArray(index.actors)) {
  fail("appearance actor index must use schema 1 and actors[].");
}
if (index.actors.length !== expectedVariantIds.length) {
  fail(`appearance actor index must contain exactly ${expectedVariantIds.length} variants`);
}
for (const id of expectedVariantIds) {
  const entry = index.actors.find((candidate) => candidate.game_definition_id === id);
  if (!entry) fail(`appearance index missing '${id}'`);
  const manifest = readJson(path.join(root, "assets", ...entry.manifest.split("/")), `${id} manifest`);
  if (
    manifest.schema !== 1 ||
    manifest.id !== `player.appearance.${id}` ||
    manifest.authored_directions !== 8 ||
    manifest.atlas_rows !== 8 ||
    manifest.render_width !== 1.02 ||
    manifest.render_height !== 1.36 ||
    manifest.frame_width !== 48 ||
    manifest.frame_height !== 64
  ) {
    fail(`${entry.manifest} does not match the synchronized player appearance contract`);
  }
  const columns = { idle:4, walk:8, attack:6, hit:4, death:8, cast:6, use:6 };
  for (const [animation, expectedColumns] of Object.entries(columns)) {
    const spec = manifest.animations?.[animation];
    if (!spec || spec.columns !== expectedColumns || spec.frames !== expectedColumns) {
      fail(`${entry.manifest} animation '${animation}' contract mismatch`);
    }
  }
}

const syncOutfitOld =
`pub fn sync_local_player_outfit(
    game_state: Res<NativeGameState>,
    mut identity: ResMut<LocalIdentity>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    sprites: Query<&LocalPlayerSprite>,
) {
    let Some(player) = game_state.local_player() else {
        return;
    };
    if player.outfit == identity.outfit {
        return;
    }

    identity.outfit = player.outfit.clone();
    let tint = outfit_tint(&identity.outfit);
    for sprite in &sprites {
        if let Some(mut material) = materials.get_mut(&sprite.material) {
            material.base_color = tint;
        }
    }

    info!(
        "ALDORIA PLAYER SPRITE OUTFIT · {} · 2D tint updated",
        identity.outfit,
    );
}
`;

const syncOutfitNew =
`pub fn sync_local_player_outfit(
    game_state: Res<NativeGameState>,
    mut identity: ResMut<LocalIdentity>,
) {
    let Some(player) = game_state.local_player() else {
        return;
    };
    if player.outfit == identity.outfit {
        return;
    }

    identity.outfit = player.outfit.clone();
    info!(
        "ALDORIA CHARACTER APPEARANCE · legacy preset seed changed to {}",
        identity.outfit,
    );
}
`;

const singleOutfitAnchor =
`            .add_systems(
                Update,
                player_sprites::sync_local_player_outfit
                    .after(pump_network)
                    .run_if(single_window_game_active),
            )
`;
const directOutfitAnchor =
`        .add_systems(Update, player_sprites::sync_local_player_outfit.after(pump_network))
`;

const singleEquipmentAnchor =
`            .add_systems(
                Update,
                player_sprites::ensure_local_player_equipment_layers
                    .after(player_sprites::update_local_player_sprite)
                    .run_if(single_window_game_active),
            )
`;
const directEquipmentAnchor =
`        .add_systems(
            Update,
            player_sprites::ensure_local_player_equipment_layers
                .after(player_sprites::update_local_player_sprite),
        )
`;

const validatorAnchor = "if (errors.length > 0) {";

if (!player.includes(MARKER)) {
  for (const [needle, label] of [
    ["use std::collections::HashMap;\n", "HashMap import"],
    ['const PLAYER_EQUIPMENT_INDEX: &str = "actors/players/equipment/index.json";\n', "equipment index const"],
    ["pub struct LocalPlayerSprite {", "LocalPlayerSprite"],
    ["    equipment: HashMap<String, ActorSpriteAssets>,\n}", "catalog equipment field"],
    ["        let mut equipment = HashMap::new();\n", "catalog load"],
    ["            equipment,\n        }", "catalog initializer"],
    ["pub(crate) fn equipment_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {", "equipment accessor"],
    ["pub(crate) fn ensure_local_player_equipment_layers(", "equipment systems anchor"],
    [syncOutfitOld, "legacy outfit tint function"],
  ]) {
    if (count(player, needle) !== 1) fail(`${label} baseline mismatch`);
  }
}

if (!main.includes(MARKER)) {
  for (const [needle, label] of [
    [singleOutfitAnchor, "single outfit schedule"],
    [directOutfitAnchor, "direct outfit schedule"],
    [singleEquipmentAnchor, "single equipment schedule"],
    [directEquipmentAnchor, "direct equipment schedule"],
  ]) {
    if (count(main, needle) !== 1) fail(`${label} baseline mismatch`);
  }
}
if (!validator.includes(validatorAnchor)) fail("validator final block missing");

if (checkOnly) {
  console.log("V36.93 PRECHECK PASSED");
  console.log(`${expectedVariantIds.length} composable appearance variants / ${expectedAtlases.size} synchronized atlases validated.`);
  console.log("Will add body + head + face + hair + facial hair + torso + legs + feet composition.");
  console.log("Skin/hair/clothing colors become independent palette channels.");
  console.log("V36.90 equipment remains above the appearance layers.");
  console.log("Old knight/mage/ranger/rogue outfit is retained only as a temporary migration preset seed.");
  console.log("No protocol/server changes in V36.93.");
  process.exit(0);
}

if (!player.includes(MARKER)) {
  player = replaceOnce(
    player,
    `// ${REQUIRED}\n`,
    `// ${REQUIRED}\n// ${MARKER}\n`,
    "V36.93 player marker",
  );

  player = replaceOnce(
    player,
    'const PLAYER_EQUIPMENT_INDEX: &str = "actors/players/equipment/index.json";\n',
    'const PLAYER_EQUIPMENT_INDEX: &str = "actors/players/equipment/index.json";\n' + appearanceDefinitions,
    "appearance definitions",
  );

  player = replaceOnce(
    player,
    "    equipment: HashMap<String, ActorSpriteAssets>,\n}",
    "    equipment: HashMap<String, ActorSpriteAssets>,\n    appearance: HashMap<String, ActorSpriteAssets>,\n}",
    "catalog appearance field",
  );

  player = replaceOnce(
    player,
    `    pub(crate) fn equipment_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {
        self.equipment.get(key)
    }

`,
    `    pub(crate) fn equipment_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {
        self.equipment.get(key)
    }

    pub(crate) fn appearance_actor(&self, key: &str) -> Option<&ActorSpriteAssets> {
        self.appearance.get(key)
    }

`,
    "appearance actor accessor",
  );

  player = replaceOnce(
    player,
    "        let mut equipment = HashMap::new();\n",
`        let mut appearance = HashMap::new();
        for entry in load_actor_index(PLAYER_APPEARANCE_INDEX) {
            let key = entry.game_definition_id;
            let actor = ActorSpriteAssets::load(asset_server, &entry.manifest);
            appearance.insert(key, actor);
        }

        info!(
            "ALDORIA CHARACTER APPEARANCE · {} composable actor variants · index={}",
            appearance.len(),
            PLAYER_APPEARANCE_INDEX,
        );

        let mut equipment = HashMap::new();
`,
    "appearance catalog load",
  );

  player = replaceOnce(
    player,
    "            equipment,\n        }",
    "            equipment,\n            appearance,\n        }",
    "appearance catalog initializer",
  );

  player = replaceOnce(
    player,
    "pub(crate) fn ensure_local_player_equipment_layers(",
    appearanceSystems + "pub(crate) fn ensure_local_player_equipment_layers(",
    "appearance systems",
  );

  player = replaceOnce(
    player,
    syncOutfitOld,
    syncOutfitNew,
    "remove fixed local outfit tint",
  );
}
player = normalize(player);
fs.writeFileSync(playerPath, player, "utf8");

if (!main.includes(MARKER)) {
  main = replaceOnce(
    main,
    `// ${REQUIRED}\n`,
    `// ${REQUIRED}\n// ${MARKER}\n`,
    "V36.93 main marker",
  );

  main = replaceOnce(
    main,
    singleOutfitAnchor,
    singleOutfitAnchor +
`            .add_systems(
                Update,
                player_sprites::sync_local_character_appearance_resource
                    .after(player_sprites::sync_local_player_outfit)
                    .run_if(single_window_game_active),
            )
`,
    "single appearance resource schedule",
  );

  main = replaceOnce(
    main,
    singleEquipmentAnchor,
`            .add_systems(
                Update,
                player_sprites::ensure_local_player_appearance_layers
                    .after(player_sprites::update_local_player_sprite)
                    .run_if(single_window_game_active),
            )
            .add_systems(
                Update,
                player_sprites::sync_local_player_appearance_layers
                    .after(player_sprites::ensure_local_player_appearance_layers)
                    .after(player_sprites::update_local_player_sprite)
                    .after(player_sprites::sync_local_character_appearance_resource)
                    .run_if(single_window_game_active),
            )
` + singleEquipmentAnchor,
    "single appearance layer schedule",
  );

  main = replaceOnce(
    main,
    directOutfitAnchor,
    directOutfitAnchor +
`        .add_systems(
            Update,
            player_sprites::sync_local_character_appearance_resource
                .after(player_sprites::sync_local_player_outfit),
        )
`,
    "direct appearance resource schedule",
  );

  main = replaceOnce(
    main,
    directEquipmentAnchor,
`        .add_systems(
            Update,
            player_sprites::ensure_local_player_appearance_layers
                .after(player_sprites::update_local_player_sprite),
        )
        .add_systems(
            Update,
            player_sprites::sync_local_player_appearance_layers
                .after(player_sprites::ensure_local_player_appearance_layers)
                .after(player_sprites::update_local_player_sprite)
                .after(player_sprites::sync_local_character_appearance_resource),
        )
` + directEquipmentAnchor,
    "direct appearance layer schedule",
  );
}
main = normalize(main);
fs.writeFileSync(mainPath, main, "utf8");

if (!validator.includes(MARKER)) {
  const block =
    "\n// " + MARKER + "\n" +
    "const playerAppearanceIndex = path.join(actorsRoot, 'players', 'appearance', 'index.json');\n" +
    "if (!fs.existsSync(playerAppearanceIndex)) fail(relative(playerAppearanceIndex) + ' is missing');\n" +
    "else validateCreatureIndex(playerAppearanceIndex);\n\n";
  validator = validator.replace(validatorAnchor, block + validatorAnchor);
}
validator = normalize(validator);
fs.writeFileSync(validatorPath, validator, "utf8");

try {
  execFileSync(process.execPath, ["scripts/validate-actor-sprites.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  fail("actor sprite validation failed after applying V36.93");
}

console.log("V36.93 PATCH APPLIED");
console.log("Local player now uses a composable appearance foundation instead of fixed outfit tinting.");
console.log("V36.94 can expose these independent parts/colors through character customization UI.");
