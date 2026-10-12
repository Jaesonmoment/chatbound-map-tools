import {WorldMapCanvas,findPath} from './src/index.js';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),map=document.querySelector('#map'),moveButton=document.querySelector('#move');
const view=new WorldMapCanvas(canvas,{gridWidth:12,gridHeight:8,settings:{showGridLines:true,locationLabelMode:'always'}});
const grid=WorldMapCanvas.blankGrid(12,8,'grass');
for(let y=0;y<8;y++)grid[y][6]=y===4?'road':'water';
for(let x=0;x<12;x++)grid[4][x]='road';
view.setGrid(12,8,grid);view.setPlayerPos(1,4);
let origin={x:1,y:4},route=null,coord=false,destination=null,roadBlocked=false,moveFrame=0,moving=false;
const blockedCells=new Set();
function updateMoveButton(){moveButton.disabled=moving||coord||!route||route.cells.length<2;moveButton.textContent=moving?'Moving...':'Move along route';}
function cancelMovement(){
  if(moveFrame)cancelAnimationFrame(moveFrame);
  moveFrame=0;
  if(moving)view.setPlayerPos(origin.x,origin.y);
  moving=false;updateMoveButton();
}
function recomputeRoute(){
  cancelMovement();
  route=destination?findPath(grid,origin,destination,blockedCells):null;
  view.setTravelPath(route?.cells??[]);updateMoveButton();
  if(!destination){status.textContent=roadBlocked?'Crossing road blocked. Choose a destination; the east side is unreachable from the west.':'Crossing road open. Click a destination to preview travel.';return;}
  status.textContent=route?`${roadBlocked?'Crossing road blocked.':'Crossing road open.'} ${route.cells.length-1} steps. Travel cost: ${route.totalTimeSec} seconds / ${route.totalEnergyCost} energy.`:`Destination unreachable. ${roadBlocked?'The crossing road is blocked. Unblock it to restore travel.':'That cell is blocked by water.'}`;
}
view.setLocations([{gridX:1,gridY:4,name:'Start',coordX:.15,coordY:.55},{gridX:10,gridY:4,name:'Destination',coordX:.85,coordY:.55}]);
view.setRoadTraces([{points:[{x:.15,y:.55},{x:.5,y:.4},{x:.85,y:.55}],color:'#eec67a'}]);
view.setHotspots([{polygon:[[.1,.15],[.45,.15],[.45,.8],[.1,.8]],name:'West region',showWhenInactive:true,color:'#38bdf8'}]);
function resizeMap(){
  const width=Math.max(1,map.clientWidth),height=Math.max(1,Math.round(width*480/800));
  if(canvas.style.width!==width+'px'||canvas.style.height!==height+'px')view.resize(width,height);
}
resizeMap();const sizeObserver=new ResizeObserver(resizeMap);sizeObserver.observe(map);
canvas.addEventListener('click',event=>{const p=view.eventToPixel(event);if(coord){const hit=view.hitTestHotspot(p.px,p.py);view.setSelectedHotspot(hit);status.textContent=hit>=0?'West region selected.':'Outside the west region.';return;}const cell=view.pixelToCell(p.px,p.py);if(!cell)return;destination=cell;recomputeRoute();});
document.querySelector('#block').onclick=()=>{roadBlocked=!roadBlocked;const button=document.querySelector('#block');button.setAttribute('aria-pressed',String(roadBlocked));button.textContent=roadBlocked?'Unblock crossing road':'Block crossing road';if(roadBlocked)blockedCells.add('6,4');else blockedCells.delete('6,4');grid[4][6]=roadBlocked?'mountain':'road';view.setGrid(12,8,grid);recomputeRoute();};
document.querySelector('#in').onclick=()=>view.zoomIn();document.querySelector('#out').onclick=()=>view.zoomOut();document.querySelector('#reset').onclick=()=>view.resetZoom();
document.querySelector('#mode').onclick=()=>{cancelMovement();coord=!coord;view.setCoordinateMode(coord);view.resetZoom();updateMoveButton();status.textContent=coord?'Coordinate view: roads, locations and a region. Click the region.':'Grid view: click a cell for a route.';};
moveButton.onclick=()=>{
  if(moving||coord||!route||route.cells.length<2)return;
  const cells=route.cells.map(cell=>({...cell}));
  moving=true;updateMoveButton();let start;
  function step(now){
    if(!moving)return;
    start??=now;const progress=Math.min(1,(now-start)/2500),index=progress*(cells.length-1),lo=Math.floor(index),hi=Math.min(lo+1,cells.length-1),fraction=index-lo;
    // Route and marker use the same canvas coordinates at every displayed size.
    view.setPlayerPos(cells[lo].x+(cells[hi].x-cells[lo].x)*fraction,cells[lo].y+(cells[hi].y-cells[lo].y)*fraction);
    if(progress<1){moveFrame=requestAnimationFrame(step);return;}
    origin={...cells.at(-1)};moveFrame=0;moving=false;route=null;view.setTravelPath([]);updateMoveButton();status.textContent='Destination reached. Choose another cell to travel again.';
  }
  moveFrame=requestAnimationFrame(step);
};
addEventListener('pagehide',()=>{cancelMovement();sizeObserver.disconnect();view.destroy();},{once:true});updateMoveButton();
