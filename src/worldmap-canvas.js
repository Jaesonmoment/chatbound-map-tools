// extension/shared/worldmap-canvas.js
// Shared canvas renderer for the world map terrain grid.
// Used by config editor (painting), overlay (viewer map), and panel (compact map).
// All visual choices come from a settings object - never hardcoded.

const WorldMapCanvas = (() => {
  'use strict';

  var DEFAULT_TERRAIN_COLORS = {
    road:     '#6b7280',
    grass:    '#22c55e',
    forest:   '#166534',
    sand:     '#d4a574',
    desert:   '#ea580c',
    mountain: '#374151',
    water:    '#3b82f6',
    city:     '#eab308',
    custom:   '#8b5cf6'
  };

  var TERRAIN_LABELS = {
    road:     'Road',
    grass:    'Grass',
    forest:   'Forest',
    sand:     'Sand',
    desert:   'Desert',
    mountain: 'Mountain',
    water:    'Water',
    city:     'City',
    custom:   'Custom'
  };

  var TERRAIN_IDS = ['road', 'grass', 'forest', 'sand', 'desert', 'mountain', 'water', 'city', 'custom'];

  function defaultSettings() {
    return {
      terrainColors: null,
      terrainOpacity: 60,
      showGridLines: false,
      locationLabelMode: 'hover',
      clickToTravel: true,
      playerMarkerStyle: 'dot',
      pathHighlightColor: '#facc15',
      mapImageFit: 'contain',
      mapBackdropEnabled: true,
      selectedLocationZoomHighlight: true,
      selectedLocationHighlightColor: '#facc15',
      selectedLocationZoomScale: 2.15
    };
  }

  function resolveColor(terrainId, settings) {
    if (settings.terrainColors && settings.terrainColors[terrainId]) {
      return settings.terrainColors[terrainId];
    }
    return DEFAULT_TERRAIN_COLORS[terrainId] || DEFAULT_TERRAIN_COLORS.grass;
  }

  function _pointInPolygon(x, y, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0], yi = polygon[i][1];
      var xj = polygon[j][0], yj = polygon[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function hexToRgba(hex, alpha) {
    if (!hex || hex.length !== 7 || hex[0] !== '#') return 'rgba(34,197,94,' + alpha + ')';
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 'rgba(34,197,94,' + alpha + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function WorldMapCanvas(canvas, opts) {
    if (!(this instanceof WorldMapCanvas)) return new WorldMapCanvas(canvas, opts);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gridWidth = (opts && opts.gridWidth) || 50;
    this.gridHeight = (opts && opts.gridHeight) || 50;
    this.settings = Object.assign(defaultSettings(), opts && opts.settings);
    this.viewerMode = (opts && opts.viewerMode) || false;
    this.terrainGrid = null;
    this.bgImage = null;
    this.bgImageLoaded = false;
    this.locations = [];
    this.pathBlocks = [];
    this.travelPath = null;
    this.playerPos = null;
    this.campPos = null;
    this.forceGridLines = false;

    // Coordinate mode state
    this.coordinateMode = false;
    this.connections = [];
    this.roadTraces = [];
    this.coordTravelPath = null;   // [{x,y}, ...] normalized coords along route
    this.hotspots = [];            // [{polygon:[[x,y],...], locationId, locationIdx, name}]
    this._hoverHotspotIdx = -1;
    this._selectedHotspotIdx = -1;
    this._selectedLocationIdx = -1;

    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._minZoom = 1;
    this._maxZoom = 5;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartOffX = 0;
    this._panStartOffY = 0;
    this._panButton = (opts && opts.panButton != null) ? opts.panButton : 0;
    this._cssWidth = canvas.clientWidth || canvas.width || 800;
    this._cssHeight = canvas.clientHeight || canvas.height || 800;
    this._dpr = globalThis.devicePixelRatio || 1;
    this.onAfterDraw = null;
    this.onBackgroundImageLoad = null;
    this.onBackgroundImageError = null;
    this._bgImageLoadId = 0;

    this._tooltipEl = null;
    this._hoverLocationIdx = -1;
    this._animFrame = 0;
    this._spriteEl = null;
    this._spriteProgress = 0;
    this._spriteTargetProgress = 0;
    this._lastFrameTime = 0;
    this._animating = false;
    this._destroyed = false;
    this._suppressDraw = false;

    this._listeners = [];
    this._initZoomPan();
  }

  WorldMapCanvas.TERRAIN_IDS = TERRAIN_IDS;
  WorldMapCanvas.TERRAIN_LABELS = TERRAIN_LABELS;
  WorldMapCanvas.DEFAULT_TERRAIN_COLORS = DEFAULT_TERRAIN_COLORS;

  var proto = WorldMapCanvas.prototype;

  function finiteNumber(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function finitePoint(x, y) {
    var nx = finiteNumber(x);
    var ny = finiteNumber(y);
    return nx == null || ny == null ? null : { x: nx, y: ny };
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hotspotLocationIdx(hotspot) {
    if (!hotspot) return -1;
    var n = Number(hotspot.locationIdx);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  }

  proto.cellSize = function () {
    var size = this._canvasCssSize();
    var cssW = size.w;
    var cssH = size.h;
    return Math.min(cssW / this.gridWidth, cssH / this.gridHeight);
  };

  proto.gridOrigin = function () {
    var size = this._canvasCssSize();
    var cs = this.cellSize();
    return {
      x: (size.w - cs * this.gridWidth) / 2,
      y: (size.h - cs * this.gridHeight) / 2
    };
  };

  proto.resize = function (width, height) {
    var dpr = globalThis.devicePixelRatio || 1;
    this._cssWidth = Math.max(1, Number(width) || 1);
    this._cssHeight = Math.max(1, Number(height) || 1);
    this._dpr = dpr;
    this.canvas.width = Math.round(this._cssWidth * dpr);
    this.canvas.height = Math.round(this._cssHeight * dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  proto.setGrid = function (gridWidth, gridHeight, terrainGrid) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.terrainGrid = terrainGrid;
    this.draw();
  };

  proto.setSettings = function (settings) {
    this.settings = Object.assign(defaultSettings(), settings);
    this.draw();
  };

  proto.setBackgroundImage = function (url) {
    this._bgImageLoadId += 1;
    var loadId = this._bgImageLoadId;
    if (!url) {
      this.bgImage = null;
      this.bgImageLoaded = false;
      this.draw();
      return;
    }
    var self = this;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (self._destroyed || loadId !== self._bgImageLoadId) return;
      self.bgImage = img;
      self.bgImageLoaded = true;
      if (self.coordinateMode && img.naturalWidth && img.naturalHeight && !self.settings.lockCanvasSize) {
        var size = self._canvasCssSize();
        var cssW = size.w;
        var aspect = img.naturalHeight / img.naturalWidth;
        var newH = Math.round(cssW * aspect);
        if (Math.abs(newH - size.h) > 2) {
          self.resize(cssW, newH);
          if (typeof self.onBackgroundImageLoad === 'function') {
            self.onBackgroundImageLoad(url, img);
          }
          return;
        }
      }
      self.draw();
      if (typeof self.onBackgroundImageLoad === 'function') {
        self.onBackgroundImageLoad(url, img);
      }
    };
    img.onerror = function () {
      if (self._destroyed || loadId !== self._bgImageLoadId) return;
      self.bgImage = null;
      self.bgImageLoaded = false;
      self.draw();
      if (typeof self.onBackgroundImageError === 'function') {
        self.onBackgroundImageError(url);
      }
    };
    img.src = url;
  };

  proto.setBackgroundBitmap = function (bitmap, sourceLabel) {
    this._bgImageLoadId += 1;
    if (!bitmap) {
      this.bgImage = null;
      this.bgImageLoaded = false;
      this.draw();
      return;
    }

    this.bgImage = bitmap;
    this.bgImageLoaded = true;
    if (this.coordinateMode && bitmap.width && bitmap.height && !this.settings.lockCanvasSize) {
      var size = this._canvasCssSize();
      var cssW = size.w;
      var aspect = bitmap.height / bitmap.width;
      var newH = Math.round(cssW * aspect);
      if (Math.abs(newH - size.h) > 2) {
        this.resize(cssW, newH);
        if (typeof this.onBackgroundImageLoad === 'function') {
          this.onBackgroundImageLoad(sourceLabel || '', bitmap);
        }
        return;
      }
    }
    this.draw();
    if (typeof this.onBackgroundImageLoad === 'function') {
      this.onBackgroundImageLoad(sourceLabel || '', bitmap);
    }
  };

  proto._canvasCssSize = function () {
    if (Number.isFinite(this._cssWidth) && Number.isFinite(this._cssHeight) && this._cssWidth > 0 && this._cssHeight > 0) {
      return { w: this._cssWidth, h: this._cssHeight };
    }
    var dpr = this._dpr || globalThis.devicePixelRatio || 1;
    return {
      w: this.canvas.width / dpr,
      h: this.canvas.height / dpr
    };
  };

  proto._syncBackingScale = function () {
    var dpr = globalThis.devicePixelRatio || 1;
    var size = this._canvasCssSize();
    var targetW = Math.max(1, Math.round(size.w * dpr));
    var targetH = Math.max(1, Math.round(size.h * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH || this._dpr !== dpr) {
      this._dpr = dpr;
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.canvas.style.width = size.w + 'px';
      this.canvas.style.height = size.h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };

  proto.clientToPixel = function (clientX, clientY) {
    this._syncBackingScale();
    var rect = this.canvas.getBoundingClientRect();
    var size = this._canvasCssSize();
    var rectW = rect.width || size.w || 1;
    var rectH = rect.height || size.h || 1;
    var cssX = Number(clientX) - rect.left;
    var cssY = Number(clientY) - rect.top;
    return {
      px: cssX * (size.w / rectW),
      py: cssY * (size.h / rectH),
      cssX: cssX,
      cssY: cssY
    };
  };

  proto.eventToPixel = function (event) {
    return this.clientToPixel(event.clientX, event.clientY);
  };

  proto._backgroundSize = function () {
    if (!this.bgImage || !this.bgImageLoaded) return null;
    var w = this.bgImage.naturalWidth || this.bgImage.videoWidth || this.bgImage.width || 0;
    var h = this.bgImage.naturalHeight || this.bgImage.videoHeight || this.bgImage.height || 0;
    if (!w || !h) return null;
    return { w: w, h: h };
  };

  proto._mapTargetRect = function () {
    var size = this._canvasCssSize();
    if (this.coordinateMode) return { x: 0, y: 0, w: size.w, h: size.h };
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    return { x: origin.x, y: origin.y, w: cs * this.gridWidth, h: cs * this.gridHeight };
  };

  proto._imageDrawRect = function () {
    var target = this._mapTargetRect();
    var src = this._backgroundSize();
    if (!src || !target.w || !target.h) return target;
    var fit = this.settings.mapImageFit === 'cover' ? 'cover' : 'contain';
    var scale = fit === 'cover'
      ? Math.max(target.w / src.w, target.h / src.h)
      : Math.min(target.w / src.w, target.h / src.h);
    var w = src.w * scale;
    var h = src.h * scale;
    return {
      x: target.x + (target.w - w) / 2,
      y: target.y + (target.h - h) / 2,
      w: w,
      h: h
    };
  };

  proto._coordSpaceRect = function () {
    return (this.bgImage && this.bgImageLoaded) ? this._imageDrawRect() : this._mapTargetRect();
  };

  proto._drawMapBackdrop = function (ctx, target) {
    if (!target || !target.w || !target.h) return;
    ctx.save();
    ctx.fillStyle = '#05070c';
    ctx.fillRect(target.x, target.y, target.w, target.h);
    if (this.settings.mapBackdropEnabled !== false) {
      ctx.fillStyle = '#1c1610';
      ctx.fillRect(target.x, target.y, target.w, target.h);
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#7a5632';
      ctx.lineWidth = 1;
      var step = 26;
      for (var x = target.x - target.h; x < target.x + target.w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, target.y + target.h);
        ctx.lineTo(x + target.h, target.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#d6b57a';
      ctx.strokeRect(target.x + 6, target.y + 6, Math.max(0, target.w - 12), Math.max(0, target.h - 12));
    }
    ctx.restore();
  };

  proto._drawBackgroundImage = function (ctx) {
    if (!this.bgImage || !this.bgImageLoaded) return;
    var target = this._mapTargetRect();
    var rect = this._imageDrawRect();
    this._drawMapBackdrop(ctx, target);
    ctx.save();
    ctx.beginPath();
    ctx.rect(target.x, target.y, target.w, target.h);
    ctx.clip();
    ctx.drawImage(this.bgImage, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  };

  proto.setLocations = function (locations) {
    this.locations = locations || [];
    if (this._hoverLocationIdx >= this.locations.length) this._hoverLocationIdx = -1;
    if (this._selectedLocationIdx >= this.locations.length) this._selectedLocationIdx = -1;
    this.draw();
  };


  proto.setPathBlocks = function (blocks) {
    this.pathBlocks = blocks || [];
    this.draw();
  };

  proto.setTravelPath = function (pathCells) {
    this.travelPath = Array.isArray(pathCells)
      ? pathCells.map(function (cell) { return cell ? finitePoint(cell.x, cell.y) : null; }).filter(Boolean)
      : null;
    this.draw();
  };

  proto.setPlayerPos = function (gridX, gridY) {
    this.playerPos = finitePoint(gridX, gridY);
    this.draw();
  };

  proto.setCampPos = function (gridX, gridY) {
    if (gridX == null || gridY == null) {
      this.campPos = null;
    } else {
      this.campPos = finitePoint(gridX, gridY);
    }
    this.draw();
  };

  proto.pixelToCell = function (px, py) {
    var rpx = (px - this._panX) / this._zoom;
    var rpy = (py - this._panY) / this._zoom;
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var gx = Math.floor((rpx - origin.x) / cs);
    var gy = Math.floor((rpy - origin.y) / cs);
    if (gx < 0 || gy < 0 || gx >= this.gridWidth || gy >= this.gridHeight) return null;
    return { x: gx, y: gy };
  };

  proto.cellToPixel = function (gx, gy) {
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var wx = (origin.x + (gx + 0.5) * cs) * this._zoom + this._panX;
    var wy = (origin.y + (gy + 0.5) * cs) * this._zoom + this._panY;
    return { x: wx, y: wy };
  };

  // Pixel-precision coordinate conversions (no cell-center snapping).
  // pixelToWorld returns floating-point world coords in cell units.
  // worldToPixel converts world coords back to canvas pixels (with zoom/pan).
  proto.pixelToWorld = function (px, py) {
    var rpx = (px - this._panX) / this._zoom;
    var rpy = (py - this._panY) / this._zoom;
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    return { x: (rpx - origin.x) / cs, y: (rpy - origin.y) / cs };
  };

  proto.worldToPixel = function (wx, wy) {
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var px = (origin.x + wx * cs) * this._zoom + this._panX;
    var py = (origin.y + wy * cs) * this._zoom + this._panY;
    return { x: px, y: py };
  };

  // -- Coordinate-mode methods --
  // Normalized 0-1 coords map to the full background image / canvas area.

  proto.setCoordinateMode = function (isCoord) {
    this.coordinateMode = !!isCoord;
    if (isCoord && this.bgImage && this.bgImage.naturalWidth && this.bgImage.naturalHeight && !this.settings.lockCanvasSize) {
      var size = this._canvasCssSize();
      var cssW = size.w;
      var aspect = this.bgImage.naturalHeight / this.bgImage.naturalWidth;
      var newH = Math.round(cssW * aspect);
      if (Math.abs(newH - size.h) > 2) {
        this.resize(cssW, newH);
        return;
      }
    }
    this.draw();
  };

  proto.setConnections = function (connections) {
    this.connections = connections || [];
    this.draw();
  };

  proto.setRoadTraces = function (roadTraces) {
    this.roadTraces = Array.isArray(roadTraces) ? roadTraces.map(function (trace) {
      var rawPoints = trace && (trace.points || trace.coords || trace.path);
      var points = Array.isArray(rawPoints) ? rawPoints.map(function (pt) {
        if (!pt) return null;
        var x = Array.isArray(pt) ? pt[0] : pt.x;
        var y = Array.isArray(pt) ? pt[1] : pt.y;
        var clean = finitePoint(x, y);
        if (!clean) return null;
        return {
          x: Math.max(0, Math.min(1, clean.x)),
          y: Math.max(0, Math.min(1, clean.y))
        };
      }).filter(Boolean) : [];
      return Object.assign({}, trace, { points: points });
    }).filter(function (trace) { return trace.points && trace.points.length >= 2; }) : [];
    this.draw();
  };

  proto.setCoordTravelPath = function (coordPath) {
    this.coordTravelPath = Array.isArray(coordPath)
      ? coordPath.map(function (pt) { return pt ? finitePoint(pt.x, pt.y) : null; }).filter(Boolean)
      : null;
    this.draw();
  };

  /**
   * Convert normalized (0-1) coordinate to canvas pixel position (zoom/pan aware).
   * In coordinate mode, the full image area is the coordinate space.
   */
  proto.coordToPixel = function (normX, normY) {
    var ox, oy, imgW, imgH;
    if (this.coordinateMode) {
      var rect = this._coordSpaceRect();
      ox = rect.x; oy = rect.y; imgW = rect.w; imgH = rect.h;
    } else {
      var cs = this.cellSize();
      var origin = this.gridOrigin();
      ox = origin.x; oy = origin.y;
      imgW = cs * this.gridWidth;
      imgH = cs * this.gridHeight;
    }
    var px = (ox + normX * imgW) * this._zoom + this._panX;
    var py = (oy + normY * imgH) * this._zoom + this._panY;
    return { x: px, y: py };
  };

  /**
   * Convert canvas pixel position to normalized (0-1) coordinate (zoom/pan aware).
   * Returns null if the click is outside the image area.
   */
  proto.pixelToCoord = function (px, py) {
    var rpx = (px - this._panX) / this._zoom;
    var rpy = (py - this._panY) / this._zoom;
    var ox, oy, imgW, imgH;
    if (this.coordinateMode) {
      var rect = this._coordSpaceRect();
      ox = rect.x; oy = rect.y;
      imgW = rect.w;
      imgH = rect.h;
      // Guard against zero-size canvas during init
      if (!imgW || !imgH) return null;
      var normX = (rpx - ox) / imgW;
      var normY = (rpy - oy) / imgH;
      if (normX < -0.001 || normX > 1.001 || normY < -0.001 || normY > 1.001) return null;
      // Clamp edge clicks that fall just outside 0..1 due to floating-point
      normX = Math.max(0, Math.min(1, normX));
      normY = Math.max(0, Math.min(1, normY));
      return { x: normX, y: normY };
    } else {
      var cs = this.cellSize();
      var origin = this.gridOrigin();
      ox = origin.x; oy = origin.y;
      imgW = cs * this.gridWidth;
      imgH = cs * this.gridHeight;
    }
    var normX = (rpx - ox) / imgW;
    var normY = (rpy - oy) / imgH;
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null;
    return { x: normX, y: normY };
  };

  proto._initZoomPan = function () {
    var self = this;
    this._listen(this.canvas, 'wheel', function (e) {
      e.preventDefault();
      var p = self.eventToPixel(e);
      var mx = p.px;
      var my = p.py;
      var oldZoom = self._zoom;
      var delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      self._zoom = Math.max(self._minZoom, Math.min(self._maxZoom, self._zoom * delta));
      self._panX = mx - (mx - self._panX) * (self._zoom / oldZoom);
      self._panY = my - (my - self._panY) * (self._zoom / oldZoom);
      self._clampPan();
      self.draw();
    }, { passive: false });

    this._listen(this.canvas, 'mousedown', function (e) {
      if (e.button !== self._panButton) return;
      if (self._panButton === 0 && self._zoom <= 1) return;
      self._isPanning = true;
      self._panStartX = e.clientX;
      self._panStartY = e.clientY;
      self._panStartOffX = self._panX;
      self._panStartOffY = self._panY;
      self.canvas.style.cursor = 'grabbing';
    });
    if (this._panButton === 2) {
      this._listen(this.canvas, 'contextmenu', function (e) { e.preventDefault(); });
    }
    this._listen(globalThis, 'mousemove', function (e) {
      if (!self._isPanning) return;
      self._panX = self._panStartOffX + (e.clientX - self._panStartX);
      self._panY = self._panStartOffY + (e.clientY - self._panStartY);
      self._clampPan();
      self.draw();
    });
    this._listen(globalThis, 'mouseup', function () {
      if (!self._isPanning) return;
      self._isPanning = false;
      self.canvas.style.cursor = '';
    });
  };

  proto._clampPan = function () {
    var size = this._canvasCssSize();
    var w = size.w;
    var h = size.h;
    var sw = w * this._zoom;
    var sh = h * this._zoom;
    this._panX = Math.max(w - sw, Math.min(0, this._panX));
    this._panY = Math.max(h - sh, Math.min(0, this._panY));
  };

  proto.zoomIn = function () {
    var size = this._canvasCssSize();
    var w = size.w;
    var h = size.h;
    var oldZoom = this._zoom;
    this._zoom = Math.min(this._maxZoom, this._zoom * 1.3);
    this._panX = w / 2 - (w / 2 - this._panX) * (this._zoom / oldZoom);
    this._panY = h / 2 - (h / 2 - this._panY) * (this._zoom / oldZoom);
    this._clampPan();
    this.draw();
  };

  proto.zoomOut = function () {
    var size = this._canvasCssSize();
    var w = size.w;
    var h = size.h;
    var oldZoom = this._zoom;
    this._zoom = Math.max(this._minZoom, this._zoom / 1.3);
    this._panX = w / 2 - (w / 2 - this._panX) * (this._zoom / oldZoom);
    this._panY = h / 2 - (h / 2 - this._panY) * (this._zoom / oldZoom);
    this._clampPan();
    this.draw();
  };

  proto.resetZoom = function () {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this.draw();
  };

  proto.getZoom = function () { return this._zoom; };

  proto.panToCell = function (gx, gy) {
    var cs = this.cellSize();
    var centerX = (gx + 0.5) * cs;
    var centerY = (gy + 0.5) * cs;
    var size = this._canvasCssSize();
    var cw = size.w;
    var ch = size.h;
    this._panX = cw / 2 - centerX * this._zoom;
    this._panY = ch / 2 - centerY * this._zoom;
    this._clampPan();
    this.draw();
  };

  proto.panToCoord = function (normX, normY) {
    var rect = this._coordSpaceRect();
    var centerX = rect.x + normX * rect.w;
    var centerY = rect.y + normY * rect.h;
    var size = this._canvasCssSize();
    var cw = size.w;
    var ch = size.h;
    this._panX = cw / 2 - centerX * this._zoom;
    this._panY = ch / 2 - centerY * this._zoom;
    this._clampPan();
    this.draw();
  };

  proto.batchUpdate = function (fn) {
    this._suppressDraw = true;
    try { fn(this); } finally { this._suppressDraw = false; this.draw(); }
  };

  proto.draw = function () {
    if (this._destroyed || this._suppressDraw) return;
    this._syncBackingScale();
    var ctx = this.ctx;
    var dpr = this._dpr || globalThis.devicePixelRatio || 1;
    var size = this._canvasCssSize();
    var w = size.w;
    var h = size.h;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);

    if (this.bgImage && this.bgImageLoaded) {
      this._drawBackgroundImage(ctx);
    }

    if (this.coordinateMode) {
      if (!this.bgImage || !this.bgImageLoaded) {
        this._drawEmptyCoordinateMap(ctx, w, h);
      }
      this._drawHotspots(ctx);
      this._drawRoadTraces(ctx);
      this._drawConnections(ctx);
      this._drawCoordPath(ctx);
      this._drawSelectedLocationZoom(ctx);
      this._drawCoordLocations(ctx);
      this._drawCoordCamp(ctx);
      this._drawCoordPlayer(ctx);
    } else {
      // Grid mode: original rendering
      if (!this.viewerMode) {
        this._drawTerrain(ctx, w, h);
      }
      this._drawPath(ctx);
      this._drawPathBlocks(ctx);
      this._drawLocations(ctx);
      this._drawCamp(ctx);
      this._drawPlayer(ctx);
    }

    ctx.restore();
    if (this.onAfterDraw) this.onAfterDraw();
  };

  proto._drawEmptyCoordinateMap = function (ctx, w, h) {
    ctx.save();
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(12, 12, Math.max(0, w - 24), Math.max(0, h - 24));
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(239,239,241,0.72)';
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sample coordinate map', w / 2, h / 2);
    ctx.restore();
  };

  proto._drawTerrain = function (ctx, w, h) {
    if (!this.terrainGrid) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var opacity = this.settings.terrainOpacity / 100;
    var showGrid = this.forceGridLines || this.settings.showGridLines;

    for (var gy = 0; gy < this.gridHeight; gy++) {
      var row = this.terrainGrid[gy];
      if (!row) continue;
      for (var gx = 0; gx < this.gridWidth; gx++) {
        var tid = row[gx] || 'grass';
        var color = resolveColor(tid, this.settings);
        var px = origin.x + gx * cs;
        var py = origin.y + gy * cs;

        if (this.bgImage && this.bgImageLoaded) {
          ctx.fillStyle = hexToRgba(color, opacity);
        } else {
          ctx.fillStyle = color;
        }
        ctx.fillRect(px, py, cs, cs);

        if (showGrid) {
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(px, py, cs, cs);
        }
      }
    }
  };

  proto._drawPath = function (ctx) {
    if (!this.travelPath || this.travelPath.length < 2) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var color = this.settings.pathHighlightColor || '#facc15';

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cs * 0.3);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.7;

    var first = this.travelPath[0];
    ctx.moveTo(origin.x + first.x * cs + cs / 2, origin.y + first.y * cs + cs / 2);
    for (var i = 1; i < this.travelPath.length; i++) {
      var cell = this.travelPath[i];
      ctx.lineTo(origin.x + cell.x * cs + cs / 2, origin.y + cell.y * cs + cs / 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  proto._drawPathBlocks = function (ctx) {
    if (!this.pathBlocks || !this.pathBlocks.length) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();

    ctx.font = Math.max(10, cs * 0.7) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < this.pathBlocks.length; i++) {
      var block = this.pathBlocks[i];
      var px = origin.x + block.gridX * cs + cs / 2;
      var py = origin.y + block.gridY * cs + cs / 2;
      ctx.fillStyle = 'rgba(220,38,38,0.6)';
      ctx.beginPath();
      ctx.arc(px, py, cs * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('⚠', px, py);
    }
  };

  proto._drawLocations = function (ctx) {
    if (!this.locations || !this.locations.length) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var labelMode = this.settings.locationLabelMode || 'hover';

    for (var i = 0; i < this.locations.length; i++) {
      var loc = this.locations[i];
      var px = origin.x + loc.gridX * cs + cs / 2;
      var py = origin.y + loc.gridY * cs + cs / 2;
      var isHovered = this._hoverLocationIdx === i;
      var isSelected = this._selectedLocationIdx === i;
      var color = isHovered || isSelected
        ? (this.settings.selectedLocationHighlightColor || '#facc15')
        : (loc.highlightColor || loc.color || loc.poiColor || '#38bdf8');

      var emoji = loc.emoji || '📍';
      var fontSize = Math.max(10, cs * 0.7);
      var drawSize = fontSize * (isSelected ? 1.38 : (isHovered ? 1.16 : 1));
      if (isHovered || isSelected) {
        this._drawLocationFocus(ctx, px, py, Math.max(cs * 0.6, drawSize * 0.64), color, isSelected);
      }
      ctx.font = drawSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (loc.locked) {
        ctx.globalAlpha = 0.4;
      }
      ctx.fillText(emoji, px, py);
      ctx.globalAlpha = 1;

      if (labelMode === 'always' || isSelected || (labelMode === 'hover' && isHovered)) {
        ctx.font = Math.max(8, cs * 0.45) + 'px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(loc.name || '', px, py - cs * 0.6);
        ctx.fillText(loc.name || '', px, py - cs * 0.6);
      }
    }
  };


  proto._drawCamp = function (ctx) {
    if (!this.campPos) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var px = origin.x + this.campPos.x * cs + cs / 2;
    var py = origin.y + this.campPos.y * cs + cs / 2;

    ctx.font = Math.max(12, cs * 0.8) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥', px, py);
  };

  proto._drawPlayer = function (ctx) {
    if (!this.playerPos) return;
    if (this.campPos) return;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var px = origin.x + this.playerPos.x * cs + cs / 2;
    var py = origin.y + this.playerPos.y * cs + cs / 2;
    var style = this.settings.playerMarkerStyle || 'dot';

    if (style === 'emoji') {
      ctx.font = Math.max(10, cs * 0.7) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧑', px, py);
    } else if (style === 'class') {
      ctx.font = Math.max(10, cs * 0.7) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔️', px, py);
    } else {
      var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      var radius = cs * 0.3 * (0.8 + 0.2 * pulse);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250,204,21,' + (0.7 + 0.3 * pulse) + ')';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // -- Coordinate-mode draw methods --

  proto._coordPos = function (normX, normY) {
    if (this.coordinateMode) {
      var rect = this._coordSpaceRect();
      return {
        x: rect.x + normX * rect.w,
        y: rect.y + normY * rect.h
      };
    }
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    return {
      x: origin.x + normX * cs * this.gridWidth,
      y: origin.y + normY * cs * this.gridHeight
    };
  };

  proto._coordForItem = function (item) {
    if (!item) return null;
    var x = item.coordX == null ? null : finiteNumber(item.coordX);
    var y = item.coordY == null ? null : finiteNumber(item.coordY);
    var gridX = item.gridX == null ? null : finiteNumber(item.gridX);
    var gridY = item.gridY == null ? null : finiteNumber(item.gridY);
    if (x == null && gridX != null) {
      x = (gridX + 0.5) / this.gridWidth;
    }
    if (y == null && gridY != null) {
      y = (gridY + 0.5) / this.gridHeight;
    }
    return x == null || y == null ? null : { x: x, y: y };
  };

  proto._drawConnections = function (ctx) {
    if (!this.connections || !this.connections.length) return;
    if (!this.locations || !this.locations.length) return;

    // Build a lookup from locationId to location object
    var locMap = {};
    for (var i = 0; i < this.locations.length; i++) {
      var loc = this.locations[i];
      if (loc.locationId) locMap[loc.locationId] = loc;
    }

    var cs = this.cellSize();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = Math.max(1.5, cs * 0.08);
    ctx.setLineDash([6, 4]);

    for (var j = 0; j < this.connections.length; j++) {
      var conn = this.connections[j];
      var fromLoc = locMap[conn.fromLocationId];
      var toLoc = locMap[conn.toLocationId];
      if (!fromLoc || !toLoc) continue;

      var fromCoord = this._coordForItem(fromLoc);
      var toCoord = this._coordForItem(toLoc);
      if (!fromCoord || !toCoord) continue;

      var fp = this._coordPos(fromCoord.x, fromCoord.y);
      var tp = this._coordPos(toCoord.x, toCoord.y);

      if (conn.blocked) {
        ctx.strokeStyle = 'rgba(220,38,38,0.4)';
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      }

      ctx.beginPath();
      ctx.moveTo(fp.x, fp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();

      // One-way arrow at midpoint
      if (!conn.bidirectional) {
        var angle = Math.atan2(tp.y - fp.y, tp.x - fp.x);
        var arrowSize = Math.max(6, cs * 0.25);
        var midX = (fp.x + tp.x) / 2;
        var midY = (fp.y + tp.y) / 2;
        var wingAngle = 2.6; // ~150 degrees from tip = narrow arrowhead
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(midX + arrowSize * Math.cos(angle), midY + arrowSize * Math.sin(angle));
        ctx.lineTo(midX + arrowSize * 0.7 * Math.cos(angle + wingAngle), midY + arrowSize * 0.7 * Math.sin(angle + wingAngle));
        ctx.lineTo(midX + arrowSize * 0.7 * Math.cos(angle - wingAngle), midY + arrowSize * 0.7 * Math.sin(angle - wingAngle));
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        ctx.setLineDash([6, 4]);
      }
    }
    ctx.restore();
  };

  proto._drawRoadTraces = function (ctx) {
    if (!this.roadTraces || !this.roadTraces.length) return;

    var cs = this.cellSize();
    for (var i = 0; i < this.roadTraces.length; i++) {
      var trace = this.roadTraces[i];
      if (!trace || trace.visible === false || !trace.points || trace.points.length < 2) continue;
      var color = trace.color || '#facc15';
      var widthPx = Number(trace.widthPx);
      var opacity = Number(trace.opacity);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = Math.max(3, cs * 0.12);
      ctx.shadowOffsetY = Math.max(1, cs * 0.05);
      ctx.strokeStyle = hexToRgba(color, trace.locked ? 0.42 : (Number.isFinite(opacity) ? Math.max(0.1, Math.min(1, opacity)) : 0.72));
      ctx.lineWidth = Number.isFinite(widthPx) ? Math.max(2, Math.min(24, widthPx)) : Math.max(3, cs * 0.12);
      if (trace.style === 'dashed') ctx.setLineDash([ctx.lineWidth * 2.2, ctx.lineWidth * 1.4]);
      ctx.beginPath();
      for (var j = 0; j < trace.points.length; j++) {
        var pt = trace.points[j];
        var pos = this._coordPos(pt.x, pt.y);
        if (j === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  proto._drawCoordPath = function (ctx) {
    if (!this.coordTravelPath || this.coordTravelPath.length < 2) return;

    var color = this.settings.pathHighlightColor || '#facc15';
    var cs = this.cellSize();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, cs * 0.15);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.8;

    var first = this._coordPos(this.coordTravelPath[0].x, this.coordTravelPath[0].y);
    ctx.moveTo(first.x, first.y);
    for (var i = 1; i < this.coordTravelPath.length; i++) {
      var pt = this._coordPos(this.coordTravelPath[i].x, this.coordTravelPath[i].y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  proto._coordPinSize = function () {
    var rect = this._coordSpaceRect();
    var shorter = Math.min(rect.w, rect.h);
    return Math.max(20, shorter * 0.045);
  };

  proto._drawLocationFocus = function (ctx, x, y, radius, color, selected) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, selected ? 0.22 : 0.14);
    ctx.fill();
    ctx.lineWidth = selected ? 3.5 : 2.25;
    ctx.strokeStyle = hexToRgba(color, selected ? 0.96 : 0.72);
    ctx.stroke();
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRgba(color, 0.38);
      ctx.stroke();
    }
    ctx.restore();
  };

  proto._locationZoomPath = function (ctx, x, y, w, h) {
    var r = Math.min(h * 0.48, w * 0.22);
    var peak = Math.min(h * 0.24, w * 0.08);
    ctx.beginPath();
    ctx.moveTo(x + r, y + peak);
    ctx.quadraticCurveTo(x + w * 0.43, y, x + w * 0.50, y - peak);
    ctx.quadraticCurveTo(x + w * 0.57, y, x + w - r, y + peak);
    ctx.quadraticCurveTo(x + w, y + peak, x + w, y + peak + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + peak + r);
    ctx.quadraticCurveTo(x, y + peak, x + r, y + peak);
    ctx.closePath();
  };

  proto._drawSelectedLocationZoom = function (ctx) {
    if (this.settings.selectedLocationZoomHighlight === false) return;
    if (!this.coordinateMode || !this.bgImage || !this.bgImageLoaded) return;
    if (!this.locations || !this.locations.length) return;

    var activeIdx = this._hoverLocationIdx >= 0 ? this._hoverLocationIdx : this._selectedLocationIdx;
    if (activeIdx < 0 || activeIdx >= this.locations.length) return;
    if (this._hasActiveLocationHotspot(activeIdx)) return;

    var loc = this.locations[activeIdx];
    var coord = this._coordForItem(loc);
    var src = this._backgroundSize();
    if (!coord || !src) return;

    var rect = this._coordSpaceRect();
    if (!rect.w || !rect.h) return;

    var pos = this._coordPos(coord.x, coord.y);
    var shorter = Math.min(rect.w, rect.h);
    var pad = Math.max(6, shorter * 0.012);
    var maxLensW = Math.max(42, Math.min(320, rect.w - pad * 2, rect.w * 0.42));
    var minLensW = Math.min(maxLensW, Math.max(72, rect.w * 0.18));
    var lensW = clampNumber(rect.w * 0.22, minLensW, maxLensW);
    var maxLensH = Math.max(34, Math.min(190, rect.h - pad * 2, rect.h * 0.34));
    var minLensH = Math.min(maxLensH, Math.max(42, rect.h * 0.14));
    var lensH = clampNumber(lensW * 0.52, minLensH, maxLensH);
    if (lensW <= 0 || lensH <= 0) return;

    var lensPeak = Math.min(lensH * 0.24, lensW * 0.08);
    var dx = clampNumber(pos.x - lensW / 2, rect.x + pad, rect.x + rect.w - lensW - pad);
    var dy = clampNumber(pos.y - lensH / 2, rect.y + pad + lensPeak, rect.y + rect.h - lensH - pad);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    var zoom = Number(this.settings.selectedLocationZoomScale);
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 2.15;
    zoom = clampNumber(zoom, 1.25, 4);

    var sx = coord.x * src.w;
    var sy = coord.y * src.h;
    var sw = Math.max(1, (lensW / rect.w) * src.w / zoom);
    var sh = Math.max(1, (lensH / rect.h) * src.h / zoom);
    var sourceX = clampNumber(sx - sw / 2, 0, Math.max(0, src.w - sw));
    var sourceY = clampNumber(sy - sh / 2, 0, Math.max(0, src.h - sh));
    var color = this.settings.selectedLocationHighlightColor || '#facc15';

    ctx.save();
    this._locationZoomPath(ctx, dx, dy, lensW, lensH);
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = Math.max(8, shorter * 0.018);
    ctx.shadowOffsetY = Math.max(2, shorter * 0.006);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(this.bgImage, sourceX, sourceY, sw, sh, dx, dy, lensW, lensH);
    ctx.restore();

    ctx.save();
    this._locationZoomPath(ctx, dx, dy, lensW, lensH);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(4, shorter * 0.012);
    ctx.strokeStyle = 'rgba(0,0,0,0.58)';
    ctx.stroke();
    ctx.lineWidth = Math.max(3, shorter * 0.009);
    ctx.strokeStyle = hexToRgba(color, 0.98);
    ctx.stroke();
    ctx.restore();
  };

  proto._drawCoordLocations = function (ctx) {
    if (!this.locations || !this.locations.length) return;

    var fontSize = this._coordPinSize();
    var labelMode = this.settings.locationLabelMode || 'hover';

    for (var i = 0; i < this.locations.length; i++) {
      var loc = this.locations[i];
      var coord = this._coordForItem(loc);
      if (!coord) continue;
      var pos = this._coordPos(coord.x, coord.y);
      var isHovered = this._hoverLocationIdx === i;
      var isSelected = this._selectedLocationIdx === i;
      var color = isHovered || isSelected
        ? (this.settings.selectedLocationHighlightColor || '#facc15')
        : (loc.highlightColor || loc.color || loc.poiColor || '#38bdf8');

      var emoji = loc.emoji || '\u{1F4CD}';
      var drawSize = fontSize * (isSelected ? 1.42 : (isHovered ? 1.18 : 1));
      if (isHovered || isSelected) {
        this._drawLocationFocus(ctx, pos.x, pos.y, drawSize * 0.62, color, isSelected);
      }
      ctx.font = drawSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (loc.locked) {
        ctx.globalAlpha = 0.4;
      }
      ctx.fillText(emoji, pos.x, pos.y);
      ctx.globalAlpha = 1;

      if (labelMode === 'always' || isSelected || (labelMode === 'hover' && isHovered)) {
        ctx.font = Math.max(11, fontSize * 0.55) + 'px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2.5;
        ctx.strokeText(loc.name || '', pos.x, pos.y - fontSize * 0.7);
        ctx.fillText(loc.name || '', pos.x, pos.y - fontSize * 0.7);
      }
    }
  };


  proto._drawCoordCamp = function (ctx) {
    if (!this.campPos) return;

    var cs = this.cellSize();
    var pos = this._coordPos(this.campPos.x, this.campPos.y);

    ctx.font = Math.max(16, cs * 1.0) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F525}', pos.x, pos.y);
  };

  proto._drawCoordPlayer = function (ctx) {
    if (!this.playerPos) return;
    if (this.campPos) return;

    var cs = this.cellSize();
    var pos = this._coordPos(this.playerPos.x, this.playerPos.y);
    var style = this.settings.playerMarkerStyle || 'dot';

    if (style === 'emoji') {
      ctx.font = Math.max(14, cs * 0.9) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F9D1}', pos.x, pos.y);
    } else if (style === 'class') {
      ctx.font = Math.max(14, cs * 0.9) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔️', pos.x, pos.y);
    } else {
      var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      var radius = Math.max(5, cs * 0.2) * (0.8 + 0.2 * pulse);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250,204,21,' + (0.7 + 0.3 * pulse) + ')';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // -- Coordinate-mode hit testing --

  proto.hitTestCoordLocation = function (px, py) {
    var coord = this.pixelToCoord(px, py);
    if (!coord) return -1;

    var rect = this.coordinateMode ? this._coordSpaceRect() : null;
    var imgW = rect ? rect.w : (this.cellSize() * this.gridWidth);
    var hitRadius = Math.max(0.02, 20 / imgW);

    for (var i = 0; i < this.locations.length; i++) {
      var loc = this.locations[i];
      var locCoord = this._coordForItem(loc);
      if (!locCoord) continue;
      var lx = locCoord.x;
      var ly = locCoord.y;
      var dx = coord.x - lx;
      var dy = coord.y - ly;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
    }
    return -1;
  };

  proto.setHotspots = function (arr) {
    this.hotspots = arr || [];
    if (this._hoverHotspotIdx >= this.hotspots.length) this._hoverHotspotIdx = -1;
    if (this._selectedHotspotIdx >= this.hotspots.length) this._selectedHotspotIdx = -1;
    this.draw();
  };

  proto.setHoverHotspot = function (idx) {
    if (this._hoverHotspotIdx === idx) return;
    this._hoverHotspotIdx = idx;
    this.draw();
  };

  proto.setSelectedHotspot = function (idx) {
    if (this._selectedHotspotIdx === idx) return;
    this._selectedHotspotIdx = idx;
    this.draw();
  };

  proto.setSelectedLocation = function (idx) {
    var next = Number.isFinite(Number(idx)) ? Number(idx) : -1;
    if (next < 0 || next >= this.locations.length) next = -1;
    if (this._selectedLocationIdx === next) return;
    this._selectedLocationIdx = next;
    this.draw();
  };

  proto.hitTestHotspot = function (px, py) {
    var coord = this.pixelToCoord(px, py);
    if (!coord) return -1;
    for (var i = this.hotspots.length - 1; i >= 0; i--) {
      if (this.hotspots[i] && this.hotspots[i].hidden) continue;
      var poly = this.hotspots[i].polygon;
      if (poly && poly.length >= 3 && _pointInPolygon(coord.x, coord.y, poly)) return i;
    }
    return -1;
  };

  proto._hotspotActiveState = function (hotspot, idx) {
    var locIdx = hotspotLocationIdx(hotspot);
    var locationHovered = locIdx >= 0 && locIdx === this._hoverLocationIdx;
    var locationSelected = locIdx >= 0 && locIdx === this._selectedLocationIdx;
    var areaHovered = idx === this._hoverHotspotIdx;
    var areaSelected = idx === this._selectedHotspotIdx;
    var active = locationHovered || locationSelected || areaHovered || areaSelected;
    return {
      active: active,
      hovered: locationHovered || areaHovered,
      selected: locationSelected || areaSelected,
      locationIdx: locIdx
    };
  };

  proto._hasActiveLocationHotspot = function (locationIdx) {
    if (!this.hotspots || !this.hotspots.length || locationIdx < 0) return false;
    for (var i = 0; i < this.hotspots.length; i++) {
      var hs = this.hotspots[i];
      if (!hs || hs.hidden || !hs.polygon || hs.polygon.length < 3) continue;
      if (hotspotLocationIdx(hs) === locationIdx) return true;
    }
    return false;
  };

  proto._drawHotspots = function (ctx) {
    if (!this.hotspots || !this.hotspots.length) return;
    for (var i = 0; i < this.hotspots.length; i++) {
      var hs = this.hotspots[i];
      if (!hs || !hs.polygon || hs.polygon.length < 3) continue;
      if (hs.hidden) continue;
      var state = this._hotspotActiveState(hs, i);
      if (!state.active && hs.showWhenInactive !== true) continue;
      var isHovered = state.hovered;
      var isSelected = state.selected;
      var style = hs.highlightStyle || (hs.highlightShadow === false ? 'outline' : 'glow');
      var color = state.active
        ? (hs.highlightColor || hs.color || this.settings.selectedLocationHighlightColor || '#facc15')
        : (hs.highlightColor || hs.color || '#38bdf8');
      var polygon = hs.polygon;
      if (state.active) {
        var cx = 0, cy = 0;
        for (var k = 0; k < hs.polygon.length; k++) {
          cx += Number(hs.polygon[k][0]) || 0;
          cy += Number(hs.polygon[k][1]) || 0;
        }
        cx = cx / hs.polygon.length;
        cy = cy / hs.polygon.length;
        var scale = isHovered ? 1.05 : 1.025;
        polygon = hs.polygon.map(function (pt) {
          return [
            cx + ((Number(pt[0]) || 0) - cx) * scale,
            cy + ((Number(pt[1]) || 0) - cy) * scale,
          ];
        });
      }
      ctx.save();
      if (state.active && style !== 'outline') {
        ctx.shadowColor = style === 'soft' ? hexToRgba(color, 0.42) : 'rgba(0,0,0,0.72)';
        ctx.shadowBlur = style === 'soft' ? 10 : 18;
        ctx.shadowOffsetY = style === 'soft' ? 0 : 4;
      }
      ctx.beginPath();
      for (var j = 0; j < polygon.length; j++) {
        var pt = this._coordPos(polygon[j][0], polygon[j][1]);
        if (j === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      if (state.active) {
        ctx.fillStyle = style === 'outline' ? hexToRgba(color, 0.08) : hexToRgba(color, isHovered ? 0.28 : 0.18);
        ctx.strokeStyle = hexToRgba(color, isHovered ? 0.98 : 0.84);
        ctx.lineWidth = isHovered ? 3 : 2.5;
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = hexToRgba(color, 0.07);
        ctx.strokeStyle = hexToRgba(color, 0.32);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };


  // -- Sprite animation for travel --

  proto.startSpriteAnimation = function (containerEl) {
    if (this._animating) return;
    if (!containerEl) return;

    if (!this._spriteEl) {
      var el = document.createElement('div');
      el.className = 'wm-sprite';
      containerEl.style.position = 'relative';
      containerEl.appendChild(el);
      this._spriteEl = el;
    }

    this._animating = true;
    this._lastFrameTime = 0;
    var self = this;

    function tick(ts) {
      if (self._destroyed || !self._animating) return;
      if (ts - self._lastFrameTime < 66) {
        self._animFrame = requestAnimationFrame(tick);
        return;
      }
      self._lastFrameTime = ts;
      self._updateSprite();
      self.draw();
      self._animFrame = requestAnimationFrame(tick);
    }
    this._animFrame = requestAnimationFrame(tick);
  };

  proto.stopSpriteAnimation = function () {
    this._animating = false;
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = 0;
    }
    if (this._spriteEl && this._spriteEl.parentNode) {
      this._spriteEl.parentNode.removeChild(this._spriteEl);
      this._spriteEl = null;
    }
  };

  proto.setSpriteProgress = function (progress) {
    this._spriteTargetProgress = Math.max(0, Math.min(1, progress));
  };

  proto._updateSprite = function () {
    if (!this._spriteEl || !this.travelPath || !this.travelPath.length) return;

    var diff = this._spriteTargetProgress - this._spriteProgress;
    this._spriteProgress += diff * 0.15;
    if (Math.abs(diff) < 0.001) this._spriteProgress = this._spriteTargetProgress;

    var idx = this._spriteProgress * (this.travelPath.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.min(lo + 1, this.travelPath.length - 1);
    var frac = idx - lo;

    var cellA = this.travelPath[lo];
    var cellB = this.travelPath[hi];
    var gx = cellA.x + (cellB.x - cellA.x) * frac;
    var gy = cellA.y + (cellB.y - cellA.y) * frac;

    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var px = origin.x + gx * cs + cs / 2;
    var py = origin.y + gy * cs + cs / 2;

    var size = Math.max(8, cs * 0.6);
    this._spriteEl.style.width = size + 'px';
    this._spriteEl.style.height = size + 'px';
    this._spriteEl.style.borderRadius = '50%';
    this._spriteEl.style.background = this.settings.pathHighlightColor || '#facc15';
    this._spriteEl.style.boxShadow = '0 0 6px ' + (this.settings.pathHighlightColor || '#facc15');
    this._spriteEl.style.transform = 'translate(' + (px - size / 2) + 'px,' + (py - size / 2) + 'px)';

    this.playerPos = { x: Math.round(gx), y: Math.round(gy) };
  };

  // -- Hit testing for click/hover --

  proto._toWorldCoords = function (px, py) {
    return { x: (px - this._panX) / this._zoom, y: (py - this._panY) / this._zoom };
  };

  proto.hitTestLocation = function (px, py) {
    var wp = this._toWorldCoords(px, py);
    var cs = this.cellSize();
    var origin = this.gridOrigin();
    var hitRadius = cs * 0.6;

    for (var i = 0; i < this.locations.length; i++) {
      var loc = this.locations[i];
      var lx = origin.x + loc.gridX * cs + cs / 2;
      var ly = origin.y + loc.gridY * cs + cs / 2;
      var dx = wp.x - lx;
      var dy = wp.y - ly;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
    }
    return -1;
  };


  proto.setHoverLocation = function (idx) {
    if (this._hoverLocationIdx !== idx) {
      this._hoverLocationIdx = idx;
      this.draw();
    }
  };

  // -- Empty state rendering --

  proto.drawEmptyState = function (message) {
    this._syncBackingScale();
    var ctx = this.ctx;
    var dpr = this._dpr || globalThis.devicePixelRatio || 1;
    var size = this._canvasCssSize();
    var w = size.w;
    var h = size.h;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30,30,30,0.8)';
    ctx.fillRect(0, 0, w, h);

    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message || 'No world map configured', w / 2, h / 2);
    ctx.restore();
  };

  // -- Cleanup --

  proto._listen = function (target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this._listeners.push([target, type, callback, options]);
  };

  proto.destroy = function () {
    this._bgImageLoadId++;
    this._listeners.forEach(function (entry) { entry[0].removeEventListener(entry[1], entry[2], entry[3]); });
    this._listeners = [];
    this._isPanning = false;
    this._destroyed = true;
    this.stopSpriteAnimation();
  };

  // -- Create blank terrain grid --

  WorldMapCanvas.blankGrid = function (w, h, fillType) {
    var fill = fillType || 'grass';
    var grid = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) {
        row.push(fill);
      }
      grid.push(row);
    }
    return grid;
  };

  return WorldMapCanvas;

})();
export { WorldMapCanvas };
