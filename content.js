(function () {
  'use strict';
  if (window.__doodleOverlayLoaded) return;
  window.__doodleOverlayLoaded = true;

  /* ── 狀態 ── */
  let active   = false;
  let drawing  = false;
  let dragging = false;
  let dragOffX = 0, dragOffY = 0;
  let tool     = 'pen';
  let penColor = '#ef4444';
  let penSize  = 5;
  let snapshots = [];
  let lastX = 0, lastY = 0;
  let arrowStartX = 0, arrowStartY = 0;
  let arrowPreviewSnap = null;
  let whiteMode = false;

  const COLORS = [
    '#ef4444','#f97316','#eab308','#22c55e',
    '#3b82f6','#a855f7','#ec4899','#14b8a6',
    '#ffffff','#111111',
  ];

  /* ── Canvas ── */
  const canvas = document.createElement('canvas');
  canvas.id = '__doodle_canvas';
  canvas.style.cssText = 'position:absolute!important;top:0!important;left:0!important;' +
    'z-index:2147483646!important;' +
    'pointer-events:none!important;cursor:crosshair!important;touch-action:none!important;';

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /* ── Laser Canvas ── */
  const laserCanvas = document.createElement('canvas');
  laserCanvas.id = '__doodle_laser';
  laserCanvas.style.cssText = 'position:absolute!important;top:0!important;left:0!important;' +
    'z-index:2147483647!important;pointer-events:none!important;';
  const laserCtx = laserCanvas.getContext('2d');
  let laserTrail = [];
  let laserX = -999, laserY = -999;
  let laserAnimId = null;
  let laserMode = false;

  function fitLaserCanvas() {
    const [w, h] = getDocSize();
    laserCanvas.width = w;
    laserCanvas.height = h;
  }

  function animateLaser() {
    const now = Date.now();
    laserTrail = laserTrail.filter(p => now - p.t < 1000);
    laserCtx.clearRect(0, 0, laserCanvas.width, laserCanvas.height);

    if (laserTrail.length > 1) {
      // Draw smooth bezier trail with per-segment fading
      for (let i = 1; i < laserTrail.length; i++) {
        const p0 = laserTrail[i - 1];
        const p1 = laserTrail[i];
        const age = (now - p1.t) / 1000;
        const alpha = (1 - age) * 0.9;
        const width = Math.max(0.5, 4 * (1 - age * 0.6));
        const mx0 = (p0.x + p1.x) / 2;
        const my0 = (p0.y + p1.y) / 2;
        const prev = laserTrail[i - 2];
        const startX = prev ? (p0.x + prev.x) / 2 : p0.x;
        const startY = prev ? (p0.y + prev.y) / 2 : p0.y;
        laserCtx.beginPath();
        laserCtx.moveTo(startX, startY);
        laserCtx.quadraticCurveTo(p0.x, p0.y, mx0, my0);
        laserCtx.strokeStyle = `rgba(255,0,0,${alpha})`;
        laserCtx.lineWidth = width;
        laserCtx.lineCap = 'round';
        laserCtx.lineJoin = 'round';
        laserCtx.stroke();
      }
    }

    if (laserMode && laserX > -999) {
      laserCtx.beginPath();
      laserCtx.arc(laserX, laserY, 12, 0, Math.PI * 2);
      laserCtx.fillStyle = 'rgba(255,200,0,0.8)';
      laserCtx.fill();
      laserCtx.beginPath();
      laserCtx.arc(laserX, laserY, 6, 0, Math.PI * 2);
      laserCtx.fillStyle = 'rgb(255,0,0)';
      laserCtx.fill();
    }

    if (laserMode || laserTrail.length > 0) {
      laserAnimId = requestAnimationFrame(animateLaser);
    } else {
      laserAnimId = null;
      laserCtx.clearRect(0, 0, laserCanvas.width, laserCanvas.height);
    }
  }

  function toggleLaser() {
    laserMode = !laserMode;
    if (laserMode) {
      if (!active) toggle();
      fitLaserCanvas();
      if (!laserAnimId) laserAnimId = requestAnimationFrame(animateLaser);
      fab.textContent = '🔴';
      fab.style.setProperty('background', 'rgba(180,0,0,0.88)', 'important');
    } else {
      laserX = -999; laserY = -999;
      fab.textContent = '✏️';
      fab.style.setProperty('background', active ? 'rgba(99,102,241,0.92)' : 'rgba(25,25,35,0.85)', 'important');
    }
  }

  function getDocSize() {
    return [
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, window.innerWidth),
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, window.innerHeight)
    ];
  }

  function fitCanvas() {
    const [w, h] = getDocSize();
    if (canvas.width === w && canvas.height === h) return;
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(tmp, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('scroll', () => {
    const [w, h] = getDocSize();
    if (canvas.width < w || canvas.height < h) fitCanvas();
  });

  /* ── FAB ── */
  const fab = document.createElement('button');
  fab.id = '__doodle_fab';
  fab.title = '塗鴉白板';
  fab.textContent = '✏️';
  fab.style.cssText = 'all:unset!important;position:fixed!important;bottom:18px!important;' +
    'right:18px!important;z-index:2147483647!important;width:46px!important;height:46px!important;' +
    'border-radius:50%!important;background:rgba(25,25,35,0.85)!important;color:#fff!important;' +
    'font-size:20px!important;cursor:pointer!important;line-height:46px!important;' +
    'text-align:center!important;box-shadow:0 3px 14px rgba(0,0,0,0.45)!important;' +
    'display:block!important;transition:background .2s!important;';

  /* ── Toolbar（直式 + 可拖拉） ── */
  const bar = document.createElement('div');
  bar.id = '__doodle_bar';

  function B(extra) { return `all:unset;box-sizing:border-box;${extra}`; }

  const colorGrid = COLORS.map(c =>
    `<span data-dcolor="${c}" style="${B(
      `display:block;width:20px;height:20px;border-radius:50%;background:${c};` +
      `cursor:pointer;border:2px solid ${c === penColor ? '#fff' : 'transparent'};`
    )}"></span>`
  ).join('');

  const btnBase = `all:unset;box-sizing:border-box;background:transparent;border:none;` +
    `color:#fff;padding:6px;border-radius:7px;cursor:pointer;font-size:17px;line-height:1;` +
    `display:block;width:100%;text-align:center;`;

  bar.innerHTML = `
    <div id="__doodle_inner" style="${B(
      'display:flex;flex-direction:column;align-items:center;gap:6px;' +
      'padding:8px 7px;background:rgba(18,18,28,0.93);border-radius:14px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.55);' +
      'font-family:system-ui,sans-serif;font-size:12px;color:#fff;' +
      'user-select:none;backdrop-filter:blur(10px);' +
      'border:1px solid rgba(255,255,255,0.1);min-width:42px;'
    )}">
      <!-- 拖拉把手 -->
      <div id="__doodle_drag" style="${B(
        'cursor:grab;color:rgba(255,255,255,0.4);font-size:14px;' +
        'width:100%;text-align:center;padding:2px 0;letter-spacing:1px;'
      )}" title="拖拉移動">⠿</div>

      <!-- 工具 -->
      <button data-dtool="pen"       title="筆刷 (P)"  style="${btnBase}background:#3b82f6;border-radius:7px;">✏️</button>
      <button data-dtool="highlight" title="螢光筆 (H)" style="${btnBase}">🟡</button>
      <button data-dtool="arrow"     title="箭頭 (A)"  style="${btnBase}">➡️</button>
      <button data-dtool="eraser"    title="橡皮擦 (E)" style="${btnBase}">🧹</button>
      <button id="__doodle_laser_btn" title="雷射光點 (L)" style="${btnBase}">🔴</button>

      <span style="${B('width:80%;height:1px;background:rgba(255,255,255,0.15);display:block;')}"></span>

      <!-- 顏色格 2x4 -->
      <div style="${B('display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;')}">
        ${colorGrid}
      </div>

      <span style="${B('width:80%;height:1px;background:rgba(255,255,255,0.15);display:block;')}"></span>

      <!-- 粗細 -->
      <input id="__doodle_size" type="range" min="2" max="32" value="${penSize}"
        style="${B('writing-mode:vertical-lr;direction:rtl;height:64px;' +
                   'accent-color:#60a5fa;cursor:pointer;' +
                   'background:rgba(255,255,255,0.15);border-radius:6px;padding:4px;')}">
      <span id="__doodle_sizeval" style="${B('color:#e2e8f0;font-size:11px;font-weight:600;')}">
        ${penSize}px</span>

      <span style="${B('width:80%;height:1px;background:rgba(255,255,255,0.15);display:block;')}"></span>

      <!-- 動作 -->
      <button id="__doodle_undo"  title="復原 (Ctrl+Z)" style="${btnBase}">↩️</button>
      <button id="__doodle_clear" title="清除全部"       style="${btnBase}">🗑️</button>
      <button id="__doodle_close" title="關閉 (Alt+Shift+D)" style="${btnBase}background:#ef4444;border-radius:7px;font-size:13px;font-weight:700;">✕</button>
    </div>
  `;

  bar.style.cssText = 'all:unset!important;position:fixed!important;' +
    'top:80px!important;right:18px!important;' +
    'z-index:2147483647!important;display:none!important;';

  /* ── DOM 掛載 ── */
  document.body.appendChild(canvas);
  document.body.appendChild(laserCanvas);
  document.body.appendChild(bar);
  document.body.appendChild(fab);
  fitCanvas();

  /* ── 拖拉邏輯 ── */
  const dragHandle = bar.querySelector('#__doodle_drag');

  dragHandle.addEventListener('mousedown', e => {
    dragging = true;
    const rect = bar.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    dragHandle.style.cursor = 'grabbing';
    e.stopPropagation();
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const x = e.clientX - dragOffX;
    const y = e.clientY - dragOffY;
    bar.style.setProperty('left',   x + 'px', 'important');
    bar.style.setProperty('top',    y + 'px', 'important');
    bar.style.setProperty('right',  'auto',   'important');
    bar.style.setProperty('bottom', 'auto',   'important');
  });

  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; dragHandle.style.cursor = 'grab'; }
  });

  /* ── FAB 拖拉邏輯 ── */
  let fabDragging = false;
  let fabOffX = 0, fabOffY = 0;

  fab.addEventListener('mousedown', e => {
    fabDragging = true;
    const rect = fab.getBoundingClientRect();
    fabOffX = e.clientX - rect.left;
    fabOffY = e.clientY - rect.top;
    fab.style.cursor = 'grabbing';
    e.stopPropagation();
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!fabDragging) return;
    const x = e.clientX - fabOffX;
    const y = e.clientY - fabOffY;
    fab.style.setProperty('left',   x + 'px', 'important');
    fab.style.setProperty('top',    y + 'px', 'important');
    fab.style.setProperty('right',  'auto',   'important');
    fab.style.setProperty('bottom', 'auto',   'important');
  });

  document.addEventListener('mouseup', () => {
    if (fabDragging) { fabDragging = false; fab.style.cursor = 'pointer'; }
  });

  /* ── 繪圖邏輯 ── */
  function getCtxPos(cx, cy) {
    return [cx + window.scrollX, cy + window.scrollY];
  }

  function drawArrow(x1, y1, x2, y2) {
    const headLen = Math.max(12, penSize * 3);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    applyStyle();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function startDraw(cx, cy) {
    if (dragging) return;
    drawing = true;
    [lastX, lastY] = getCtxPos(cx, cy);
    snapshots.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (snapshots.length > 40) snapshots.shift();
    if (tool === 'arrow') {
      arrowStartX = lastX;
      arrowStartY = lastY;
      arrowPreviewSnap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    applyStyle();
  }

  function applyStyle() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.lineWidth = penSize * 4;
    } else if (tool === 'highlight') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
    }
  }

  function moveDraw(cx, cy) {
    if (!drawing) return;
    const [x, y] = getCtxPos(cx, cy);
    if (tool === 'arrow') {
      ctx.putImageData(arrowPreviewSnap, 0, 0);
      drawArrow(arrowStartX, arrowStartY, x, y);
      return;
    }
    const mx = (x + lastX) / 2, my = (y + lastY) / 2;
    ctx.quadraticCurveTo(lastX, lastY, mx, my);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my);
    lastX = x; lastY = y;
  }

  function endDraw(cx, cy) {
    if (!drawing) return;
    if (tool === 'arrow' && cx !== undefined && cy !== undefined) {
      const [x, y] = getCtxPos(cx, cy);
      ctx.putImageData(arrowPreviewSnap, 0, 0);
      drawArrow(arrowStartX, arrowStartY, x, y);
      arrowPreviewSnap = null;
    }
    drawing = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  document.addEventListener('mousemove', e => {
    if (!laserMode) return;
    laserX = e.clientX + window.scrollX;
    laserY = e.clientY + window.scrollY;
    laserTrail.push({ x: laserX, y: laserY, t: Date.now() });
    if (laserTrail.length > 300) laserTrail.shift();
  });

  canvas.addEventListener('mousedown',  e => { e.preventDefault(); startDraw(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove',  e => moveDraw(e.clientX, e.clientY));
  canvas.addEventListener('mouseup',    e => endDraw(e.clientX, e.clientY));
  canvas.addEventListener('mouseleave', e => endDraw(e.clientX, e.clientY));

  canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; startDraw(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; moveDraw(t.clientX, t.clientY); },  { passive: false });
  canvas.addEventListener('touchend',   e => { const t = e.changedTouches[0]; endDraw(t.clientX, t.clientY); });

  /* ── 切換 ── */
  function setTool(t) {
    tool = t;
    bar.querySelectorAll('[data-dtool]').forEach(b => {
      b.style.background = b.dataset.dtool === t ? '#3b82f6' : 'transparent';
    });
  }

  function toggle() {
    active = !active;
    canvas.style.setProperty('pointer-events', active ? 'all' : 'none', 'important');
    bar.style.setProperty('display', active ? 'block' : 'none', 'important');
    fab.textContent = '✏️';
    fab.style.setProperty('background', active ? 'rgba(99,102,241,0.92)' : 'rgba(25,25,35,0.85)', 'important');
    fab.style.setProperty('box-shadow', active ? '0 0 0 3px rgba(99,102,241,0.5),0 3px 14px rgba(0,0,0,0.45)' : '0 3px 14px rgba(0,0,0,0.45)', 'important');
    // 離開塗鴉模式時清除所有塗鴉
    if (!active) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      snapshots = [];
    }
  }

  fab.addEventListener('click', e => { e.stopPropagation(); toggle(); });

  function toggleWhiteMode() {
    whiteMode = !whiteMode;
    if (whiteMode) {
      if (!active) toggle();
      snapshots.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (snapshots.length > 40) snapshots.shift();
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      fab.style.setProperty('background', 'rgba(200,200,200,0.92)', 'important');
      fab.textContent = '📋';
    } else {
      if (active) toggle();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      snapshots = [];
      fab.textContent = '✏️';
    }
  }

  /* ── Toolbar 互動 ── */
  bar.addEventListener('click', e => {
    e.stopPropagation();
    const toolBtn = e.target.closest('[data-dtool]');
    if (toolBtn) { setTool(toolBtn.dataset.dtool); return; }

    const dot = e.target.closest('[data-dcolor]');
    if (dot) {
      penColor = dot.dataset.dcolor;
      bar.querySelectorAll('[data-dcolor]').forEach(d =>
        d.style.border = `2px solid ${d.dataset.dcolor === penColor ? '#fff' : 'transparent'}`
      );
      if (tool === 'eraser') setTool('pen');
      return;
    }

    const id = e.target.id;
    if (id === '__doodle_undo')  { if (snapshots.length) ctx.putImageData(snapshots.pop(), 0, 0); return; }
    if (id === '__doodle_clear') { ctx.clearRect(0, 0, canvas.width, canvas.height); snapshots = []; return; }
    if (id === '__doodle_laser_btn') { toggleLaser(); return; }
    if (id === '__doodle_close') { toggle(); return; }
  });

  const sizeSlider = bar.querySelector('#__doodle_size');
  const sizeLabel  = bar.querySelector('#__doodle_sizeval');
  sizeSlider.addEventListener('input', () => {
    penSize = +sizeSlider.value;
    sizeLabel.textContent = `${penSize}px`;
  });

  /* ── 鍵盤快捷鍵 ── */
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'w' || e.key === 'W') { e.preventDefault(); toggleWhiteMode(); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); toggleLaser(); return; }
      if (e.key === 'p' || e.key === 'P') { setTool('pen'); return; }
      if (e.key === 'h' || e.key === 'H') { setTool('highlight'); return; }
      if (e.key === 'a' || e.key === 'A') { setTool('arrow'); return; }
      if (e.key === 'e' || e.key === 'E') { setTool('eraser'); return; }
      if (e.key === 'c' || e.key === 'C') { ctx.clearRect(0, 0, canvas.width, canvas.height); snapshots = []; return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (snapshots.length) ctx.putImageData(snapshots.pop(), 0, 0);
    }
  });

})();
