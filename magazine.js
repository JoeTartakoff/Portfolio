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

    // The canvas renderer paints the whole book white every frame, which shows
    // an empty page beside a lone cover. Clear to transparent instead.
    const render = pageFlip.getRender();
    render.clear = function () {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    };

    // Flipping to or from a lone page, page-flip uses that same page as both the
    // flipping page and the page beneath it, so the area the fold uncovers keeps
    // showing the old spread (a white page). Clear that area to the background,
    // and fade out the page on the far side so no white edge is left around the
    // lone page as it lands.
    const flipController = pageFlip.getFlipController();
    let lonePageFlip = false;
    const origDrawFrame = render.drawFrame;
    render.drawFrame = function () {
      const bottom = this.bottomPage;
      const calc = flipController.calc;
      if (bottom == null || bottom !== this.flippingPage || !calc) return origDrawFrame.call(this);

      const ctx = this.ctx;
      const farKey = this.getDirection() === 1 ? "rightPage" : "leftPage";
      const far = this[farKey];
      const progress = Math.min(calc.getFlippingProgress() / 100, 1);
      if (far) {
        this[farKey] = {
          simpleDraw: (side) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, (1 - progress) * 2));
            far.simpleDraw(side);
            ctx.restore();
          },
        };
      }
      this.bottomPage = {
        draw: () => {
          const rect = this.getRect();
          ctx.save();
          ctx.beginPath();
          for (const p of calc.getBottomClipArea()) {
            if (p === null) continue;
            const g = this.convertToGlobal(p);
            ctx.lineTo(g.x, g.y);
          }
          ctx.clip();
          ctx.clearRect(rect.left, rect.top, rect.width, rect.height);
          ctx.restore();
        },
      };
      lonePageFlip = true;
      try {
        origDrawFrame.call(this);
      } finally {
        lonePageFlip = false;
        this.bottomPage = bottom;
        this[farKey] = far;
      }
    };

    // No spine shadow beside a lone page, or while flipping to or from one.
    const origDrawBookShadow = render.drawBookShadow;
    render.drawBookShadow = function () {
      if (lonePageFlip || this.leftPage == null || this.rightPage == null) return;
      return origDrawBookShadow.call(this);
    };

    // The outer shadow of a flipping page falls on the page beneath it. Flipping
    // to or from a lone page there is no page beneath, so it would paint a dark
    // rectangle onto the empty background.
    const origDrawOuterShadow = render.drawOuterShadow;
    render.drawOuterShadow = function () {
      if (lonePageFlip) return;
      return origDrawOuterShadow.call(this);
    };

    const total = images.length;

    // In landscape a lone page sits in one half of the book. Slide the book by
    // half a page so it is centered: the front cover (right half) moves left,
    // a lone back cover (left half, only when the page count is even) moves right.
    const offsetFor = (index) => {
      if (pageFlip.getOrientation() !== "landscape") return 0;
      if (index === 0) return -width / 2;
      if (total % 2 === 0 && index === total - 1) return width / 2;
      return 0;
    };
    const setOffset = (x) => {
      bookEl.style.transform = `translate3d(${x}px, 0, 0)`;
    };

    // Start sliding when page-flip commits to turning the page (button, click,
    // or a released drag past the spine), so the book opens while the page
    // turns. A drag that springs back calls this with isTurned = false.
    // Direction 0 = forward, 1 = back.
    const origAnimate = flipController.animateFlippingTo;
    flipController.animateFlippingTo = function (from, to, isTurned, ...rest) {
      if (isTurned && this.calc) {
        const cur = pageFlip.getCurrentPageIndex();
        const target = this.calc.getDirection() === 0
          ? (total % 2 === 0 && cur >= total - 3 ? total - 1 : Math.max(cur, 1))
          : (cur <= 2 ? 0 : Math.min(cur, total - 2));
        setOffset(offsetFor(target));
      }
      return origAnimate.call(this, from, to, isTurned, ...rest);
    };
    pageFlip.on("changeState", (e) => {
      if (e.data === "read") setOffset(offsetFor(pageFlip.getCurrentPageIndex()));
    });

    setOffset(offsetFor(0));
    requestAnimationFrame(() => requestAnimationFrame(() => bookEl.classList.add("animated")));

    const updateUI = () => {
      const cur = pageFlip.getCurrentPageIndex();
      pageCount.textContent = `${cur + 1} / ${total}`;
      prevBtn.disabled = cur <= 0;
      nextBtn.disabled = cur >= total - 1;
      setOffset(offsetFor(cur));
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
