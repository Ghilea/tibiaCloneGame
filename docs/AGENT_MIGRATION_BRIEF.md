# Agent task: migrate all actors from runtime 3D models to dynamically lit 2D/2.5D sprites

## Goal

Replace runtime GLB/3D rendering for **player characters and monsters** with animated **8-direction 2D sprites rendered inside the existing Three.js world**.

Do **not** remove Three.js and do **not** convert the map/world back to a pure pixel renderer.

The reason for keeping Three.js is that the game still needs:

- dynamic point/spot/directional lighting;
- day/night and dungeon lighting;
- fog;
- depth testing and correct occlusion against 3D walls/objects;
- multiple floors/heights;
- camera projection and the existing isometric 3D world;
- particles and spell effects;
- world-space shadows and effects.

Only the visual representation of actors changes.

The intended result is a **2.5D game**:
3D world + dynamically lit animated 2D actors.

---

## Current actors

### Player characters

The current KayKit-based runtime 3D characters are:

- Knight
- Ranger
- Mage

They must be converted to sprite actors too.

Do not destroy the original KayKit source GLBs immediately. Keep them as offline/source assets until the new sprite version is approved. They are useful for baking consistent animation frames and normal maps.

### Monsters

Use these exact creature IDs:

- `castle_rat`
- `mireling`
- `mire_skulker`
- `reed_stalker`
- `fen_brute`
- `crypt_guard`
- `bone_acolyte`
- `cellar_warden`

Never assign graphics by list/index position. Always resolve by exact creature ID.

---

## Required 8 directions

Every gameplay actor must support:

- N
- NE
- E
- SE
- S
- SW
- W
- NW

Do not rotate the 2D artwork to fake direction.

The billboard plane always faces the isometric camera. The creature's direction is represented by selecting the correct directional animation frames.

Movement/aim direction is quantized into 8 octants.

---

## Required monster animations

### Castle Rat
- Idle
- Walk
- Run
- Bite
- Attack
- Hit
- Death
- Alert
- Eat

### Mireling
- Idle
- Walk
- Run
- Attack
- LeapAttack
- Hit
- Death
- Alert

### Mire Skulker
- Idle
- Walk
- Run
- Attack
- Lunge
- Hit
- Death
- Alert

### Reed Stalker
- Idle
- Walk
- Run
- Attack
- RootAttack
- Hit
- Death
- Alert

### Fen Brute
- Idle
- Walk
- Run
- Attack
- GroundSlam
- Roar
- Hit
- Death

### Crypt Guard
- Idle
- Walk
- Run
- Attack
- ShieldBash
- Hit
- Death
- Alert

### Bone Acolyte
- Idle
- Walk
- Run
- Cast
- RaiseDead
- Hit
- Death
- Alert

### Cellar Warden
- Idle
- Walk
- Run
- HeavyAttack
- GroundSlam
- Roar
- Hit
- Death

Player characters must at minimum retain all gameplay-critical animations currently used by the game. Do not delete an animation/state because the renderer changed.

---

## Sprite quality target

The monster sprites should visually match the approved concept-art direction rather than the old procedural GLB models.

For Castle Rat specifically, the approved direction is:

- chubby pear-shaped body;
- short limbs;
- huge round ears;
- pink inner ears;
- layered dark/mid/light grey fur;
- mud/dirt accents;
- glossy brown eyes;
- pink nose;
- long yellow incisors;
- small detailed forepaws;
- large hind feet;
- segmented pink tail;
- readable silhouette from the isometric camera.

The same visual discipline should be applied to all eight monsters.

---

## Required files per actor

Each actor should have:

```text
<actor_id>_albedo.webp
<actor_id>_normal.webp
<actor_id>.json
```

Both atlas textures must have **exactly the same frame packing**.

Optional later:
- roughness atlas;
- emissive atlas;
- hit-mask atlas.

Do not ship hundreds of individual PNG files in the runtime build if they can be packed into atlases.

---

## Dynamic lighting — critical requirement

This migration must **preserve dynamic lighting**.

Render actors on `THREE.PlaneGeometry` using a lit material, not `THREE.Sprite` with an unlit sprite material.

Baseline material:

```ts
new THREE.MeshStandardMaterial({
  map: albedoAtlas,
  normalMap: normalAtlas,
  roughness: 0.9,
  metalness: 0,
  alphaTest: 0.35,
  transparent: false,
  depthTest: true,
  depthWrite: true,
});
```

The albedo atlas uses SRGB color space.

The normal atlas must use the identical frame coordinates as the albedo atlas.

Because the sprites have a normal map, Three.js point lights, spot lights and directional lights can produce convincing dynamic lighting on the otherwise flat character plane.

This is why Three.js should remain.

---

## Normal-map production

There are two asset pipelines.

### Player characters

For Knight/Ranger/Mage, use the existing KayKit GLB models as offline sources.

For each animation and direction:

1. place the character in a controlled render scene;
2. use the same orthographic/isometric camera angle as the game;
3. render albedo/color frames with transparent background;
4. render a matching normal pass;
5. trim/pad every frame to the same logical canvas;
6. preserve a fixed foot anchor;
7. pack frames into albedo and normal atlases;
8. output JSON metadata.

This keeps their current animations and style while removing runtime skinned meshes.

### Monsters

Approved monster artwork is the visual source.

Each monster must be rendered/generated as consistent 8-direction animation frames.

Produce both:
- painted albedo frames;
- corresponding normal-map frames.

If normal maps cannot be authored directly, temporarily generate them from a height/shape approximation, but do not block the migration on perfect normals. The runtime must support replacing them later without code changes.

---

## Foot anchor / positioning

Actor world position is always the point between the feet on the ground.

Do not center the plane on `actor.position`.

Translate PlaneGeometry upward so its bottom/foot anchor sits on actor origin.

This is essential for:
- walking behind walls;
- floors;
- stairs;
- sorting;
- shadows;
- spell targeting.

Do not derive the gameplay collision box from visible sprite dimensions.

Collision remains server/gameplay data.

---

## Billboard behavior

The visual plane should always face the fixed isometric camera.

Do not change the billboard's world yaw to represent N/E/S/W.

Instead:

```text
gameplay direction -> Direction8 -> choose corresponding sprite frames
```

The plane remains camera-facing.

---

## Depth and transparency

Avoid ordinary blend-sorted transparent character planes where possible.

Use cutout rendering:

```ts
transparent: false
alphaTest: 0.35
depthTest: true
depthWrite: true
```

Enable `alphaToCoverage` when MSAA is available.

This gives substantially better depth behavior around:
- actors;
- trees;
- walls;
- fences;
- props.

Do not solve occlusion by manually changing `renderOrder` for every entity.

Depth buffer should remain the primary solution.

---

## Shadows

Do not depend on the billboard itself casting a physically accurate 3D shadow.

Add a soft ground blob/decal under actors.

It should:
- remain parallel to ground;
- scale by creature size;
- darken under normal movement;
- shrink/fade during jumps/airborne animation if needed.

Keep Three.js world shadows for actual 3D environment objects.

---

## Animation state machine

Renderer animation must follow gameplay state.

Examples:

```text
standing -> idle
moving -> walk/run
attack command -> attack animation
damage -> hit
dead -> death
```

One-shot animations return to the correct locomotion/idle state when complete unless gameplay state says otherwise.

Do not let animation code change authoritative gameplay state.

---

## Attack event frames

Animation metadata may specify an `eventFrame`.

Example:

```json
{
  "fps": 14,
  "playback": "once",
  "eventFrame": 4
}
```

Use this for:
- hit flash;
- swing trail;
- local sound timing;
- client-side impact effect.

The server remains authoritative for actual damage.

Do not make damage dependent on client animation frame timing.

---

## Existing 3D actor code

Find all code that:
- loads actor `.glb` files;
- creates `SkinnedMesh`;
- runs `AnimationMixer`;
- maps creature IDs to 3D models;
- retargets or selects GLTF animation clips;
- rotates 3D actor meshes to movement direction.

Replace those runtime responsibilities with:
- `DirectionalSpriteActor`;
- atlas loading;
- sprite animation state;
- Direction8 frame selection.

Do not remove GLB loading that is still needed for world props/buildings unless those are intentionally migrated separately.

This task applies to **characters and creatures**, not the entire world.

---

## Creature ID mapping

The mapping must be explicit:

```text
castle_rat     -> castle_rat sprite definition
mireling       -> mireling
mire_skulker   -> mire_skulker
reed_stalker   -> reed_stalker
fen_brute      -> fen_brute
crypt_guard    -> crypt_guard
bone_acolyte   -> bone_acolyte
cellar_warden  -> cellar_warden
```

Do not use array position, filesystem alphabetical order or spawn-table index.

---

## Asset loading

Load each atlas once and reuse it.

Do not instantiate a new texture for every monster instance.

At minimum:
- cache albedo texture by URL;
- cache normal texture by URL;
- reuse geometry where dimensions match.

After correctness is proven, add batching/instancing if profiling shows it is needed.

Do not prematurely complicate the first implementation.

---

## Performance target

The sprite renderer should comfortably handle large numbers of visible actors.

Initial correctness target:
- 100+ animated actors visible without major CPU stalls.

Later optimization:
- shared materials;
- instanced planes;
- per-instance frame rectangle;
- per-instance lighting parameters where required.

Do not sacrifice correct animation/direction handling for batching in the first pass.

---

## Keep these systems unchanged

Do not rewrite:
- server movement;
- pathfinding;
- creature AI;
- combat rules;
- tile collision;
- floor transitions;
- creature spawn IDs;
- network entity IDs.

The migration is primarily a client rendering/asset change.

---

## Remove only after migration is verified

Once player + monster sprite rendering works and is visually approved:

- stop loading their runtime GLBs;
- remove unused `AnimationMixer` paths for actor rendering;
- remove 3D creature-specific visual rotation code;
- remove obsolete 3D model mappings.

Keep the old code behind a temporary feature flag during implementation if that helps comparison.

---

## Recommended implementation order

1. Introduce `DirectionalSpriteActor` alongside existing 3D actor renderer.
2. Implement atlas/normal loading and 8-direction frame selection.
3. Test Castle Rat only.
4. Verify dynamic point lights affect Castle Rat.
5. Verify occlusion behind walls/trees.
6. Verify floors/stairs and foot anchor.
7. Verify Idle/Walk/Run/Bite/Hit/Death transitions.
8. Add remaining Castle Rat animations.
9. Migrate the other seven monsters.
10. Bake Knight/Ranger/Mage from existing KayKit GLBs to 8-direction atlases.
11. Switch player rendering to the same sprite actor system.
12. Remove runtime actor GLB renderer after parity is confirmed.
13. Profile and batch only if needed.

---

## Acceptance criteria

The task is not complete until:

- no monster runtime rendering requires a GLB;
- Knight/Ranger/Mage can also render as sprite actors;
- all eight directions work;
- animation state transitions work;
- one-shot attack/death animations work;
- sprites remain anchored to the correct tile;
- actors pass behind/in front of world geometry correctly;
- point/spot/directional lights visibly affect the sprites;
- a normal map is supported and loaded per atlas;
- dungeon lighting still works;
- floor changes still work;
- creature IDs cannot accidentally show another creature's artwork;
- Idle does not move the actor's world position;
- existing gameplay/network logic still works.
