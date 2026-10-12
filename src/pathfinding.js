// ebs/src/game/pathfinding.ts
//
// A* pathfinding over a terrain grid. Returns the shortest passable path
// between two grid cells, weighted by terrain speed. Impassable cells
// (mountain, water) are excluded. Iteration cap prevents CPU timeout
// in Cloudflare Workers.
//
// All functions are pure: no DB access, no side effects.
import { terrainDefFor } from './terrain.js';
const MAX_ITERATIONS = 10_000;
const BASE_CELL_TIME_SEC = 10;
export function findPath(grid, from, to, blockedCells, overrides) {
    if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0]) || !grid[0].length) return null;
    if (grid.some(row => !Array.isArray(row) || row.length !== grid[0].length)) return null;
    if (![from?.x, from?.y, to?.x, to?.y].every(Number.isSafeInteger)) return null;
    const height = grid.length;
    if (height === 0)
        return null;
    const width = grid[0].length;
    if (from.x < 0 || from.x >= width || from.y < 0 || from.y >= height)
        return null;
    if (to.x < 0 || to.x >= width || to.y < 0 || to.y >= height)
        return null;
    if (blockedCells?.has(`${from.x},${from.y}`) || blockedCells?.has(`${to.x},${to.y}`) || !terrainDefFor(grid[from.y][from.x], overrides).passable) return null;
    const toTerrain = terrainDefFor(grid[to.y][to.x], overrides);
    if (!toTerrain.passable)
        return null;
    if (from.x === to.x && from.y === to.y) {
        return { cells: [from], totalTimeSec: 0, totalEnergyCost: 0 };
    }
    const cellKey = (x, y) => `${x},${y}`;
    const gScore = new Map();
    const cameFrom = new Map();
    const startKey = cellKey(from.x, from.y);
    gScore.set(startKey, 0);
    const openSet = [
        { key: startKey, x: from.x, y: from.y, f: heuristic(from, to) },
    ];
    const openSetKeys = new Set([startKey]);
    let iterations = 0;
    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[bestIdx].f)
                bestIdx = i;
        }
        const current = openSet[bestIdx];
        openSet.splice(bestIdx, 1);
        openSetKeys.delete(current.key);
        if (current.x === to.x && current.y === to.y) {
            return reconstructPath(grid, cameFrom, current.key, from, overrides);
        }
        const neighbors = getNeighbors(current.x, current.y, width, height);
        for (const n of neighbors) {
            const nKey = cellKey(n.x, n.y);
            if (blockedCells?.has(nKey))
                continue;
            const nTerrain = terrainDefFor(grid[n.y][n.x], overrides);
            if (!nTerrain.passable)
                continue;
            const moveCost = nTerrain.speedMultiplier > 0 ? Math.ceil(BASE_CELL_TIME_SEC / nTerrain.speedMultiplier) : Infinity;
            const tentativeG = (gScore.get(current.key) ?? Infinity) + moveCost;
            if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
                cameFrom.set(nKey, current.key);
                gScore.set(nKey, tentativeG);
                const f = tentativeG + heuristic(n, to);
                const queued = openSet.find(item => item.key === nKey);
                if (queued) queued.f = f;
                if (!openSetKeys.has(nKey)) {
                    openSet.push({ key: nKey, x: n.x, y: n.y, f });
                    openSetKeys.add(nKey);
                }
            }
        }
    }
    return null;
}
function heuristic(a, b) {
    return 0; // Dijkstra ordering stays optimal for configurable speeds and rounded time.
}
function getNeighbors(x, y, width, height) {
    const result = [];
    if (x > 0)
        result.push({ x: x - 1, y });
    if (x < width - 1)
        result.push({ x: x + 1, y });
    if (y > 0)
        result.push({ x, y: y - 1 });
    if (y < height - 1)
        result.push({ x, y: y + 1 });
    return result;
}
function reconstructPath(grid, cameFrom, endKey, from, overrides) {
    const keys = [];
    let current = endKey;
    while (current) {
        keys.push(current);
        const prev = cameFrom.get(current);
        if (!prev)
            break;
        current = prev;
    }
    keys.reverse();
    const cells = keys.map(k => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
    });
    let totalTimeSec = 0;
    let totalEnergyCost = 0;
    for (let i = 1; i < cells.length; i++) {
        const cell = cells[i];
        const td = terrainDefFor(grid[cell.y][cell.x], overrides);
        const speed = td.speedMultiplier > 0 ? td.speedMultiplier : 1;
        totalTimeSec += Math.ceil(BASE_CELL_TIME_SEC / speed);
        totalEnergyCost += td.energyCostMultiplier;
    }
    totalEnergyCost = Math.floor(totalEnergyCost);
    return { cells, totalTimeSec, totalEnergyCost };
}
export function blockedCellsFromJson(blocks) {
    const result = new Set();
    for (const block of blocks) {
        try {
            const cells = JSON.parse(block.cellsJson);
            if (Array.isArray(cells)) {
                for (const c of cells) {
                    if (c && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y) && c.x >= 0 && c.y >= 0) {
                        result.add(`${c.x},${c.y}`);
                    }
                }
            }
        }
        catch { /* skip malformed */ }
    }
    return result;
}
export function pathCrossesCells(path, checkCells) {
    return path.filter(c => checkCells.has(`${c.x},${c.y}`));
}
