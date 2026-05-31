// --- Feature flags ---
const FLAGS = {
  DEBUG: new URLSearchParams(window.location.search).has("debug"),
};

function dbg(...args) {
  if (FLAGS.DEBUG) console.log("[doodle2svg]", ...args);
}

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById("work-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const controls = document.getElementById("controls");
const previewSection = document.getElementById("preview-section");
const previewGrid = document.getElementById("preview-grid");
const resultTitle = document.getElementById("result-title");
const btnDownloadAll = document.getElementById("btn-download-all");
const thresholdInput = document.getElementById("threshold");
const thresholdVal = document.getElementById("threshold-val");
const minSizeInput = document.getElementById("min-size");
const minSizeVal = document.getElementById("min-size-val");
const groupDistInput = document.getElementById("group-dist");
const groupDistVal = document.getElementById("group-dist-val");
const paddingInput = document.getElementById("padding");
const paddingVal = document.getElementById("padding-val");

let loadedImage = null;
let generatedSVGs = [];

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
  dbg("file selected:", file.name, file.type, `${(file.size / 1024).toFixed(1)}KB`);
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      loadedImage = img;
      dbg("image loaded:", img.naturalWidth, "x", img.naturalHeight);
      showImagePreview(e.target.result);
      controls.classList.remove("hidden");
      previewSection.classList.add("hidden");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showImagePreview(src) {
  uploadZone.classList.add("has-image");
  const existing = uploadZone.querySelector("img");
  if (existing) existing.remove();
  const img = document.createElement("img");
  img.src = src;
  uploadZone.appendChild(img);
}

// --- Slider labels ---

thresholdInput.addEventListener("input", () => {
  thresholdVal.textContent = thresholdInput.value;
});
minSizeInput.addEventListener("input", () => {
  minSizeVal.textContent = minSizeInput.value;
});
groupDistInput.addEventListener("input", () => {
  groupDistVal.textContent = groupDistInput.value;
});
paddingInput.addEventListener("input", () => {
  paddingVal.textContent = paddingInput.value;
});

// --- Buttons ---

document.getElementById("btn-single").addEventListener("click", traceWhole);
document.getElementById("btn-split").addEventListener("click", autoSplit);
document.getElementById("btn-reset").addEventListener("click", resetApp);
btnDownloadAll.addEventListener("click", downloadAllZip);

// --- Trace whole page ---

function traceWhole() {
  if (!loadedImage) return;
  showSpinner("Tracing...");

  setTimeout(() => {
    try {
      dbg("traceWhole: threshold =", thresholdInput.value);
      const t0 = performance.now();
      const binarized = getBinarizedCanvas(loadedImage);
      dbg("binarize done:", (performance.now() - t0).toFixed(1), "ms");
      const svgStr = traceCanvas(binarized);
      dbg("trace done:", (performance.now() - t0).toFixed(1), "ms, SVG size:", svgStr.length, "chars");
      generatedSVGs = [{ name: "doodle.svg", svg: svgStr }];
      renderResults(true);
    } catch (err) {
      console.error("traceWhole failed:", err);
      alert("Tracing failed: " + err.message);
    } finally {
      hideSpinner();
    }
  }, 50);
}

// --- Auto-split ---

function autoSplit() {
  if (!loadedImage) return;
  showSpinner("Detecting icons...");

  setTimeout(() => {
    try {
      const threshold = parseInt(thresholdInput.value);
      const minSize = parseInt(minSizeInput.value);
      const groupDist = parseInt(groupDistInput.value);
      const pad = parseInt(paddingInput.value);

      dbg("autoSplit: threshold =", threshold, "minSize =", minSize, "groupDist =", groupDist, "pad =", pad);
      const t0 = performance.now();

      // Draw and binarize
      canvas.width = loadedImage.naturalWidth;
      canvas.height = loadedImage.naturalHeight;
      ctx.drawImage(loadedImage, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const binary = binarize(imageData, threshold);
      dbg("binarize done:", (performance.now() - t0).toFixed(1), "ms");

      // Connected components
      const bboxes = findConnectedComponents(
        binary,
        canvas.width,
        canvas.height,
        minSize
      );
      dbg("connected components:", bboxes.length, "found in", (performance.now() - t0).toFixed(1), "ms");
      if (FLAGS.DEBUG) bboxes.forEach((b, i) => dbg(`  cc[${i}]:`, b));

      // Merge nearby bboxes using group distance
      const merged = mergeBBoxes(bboxes, groupDist);
      dbg("after merge:", merged.length, "icons");
      if (FLAGS.DEBUG) merged.forEach((b, i) => dbg(`  icon[${i}]:`, b));

      if (merged.length === 0) {
        hideSpinner();
        alert("No icons detected. Try lowering the threshold or min size.");
        return;
      }

      showSpinner(`Tracing ${merged.length} icon${merged.length > 1 ? "s" : ""}...`);

      setTimeout(() => {
        try {
          generatedSVGs = [];

          merged.forEach((box, i) => {
            const x = Math.max(0, box.x - pad);
            const y = Math.max(0, box.y - pad);
            const w = Math.min(canvas.width - x, box.w + pad * 2);
            const h = Math.min(canvas.height - y, box.h + pad * 2);

            // Extract region
            const regionCanvas = document.createElement("canvas");
            regionCanvas.width = w;
            regionCanvas.height = h;
            const rctx = regionCanvas.getContext("2d");
            rctx.drawImage(loadedImage, x, y, w, h, 0, 0, w, h);

            const binarized = getBinarizedCanvas(
              regionCanvas,
              parseInt(thresholdInput.value)
            );
            const svgStr = traceCanvas(binarized);
            dbg(`icon ${i + 1}: region ${w}x${h} at (${x},${y}), SVG ${svgStr.length} chars`);
            generatedSVGs.push({
              name: `icon-${String(i + 1).padStart(2, "0")}.svg`,
              svg: svgStr,
            });
          });

          renderResults(false);
        } catch (err) {
          console.error("autoSplit tracing failed:", err);
          alert("Tracing failed: " + err.message);
        } finally {
          hideSpinner();
        }
      }, 50);
    } catch (err) {
      console.error("autoSplit detection failed:", err);
      alert("Detection failed: " + err.message);
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

function binarize(imageData, threshold) {
  const d = imageData.data;
  const out = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0; i < out.length; i++) {
    const off = i * 4;
    const gray = d[off] * 0.299 + d[off + 1] * 0.587 + d[off + 2] * 0.114;
    out[i] = gray < threshold ? 1 : 0;
  }
  return out;
}

// --- Connected component labeling (two-pass) ---

function findConnectedComponents(binary, w, h, minSize) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  let nextLabel = 1;

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a, b) {
    a = find(a);
    b = find(b);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }

  // First pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (binary[idx] === 0) continue;

      const neighbors = [];
      if (x > 0 && labels[idx - 1] > 0) neighbors.push(labels[idx - 1]);
      if (y > 0 && labels[idx - w] > 0) neighbors.push(labels[idx - w]);
      if (x > 0 && y > 0 && labels[idx - w - 1] > 0)
        neighbors.push(labels[idx - w - 1]);
      if (x < w - 1 && y > 0 && labels[idx - w + 1] > 0)
        neighbors.push(labels[idx - w + 1]);

      if (neighbors.length === 0) {
        labels[idx] = nextLabel;
        parent.push(nextLabel);
        nextLabel++;
      } else {
        const minLabel = Math.min(...neighbors);
        labels[idx] = minLabel;
        for (const n of neighbors) union(n, minLabel);
      }
    }
  }

  // Second pass — collect bounding boxes
  const boxes = {};
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] === 0) continue;
      const root = find(labels[idx]);
      if (!boxes[root]) {
        boxes[root] = { minX: x, minY: y, maxX: x, maxY: y, pixels: 0 };
      }
      const b = boxes[root];
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
      b.pixels++;
    }
  }

  // Filter by min size
  const result = [];
  for (const key of Object.keys(boxes)) {
    const b = boxes[key];
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    if (bw >= minSize || bh >= minSize) {
      result.push({ x: b.minX, y: b.minY, w: bw, h: bh });
    }
  }

  return result;
}

// --- Merge nearby bounding boxes ---

function mergeBBoxes(boxes, groupDist) {
  if (boxes.length === 0) return [];

  // Expand each box by groupDist to find nearby components, merge overlapping, shrink back
  let expanded = boxes.map((b) => ({
    x: b.x - groupDist,
    y: b.y - groupDist,
    w: b.w + groupDist * 2,
    h: b.h + groupDist * 2,
  }));

  let changed = true;
  while (changed) {
    changed = false;
    const merged = [];
    const used = new Set();

    for (let i = 0; i < expanded.length; i++) {
      if (used.has(i)) continue;
      let current = { ...expanded[i] };

      for (let j = i + 1; j < expanded.length; j++) {
        if (used.has(j)) continue;
        if (overlaps(current, expanded[j])) {
          current = unionBox(current, expanded[j]);
          used.add(j);
          changed = true;
        }
      }
      merged.push(current);
    }
    expanded = merged;
  }

  // Shrink back to tight bounding boxes
  return expanded.map((b) => ({
    x: b.x + groupDist,
    y: b.y + groupDist,
    w: b.w - groupDist * 2,
    h: b.h - groupDist * 2,
  }));
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

// --- SVG tracing via imagetracerjs ---

function traceCanvas(inputCanvas) {
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
  return svgStr;
}

// --- Render results ---

function renderResults(isSingle) {
  previewGrid.innerHTML = "";
  previewSection.classList.remove("hidden");

  if (isSingle) {
    resultTitle.textContent = "Traced SVG";
    btnDownloadAll.classList.add("hidden");
  } else {
    resultTitle.textContent = `${generatedSVGs.length} Icons Detected`;
    btnDownloadAll.classList.toggle("hidden", generatedSVGs.length <= 1);
  }

  generatedSVGs.forEach((item, i) => {
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
    dlBtn.addEventListener("click", () => downloadSVG(item.name, item.svg));

    const cpBtn = document.createElement("button");
    cpBtn.className = "btn btn-ghost";
    cpBtn.textContent = "Copy SVG";
    cpBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.svg).then(() => {
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

function downloadSVG(name, svgStr) {
  const blob = new Blob([svgStr], { type: "image/svg+xml" });
  saveAs(blob, name);
}

function downloadAllZip() {
  const zip = new JSZip();
  generatedSVGs.forEach((item) => zip.file(item.name, item.svg));
  zip.generateAsync({ type: "blob" }).then((blob) => {
    saveAs(blob, "doodle-icons.zip");
  });
}

// --- Reset ---

function resetApp() {
  loadedImage = null;
  generatedSVGs = [];
  uploadZone.classList.remove("has-image");
  const img = uploadZone.querySelector("img");
  if (img) img.remove();
  controls.classList.add("hidden");
  previewSection.classList.add("hidden");
  previewGrid.innerHTML = "";
  fileInput.value = "";
}

// --- Spinner ---

function showSpinner(text) {
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
