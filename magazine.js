const PDF_URL = "assets/magazine.pdf";

// page-flip renders its pages onto internal <canvas> elements sized to plain
// CSS pixels, so on retina screens the raster is 1x and looks soft. Patch
// HTMLCanvasElement so any canvas it creates gets a devicePixelRatio-sized
// backing store while keeping the same logical width/height API it expects.
function enableCanvasHiDPI(dpr) {
  if (dpr <= 1 || enableCanvasHiDPI.applied) return;
  enableCanvasHiDPI.applied = true;
  const proto = HTMLCanvasElement.prototype;
  const widthDesc = Object.getOwnPropertyDescriptor(proto, "width");
  const heightDesc = Object.getOwnPropertyDescriptor(proto, "height");

  const rescale = (canvas) => {
    const ctx = canvas.__ctx2d;
    if (ctx) ctx.scale(dpr, dpr);
  };

  Object.defineProperty(proto, "width", {
    configurable: true,
    get() { return this.__logicalWidth ?? widthDesc.get.call(this); },
    set(v) {
      this.__logicalWidth = v;
      widthDesc.set.call(this, Math.round(v * dpr));
      rescale(this);
    },
  });
  Object.defineProperty(proto, "height", {
    configurable: true,
    get() { return this.__logicalHeight ?? heightDesc.get.call(this); },
    set(v) {
      this.__logicalHeight = v;
      heightDesc.set.call(this, Math.round(v * dpr));
      rescale(this);
    },
  });

  const origGetContext = proto.getContext;
  proto.getContext = function (type, opts) {
    const ctx = origGetContext.call(this, type, opts);
    if (type === "2d" && ctx && !this.__ctx2d) {
      this.__ctx2d = ctx;
      ctx.scale(dpr, dpr);
    }
    return ctx;
  };
}

async function renderPdfToImages(url) {
  const base = new URL(".", window.location.href).href;
  pdfjsLib.GlobalWorkerOptions.workerSrc = base + "vendor/pdfjs/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({
    url: base + url,
    cMapUrl: base + "vendor/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "vendor/pdfjs/standard_fonts/",
  }).promise;
  const images = [];
  let aspect = 1.414; // fallback A4-ish portrait

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    if (i === 1) aspect = baseViewport.height / baseViewport.width;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetWidth = 1600 * dpr; // render resolution, downsized to fit at display time
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    images.push(canvas.toDataURL("image/png"));
  }

  return { images, aspect };
}

function computeBookSize(aspect) {
  const stage = document.querySelector(".stage");
  const availH = stage.clientHeight - 8;
  const availW = stage.clientWidth - 100; // leave room for nav buttons

  let height = availH;
  let width = height / aspect;
  if (width > availW / 2) {
    width = availW / 2;
    height = width * aspect;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

async function init() {
  const loading = document.getElementById("loading");
  const bookEl = document.getElementById("book");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageCount = document.getElementById("pageCount");

  try {
    const { images, aspect } = await renderPdfToImages(PDF_URL);
    const { width, height } = computeBookSize(aspect);

    enableCanvasHiDPI(Math.min(window.devicePixelRatio || 1, 3));

    const pageFlip = new St.PageFlip(bookEl, {
      width,
      height,
      size: "fixed",
      minWidth: 200,
      maxWidth: 2000,
      minHeight: 200,
      maxHeight: 2800,
      showCover: true,
      usePortrait: window.innerWidth < 900,
      maxShadowOpacity: 0.5,
      mobileScrollSupport: false,
      drawShadow: true,
      flippingTime: 700,
    });

    pageFlip.loadFromImages(images);

    const total = images.length;
    const updateUI = () => {
      const cur = pageFlip.getCurrentPageIndex();
      pageCount.textContent = `${cur + 1} / ${total}`;
      prevBtn.disabled = cur <= 0;
      nextBtn.disabled = cur >= total - 1;
    };

    pageFlip.on("flip", updateUI);
    updateUI();

    prevBtn.addEventListener("click", () => pageFlip.flipPrev());
    nextBtn.addEventListener("click", () => pageFlip.flipNext());

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") pageFlip.flipPrev();
      if (e.key === "ArrowRight") pageFlip.flipNext();
    });

    const fsBtn = document.getElementById("fsBtn");
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      fsBtn.textContent = document.fullscreenElement ? "⤢" : "⛶";
    });

    loading.classList.add("hidden");
  } catch (err) {
    loading.innerHTML = `<span>매거진을 불러오지 못했습니다.</span>`;
    console.error(err);
  }
}

init();
