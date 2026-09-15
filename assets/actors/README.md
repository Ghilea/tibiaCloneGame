# Aldoria actor sprite manifests

V36.83 moves actor presentation metadata out of Rust. Sprite sheets stay under the normal
`assets/` tree; JSON manifests describe how the client interprets them.

## Direction order

Eight-direction sheets use rows in this exact order:

1. North
2. NorthEast
3. East
4. SouthEast
5. South
6. SouthWest
7. West
8. NorthWest

All frames in one actor manifest share `frame_width`, `frame_height`, and `atlas_rows`.
Each animation may use its own number of columns/frames and FPS.

## Adding a creature without Rust changes

1. Create `assets/actors/creatures/<id>/actor.json`.
2. Put the referenced sprite sheets anywhere below `assets/`.
3. Add one entry to `assets/actors/creatures/index.json` mapping the server's
   `definition_id` to the manifest.
4. Run `npm run actors:validate`.

The runtime validates manifests, referenced files, and PNG atlas dimensions again at startup.
An invalid production sheet fails immediately with the manifest and asset path in the error.

## Animation keys

Supported keys are `idle`, `walk`, `attack`, `hit`, `death`, `cast`, and `use`.
`idle` is mandatory. Other states are optional; the runtime falls back to idle when an actor
does not author a requested state.

For one-shot actions use `looping=false` and `lock_until_complete=true`. For death use
`terminal=true` as well. A terminal animation holds its final frame.

## Atlas validation

For PNG files, expected dimensions are calculated as:

- width = `frame_width * animation.columns`
- height = `frame_height * atlas_rows`

This catches accidental wrong row/column layouts before the game reaches gameplay.

<!-- TIBIAGAME_V36_84_ALDORIA_STYLE_PACK -->
## Aldoria visual style v1

V36.84 is the first production-style actor pack. Runtime animation metadata remains
data-driven; replacing or iterating art only requires changing manifest texture paths.

The first pack covers player.default, npc.default and creature.castle_rat. It keeps the
same frame dimensions and eight-direction row contract introduced by V36.83.

<!-- TIBIAGAME_V36_85_MIRE_CREATURE_EXPANSION -->
## Mire creature expansion

V36.85 adds full eight-direction Idle/Walk/Attack/Hit/Death manifests for
`mireling` and `mire_skulker`. Both are registered only through
`actors/creatures/index.json`; their old solid-fallback rows are removed from Rust.

The validator also requires every creature `actor.json` to be represented by
the creature index, preventing orphaned content packs.
