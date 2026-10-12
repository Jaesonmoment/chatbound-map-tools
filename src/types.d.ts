export type TerrainTypeId='road'|'grass'|'forest'|'sand'|'desert'|'mountain'|'water'|'city'|'custom';
export type GridCell={x:number;y:number};
export type NormCoord=GridCell;
export interface TerrainDef{id:TerrainTypeId;label:string;speedMultiplier:number;energyCostMultiplier:number;passable:boolean;allowsCombat:boolean;emoji:string}
export type TerrainOverrides=Partial<Record<TerrainTypeId,Partial<TerrainDef>>>;
export const TERRAIN_DEFAULTS:Record<TerrainTypeId,TerrainDef>;
export function terrainDefFor(id:TerrainTypeId,overrides?:TerrainOverrides):TerrainDef;
export function isTerrainTypeId(value:unknown):value is TerrainTypeId;
export function terrainSpeedFor(id:TerrainTypeId,overrides?:TerrainOverrides):number;
export function terrainEnergyCostFor(id:TerrainTypeId,overrides?:TerrainOverrides):number;
export function isPassable(id:TerrainTypeId,overrides?:TerrainOverrides):boolean;
export function parseTerrainGrid(raw:string|null|undefined,width:number,height:number):TerrainTypeId[][];
export function serializeTerrainGrid(grid:TerrainTypeId[][]):string;
export interface PathResult{cells:GridCell[];totalTimeSec:number;totalEnergyCost:number}
export function findPath(grid:TerrainTypeId[][],from:GridCell,to:GridCell,blockedCells?:Set<string>,overrides?:TerrainOverrides):PathResult|null;
export function blockedCellsFromJson(blocks:{cellsJson:string}[]):Set<string>;
export function pathCrossesCells(path:GridCell[],cells:Set<string>):GridCell[];
export interface WaypointEdge{connectionId:string;fromLocationId:string;toLocationId:string;bidirectional:boolean;distanceWeight:number;speedModifier:number;terrainType:TerrainTypeId|null;blocked:boolean}
export interface WaypointGraph{adjacency:Map<string,{toId:string;edge:WaypointEdge}[]>}
export interface WaypointPathResult{locationIds:string[];edgeIds:string[];edgeTimesMs:number[];totalTimeSec:number;totalEnergyCost:number}
export const MIN_CONNECTION_DISTANCE_WEIGHT:number;
export const MAX_CONNECTION_DISTANCE_WEIGHT:number;
export function isValidConnectionDistanceWeight(value:number):boolean;
export function buildWaypointGraph(edges:WaypointEdge[]):WaypointGraph;
export function euclideanDistance(a:NormCoord,b:NormCoord):number;
export function edgeTimeSec(edge:WaypointEdge,from:NormCoord,to:NormCoord,baseTimeSec?:number,overrides?:TerrainOverrides):number;
export function edgeEnergyCost(edge:WaypointEdge,from:NormCoord,to:NormCoord,overrides?:TerrainOverrides):number;
export function findWaypointPath(graph:WaypointGraph,from:string,to:string,coords:Map<string,NormCoord>,baseTimeSec?:number,overrides?:TerrainOverrides):WaypointPathResult|null;
export function pointInPolygon(point:NormCoord,polygon:[number,number][]):boolean;
export function parsePolygonJson(raw:string|null|undefined):[number,number][];
export function findRegionAtPoint(point:NormCoord,regions:{regionId:string;polygonJson:string|null}[]):string|null;
export class WorldMapCanvas{
 constructor(canvas:HTMLCanvasElement,options?:{gridWidth?:number;gridHeight?:number;settings?:Record<string,unknown>;viewerMode?:boolean;panButton?:number});
 static blankGrid(width:number,height:number,terrain?:TerrainTypeId):TerrainTypeId[][];
 static TERRAIN_IDS:TerrainTypeId[];
 resize(width:number,height:number):void;
 setGrid(width:number,height:number,grid:TerrainTypeId[][]):void;
 setSettings(settings:Record<string,unknown>):void;
 setBackgroundImage(url:string|null):void;
 setBackgroundBitmap(bitmap:CanvasImageSource|null,label?:string):void;
 setLocations(locations:Record<string,unknown>[]):void;
 setRoadTraces(traces:Record<string,unknown>[]):void;
 setHotspots(hotspots:Record<string,unknown>[]):void;
 setPathBlocks(blocks:Record<string,unknown>[]):void;
 setTravelPath(path:GridCell[]):void;
 setCoordTravelPath(path:NormCoord[]):void;
 setPlayerPos(x:number,y:number):void;
 setCoordinateMode(enabled:boolean):void;
 eventToPixel(event:MouseEvent):{px:number;py:number;cssX:number;cssY:number};
 pixelToCell(x:number,y:number):GridCell|null;
 cellToPixel(x:number,y:number):GridCell;
 coordToPixel(x:number,y:number):GridCell;
 pixelToCoord(x:number,y:number):NormCoord|null;
 setSelectedHotspot(index:number):void;
 hitTestHotspot(x:number,y:number):number;
 zoomIn():void;zoomOut():void;resetZoom():void;getZoom():number;
 startSpriteAnimation(container:HTMLElement):void;stopSpriteAnimation():void;setSpriteProgress(progress:number):void;
 draw():void;destroy():void;
}
