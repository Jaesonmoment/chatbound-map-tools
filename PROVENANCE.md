# Source lineage

Derived from Jaesaen's actual Chat-Bound RPG sources, not a replacement map library:

- `extension/shared/worldmap-canvas.js`: drawing, coordinate conversions, aspect-preserving background fitting, location/region/road visuals, zoom/pan and movement. Converted the wrapper to a JavaScript module; removed portal methods and drawing calls. Added owned-listener cleanup, late image callback guards, destroyed-view draw guard and exception-safe batched drawing.
- `ebs/src/game/terrain.ts`: registry, costs, serialized-grid helpers. Converted to JavaScript, added finite cost/dimension validation and unknown-terrain rejection.
- `ebs/src/game/pathfinding.ts`: grid search and blocked-cell helpers. Converted to JavaScript; validated grid/endpoints; use Dijkstra ordering with actual rounded travel seconds and update queued costs. This fixes optimality under configurable speeds.
- `ebs/src/game/waypoint-pathfinding.ts`: graph construction, travel costs, polygon/region helpers. Converted to JavaScript; omit rest/journey helpers; reject invalid edge costs and impassable terrain, validate endpoints and polygons; document PNPOLY boundary semantics honestly.

No original private source was modified. New examples contain only generic geometry and synthetic map data. No art, saved map, story, viewer identity, service identifier, credential or hosting configuration is included. Build-only conversion uses existing tooling; shipped code has no dependencies. Public source hashes and exact manifests are recorded by the candidate build report outside this independently usable package.

PNPOLY originates with W. Randolph Franklin: https://wrfranklin.org/Research/Short_Notes/pnpoly.html. Its notice is retained in `NOTICE.md`.
