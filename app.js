// --- Feature flags ---
const FLAGS = {
  DEBUG: new URLSearchParams(window.location.search).has("debug"),
};

function dbg(...args) {
  if (FLAGS.DEBUG) console.log("🖊️", ...args);
}

// --- DOM refs ---

const drawCanvas = document.getElementById("draw-canvas");
const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true });

const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const drawSection = document.getElementById("draw-section");
const drawTitle = document.getElementById("draw-title");
const previewSection = document.getElementById("preview-section");
const previewGrid = document.getElementById("preview-grid");
const resultTitle = document.getElementById("result-title");
const btnDownloadAll = document.getElementById("btn-download-all");
const btnTraceRegions = document.getElementById("btn-trace-regions");
const thresholdInput = document.getElementById("threshold");
const thresholdVal = document.getElementById("threshold-val");
const paddingInput = document.getElementById("padding");
const paddingVal = document.getElementById("padding-val");

let loadedImage = null;
let generatedSVGs = [];
let regions = []; // { x, y, w, h }
let drawing = false;
let lassoPoints = [];

// --- Upload handling ---

uploadZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () =>
  uploadZone.classList.remove("drag-over")
);
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) handleFile(file);
});

function handleFile(file) {
  if (!file) return;
  dbg("📁 file:", file.name, file.type, `${(file.size / 1024).toFixed(1)}KB`);
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      loadedImage = img;
      dbg("🖼️ loaded:", img.naturalWidth, "x", img.naturalHeight);
      regions = [];
      generatedSVGs = [];
      setupDrawCanvas();
      uploadZone.classList.add("hidden");
      drawSection.classList.remove("hidden");
      previewSection.classList.add("hidden");
      updateTitle();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Drawing canvas setup ---

function setupDrawCanvas() {
  drawCanvas.width = loadedImage.naturalWidth;
  drawCanvas.height = loadedImage.naturalHeight;
  dbg("🎨 canvas set:", drawCanvas.width, "x", drawCanvas.height);
  redraw();
}

function redraw() {
  const t0 = performance.now();
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.drawImage(loadedImage, 0, 0);

  const pad = parseInt(paddingInput.value);

  // Draw dim overlay where no region exists, highlight regions
  if (regions.length > 0) {
    drawCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);

    // Cut out regions to show original image
    regions.forEach((r) => {
      const x = Math.max(0, r.x - pad);
      const y = Math.max(0, r.y - pad);
      const w = Math.min(drawCanvas.width - x, r.w + pad * 2);
      const h = Math.min(drawCanvas.height - y, r.h + pad * 2);

      drawCtx.save();
      drawCtx.beginPath();
      drawCtx.roundRect(x, y, w, h, 4);
      drawCtx.clip();
      drawCtx.drawImage(loadedImage, 0, 0);
      drawCtx.restore();
    });
  }

  // Draw region boxes + labels
  regions.forEach((r, i) => {
    const x = Math.max(0, r.x - pad);
    const y = Math.max(0, r.y - pad);
    const w = Math.min(drawCanvas.width - x, r.w + pad * 2);
    const h = Math.min(drawCanvas.height - y, r.h + pad * 2);

    drawCtx.strokeStyle = "#22c55e";
    drawCtx.lineWidth = 3;
    drawCtx.strokeRect(x, y, w, h);

    // Label
    const label = `${i + 1}`;
    drawCtx.font = "bold 16px sans-serif";
    const labelW = drawCtx.measureText(label).width + 10;
    drawCtx.fillStyle = "#22c55e";
    drawCtx.fillRect(x, y - 22, labelW, 22);
    drawCtx.fillStyle = "#000";
    drawCtx.fillText(label, x + 5, y - 6);
  });

  dbg("🎨 redraw:", regions.length, "regions,", (performance.now() - t0).toFixed(1), "ms");
}

function updateTitle() {
  drawTitle.textContent =
    regions.length === 0
      ? "Draw around each icon"
      : `${regions.length} region${regions.length > 1 ? "s" : ""} marked`;
  btnTraceRegions.disabled = regions.length === 0;
}

// --- Canvas pointer: lasso to create, click to delete ---

function getCanvasPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (e.offsetX / rect.width) * drawCanvas.width,
    y: (e.offsetY / rect.height) * drawCanvas.height,
  };
}

function getTouchCanvasPos(touch) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: ((touch.clientX - rect.left) / rect.width) * drawCanvas.width,
    y: ((touch.clientY - rect.top) / rect.height) * drawCanvas.height,
  };
}

drawCanvas.addEventListener("mousedown", (e) => {
  const pos = getCanvasPos(e);
  const pad = parseInt(paddingInput.value);

  // Check if clicking existing region to delete
  const hit = findRegionAt(pos.x, pos.y, pad);
  if (hit >= 0) {
    dbg("🗑️ removed region", hit + 1, ":", regions[hit]);
    regions.splice(hit, 1);
    updateTitle();
    redraw();
    return;
  }

  // Start drawing lasso
  drawing = true;
  lassoPoints = [pos];
  dbg("✏️ lasso start:", Math.round(pos.x), Math.round(pos.y));
});

drawCanvas.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const pos = getCanvasPos(e);
  lassoPoints.push(pos);
  redraw();
  drawLassoPath();
});

drawCanvas.addEventListener("mouseup", () => finishLasso());
drawCanvas.addEventListener("mouseleave", () => {
  if (drawing) finishLasso();
});

// Touch
drawCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const pos = getTouchCanvasPos(e.touches[0]);
  const pad = parseInt(paddingInput.value);

  const hit = findRegionAt(pos.x, pos.y, pad);
  if (hit >= 0) {
    dbg("🗑️ removed region", hit + 1);
    regions.splice(hit, 1);
    updateTitle();
    redraw();
    return;
  }

  drawing = true;
  lassoPoints = [pos];
});

drawCanvas.addEventListener("touchmove", (e) => {
  if (!drawing) return;
  e.preventDefault();
  const pos = getTouchCanvasPos(e.touches[0]);
  lassoPoints.push(pos);
  redraw();
  drawLassoPath();
});

drawCanvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  finishLasso();
});

function findRegionAt(x, y, pad) {
  // Search in reverse so topmost region is found first
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    const rx = r.x - pad;
    const ry = r.y - pad;
    const rw = r.w + pad * 2;
    const rh = r.h + pad * 2;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return i;
  }
  return -1;
}

function drawLassoPath() {
  if (lassoPoints.length < 2) return;
  drawCtx.strokeStyle = "#a78bfa";
  drawCtx.lineWidth = 3;
  drawCtx.setLineDash([8, 5]);
  drawCtx.beginPath();
  drawCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  for (let i = 1; i < lassoPoints.length; i++) {
    drawCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
  }
  drawCtx.closePath();
  drawCtx.stroke();
  drawCtx.setLineDash([]);

  // Fill with translucent accent
  drawCtx.fillStyle = "rgba(167, 139, 250, 0.1)";
  drawCtx.fill();
}

function finishLasso() {
  if (!drawing) return;
  drawing = false;

  if (lassoPoints.length < 10) {
    dbg("✏️ lasso too short, ignored:", lassoPoints.length, "points");
    lassoPoints = [];
    redraw();
    return;
  }

  // Convert to bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of lassoPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const region = {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
  };

  // Ignore tiny regions (accidental clicks)
  if (region.w < 20 || region.h < 20) {
    dbg("✏️ region too small, ignored:", region.w, "x", region.h);
    lassoPoints = [];
    redraw();
    return;
  }

  dbg("🎯 region added:", `${region.w}x${region.h} at (${region.x},${region.y})`);
  regions.push(region);
  lassoPoints = [];
  updateTitle();
  redraw();
}

// --- Slider labels ---

thresholdInput.addEventListener("input", () => {
  thresholdVal.textContent = thresholdInput.value;
});
paddingInput.addEventListener("input", () => {
  paddingVal.textContent = paddingInput.value;
  redraw();
});

// --- Buttons ---

document.getElementById("btn-undo").addEventListener("click", () => {
  if (regions.length === 0) return;
  const removed = regions.pop();
  dbg("↩️ undo: removed region", regions.length + 1, removed);
  updateTitle();
  redraw();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  dbg("🧹 clear all:", regions.length, "regions removed");
  regions = [];
  updateTitle();
  redraw();
});

document.getElementById("btn-trace-whole").addEventListener("click", traceWhole);
btnTraceRegions.addEventListener("click", traceRegions);
btnDownloadAll.addEventListener("click", downloadAllZip);

document.getElementById("btn-new-image").addEventListener("click", () => {
  dbg("🔄 new image");
  loadedImage = null;
  regions = [];
  generatedSVGs = [];
  uploadZone.classList.remove("hidden");
  drawSection.classList.add("hidden");
  previewSection.classList.add("hidden");
  fileInput.value = "";
});

document.getElementById("btn-back-draw").addEventListener("click", () => {
  dbg("⬅️ back to drawing");
  previewSection.classList.add("hidden");
  drawSection.classList.remove("hidden");
  redraw();
});

// --- Trace whole page ---

function traceWhole() {
  if (!loadedImage) return;
  dbg("🔄 traceWhole: full-page trace starting");
  showSpinner("Tracing whole page...");

  setTimeout(() => {
    try {
      const t0 = performance.now();
      dbg("⚙️ threshold =", thresholdInput.value);
      const binarized = getBinarizedCanvas(loadedImage);
      dbg("⬛ binarize done:", (performance.now() - t0).toFixed(1), "ms");
      const svgStr = traceCanvas(binarized);
      dbg("✅ trace done:", (performance.now() - t0).toFixed(1), "ms, SVG:", svgStr.length, "chars");
      generatedSVGs = [{ name: "doodle.svg", svg: svgStr }];
      drawSection.classList.add("hidden");
      renderResults(true);
    } catch (err) {
      console.error("❌ traceWhole failed:", err);
      alert("Tracing failed: " + err.message);
    } finally {
      hideSpinner();
    }
  }, 50);
}

// --- Trace marked regions ---

function traceRegions() {
  if (regions.length === 0) return;
  dbg("🔄 traceRegions:", regions.length, "regions to trace");
  showSpinner(`Tracing ${regions.length} region${regions.length > 1 ? "s" : ""}...`);

  setTimeout(() => {
    try {
      const pad = parseInt(paddingInput.value);
      const threshold = parseInt(thresholdInput.value);
      const t0 = performance.now();
      generatedSVGs = [];

      regions.forEach((box, i) => {
        const x = Math.max(0, box.x - pad);
        const y = Math.max(0, box.y - pad);
        const w = Math.min(loadedImage.naturalWidth - x, box.w + pad * 2);
        const h = Math.min(loadedImage.naturalHeight - y, box.h + pad * 2);

        dbg(`⚙️ region ${i + 1}/${regions.length}: extracting ${w}x${h} at (${x},${y})`);

        const regionCanvas = document.createElement("canvas");
        regionCanvas.width = w;
        regionCanvas.height = h;
        const rctx = regionCanvas.getContext("2d");
        rctx.drawImage(loadedImage, x, y, w, h, 0, 0, w, h);

        const binarized = getBinarizedCanvas(regionCanvas, threshold);
        const svgStr = traceCanvas(binarized);
        dbg(`✅ region ${i + 1}: SVG ${svgStr.length} chars, ${(performance.now() - t0).toFixed(1)}ms elapsed`);

        generatedSVGs.push({
          name: `icon-${String(i + 1).padStart(2, "0")}.svg`,
          svg: svgStr,
        });
      });

      dbg(`🎉 all done: ${regions.length} regions in ${(performance.now() - t0).toFixed(1)}ms`);
      drawSection.classList.add("hidden");
      renderResults(false);
    } catch (err) {
      console.error("❌ traceRegions failed:", err);
      alert("Tracing failed: " + err.message);
    } finally {
      hideSpinner();
    }
  }, 50);
}

// --- Image processing ---

function getBinarizedCanvas(source, thresh) {
  const t = thresh || parseInt(thresholdInput.value);
  const isCanvas = source instanceof HTMLCanvasElement;
  const w = isCanvas ? source.width : source.naturalWidth;
  const h = isCanvas ? source.height : source.naturalHeight;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tctx = tempCanvas.getContext("2d");

  if (isCanvas) {
    tctx.drawImage(source, 0, 0);
  } else {
    tctx.drawImage(source, 0, 0, w, h);
  }

  const imgData = tctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const val = gray < t ? 0 : 255;
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
    d[i + 3] = 255;
  }

  tctx.putImageData(imgData, 0, 0);
  return tempCanvas;
}

// --- SVG tracing via imagetracerjs ---

function traceCanvas(inputCanvas) {
  dbg("🖊️ tracing canvas:", inputCanvas.width, "x", inputCanvas.height);
  const t0 = performance.now();
  const imgd = inputCanvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, inputCanvas.width, inputCanvas.height);

  const options = ImageTracer.optionpresets.default;
  options.numberofcolors = 2;
  options.mincolorratio = 0;
  options.colorquantcycles = 1;
  options.blurradius = 0;
  options.strokewidth = 0;
  options.scale = 1;

  const traceData = ImageTracer.imagedataToTracedata(imgd, options);
  const svgStr = ImageTracer.getsvgstring(traceData, options);
  dbg("🖊️ traced:", svgStr.length, "chars in", (performance.now() - t0).toFixed(1), "ms");
  return svgStr;
}

// --- Render results ---

function renderResults(isSingle) {
  dbg("📊 rendering:", generatedSVGs.length, "SVGs");
  previewGrid.innerHTML = "";
  previewSection.classList.remove("hidden");

  if (isSingle) {
    resultTitle.textContent = "Traced SVG";
    btnDownloadAll.classList.add("hidden");
  } else {
    resultTitle.textContent = `${generatedSVGs.length} Icons Traced`;
    btnDownloadAll.classList.toggle("hidden", generatedSVGs.length <= 1);
  }

  generatedSVGs.forEach((item) => {
    const card = document.createElement("div");
    card.className = "preview-card" + (isSingle ? " full-width" : "");

    const preview = document.createElement("div");
    preview.className = "svg-preview";
    preview.innerHTML = item.svg;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const dlBtn = document.createElement("button");
    dlBtn.className = "btn btn-primary";
    dlBtn.textContent = "Download SVG";
    dlBtn.addEventListener("click", () => {
      dbg("💾 download:", item.name);
      const blob = new Blob([item.svg], { type: "image/svg+xml" });
      saveAs(blob, item.name);
    });

    const cpBtn = document.createElement("button");
    cpBtn.className = "btn btn-ghost";
    cpBtn.textContent = "Copy SVG";
    cpBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.svg).then(() => {
        dbg("📋 copied:", item.name);
        cpBtn.textContent = "Copied!";
        setTimeout(() => (cpBtn.textContent = "Copy SVG"), 1500);
      });
    });

    actions.appendChild(dlBtn);
    actions.appendChild(cpBtn);
    card.appendChild(preview);
    card.appendChild(actions);
    previewGrid.appendChild(card);
  });

  previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- Downloads ---

function downloadAllZip() {
  dbg("💾 zip download:", generatedSVGs.length, "files");
  const zip = new JSZip();
  generatedSVGs.forEach((item) => zip.file(item.name, item.svg));
  zip.generateAsync({ type: "blob" }).then((blob) => {
    saveAs(blob, "doodle-icons.zip");
  });
}

// --- Spinner ---

function showSpinner(text) {
  dbg("⏳", text);
  const overlay = document.createElement("div");
  overlay.className = "spinner-overlay";
  overlay.id = "spinner";
  overlay.innerHTML = `<div class="spinner"></div><p class="spinner-text">${text}</p>`;
  document.body.appendChild(overlay);
}

function hideSpinner() {
  const el = document.getElementById("spinner");
  if (el) el.remove();
}
