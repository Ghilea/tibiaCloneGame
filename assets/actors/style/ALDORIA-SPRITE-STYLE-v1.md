# Aldoria Actor Sprite Style v1

This document defines the first coherent actor-art direction introduced in V36.84.

The game remains a 3D/2.5D world with camera-facing 2D actors. Actor art should therefore
prioritize silhouette readability and direction recognition over tiny texture detail.

## Palette principles

Player: warm ivory cloth, muted steel, brown leather, burgundy accent.
NPC: ochre/brown cloth, subdued green hood/cloak, dark leather.
Castle Rat: charcoal/warm brown body, muted pink tail/ears, amber eye.
Magic: restrained cyan/teal for high contrast against the earth-tone world.

## Rendering

- transparent PNG atlases
- hard pixel edges
- dark contour around important body masses
- lighting painted into albedo
- no mandatory normal map
- no soft photographic shading
- avoid excessive saturation

## Direction rows

N, NE, E, SE, S, SW, W, NW.

## Animation rule

Keep contact/action poses readable at normal gameplay zoom. For one-shot actions,
the strongest silhouette should occur around the middle of the animation rather
than only on the final frame.
