// ebs/src/game/terrain.ts
//
// Terrain type registry and speed/cost helpers. 9 built-in terrain types
// with configurable speed modifiers. Streamers can adjust speeds and add
// a custom terrain type.
//
// All functions are pure: no DB access, no side effects.
export const TERRAIN_DEFAULTS = {
    road: { id: 'road', label: 'Road/Path', speedMultiplier: 1.0, energyCostMultiplier: 1.0, allowsCombat: true, passable: true, emoji: '🛤️' },
    grass: { id: 'grass', label: 'Grass', speedMultiplier: 0.8, energyCostMultiplier: 1.2, allowsCombat: true, passable: true, emoji: '🌿' },
    forest: { id: 'forest', label: 'Forest', speedMultiplier: 0.6, energyCostMultiplier: 1.5, allowsCombat: true, passable: true, emoji: '🌲' },
    sand: { id: 'sand', label: 'Sand', speedMultiplier: 0.5, energyCostMultiplier: 1.8, allowsCombat: true, passable: true, emoji: '🏖️' },
    desert: { id: 'desert', label: 'Desert', speedMultiplier: 0.4, energyCostMultiplier: 2.5, allowsCombat: true, passable: true, emoji: '🏜️' },
    mountain: { id: 'mountain', label: 'Mountain', speedMultiplier: 0, energyCostMultiplier: 0, allowsCombat: false, passable: false, emoji: '⛰️' },
    water: { id: 'water', label: 'Water', speedMultiplier: 0, energyCostMultiplier: 0, allowsCombat: false, passable: false, emoji: '🌊' },
    city: { id: 'city', label: 'City/Town', speedMultiplier: 1.0, energyCostMultiplier: 0.5, allowsCombat: false, passable: true, emoji: '🏘️' },
    custom: { id: 'custom', label: 'Custom', speedMultiplier: 0.7, energyCostMultiplier: 1.0, allowsCombat: true, passable: true, emoji: '❓' },
};
const VALID_TERRAIN_IDS = new Set(Object.keys(TERRAIN_DEFAULTS));
export function isTerrainTypeId(v) {
    return typeof v === 'string' && VALID_TERRAIN_IDS.has(v);
}
export function terrainDefFor(terrainId, overrides) {
    if (!isTerrainTypeId(terrainId)) throw new TypeError("Unknown terrain");
    const base = TERRAIN_DEFAULTS[terrainId];
    if (!overrides?.[terrainId])
        return base;
    const ov = overrides[terrainId];
    const speed = ov.speedMultiplier ?? base.speedMultiplier;
    const energy = ov.energyCostMultiplier ?? base.energyCostMultiplier;
    if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(energy) || energy < 0 || ((ov.passable ?? base.passable) && speed <= 0)) throw new RangeError("Invalid terrain cost");
    return {
        ...base,
        ...ov,
        id: terrainId,
    };
}
export function terrainSpeedFor(terrainId, overrides) {
    return terrainDefFor(terrainId, overrides).speedMultiplier;
}
export function terrainEnergyCostFor(terrainId, overrides) {
    return terrainDefFor(terrainId, overrides).energyCostMultiplier;
}
export function isPassable(terrainId, overrides) {
    return terrainDefFor(terrainId, overrides).passable;
}
export function parseTerrainGrid(raw, width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 1000000) throw new RangeError('Invalid grid dimensions');
    if (!raw)
        return defaultGrid(width, height);
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== height)
            return defaultGrid(width, height);
        const grid = [];
        for (let y = 0; y < height; y++) {
            const row = parsed[y];
            if (!Array.isArray(row) || row.length !== width)
                return defaultGrid(width, height);
            const typedRow = [];
            for (let x = 0; x < width; x++) {
                typedRow.push(isTerrainTypeId(row[x]) ? row[x] : 'grass');
            }
            grid.push(typedRow);
        }
        return grid;
    }
    catch {
        return defaultGrid(width, height);
    }
}
function defaultGrid(width, height) {
    const grid = [];
    for (let y = 0; y < height; y++) {
        grid.push(new Array(width).fill('grass'));
    }
    return grid;
}
export function serializeTerrainGrid(grid) {
    return JSON.stringify(grid);
}
