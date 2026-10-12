// ebs/src/game/waypoint-pathfinding.ts
//
// Dijkstra pathfinding over a waypoint graph for coordinate-mode maps.
// Locations are nodes, connections are edges. Returns the shortest path
// as an ordered list of location IDs with total time and energy cost.
//
// Also includes point-in-polygon (PNPOLY ray-casting) for determining
// which region a coordinate falls inside.
//
// All functions are pure: no DB access, no side effects.
import { terrainDefFor } from './terrain.js';
// -- Constants --------------------------------------------
/**
 * Base time in seconds to traverse one full unit of normalized distance
 * (i.e. the full diagonal of the map, distance ~1.41, would take ~85s
 * at default speed). Configurable via WorldMapConfig.baseEdgeTimeSec.
 */
const DEFAULT_BASE_EDGE_TIME_SEC = 60;
export const MIN_CONNECTION_DISTANCE_WEIGHT = 0.1;
export const MAX_CONNECTION_DISTANCE_WEIGHT = 100;
export function isValidConnectionDistanceWeight(value) {
    return Number.isFinite(value) && value >= MIN_CONNECTION_DISTANCE_WEIGHT && value <= MAX_CONNECTION_DISTANCE_WEIGHT;
}
// -- Graph Construction -----------------------------------
/**
 * Build an adjacency list from a list of connection edges.
 * Skips blocked edges. For bidirectional edges, adds entries in both
 * directions. O(E) where E = number of connections.
 */
export function buildWaypointGraph(connections) {
    const adjacency = new Map();
    const ensure = (id) => {
        if (!adjacency.has(id))
            adjacency.set(id, []);
    };
    for (const edge of connections) {
        if (edge.blocked || !isValidConnectionDistanceWeight(edge.distanceWeight) || !Number.isFinite(edge.speedModifier) || edge.speedModifier <= 0 || !edge.fromLocationId || !edge.toLocationId)
            continue;
        ensure(edge.fromLocationId);
        ensure(edge.toLocationId);
        adjacency.get(edge.fromLocationId).push({
            toId: edge.toLocationId,
            edge,
        });
        if (edge.bidirectional) {
            adjacency.get(edge.toLocationId).push({
                toId: edge.fromLocationId,
                edge,
            });
        }
    }
    return { adjacency };
}
// -- Distance + Cost Helpers ------------------------------
/** Euclidean distance between two normalized coordinates */
export function euclideanDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
/**
 * Time in seconds to traverse a single edge.
 *
 * Formula:
 *   euclidean_distance * distance_weight / (speed_modifier * terrain_speed) * base_time
 *
 * Where terrain_speed comes from TERRAIN_DEFAULTS if the edge has a terrain type,
 * otherwise defaults to 1.0 (road speed).
 */
export function edgeTimeSec(edge, fromCoord, toCoord, baseTimeSec = DEFAULT_BASE_EDGE_TIME_SEC, overrides) {
    if (!isValidConnectionDistanceWeight(edge.distanceWeight) || !Number.isFinite(edge.speedModifier) || edge.speedModifier <= 0 || !Number.isFinite(baseTimeSec) || baseTimeSec <= 0 || ![fromCoord.x,fromCoord.y,toCoord.x,toCoord.y].every(Number.isFinite)) return Infinity;
    if (edge.terrainType && !terrainDefFor(edge.terrainType, overrides).passable) return Infinity;
    const dist = euclideanDistance(fromCoord, toCoord);
    const distanceWeight = Number.isFinite(edge.distanceWeight) && edge.distanceWeight > 0
        ? edge.distanceWeight
        : 1;
    const distWeighted = dist * distanceWeight;
    const terrainSpeed = edge.terrainType
        ? terrainDefFor(edge.terrainType, overrides).speedMultiplier
        : 1.0;
    const effectiveSpeed = (edge.speedModifier > 0 ? edge.speedModifier : 1) *
        (terrainSpeed > 0 ? terrainSpeed : 1);
    return Math.max(1, Math.ceil((distWeighted / effectiveSpeed) * baseTimeSec));
}
/**
 * Energy cost to traverse a single edge.
 * Uses the terrain's energyCostMultiplier scaled by distance.
 */
export function edgeEnergyCost(edge, fromCoord, toCoord, overrides) {
    if (!isValidConnectionDistanceWeight(edge.distanceWeight) || !Number.isFinite(edge.speedModifier) || edge.speedModifier <= 0 || ![fromCoord.x,fromCoord.y,toCoord.x,toCoord.y].every(Number.isFinite)) return Infinity;
    if (edge.terrainType && !terrainDefFor(edge.terrainType, overrides).passable) return Infinity;
    const dist = euclideanDistance(fromCoord, toCoord);
    const distanceWeight = Number.isFinite(edge.distanceWeight) && edge.distanceWeight > 0
        ? edge.distanceWeight
        : 1;
    const distWeighted = dist * distanceWeight;
    const terrainEnergy = edge.terrainType
        ? terrainDefFor(edge.terrainType, overrides).energyCostMultiplier
        : 1.0;
    // Scale energy by distance (10 units per full normalized unit of distance)
    return distWeighted * terrainEnergy * 10;
}
// -- Dijkstra ---------------------------------------------
/**
 * Find the shortest path through the waypoint graph from one location
 * to another. Uses Dijkstra's algorithm with a simple array-based
 * priority queue (suitable for graphs with < 200 nodes).
 *
 * Returns null if the destination is unreachable.
 */
export function findWaypointPath(graph, fromLocationId, toLocationId, locationCoords, baseTimeSec = DEFAULT_BASE_EDGE_TIME_SEC, overrides) {
    if (!locationCoords.has(fromLocationId) || !locationCoords.has(toLocationId)) return null;
    if (![locationCoords.get(fromLocationId)?.x,locationCoords.get(fromLocationId)?.y,locationCoords.get(toLocationId)?.x,locationCoords.get(toLocationId)?.y].every(Number.isFinite) || !Number.isFinite(baseTimeSec) || baseTimeSec <= 0) return null;
    if (fromLocationId === toLocationId) {
        return { locationIds: [fromLocationId], totalTimeSec: 0, totalEnergyCost: 0, edgeIds: [], edgeTimesMs: [] };
    }
    const fromCoord = locationCoords.get(fromLocationId);
    const toCoord = locationCoords.get(toLocationId);
    if (!fromCoord || !toCoord)
        return null;
    if (!graph.adjacency.has(fromLocationId))
        return null;
    // Dijkstra state
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    // Simple priority queue (sorted array) - fine for < 200 nodes
    const queue = [];
    dist.set(fromLocationId, 0);
    queue.push({ id: fromLocationId, cost: 0 });
    while (queue.length > 0) {
        // Extract minimum
        let minIdx = 0;
        for (let i = 1; i < queue.length; i++) {
            if (queue[i].cost < queue[minIdx].cost)
                minIdx = i;
        }
        const current = queue[minIdx];
        queue.splice(minIdx, 1);
        if (visited.has(current.id))
            continue;
        visited.add(current.id);
        if (current.id === toLocationId)
            break;
        const neighbors = graph.adjacency.get(current.id);
        if (!neighbors)
            continue;
        const currentCoord = locationCoords.get(current.id);
        if (!currentCoord)
            continue;
        for (const { toId, edge } of neighbors) {
            if (visited.has(toId))
                continue;
            const neighborCoord = locationCoords.get(toId);
            if (!neighborCoord)
                continue;
            const edgeCost = edgeTimeSec(edge, currentCoord, neighborCoord, baseTimeSec, overrides);
            const newDist = (dist.get(current.id) ?? Infinity) + edgeCost;
            if (newDist < (dist.get(toId) ?? Infinity)) {
                dist.set(toId, newDist);
                prev.set(toId, { fromId: current.id, edge });
                queue.push({ id: toId, cost: newDist });
            }
        }
    }
    // Reconstruct path
    if (!prev.has(toLocationId) && fromLocationId !== toLocationId) {
        return null; // unreachable
    }
    const locationIds = [];
    const edgeIds = [];
    const edgeTimesMs = [];
    let totalEnergyCost = 0;
    let current = toLocationId;
    while (current !== fromLocationId) {
        locationIds.push(current);
        const p = prev.get(current);
        if (!p)
            break;
        edgeIds.push(p.edge.connectionId);
        const fromC = locationCoords.get(p.fromId);
        const toC = locationCoords.get(current);
        if (fromC && toC) {
            const timeSec = edgeTimeSec(p.edge, fromC, toC, baseTimeSec, overrides);
            edgeTimesMs.push(timeSec * 1000);
            totalEnergyCost += edgeEnergyCost(p.edge, fromC, toC, overrides);
        }
        current = p.fromId;
    }
    locationIds.push(fromLocationId);
    // Reverse to get start -> end order
    locationIds.reverse();
    edgeIds.reverse();
    edgeTimesMs.reverse();
    totalEnergyCost = Math.floor(totalEnergyCost);
    return {
        locationIds,
        totalTimeSec: dist.get(toLocationId) ?? 0,
        totalEnergyCost,
        edgeIds,
        edgeTimesMs,
    };
}
// -- Point-in-Polygon -------------------------------------
/**
 * PNPOLY ray-casting algorithm (W. Randolph Franklin).
 * Tests whether a point is inside a polygon defined by its vertices.
 * Polygon is an array of [x, y] pairs (normalized 0-1 coordinates).
 *
 * For simple convex/concave polygons. Boundary uses PNPOLY semi-open semantics;
 * boundary points may be classified inside or outside. No holes encoding.
 */
export function pointInPolygon(point, polygon) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Array.isArray(polygon) || polygon.length < 3 || polygon.some(v => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))) return false;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}
/**
 * Parse a polygon_json string into vertex pairs.
 * Expects JSON array of [x, y] pairs. Returns empty array on failure.
 */
export function parsePolygonJson(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        const result = [];
        for (const v of parsed) {
            if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
                if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return [];
                result.push([v[0], v[1]]);
            } else return [];
        }
        return result.length >= 3 ? result : [];
    }
    catch {
        return [];
    }
}
/**
 * Find which region a point falls inside. Iterates all regions with
 * polygon_json and runs pointInPolygon. Returns the first matching
 * region ID, or null if the point is outside all regions.
 *
 * For fewer than ~50 regions, linear scan is faster than building a
 * spatial index.
 */
export function findRegionAtPoint(point, regions) {
    for (const region of regions) {
        const polygon = parsePolygonJson(region.polygonJson);
        if (polygon.length === 0)
            continue;
        if (pointInPolygon(point, polygon)) {
            return region.regionId;
        }
    }
    return null;
}
