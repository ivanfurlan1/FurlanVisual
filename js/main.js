/* =========================================================
   FURLAN — CINE DE ARQUITECTURA
   Motor optimizado de proyección, scroll y microinteracciones.
   ========================================================= */
(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const range = (v, a, b) => clamp((v - a) / (b - a));
  const smooth = (t) => t * t * (3 - 2 * t);
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const setCssVar = (styleObj, cache, name, val) => {
    if (cache[name] !== val) {
      cache[name] = val;
      styleObj.setProperty(name, val);
    }
  };
  const setTextCached = (el, cache, key, val) => {
    if (el && cache[key] !== val) {
      cache[key] = val;
      el.textContent = val;
    }
  };

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const body = document.body;
  const root = document.documentElement;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  let vw = innerWidth, vh = innerHeight;
  root.style.setProperty("--vh", `${vh}px`);

  /* ---------------------------------------------------------
     Perfil adaptativo de red, memoria y grano ligero en Canvas
     --------------------------------------------------------- */
  const netConn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const deviceMemGB = navigator.deviceMemory || 8;
  const isLowMem = deviceMemGB <= 4;
  const isSaveData = !!(netConn && netConn.saveData);
  const netEffType = (netConn && netConn.effectiveType) || "4g";
  const isConstrainedNet = isSaveData || /^(slow-2g|2g|3g)$/i.test(netEffType);

  const NET_PROFILE = {
    isLowMem,
    isSaveData,
    isConstrainedNet,
    maxCanvasDpr: isLowMem ? 1.15 : 1.35,
    maxReelDpr: isLowMem ? 1.15 : 1.25,
    fetchConcurrency: isSaveData ? 2 : (isConstrainedNet ? 3 : 6),
    decodeConcurrency: isLowMem ? 2 : 3,
    blobBudgetBytes: (isLowMem ? 72 : 128) * 1024 * 1024,
    bitmapBehind: isLowMem ? 5 : 8,
    bitmapAhead: isLowMem ? 14 : 20,
    reelBitmapBehind: 4,
    reelBitmapAhead: isLowMem ? 10 : 14,
  };

  function pickOptimalSet({ portraitAllowed = true, targetWidthPx = 1920 } = {}) {
    if (portraitAllowed && vw / Math.max(1, vh) < 0.9) return "pt";
    if (!portraitAllowed && vw <= 900) return "md";
    if (NET_PROFILE.isConstrainedNet || NET_PROFILE.isLowMem || targetWidthPx <= 1480) return "md";
    return "lg";
  }

  // Genera una textura ligera de grano 96x96 una sola vez (reemplaza feTurbulence SVG costoso)
  (function initCanvasGrain() {
    const grainEl = $(".grain");
    if (!grainEl) return;
    try {
      const size = 96;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const gctx = c.getContext("2d");
      if (!gctx) return;
      const imgData = gctx.createImageData(size, size);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      gctx.putImageData(imgData, 0, 0);
      grainEl.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
      grainEl.style.backgroundSize = `${size}px ${size}px`;
    } catch (_) {}
  })();

  /* ---------------------------------------------------------
     Scroll suave (Lenis, sólo con puntero fino)
     --------------------------------------------------------- */
  let lenis = null;
  if (window.Lenis && !reduce && finePointer) {
    lenis = new window.Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 1,
      smoothWheel: true,
    });
    lenis.stop();
  }

  const scrollContainer = $("#top");
  const isVerticalScroller = () =>
    vw <= 900 || (window.matchMedia && window.matchMedia("(max-aspect-ratio: 1/1)").matches);

  let isUserTouching = false;
  window.addEventListener("touchstart", () => { isUserTouching = true; }, { passive: true });
  window.addEventListener("touchend", () => { isUserTouching = false; }, { passive: true });
  window.addEventListener("touchcancel", () => { isUserTouching = false; }, { passive: true });

  const scrollY = () => {
    if (scrollContainer && isVerticalScroller()) return scrollContainer.scrollTop;
    if (lenis) return lenis.scroll;
    return window.scrollY;
  };

  function scrollToTarget(target, opts = {}) {
    const el = typeof target === "string" ? $(target) : target;
    const y = typeof target === "number" ? target : (el ? el.getBoundingClientRect().top + scrollY() : 0);
    if (scrollContainer && isVerticalScroller()) {
      if (reduce || opts.immediate) {
        scrollContainer.scrollTop = y;
      } else {
        scrollContainer.scrollTo({ top: y, behavior: "smooth" });
      }
    } else if (lenis) {
      lenis.scrollTo(y, { duration: opts.duration || 1.35, immediate: !!opts.immediate });
    } else {
      window.scrollTo({ top: y, behavior: reduce || opts.immediate ? "auto" : "smooth" });
    }
  }

  function bindTimelineScrub(scrubEl, onSeek, onStateChange) {
    if (!scrubEl) return;
    let activeId = null;
    let pointerType = "mouse";
    let startX = 0;
    let startY = 0;
    let dragging = false;

    const ratioFromClientX = (clientX) => {
      const rect = scrubEl.getBoundingClientRect();
      if (!rect.width) return null;
      return clamp((clientX - rect.left) / rect.width);
    };

    const setScrubbing = (active) => {
      scrubEl.classList.toggle("is-scrubbing", active);
      if (onStateChange) onStateChange(active);
    };

    scrubEl.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      activeId = e.pointerId;
      pointerType = e.pointerType || "mouse";
      startX = e.clientX;
      startY = e.clientY;

      if (pointerType === "mouse") {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        try { scrubEl.setPointerCapture(e.pointerId); } catch (_) {}
        setScrubbing(true);
        const r = ratioFromClientX(e.clientX);
        if (r !== null) onSeek(r, { immediate: false });
      } else {
        dragging = false;
      }
    }, { passive: false });

    scrubEl.addEventListener("pointermove", (e) => {
      if (activeId !== e.pointerId) return;
      if (!dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.1) {
          activeId = null;
          return;
        }
        if (Math.abs(dx) > 6 && Math.abs(dx) >= Math.abs(dy) * 1.15) {
          dragging = true;
          try { scrubEl.setPointerCapture(e.pointerId); } catch (_) {}
          setScrubbing(true);
        } else {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      const r = ratioFromClientX(e.clientX);
      if (r !== null) onSeek(r, { immediate: true });
    }, { passive: false });

    const endScrub = (e) => {
      if (activeId !== e.pointerId) return;
      const wasDragging = dragging;
      activeId = null;
      dragging = false;
      if (wasDragging) {
        try { scrubEl.releasePointerCapture(e.pointerId); } catch (_) {}
        setScrubbing(false);
      }
    };
    scrubEl.addEventListener("pointerup", endScrub);
    scrubEl.addEventListener("pointercancel", endScrub);
    scrubEl.addEventListener("lostpointercapture", () => {
      if (activeId !== null || dragging) {
        activeId = null;
        dragging = false;
        setScrubbing(false);
      }
    });
  }

  /* ---------------------------------------------------------
     Cursor con anillo óptico inercial y atracción magnética
     --------------------------------------------------------- */
  const cursor = $(".cursor");
  const cursorRing = $(".cursor__ring");
  const cursorLabel = $(".cursor__label");
  let mx = -200, my = -200, cx = -200, cy = -200, rx = -200, ry = -200;
  let normMx = 0, normMy = 0;

  function bindCursorTarget(el) {
    if (!finePointer || !cursor || !el) return;
    el.addEventListener("mouseenter", () => {
      const label = el.dataset.cursor;
      if (label) {
        cursorLabel.textContent = label;
        body.classList.add("cursor-label");
      } else {
        body.classList.add("cursor-link");
      }
      playTactileTick(740, 0.015, 0.01);
    });
    el.addEventListener("mouseleave", () => {
      body.classList.remove("cursor-label", "cursor-link");
    });
  }

  if (finePointer && cursor) {
    body.classList.add("has-cursor");
    addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;
      normMx = (mx / Math.max(1, vw) - 0.5) * 2;
      normMy = (my / Math.max(1, vh) - 0.5) * 2;
    }, { passive: true });

    $$("a, button, .seq__scrub, [data-cursor]").forEach(bindCursorTarget);

    $$("[data-magnetic]").forEach((el) => {
      const strength = parseFloat(el.dataset.magnetic) || 0.22;
      el.addEventListener("mousemove", (e) => {
        if (reduce) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width * 0.5)) * strength;
        const dy = (e.clientY - (r.top + r.height * 0.5)) * strength;
        el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      }, { passive: true });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
      });
    });
  }

  /* ---------------------------------------------------------
     Texto palabra por palabra (nítido, sin desenfoque)
     --------------------------------------------------------- */
  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = "";
    const allWords = [];
    nodes.forEach((n) => {
      const isEl = n.nodeType === 1;
      const words = n.textContent.split(/\s+/).filter(Boolean);
      words.forEach((w) => {
        allWords.push({ w, isEl, tag: isEl ? n.tagName.toLowerCase() : null });
      });
    });

    allWords.forEach((item, idx) => {
      const s = document.createElement("span");
      s.className = "wd";
      if (item.isEl) {
        const inner = document.createElement(item.tag);
        inner.textContent = item.w;
        s.appendChild(inner);
      } else {
        s.textContent = item.w;
      }
      el.appendChild(s);
      if (idx < allWords.length - 1) el.appendChild(document.createTextNode(" "));
    });
  }

  const wordBlocks = $$("[data-words]").map((el) => {
    splitWords(el);
    return { el, words: $$(".wd", el), lastP: -1 };
  });

  const lineBlocks = $$("[data-lines]").map((el) => ({
    el,
    lines: $$(".ln", el),
  }));

  /* ---------------------------------------------------------
     MOTOR HÍBRIDO DE AUTO-REPRODUCCIÓN Y CONTROL DE SCROLL
     --------------------------------------------------------- */
  function runHybridScrollEngine({ top, len, dt, viewportEntry, rawP, baseDuration, speedScale = 1, peekPx: customPeekPx, minSpeed = 0.45, state, hasFrames, isHero }) {
    if (reduce) return;
    const dtSec = Math.min(dt || 0.016, 0.04);
    const peekPx = customPeekPx !== undefined ? customPeekPx : Math.round(Math.min(vh * 0.13, 105));
    const endY = top + len + peekPx;
    const y = scrollY();
    const isFullyInView = isHero ? (rawP >= 0.025) : (viewportEntry >= 0.975 || rawP >= -0.03);
    const inActiveZone = isFullyInView && y < endY - 0.5;

    if (!inActiveZone || state.autoPlayPaused || !hasFrames) {
      if (y >= endY - 0.5 || (!isHero && viewportEntry < 0.8) || (isHero && rawP < 0.015)) {
        state.autoPlaySuspended = false;
        state.subpixelAcc = 0;
      }
      return;
    }

    let speedFactor = speedScale;
    if (rawP > 0.84) {
      const tDecel = clamp((rawP - 0.84) / (0.16 + peekPx / Math.max(1, len)), 0, 1);
      speedFactor *= Math.max(minSpeed, 1.0 - Math.pow(tDecel, 1.15) * (1.0 - minSpeed));
    }

    const autoSpeed = (len / Math.max(4, baseDuration)) * speedFactor;
    const autoDy = autoSpeed * dtSec;

    if (lenis && !isVerticalScroller()) {
      const targetY = lenis.targetScroll !== undefined ? lenis.targetScroll : y;
      const userDiff = targetY - y;

      if (userDiff < -1.5) state.autoPlaySuspended = true;
      else if (userDiff > 2.0) state.autoPlaySuspended = false;

      if (!state.autoPlaySuspended) {
        const userForwardLead = Math.max(0, userDiff);
        const userDy = userForwardLead * (1 - Math.exp(-14 * dtSec));
        const nextY = Math.min(endY, y + autoDy + userDy);
        const remainingLead = Math.max(0, userForwardLead - userDy);
        lenis.scrollTo(nextY, { immediate: true });
        if (remainingLead > 0.5) lenis.targetScroll = nextY + remainingLead;
      }
    } else {
      const scroller = (scrollContainer && isVerticalScroller()) ? scrollContainer : window;
      const currentY = (scrollContainer && isVerticalScroller()) ? scrollContainer.scrollTop : window.scrollY;

      if (state.lastTrackedY === undefined) state.lastTrackedY = currentY;
      const scrollDelta = currentY - state.lastTrackedY;
      state.lastTrackedY = currentY;

      if (scrollDelta < -1.5) {
        state.autoPlaySuspended = true;
        state.subpixelAcc = 0;
      } else if (scrollDelta > 2.0) {
        state.autoPlaySuspended = false;
      }

      if (!state.autoPlaySuspended && currentY < endY - 0.5) {
        if (isUserTouching) {
          state.subpixelAcc = 0;
        } else {
          state.subpixelAcc = (state.subpixelAcc || 0) + autoDy;
          if (state.subpixelAcc >= 1) {
            const intStep = Math.floor(state.subpixelAcc);
            state.subpixelAcc -= intStep;
            const nextY = Math.min(endY, currentY + intStep);
            if (scroller === window) window.scrollTo(0, nextY);
            else scroller.scrollTop = nextY;
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------
     BANCO DE FRAMES & PLANIFICADOR INTELIGENTE DE CARGA
     Almacena Blobs comprimidos en RAM + ventana deslizante de ImageBitmaps
     pre-decodificados en segundo plano (sin evicción ni trabas de CPU).
     --------------------------------------------------------- */
  const frameBanks = new Map();
  let totalBlobBytes = 0;
  const supportsImageBitmap = typeof window.createImageBitmap === "function";

  function decodeBlobToDrawable(blob) {
    if (supportsImageBitmap) {
      return createImageBitmap(blob);
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const done = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        if (img.decode) img.decode().then(done, done);
        else done();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("img decode error"));
      };
      img.src = url;
    });
  }

  class FrameBank {
    constructor(src, count, version, set) {
      this.key = `${src}|${set}`;
      this.src = src;
      this.count = Math.max(1, count);
      this.version = version || "";
      this.set = set;
      this.vParam = this.version ? `?v=${this.version}` : "";

      this.blobs = new Array(this.count).fill(null);
      this.bitmaps = new Array(this.count).fill(null);
      this.failed = new Uint8Array(this.count);
      this.fetching = new Set();
      this.decoding = new Set();
      this.queuedDecode = new Set();
      this.blobBytes = 0;
      this.lastAnchor = 0;
      this.lastUseAt = performance.now();
      this.listeners = new Set();
    }

    urlFor(idx) {
      return `${this.src}/${this.set}/${pad(idx + 1, 4)}.webp${this.vParam}`;
    }

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    notify(idx, isBitmap) {
      this.listeners.forEach((fn) => fn(idx, isBitmap));
    }

    hasData(idx) {
      return !!(this.bitmaps[idx] || this.blobs[idx] || this.failed[idx]);
    }

    contiguousLoadedFrom(startIdx = 0) {
      let c = 0;
      for (let i = startIdx; i < this.count; i++) {
        if (this.blobs[i] || this.bitmaps[i] || this.failed[i]) c++;
        else break;
      }
      return c;
    }

    contiguousDecodedFrom(startIdx = 0) {
      let c = 0;
      for (let i = startIdx; i < this.count; i++) {
        if (this.bitmaps[i] || this.failed[i]) c++;
        else break;
      }
      return c;
    }

    hasContiguousAhead(startIdx, minAhead = 6) {
      const s = clamp(Math.round(startIdx), 0, this.count - 1);
      const end = Math.min(this.count - 1, s + minAhead);
      const needDecoded = Math.min(3, end - s + 1);
      let decodedOk = 0;
      for (let i = s; i <= end; i++) {
        if (this.bitmaps[i] || this.failed[i]) {
          if (i - s < needDecoded) decodedOk++;
        } else if (!this.blobs[i]) {
          return false;
        }
      }
      return decodedOk >= needDecoded;
    }

    storeBlob(idx, blob) {
      if (!blob) return;
      if (!this.blobs[idx]) {
        this.blobs[idx] = blob;
        this.blobBytes += blob.size;
        totalBlobBytes += blob.size;
      }
      this.lastUseAt = performance.now();
      this.notify(idx, false);
    }

    releaseBitmapAt(idx) {
      const bm = this.bitmaps[idx];
      if (!bm) return;
      if (typeof bm.close === "function") {
        try { bm.close(); } catch (_) {}
      }
      this.bitmaps[idx] = null;
    }

    releaseBitmaps() {
      for (let i = 0; i < this.count; i++) {
        if (this.bitmaps[i]) this.releaseBitmapAt(i);
      }
      this.decoding.clear();
      this.queuedDecode.clear();
    }

    releaseBlobs(keepZero = true) {
      const start = keepZero ? 1 : 0;
      for (let i = start; i < this.count; i++) {
        const b = this.blobs[i];
        if (b) {
          this.blobBytes -= b.size;
          totalBlobBytes = Math.max(0, totalBlobBytes - b.size);
          this.blobs[i] = null;
        }
      }
    }

    pruneWindow(anchorIdx, behind, ahead) {
      const minKeep = Math.max(0, anchorIdx - behind - 2);
      const maxKeep = Math.min(this.count - 1, anchorIdx + ahead + 3);
      for (let i = 0; i < this.count; i++) {
        if (i < minKeep || i > maxKeep) {
          if (this.bitmaps[i]) this.releaseBitmapAt(i);
        }
      }
    }

    getBestDrawable(idx) {
      this.lastUseAt = performance.now();
      const bm = this.bitmaps[idx];
      if (bm) return { img: bm, exact: true, frameIdx: idx };

      if (this.blobs[idx] && !this.decoding.has(idx)) {
        AssetScheduler.enqueueDecode(this, idx, true);
      }

      for (let d = 1; d < this.count; d++) {
        if (idx - d >= 0 && this.bitmaps[idx - d]) {
          return { img: this.bitmaps[idx - d], exact: false, frameIdx: idx - d };
        }
        if (idx + d < this.count && this.bitmaps[idx + d]) {
          return { img: this.bitmaps[idx + d], exact: false, frameIdx: idx + d };
        }
      }
      return null;
    }
  }

  function getFrameBank(src, count, version, set) {
    const key = `${src}|${set}`;
    let bank = frameBanks.get(key);
    if (!bank || bank.version !== (version || "") || bank.count !== count) {
      if (bank) {
        bank.releaseBitmaps();
        bank.releaseBlobs(false);
      }
      bank = new FrameBank(src, count, version, set);
      frameBanks.set(key, bank);
    }
    return bank;
  }

  const AssetScheduler = (() => {
    const sources = [];
    const decodeQueue = [];
    let activeFetches = 0;
    let activeDecodes = 0;
    let pumpScheduled = false;
    let lastSweep = 0;
    let lastHeroProgressEmit = 0;

    function registerSource(srcObj) {
      if (!sources.includes(srcObj)) sources.push(srcObj);
    }

    function pickNextFrameFromJob(job) {
      const { bank, anchor, start, end } = job;
      const a = clamp(Math.round(anchor), start, end);
      for (let i = a; i <= end; i++) {
        if (!bank.hasData(i) && !bank.fetching.has(i)) return i;
      }
      for (let i = a - 1; i >= start; i--) {
        if (!bank.hasData(i) && !bank.fetching.has(i)) return i;
      }
      return -1;
    }

    function gatherJobs() {
      const y = scrollY();
      const jobs = [];
      for (let i = 0; i < sources.length; i++) {
        const list = sources[i].getLoadJobs(y, vh);
        for (let j = 0; j < list.length; j++) jobs.push(list[j]);
      }
      jobs.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
      return jobs;
    }

    function enqueueDecode(bank, idx, urgent = false) {
      if (bank.bitmaps[idx] || bank.decoding.has(idx) || bank.queuedDecode.has(idx) || !bank.blobs[idx]) return;
      bank.queuedDecode.add(idx);
      if (urgent) {
        decodeQueue.unshift({ bank, idx, urgent: true });
      } else {
        decodeQueue.push({ bank, idx, urgent: false });
      }
      if (decodeQueue.length > 48) {
        const dropped = decodeQueue.pop();
        if (dropped) dropped.bank.queuedDecode.delete(dropped.idx);
      }
      pumpDecodes();
    }

    function pumpDecodes() {
      while (activeDecodes < NET_PROFILE.decodeConcurrency && decodeQueue.length > 0) {
        const item = decodeQueue.shift();
        const { bank, idx } = item;
        bank.queuedDecode.delete(idx);
        if (!bank.blobs[idx] || bank.bitmaps[idx] || bank.decoding.has(idx)) continue;
        bank.decoding.add(idx);
        activeDecodes++;
        decodeBlobToDrawable(bank.blobs[idx])
          .then((drawable) => {
            bank.decoding.delete(idx);
            activeDecodes--;
            if (bank.bitmaps[idx] && typeof bank.bitmaps[idx].close === "function") {
              try { bank.bitmaps[idx].close(); } catch (_) {}
            }
            bank.bitmaps[idx] = drawable;
            bank.notify(idx, true);
            if (typeof window.__onBankDecode === "function") window.__onBankDecode(bank);
            pumpDecodes();
          })
          .catch(() => {
            bank.decoding.delete(idx);
            activeDecodes--;
            pumpDecodes();
          });
      }
    }

    function syncActiveWindows(jobs) {
      const activeBankKeys = new Set();
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.priority > 1.35) continue;
        activeBankKeys.add(job.bank.key);
        const behind = job.isReel ? (job.priority === 0 ? NET_PROFILE.reelBitmapBehind : 2) : NET_PROFILE.bitmapBehind;
        const ahead = job.isReel ? (job.priority === 0 ? NET_PROFILE.reelBitmapAhead : 8) : (job.priority === 0 ? NET_PROFILE.bitmapAhead : 12);
        const a = clamp(Math.round(job.anchor), job.start, job.end);
        job.bank.lastAnchor = a;
        job.bank.pruneWindow(a, behind, ahead);

        const winStart = Math.max(job.start, a - Math.min(3, behind));
        const winEnd = Math.min(job.end, a + ahead);
        for (let f = a; f <= winEnd; f++) {
          if (job.bank.blobs[f] && !job.bank.bitmaps[f] && !job.bank.decoding.has(f) && !job.bank.queuedDecode.has(f)) {
            enqueueDecode(job.bank, f, f - a <= 4);
          }
        }
        for (let f = a - 1; f >= winStart; f--) {
          if (job.bank.blobs[f] && !job.bank.bitmaps[f] && !job.bank.decoding.has(f) && !job.bank.queuedDecode.has(f)) {
            enqueueDecode(job.bank, f, false);
          }
        }
      }

      const now = performance.now();
      if (now - lastSweep > 450) {
        lastSweep = now;
        frameBanks.forEach((bank) => {
          if (!activeBankKeys.has(bank.key)) {
            bank.releaseBitmaps();
          }
        });

        if (totalBlobBytes > NET_PROFILE.blobBudgetBytes) {
          const distMap = new Map();
          const y = scrollY();
          for (let i = 0; i < sources.length; i++) {
            sources[i].collectBankDistances(y, vh, distMap);
          }
          const candidates = Array.from(frameBanks.values())
            .filter((b) => !activeBankKeys.has(b.key) && b.blobBytes > 0 && (distMap.get(b.key) || 999999) > vh * 2.4)
            .sort((a, b) => (distMap.get(b.key) || 999999) - (distMap.get(a.key) || 999999));
          for (let i = 0; i < candidates.length && totalBlobBytes > NET_PROFILE.blobBudgetBytes * 0.85; i++) {
            candidates[i].releaseBlobs(true);
          }
        }
      }
    }

    function pump() {
      pumpScheduled = false;
      const jobs = gatherJobs();
      syncActiveWindows(jobs);

      while (activeFetches < NET_PROFILE.fetchConcurrency) {
        let chosenJob = null;
        let chosenIdx = -1;
        for (let i = 0; i < jobs.length; i++) {
          const idx = pickNextFrameFromJob(jobs[i]);
          if (idx !== -1) {
            chosenJob = jobs[i];
            chosenIdx = idx;
            break;
          }
        }
        if (!chosenJob || chosenIdx === -1) break;

        const bank = chosenJob.bank;
        bank.fetching.add(chosenIdx);
        activeFetches++;
        const url = bank.urlFor(chosenIdx);
        const fetchOpts = chosenJob.priority === 0 ? { priority: "high" } : {};

        fetch(url, fetchOpts)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          })
          .then((blob) => {
            bank.fetching.delete(chosenIdx);
            activeFetches--;
            bank.storeBlob(chosenIdx, blob);
            const dist = Math.abs(chosenIdx - bank.lastAnchor);
            const aheadLimit = chosenJob.isReel ? NET_PROFILE.reelBitmapAhead : NET_PROFILE.bitmapAhead;
            const behindLimit = chosenJob.isReel ? NET_PROFILE.reelBitmapBehind : NET_PROFILE.bitmapBehind;
            if (chosenJob.priority <= 1.35 && chosenIdx >= bank.lastAnchor - behindLimit && chosenIdx <= bank.lastAnchor + aheadLimit) {
              enqueueDecode(bank, chosenIdx, dist <= 6);
            }
            if (typeof window.__onBankProgress === "function") {
              const now = performance.now();
              if (now - lastHeroProgressEmit > 30 || chosenIdx < 60) {
                lastHeroProgressEmit = now;
                window.__onBankProgress(bank);
              }
            }
            schedulePump();
          })
          .catch(() => {
            bank.fetching.delete(chosenIdx);
            bank.failed[chosenIdx] = 1;
            activeFetches--;
            if (typeof window.__onBankProgress === "function") window.__onBankProgress(bank);
            schedulePump();
          });
      }
    }

    function schedulePump() {
      if (pumpScheduled) return;
      pumpScheduled = true;
      queueMicrotask(pump);
    }

    return {
      registerSource,
      schedulePump,
      enqueueDecode,
    };
  })();

  /* ---------------------------------------------------------
     MOTOR DE SECUENCIAS
     --------------------------------------------------------- */
  class Sequence {
    constructor(el) {
      this.el = el;
      this.isHero = el.classList.contains("seq--hero");
      this.isFullscreen = el.classList.contains("seq--fullscreen");
      this.isTrace = el.classList.contains("seq--trace");
      this.isKinetic = el.classList.contains("seq--kinetic");
      this.isCinema = el.classList.contains("seq--cinema");
      this.isHybrid = el.dataset.mode === "hybrid" || this.isTrace || this.isKinetic || this.isCinema || this.isHero;
      this.autoPlayPaused = false;
      this.autoPlaySuspended = false;
      this.lastTrackedY = undefined;

      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.version = el.dataset.version || "";
      this.fps = +el.dataset.fps || 24;
      this.customDuration = parseFloat(el.dataset.duration) || 0;

      this.stage = $(".seq__stage", el);
      this.media = $(".seq__media", el);
      this.canvas = $(".seq__canvas", el);
      this.posterImg = $(".seq__poster img", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.hero = $("[data-seq-hero]", el);
      this.heroTitle = this.hero ? $(".hero__title", this.hero) : null;
      this.heroL1 = this.heroTitle ? $(".hero__line:nth-child(1)", this.heroTitle) : null;
      this.heroL2 = this.heroTitle ? $(".hero__line--2", this.heroTitle) : null;
      this.heroFoot = this.hero ? $(".hero__foot", this.hero) : null;
      this.lead = $("[data-seq-lead]", el);

      if (this.isKinetic) {
        this.kWingL = $("[data-kseq-wing-l]", el);
        this.kWingR = $("[data-kseq-wing-r]", el);
        this.kPhase = $("[data-kseq-phase]", el);
      }

      if (this.isCinema) {
        this.cinemaPrelude = $("[data-cinema-prelude]", el);
      }

      if (this.isTrace) {
        this.tracePathCore = $("#tracePathCore", el);
        this.tracePathGlow = $("#tracePathGlow", el);
        this.traceDrone = $("[data-trace-drone]", el);
        this.traceDroneRot = $("[data-trace-drone-rot]", el);
        this.traceDroneTxt = $("[data-trace-drone-txt]", el);
        this.traceWakeRing = $("[data-trace-wake]", el);

        this.tracePathCoreV = $("#tracePathCoreV", el);
        this.tracePathGlowV = $("#tracePathGlowV", el);
        this.traceDroneV = $("[data-trace-drone-v]", el);
        this.traceDroneRotV = $("[data-trace-drone-rot-v]", el);
        this.traceDroneTxtV = $("[data-trace-drone-txt-v]", el);
        this.traceWakeRingV = $("[data-trace-wake-v]", el);

        this.tracePhasePill = $("[data-trace-phase-pill]", el);
        this.traceAltEl = $("[data-trace-alt]", el);
        this.traceYawEl = $("[data-trace-yaw]", el);
        this.tracePlanStateEl = $("[data-trace-plan-state]", el);
        this.traceDistEl = $("[data-trace-dist]", el);
        this.traceRoomNameEl = $("[data-trace-room-name]", el);
        this.traceTcEl = $("[data-trace-tc]", el);
        this.traceRooms = $$("[data-trace-room]", el);
        this.traceRoomsV = $$("[data-trace-room-v]", el);
        this.traceWps = $$("[data-trace-wp]", el);
        this.traceWpsV = $$("[data-trace-wp-v]", el);
        this.traceActs = $$("[data-trace-act]", el).map((n) => ({
          n,
          r: n.dataset.traceAct.split(",").map(Number),
        }));
        this.traceCur = 0;
        this.lastTraceZone = -1;

        this.tracePathLen = 1034;
        if (this.tracePathCore && typeof this.tracePathCore.getTotalLength === "function") {
          try {
            const len = this.tracePathCore.getTotalLength();
            if (len > 20) this.tracePathLen = len;
          } catch (_) {}
        }
        if (this.tracePathCore) {
          this.tracePathCore.style.strokeDasharray = `${this.tracePathLen}`;
          this.tracePathCore.style.strokeDashoffset = `${this.tracePathLen}`;
        }
        if (this.tracePathGlow) {
          this.tracePathGlow.style.strokeDasharray = `${this.tracePathLen}`;
          this.tracePathGlow.style.strokeDashoffset = `${this.tracePathLen}`;
        }

        this.tracePathLenV = 690;
        if (this.tracePathCoreV && typeof this.tracePathCoreV.getTotalLength === "function") {
          try {
            const lenV = this.tracePathCoreV.getTotalLength();
            if (lenV > 20) this.tracePathLenV = lenV;
          } catch (_) {}
        }
        if (this.tracePathCoreV) {
          this.tracePathCoreV.style.strokeDasharray = `${this.tracePathLenV}`;
          this.tracePathCoreV.style.strokeDashoffset = `${this.tracePathLenV}`;
        }
        if (this.tracePathGlowV) {
          this.tracePathGlowV.style.strokeDasharray = `${this.tracePathLenV}`;
          this.tracePathGlowV.style.strokeDashoffset = `${this.tracePathLenV}`;
        }
      }

      this.chapters = $$(".chapter", el).map((n) => ({
        n,
        r: n.dataset.range.split(",").map(Number),
        tick: null,
      }));

      this.tcEl = $("[data-tc]", el);
      this.frEl = $("[data-hud-fr]", el);
      this.scrub = $(".seq__scrub", el);
      this.scrubTrack = $(".seq__track", el);
      this.scrubFill = $("[data-scrub-fill]", el);
      this.outroCard = $("[data-seq-outro]", el);

      this.bank = null;
      this.unsubBank = null;
      this.cur = 0;
      this.lastCur = -1;
      this.lastFrame = -1;
      this.lastDrawnIdx = -1;
      this.lastDrawnExact = false;
      this.dirty = true;
      this.lastBlur = -1;
      this.lastGray = -1;
      this.lastPumpFrame = -999;
      this.lastRenderedState = "";
      this._stageVars = {};
      this._elVars = {};
      this._txtCache = {};
      this.isOffscreen = false;
      this.lastCinemaPassed = false;
      this.lastHasChapterGlow = false;

      if (this.isHybrid && !this.isTrace && this.media) {
        this.media.addEventListener("click", (e) => {
          if (e.target.closest("button, a, [data-video-trigger], .seq__outro-card, .seq__scrub")) return;
          this.togglePlayPause();
        });
      }
      this.bindScrub();
      this.measure();
      if (!this.isHero && !this.isKinetic && !this.isCinema) this.setVisualFilter(0, 1);
      AssetScheduler.registerSource(this);
    }

    bindScrub() {
      if (!this.scrub) return;
      bindTimelineScrub(
        this.scrub,
        (r, opts) => this.seekToProgress(r, opts),
        (active) => { this.isScrubbing = active; }
      );
      this.scrub.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 0.1 : 0.04;
        const cur = this.progress || 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToProgress(clamp(cur + step)); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToProgress(clamp(cur - step)); }
      });
    }

    seekToProgress(progress, opts = {}) {
      const targetP = clamp(progress, 0, 1);
      const targetY = this.top + targetP * this.len;
      scrollToTarget(targetY, { duration: 0.45, immediate: !!opts.immediate });
    }

    togglePlayPause() {
      if (!this.isHybrid) return;
      if (this.progress >= 0.99) {
        this.seekToProgress(0.03);
        this.autoPlayPaused = false;
        playTactileTick(720, 0.025, 0.02);
        return;
      }
      this.autoPlayPaused = !this.autoPlayPaused;
      playTactileTick(this.autoPlayPaused ? 480 : 660, 0.02, 0.015);
    }

    pickSet() {
      // #propiedad y #film-03 siempre horizontales 16:9 (tanto en escritorio como en vertical)
      const portraitAllowed = !(this.isKinetic || this.isCinema);
      const targetWidthPx = this.canvas ? this.canvas.width : Math.round(vw * NET_PROFILE.maxCanvasDpr);
      return pickOptimalSet({ portraitAllowed, targetWidthPx });
    }

    target() {
      const portrait = vw / vh < 0.9 || vw <= 680;
      let tw, th;
      if (portrait) {
        th = Math.min(vh * 0.66, 640);
        tw = th * 9 / 16;
        if (tw > vw * 0.88) { tw = vw * 0.88; th = tw * 16 / 9; }
      } else {
        tw = Math.min(vw * 0.86, 1420);
        th = tw * 9 / 16;
        const maxH = Math.min(vh * 0.72, vh - 190);
        if (th > maxH) { th = maxH; tw = th * 16 / 9; }
      }
      return { tw: Math.round(tw), th: Math.round(th) };
    }

    measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, NET_PROFILE.maxCanvasDpr);
      const isLandscape = vw >= vh;
      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const t = this.target();
      this.tw = t.tw;
      this.th = t.th;
      this.fullScale = Math.max(vw / Math.max(1, t.tw), vh / Math.max(1, t.th));
      this.stage.style.setProperty("--tw", `${t.tw}px`);
      this.stage.style.setProperty("--th", `${t.th}px`);

      if (!this.isKinetic && !this.isCinema) {
        let w, h;
        if (this.isFullscreen) {
          w = Math.min(1920, Math.round(vw * dpr));
          h = Math.min(isLandscape ? 1080 : 1440, Math.round(vh * dpr));
        } else {
          const rawW = Math.round(t.tw * this.fullScale * dpr);
          const rawH = Math.round(t.th * this.fullScale * dpr);
          const cap = Math.min(1, 1920 / Math.max(1, rawW), (isLandscape ? 1080 : 1440) / Math.max(1, rawH));
          w = Math.max(2, Math.round(rawW * cap));
          h = Math.max(2, Math.round(rawH * cap));
        }
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
          this.dirty = true;
        }
      }

      if (this.isKinetic) {
        const isMob = vw <= 900 || (vw / vh < 0.95);
        let kw, kh;
        if (isMob) {
          kw = Math.min(vw * 0.92, 540);
          kh = Math.round(kw * (9 / 16));
        } else {
          kw = Math.min(vw * 0.68, 980);
          kh = Math.round(kw * (9 / 16));
          const maxKh = Math.min(vh * 0.62, vh - 220);
          if (kh > maxKh) {
            kh = maxKh;
            kw = Math.round(kh * (16 / 9));
          }
        }
        this.kw = Math.round(kw);
        this.kh = Math.round(kh);
        this.stage.style.setProperty("--kseq-w", `${this.kw}px`);
        this.stage.style.setProperty("--kseq-h", `${this.kh}px`);

        const cw = Math.round(this.kw * dpr);
        const ch = Math.round(this.kh * dpr);
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
          this.canvas.width = cw;
          this.canvas.height = ch;
          this.dirty = true;
        }
      }

      if (this.isCinema) {
        const isMob = vw <= 900 || (vw / vh < 0.95);
        let cwBox, chBox;
        if (isMob) {
          cwBox = Math.min(vw * 0.92, 600);
          chBox = Math.round(cwBox * (9 / 16));
          const maxCh = Math.max(160, vh - 190);
          if (chBox > maxCh) {
            chBox = maxCh;
            cwBox = Math.round(chBox * (16 / 9));
          }
        } else {
          cwBox = Math.min(vw * 0.82, 1320);
          chBox = Math.round(cwBox * (9 / 16));
          const maxCh = Math.min(vh * 0.70, vh - 210);
          if (chBox > maxCh) {
            chBox = maxCh;
            cwBox = Math.round(chBox * (16 / 9));
          }
        }
        this.cwBox = Math.round(cwBox);
        this.chBox = Math.round(chBox);
        this.el.style.setProperty("--cinema-w", `${this.cwBox}px`);
        this.el.style.setProperty("--cinema-h", `${this.chBox}px`);

        const cw = Math.round(this.cwBox * dpr);
        const ch = Math.round(this.chBox * dpr);
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
          this.canvas.width = cw;
          this.canvas.height = ch;
          this.dirty = true;
        }
      }

      const set = this.pickSet();
      if (this.set && set !== this.set) {
        this.ensureBank(set);
      }
      this.lastRenderedState = "";
      this._stageVars = {};
      this._elVars = {};
      this._txtCache = {};
      this.isOffscreen = false;
      this.lastCinemaPassed = false;
      this.lastHasChapterGlow = false;
      if (!this.isFullscreen && !this.isKinetic && !this.isCinema) {
        setCssVar(this.stage.style, this._stageVars, "--frame-scale", this.fullScale.toFixed(4));
      }
    }

    ensureBank(set = this.pickSet()) {
      if (this.set === set && this.bank) return this.bank;
      if (this.unsubBank) { this.unsubBank(); this.unsubBank = null; }
      this.set = set;
      this.bank = getFrameBank(this.src, this.count, this.version, set);
      this.lastDrawnIdx = -1;
      this.lastDrawnExact = false;
      this.dirty = true;
      this.unsubBank = this.bank.subscribe((frameIdx, isBitmap) => {
        if (!isBitmap) return;
        const curIdx = Math.round(this.cur);
        if (frameIdx === 0 && !this.hasCanvasClass) {
          this.draw(0);
        }
        if (Math.abs(frameIdx - curIdx) <= 2 || (frameIdx === curIdx && !this.lastDrawnExact)) {
          this.dirty = true;
        }
      });
      AssetScheduler.schedulePump();
      return this.bank;
    }

    load(set = this.pickSet()) {
      this.ensureBank(set);
    }

    getLoadJobs(y, viewH) {
      const secEnd = this.top + this.len + viewH;
      const inView = y + viewH >= this.top - viewH * 0.25 && y <= secEnd + viewH * 0.25;
      const dist = inView ? 0 : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      if (!inView && dist > viewH * 2.4 && !this.isHero) return [];

      const bank = this.ensureBank();
      const anchor = inView ? clamp(Math.round(this.cur), 0, this.count - 1) : 0;
      const jobs = [];

      if (inView) {
        jobs.push({
          bank,
          priority: 0,
          distance: 0,
          anchor,
          start: 0,
          end: this.count - 1,
          isReel: false,
        });
      } else if (dist <= viewH * 1.4) {
        const preEnd = Math.min(this.count - 1, 27);
        jobs.push({
          bank,
          priority: 1,
          distance: dist,
          anchor: 0,
          start: 0,
          end: preEnd,
          isReel: false,
        });
        if (!NET_PROFILE.isConstrainedNet) {
          jobs.push({
            bank,
            priority: 2.5,
            distance: dist,
            anchor: preEnd + 1,
            start: 0,
            end: this.count - 1,
            isReel: false,
          });
        }
      } else if (dist <= viewH * 2.4) {
        jobs.push({
          bank,
          priority: 2.2,
          distance: dist,
          anchor: 0,
          start: 0,
          end: Math.min(this.count - 1, 23),
          isReel: false,
        });
      } else if (this.isHero && dist <= viewH * 4) {
        jobs.push({
          bank,
          priority: 2.8,
          distance: dist,
          anchor: 0,
          start: 0,
          end: Math.min(this.count - 1, 53),
          isReel: false,
        });
      }
      return jobs;
    }

    collectBankDistances(y, viewH, distMap) {
      if (!this.bank) return;
      const secEnd = this.top + this.len + viewH;
      const dist = (y + viewH >= this.top && y <= secEnd)
        ? 0
        : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      const prev = distMap.get(this.bank.key);
      if (prev === undefined || dist < prev) distMap.set(this.bank.key, dist);
    }

    draw(pos) {
      if (!this.bank) return;
      const f = Math.round(clamp(pos, 0, this.count - 1));
      if (this.lastDrawnIdx === f && this.lastDrawnExact && !this.dirty) return;

      const hit = this.bank.getBestDrawable(f);
      if (!hit || !hit.img) return;
      const img = hit.img;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      if (this.lastDrawnIdx === hit.frameIdx && this.lastDrawnExact === hit.exact && !this.dirty) return;

      const c = this.canvas, ctx = this.ctx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;

      if (!this.hasCanvasClass) {
        this.hasCanvasClass = true;
        this.el.classList.add("has-canvas");
      }

      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, x, y, dw, dh);
      this.lastDrawnIdx = hit.frameIdx;
      this.lastDrawnExact = hit.exact;
      this.dirty = false;
    }

    setVisualFilter(blurPx, grayVal = 0) {
      // Evita Gaussian blur GPU en vivo sobre canvas 1080p+; mantiene grayscale ligero con saltos discretos
      const g = Math.max(0, Math.min(1, Math.round(grayVal * 20) / 20));
      if (g === this.lastGray) return;
      this.lastGray = g;
      const f = g > 0.02 ? `grayscale(${g})` : "none";
      this.canvas.style.filter = f;
      if (this.posterImg) this.posterImg.style.filter = f;
    }

    setText(el, o, ty) {
      const op = o.toFixed(3);
      const tr = ty ? `translate3d(0, ${ty.toFixed(2)}vh, 0)` : "none";
      const vis = o <= 0.001 ? "hidden" : "visible";
      if (el._lastOp !== op) { el._lastOp = op; el.style.opacity = op; }
      if (el._lastTr !== tr) { el._lastTr = tr; el.style.transform = tr; }
      if (el._lastVis !== vis) { el._lastVis = vis; el.style.visibility = vis; }
    }

    updateTrace(traceTarget, p, viewportEntry, dt) {
      const st = this.stage.style;
      const k = reduce ? 1 : (dt ? Math.min(1, 1 - Math.exp(-13 * dt)) : 0.22);
      this.traceCur += (traceTarget - this.traceCur) * k;
      if (Math.abs(traceTarget - this.traceCur) < 0.001) this.traceCur = traceTarget;
      const tp = clamp(this.traceCur, 0, 1);

      const entryShiftY = -(1 - smooth(viewportEntry)) * (vh * 0.14);
      const outro = smooth(range(p, 0.92, 1.15));
      const hudOp = smooth(range(viewportEntry, 0.10, 0.58)) * (1 - outro * 0.85);
      st.setProperty("--trace-entry-y", `${entryShiftY.toFixed(1)}px`);
      st.setProperty("--trace-hud-op", hudOp.toFixed(3));

      const totalLen = this.tracePathLen || 1034;
      const curLen = tp * totalLen;
      const dashOffset = (totalLen - curLen).toFixed(1);
      if (this.tracePathCore) this.tracePathCore.style.strokeDashoffset = dashOffset;
      if (this.tracePathGlow) this.tracePathGlow.style.strokeDashoffset = dashOffset;

      let yawReading = 78;
      if (this.tracePathCore && this.traceDrone) {
        try {
          const pt = this.tracePathCore.getPointAtLength(curLen);
          const p1 = this.tracePathCore.getPointAtLength(Math.max(0, curLen - 6));
          const p2 = this.tracePathCore.getPointAtLength(Math.min(totalLen, curLen + 6));
          const tangentDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
          const patioLook = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -24;
          const naveLook = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
          const coneDeg = tangentDeg + patioLook + naveLook;
          yawReading = Math.round((90 + coneDeg + 360) % 360);
          this.traceDrone.setAttribute("transform", `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
          if (this.traceDroneRot) this.traceDroneRot.setAttribute("transform", `rotate(${coneDeg.toFixed(1)})`);
        } catch (_) {}
      }

      if (this.tracePathCoreV) {
        const totalLenV = this.tracePathLenV || 690;
        const curLenV = tp * totalLenV;
        const dashOffsetV = (totalLenV - curLenV).toFixed(1);
        this.tracePathCoreV.style.strokeDashoffset = dashOffsetV;
        if (this.tracePathGlowV) this.tracePathGlowV.style.strokeDashoffset = dashOffsetV;

        if (this.traceDroneV) {
          try {
            const ptV = this.tracePathCoreV.getPointAtLength(curLenV);
            const p1V = this.tracePathCoreV.getPointAtLength(Math.max(0, curLenV - 6));
            const p2V = this.tracePathCoreV.getPointAtLength(Math.min(totalLenV, curLenV + 6));
            const tangentDegV = Math.atan2(p2V.y - p1V.y, p2V.x - p1V.x) * (180 / Math.PI);
            const patioLookV = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -20;
            const naveLookV = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
            const coneDegV = (tangentDegV - 90) + patioLookV + naveLookV;
            if (window.matchMedia && window.matchMedia("(max-aspect-ratio: 9/10)").matches) {
              yawReading = Math.round((tangentDegV + patioLookV + naveLookV + 360) % 360);
            }
            this.traceDroneV.setAttribute("transform", `translate(${ptV.x.toFixed(1)}, ${ptV.y.toFixed(1)})`);
            if (this.traceDroneRotV) this.traceDroneRotV.setAttribute("transform", `rotate(${coneDegV.toFixed(1)})`);
          } catch (_) {}
        }
      }

      st.setProperty("--trace-darken-op", smooth(range(tp, 0.12, 0.28)).toFixed(3));
      st.setProperty("--trace-grid-op", smooth(range(tp, 0.14, 0.26)).toFixed(3));
      st.setProperty("--trace-plan-op", smooth(range(tp, 0.15, 0.23)).toFixed(3));
      st.setProperty("--trace-draw-1", smooth(range(tp, 0.15, 0.28)).toFixed(3));
      st.setProperty("--trace-draw-2", smooth(range(tp, 0.21, 0.35)).toFixed(3));
      st.setProperty("--trace-draw-3", smooth(range(tp, 0.27, 0.41)).toFixed(3));
      st.setProperty("--trace-sec1-op", smooth(range(tp, 0.15, 0.24)).toFixed(3));
      st.setProperty("--trace-sec2-op", smooth(range(tp, 0.20, 0.30)).toFixed(3));
      st.setProperty("--trace-sec3-op", smooth(range(tp, 0.26, 0.37)).toFixed(3));
      st.setProperty("--trace-ghost-op", ((0.14 + 0.32 * smooth(range(tp, 0.18, 0.32))) * (1 - smooth(range(tp, 0.92, 0.99)))).toFixed(3));

      const wakeWave = range(tp, 0.15, 0.30);
      if (this.traceWakeRing) {
        if (wakeWave > 0 && wakeWave < 1) {
          this.traceWakeRing.setAttribute("r", (10 + smooth(wakeWave) * 195).toFixed(1));
          this.traceWakeRing.setAttribute("stroke-opacity", (Math.sin(wakeWave * Math.PI) * 0.52).toFixed(3));
        } else {
          this.traceWakeRing.setAttribute("stroke-opacity", "0");
        }
      }
      if (this.traceWakeRingV) {
        if (wakeWave > 0 && wakeWave < 1) {
          this.traceWakeRingV.setAttribute("r", (10 + smooth(wakeWave) * 150).toFixed(1));
          this.traceWakeRingV.setAttribute("stroke-opacity", (Math.sin(wakeWave * Math.PI) * 0.52).toFixed(3));
        } else {
          this.traceWakeRingV.setAttribute("stroke-opacity", "0");
        }
      }

      let camX = 0, camY = 0, camScale = 1, camRx = 0, camRy = 0;
      if (vw / vh < 0.95 || vw <= 768) {
        camY = (0.35 - tp * 0.70) * 16;
      } else {
        const introFocus = 1 - smooth(range(tp, 0.12, 0.36));
        camScale = 1 + introFocus * 0.05;
        camX = introFocus * 42 + (finePointer && !reduce ? normMx * -7 : 0);
        camY = finePointer && !reduce ? normMy * -5 : 0;
        camRx = finePointer && !reduce ? -normMy * 1.2 : 0;
        camRy = finePointer && !reduce ? normMx * 1.6 : 0;
      }
      st.setProperty("--trace-cam-x", `${camX.toFixed(1)}px`);
      st.setProperty("--trace-cam-y", `${camY.toFixed(1)}px`);
      st.setProperty("--trace-cam-scale", camScale.toFixed(4));
      st.setProperty("--trace-cam-rx", `${camRx.toFixed(2)}deg`);
      st.setProperty("--trace-cam-ry", `${camRy.toFixed(2)}deg`);

      const zoneIdx = tp < 0.24 ? 0 : (tp < 0.50 ? 1 : (tp < 0.78 ? 2 : 3));
      const activeRoomNum = zoneIdx === 1 ? "2" : (zoneIdx === 2 ? "3" : (zoneIdx === 3 ? "4" : "1"));
      this.traceRooms.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoom === activeRoomNum));
      this.traceRoomsV.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoomV === activeRoomNum));

      if (zoneIdx !== this.lastTraceZone) {
        if (this.lastTraceZone !== -1 && viewportEntry > 0.2) playTactileTick(620 + zoneIdx * 55, 0.025, 0.018);
        this.lastTraceZone = zoneIdx;
      }

      const wpThresholds = [0.0, 0.25, 0.41, 0.59, 0.79, 0.96];
      this.traceWps.forEach((wp, idx) => wp.classList.toggle("is-reached", tp >= (wpThresholds[idx] || 0)));
      this.traceWpsV.forEach((wp, idx) => wp.classList.toggle("is-reached", tp >= (wpThresholds[idx] || 0)));

      const rippleT = smooth(range(tp, 0.76, 0.96));
      st.setProperty("--trace-ripple-op", rippleT.toFixed(3));
      st.setProperty("--trace-ripple-s", (0.82 + rippleT * 0.36).toFixed(3));

      const meters = (tp * 64.8).toFixed(1);
      const altM = tp < 0.22 ? (1.85 - (tp / 0.22) * 0.15) : (tp < 0.78 ? 1.70 : (1.70 - ((tp - 0.78) / 0.22) * 0.25));
      if (this.traceDroneTxt) this.traceDroneTxt.textContent = `${meters}m · +${altM.toFixed(2)}m`;
      if (this.traceDroneTxtV) this.traceDroneTxtV.textContent = `${meters}m · +${altM.toFixed(2)}m`;
      if (this.traceDistEl) this.traceDistEl.textContent = `${meters} m`;
      if (this.traceAltEl) this.traceAltEl.textContent = `+${altM.toFixed(2)} m`;
      if (this.traceYawEl) this.traceYawEl.textContent = `${pad(yawReading, 3)}° E`;
      if (this.traceTcEl) this.traceTcEl.textContent = `00:${pad(Math.min(14, Math.floor(tp * 14)))}`;

      const phaseLabels = ["01 · Aproximación", "02 · Acceso y umbral", "03 · Recorrido interior", "04 · Salida al parque"];
      const roomLabels = ["Aproximación Exterior", "Ingreso Principal", "Espacio Central", "Jardín & Agua"];
      const planStates = ["Exterior", "Ingreso", "Interior", "Completado"];
      if (this.tracePhasePill) this.tracePhasePill.textContent = phaseLabels[zoneIdx];
      if (this.traceRoomNameEl) this.traceRoomNameEl.textContent = roomLabels[zoneIdx];
      if (this.tracePlanStateEl) this.tracePlanStateEl.textContent = planStates[zoneIdx];

      this.traceActs.forEach(({ n: el, r: [a, b] }) => {
        const t = (tp - a) / (b - a);
        if (t <= 0 || t >= 1) {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
          return;
        }
        const fadeIn = a < 0 ? range(t, 0, 0.14) : range(t, 0, 0.2);
        const fadeOut = b > 1 ? 1 : (1 - range(t, 0.8, 1));
        const o = smooth(Math.min(fadeIn, fadeOut));
        el.style.visibility = o <= 0.005 ? "hidden" : "visible";
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((0.5 - t) * 10).toFixed(1)}px, 0)`;
      });
    }

    update(dt, isScrolling = true) {
      const n = this.count;
      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);
      const st = this.stage.style;
      const sv = this._stageVars;

      if (!this.set && viewportEntry > 0) this.load();
      if (y + vh < this.top - vh || y > this.top + this.len + vh) {
        if (!this.isOffscreen) {
          this.isOffscreen = true;
          this.el.classList.add("is-offscreen");
        }
        return;
      }
      if (this.isOffscreen) {
        this.isOffscreen = false;
        this.el.classList.remove("is-offscreen");
      }

      if (!this.isHero && viewportEntry <= 0) {
        if (this.lastRenderedState !== "pre" || this.dirty) {
          this.lastRenderedState = "pre";
          this.needsVisualSync = true;
          this.cur = 0;
          this.progress = 0;
          if (this.isKinetic) {
            setCssVar(st, sv, "--kseq-clip-x", "28%");
            setCssVar(st, sv, "--kseq-clip-y", "6%");
            setCssVar(st, sv, "--kseq-ty", "0px");
            setCssVar(st, sv, "--kseq-curtain-y", "0px");
            setCssVar(st, sv, "--kseq-scale", "0.94");
            setCssVar(st, sv, "--kseq-hud-op", "0");
            setCssVar(st, sv, "--kseq-inner-hud", "0");
            setCssVar(st, sv, "--outro-card-op", "0");
            setCssVar(st, sv, "--outro-card-vis", "hidden");
            setCssVar(st, sv, "--outro-card-pe", "none");
            if (this.kWingL) { this.kWingL.style.opacity = "1"; this.kWingL.style.transform = "translate3d(0,0,0)"; }
            if (this.kWingR) { this.kWingR.style.opacity = "1"; this.kWingR.style.transform = "translate3d(0,0,0)"; }
          } else if (this.isCinema) {
            const cs = this.el.style;
            const ev = this._elVars;
            setCssVar(cs, ev, "--cinema-line", "0");
            setCssVar(cs, ev, "--cinema-line-op", "0");
            setCssVar(cs, ev, "--cinema-clip-x", "10%");
            setCssVar(cs, ev, "--cinema-clip-y", "48.2%");
            setCssVar(cs, ev, "--cinema-ty", "0px");
            setCssVar(cs, ev, "--cinema-scale", "1.035");
            setCssVar(cs, ev, "--cinema-beam-op", "0.35");
            setCssVar(cs, ev, "--cinema-beam-s", "0.35");
            setCssVar(cs, ev, "--cinema-prelude-op", "1");
            setCssVar(cs, ev, "--cinema-prelude-y", "0px");
            setCssVar(cs, ev, "--cinema-hud-op", "0");
            setCssVar(cs, ev, "--cinema-marks-op", "0");
            setCssVar(cs, ev, "--cinema-ambient", "0");
            setCssVar(cs, ev, "--cinema-border", "0.08");
            setCssVar(cs, ev, "--cinema-shadow", "0.4");
            setCssVar(cs, ev, "--cinema-blackout", "0");
            if (this.lastCinemaPassed) {
              this.lastCinemaPassed = false;
              this.el.classList.remove("is-cinema-passed");
            }
            if (this.cinemaPrelude) this.cinemaPrelude.style.visibility = "visible";
            this.setVisualFilter(0, 0.25);
          } else if (this.isTrace) {
            this.traceCur = 0;
            this.updateTrace(0, -0.2, 0, 0.016);
          } else {
            setCssVar(st, sv, "--frame-scale", (this.fullScale || 1).toFixed(4));
            setCssVar(st, sv, "--chrome-opacity", "0");
            setCssVar(st, sv, "--chrome-vis", "hidden");
          }
          this.draw(0);
          this.lastCur = 0;
        }
        return;
      }

      const exitRange = 0.2;
      const pinMaxProg = 0.9;

      if (rawP >= 1.0 + exitRange) {
        if (this.lastRenderedState !== "post" || this.dirty) {
          this.lastRenderedState = "post";
          this.needsVisualSync = true;
          this.cur = n - 1;
          this.progress = 1;
          if (this.isTrace) {
            this.traceCur = 1;
            this.updateTrace(1, 1.0 + exitRange, 1, 0.016);
          }
          if (this.isKinetic) {
            setCssVar(st, sv, "--kseq-clip-x", "0%");
            setCssVar(st, sv, "--kseq-clip-y", "0%");
            setCssVar(st, sv, "--kseq-scale", "1");
            setCssVar(st, sv, "--kseq-hud-op", "0.2");
            setCssVar(st, sv, "--kseq-inner-hud", "0");
            if (this.kWingL) this.kWingL.style.opacity = "0";
            if (this.kWingR) this.kWingR.style.opacity = "0";
          } else if (this.isCinema) {
            const cs = this.el.style;
            const ev = this._elVars;
            setCssVar(cs, ev, "--cinema-line", "1");
            setCssVar(cs, ev, "--cinema-line-op", "0");
            setCssVar(cs, ev, "--cinema-clip-x", "0%");
            setCssVar(cs, ev, "--cinema-clip-y", "0%");
            setCssVar(cs, ev, "--cinema-scale", "0.982");
            setCssVar(cs, ev, "--cinema-beam-op", "0");
            setCssVar(cs, ev, "--cinema-prelude-op", "0");
            setCssVar(cs, ev, "--cinema-hud-op", "0");
            setCssVar(cs, ev, "--cinema-marks-op", "0");
            setCssVar(cs, ev, "--cinema-ambient", "0");
            setCssVar(cs, ev, "--cinema-border", "0");
            setCssVar(cs, ev, "--cinema-shadow", "0");
            setCssVar(cs, ev, "--cinema-blackout", "1");
            if (!this.lastCinemaPassed) {
              this.lastCinemaPassed = true;
              this.el.classList.add("is-cinema-passed");
            }
            if (this.cinemaPrelude) this.cinemaPrelude.style.visibility = "hidden";
            this.draw(n - 1);
            this.lastCur = n - 1;
          } else if (!this.isFullscreen) {
            setCssVar(st, sv, "--frame-scale", "1");
          }
          if (this.outroCard) {
            setCssVar(st, sv, "--cover-opacity", "0.36");
            setCssVar(st, sv, "--frame-opacity", "1");
            setCssVar(st, sv, "--chrome-opacity", "1");
            setCssVar(st, sv, "--chrome-vis", "visible");
            setCssVar(st, sv, "--outro-card-op", "1");
            setCssVar(st, sv, "--outro-card-vis", "visible");
            setCssVar(st, sv, "--outro-card-ty", "0px");
            setCssVar(st, sv, "--outro-card-pe", "auto");
          }
          if (this.scrubFill && this.lastPctVal !== 100) {
            this.lastPctVal = 100;
            this.scrubFill.style.width = "100%";
          }
        }
        return;
      }

      const wasActive = this.lastRenderedState === "active";
      this.lastRenderedState = "active";
      const p = rawP;
      let prog = 0;

      if (this.isHybrid) {
        const baseDuration = this.customDuration || (this.isHero ? 7.2 : (this.isKinetic ? 12.5 : (this.isCinema ? 13.5 : (this.isTrace ? 10.8 : 9.8))));
        const nextTraceTop = (this.isCinema && typeof traceReels !== "undefined" && traceReels.length) ? traceReels[0].top : (this.top + this.len);
        const cinemaPeek = this.isCinema ? Math.max(2, (nextTraceTop - (this.top + this.len)) + 2) : undefined;
        const curIdx = clamp(Math.round(this.cur), 0, n - 1);
        const bufferReady = !!(this.bank && this.bank.hasContiguousAhead(curIdx, 6));
        if (!(this.isCinema && y >= nextTraceTop)) {
          runHybridScrollEngine({
            top: this.top,
            len: this.len,
            dt,
            viewportEntry,
            rawP,
            baseDuration,
            peekPx: cinemaPeek,
            minSpeed: this.isCinema ? 0.72 : 0.45,
            state: this,
            hasFrames: bufferReady,
            isHero: this.isHero,
          });
        }

        if (this.isHero) {
          if (rawP <= 0.0) prog = 0;
          else if (rawP <= 1.0) prog = rawP * pinMaxProg;
          else prog = pinMaxProg + Math.sin(clamp((rawP - 1.0) / exitRange) * Math.PI * 0.5) * (1.0 - pinMaxProg);
        } else {
          const pPlayStart = -Math.min(0.5, (vh * 0.8) / this.len);
          const preShare = 0.055;
          const pinEndProg = this.isCinema ? 1.0 : 0.95;

          if (rawP < pPlayStart) prog = 0;
          else if (rawP < 0.0) prog = preShare * Math.pow(clamp((rawP - pPlayStart) / (-pPlayStart)), 1.35);
          else if (rawP <= 1.0) prog = preShare + rawP * (pinEndProg - preShare);
          else prog = pinEndProg + Math.sin(clamp((rawP - 1.0) / exitRange) * Math.PI * 0.5) * (1.0 - pinEndProg);
        }
      }

      prog = clamp(prog, 0, 1);
      this.progress = prog;

      const targetF = prog * (n - 1);
      const k = reduce ? 1 : (this.isHybrid ? (1 - Math.exp(-26 * dt)) : (1 - Math.exp(-14 * dt)));
      this.cur += (targetF - this.cur) * k;
      if (Math.abs(targetF - this.cur) < 0.002) this.cur = targetF;

      const curChanged = Math.abs(this.cur - this.lastCur) > 0.002 || this.dirty;
      if (curChanged) {
        this.draw(this.cur);
        this.lastCur = this.cur;

        const f = Math.round(this.cur);
        if (f !== this.lastFrame) {
          this.lastFrame = f;
          if (this.tcEl) {
            const sec = Math.floor(f / this.fps);
            const fr = f % this.fps;
            setTextCached(this.tcEl, this._txtCache, "tc", `${pad(sec)}:${pad(fr)}`);
          }
          if (this.frEl) setTextCached(this.frEl, this._txtCache, "fr", pad(f + 1, 3));
          if (Math.abs(f - this.lastPumpFrame) >= 4) {
            this.lastPumpFrame = f;
            AssetScheduler.schedulePump();
          }
        }
        const pctVal = Math.round(prog * 1000) / 10;
        if (pctVal !== this.lastPctVal) {
          this.lastPctVal = pctVal;
          if (this.scrubFill) this.scrubFill.style.width = `${pctVal}%`;
          if (this.scrub) this.scrub.setAttribute("aria-valuenow", String(Math.round(pctVal)));
        }
      }

      const morph = (!this.isFullscreen && !this.isKinetic && !this.isCinema) ? smooth(range(p, 0.0, 0.26)) : 0;
      const outro = (!this.isFullscreen && !this.isKinetic && !this.isCinema) ? smooth(range(prog, 0.86, 1.0)) : 0;

      if (wasActive && !this.needsVisualSync && !isScrolling && !curChanged) {
        return;
      }
      this.needsVisualSync = false;

      if (this.isFullscreen) {
        setCssVar(st, sv, "--frame-w", `${vw}px`);
        setCssVar(st, sv, "--frame-h", `${vh}px`);
        setCssVar(st, sv, "--img-scale", "1.02");
        setCssVar(st, sv, "--frame-opacity", "1");
        this.setVisualFilter(0, 0);
        if (this.isTrace) this.updateTrace(prog, p, viewportEntry, dt);
        return;
      }

      if (this.isKinetic) {
        const isMob = vw <= 900 || (vw / vh < 0.95);
        const openT = smooth(range(p, 0.02, 0.42));
        setCssVar(st, sv, "--kseq-clip-x", `${((1 - openT) * (isMob ? 24 : 30)).toFixed(2)}%`);
        setCssVar(st, sv, "--kseq-clip-y", `${((1 - openT) * 6).toFixed(2)}%`);

        const wakeT = smooth(range(p, -0.10, 0.08));
        const kOutro = smooth(range(prog, 0.88, 1.0));
        setCssVar(st, sv, "--cover-opacity", Math.max((1 - wakeT) * 0.34, kOutro * 0.44).toFixed(3));
        setCssVar(st, sv, "--frame-opacity", "1");
        this.setVisualFilter(0, 1 - wakeT);

        const wingMove = openT;
        const wingOp = 1 - smooth(range(p, 0.22, 0.40));
        const wingShiftX = wingMove * (isMob ? vw * 0.22 : vw * 0.20);
        const wingVis = wingOp <= 0.005 ? "hidden" : "visible";
        const wingOpStr = wingOp.toFixed(3);
        if (this.kWingL) {
          if (this.kWingL._vis !== wingVis) { this.kWingL._vis = wingVis; this.kWingL.style.visibility = wingVis; }
          if (wingVis === "visible") {
            this.kWingL.style.opacity = wingOpStr;
            this.kWingL.style.transform = `translate3d(${(-wingShiftX).toFixed(1)}px, 0, 0)`;
          } else if (this.kWingL._op !== "0") {
            this.kWingL._op = "0";
            this.kWingL.style.opacity = "0";
          }
        }
        if (this.kWingR) {
          if (this.kWingR._vis !== wingVis) { this.kWingR._vis = wingVis; this.kWingR.style.visibility = wingVis; }
          if (wingVis === "visible") {
            this.kWingR.style.opacity = wingOpStr;
            this.kWingR.style.transform = `translate3d(${wingShiftX.toFixed(1)}px, 0, 0)`;
          } else if (this.kWingR._op !== "0") {
            this.kWingR._op = "0";
            this.kWingR.style.opacity = "0";
          }
        }

        const mobEntryShiftY = isMob ? (-(1 - smooth(viewportEntry)) * (vh * 0.16)) : 0;
        setCssVar(st, sv, "--kseq-ty", `${mobEntryShiftY.toFixed(1)}px`);
        setCssVar(st, sv, "--kseq-curtain-y", `${mobEntryShiftY.toFixed(1)}px`);
        setCssVar(st, sv, "--kseq-scale", (0.94 + openT * 0.06).toFixed(4));

        const hudOp = smooth(range(p, 0.28, 0.44)) * (1 - smooth(range(p, 0.88, 0.96)));
        setCssVar(st, sv, "--kseq-hud-op", hudOp.toFixed(3));
        setCssVar(st, sv, "--kseq-hud-y", `${((1 - hudOp) * -8).toFixed(1)}px`);
        setCssVar(st, sv, "--kseq-bot-y", `${((1 - hudOp) * 8).toFixed(1)}px`);
        setCssVar(st, sv, "--kseq-inner-hud", (openT * (1 - kOutro)).toFixed(3));

        if (this.kPhase) {
          const ph = p < 0.22
            ? "Apertura"
            : (p < 0.56 ? "Aproximación" : (p < 0.84 ? "Interior" : "Film Máster 4K"));
          setTextCached(this.kPhase, this._txtCache, "kPhase", ph);
        }

        if (this.outroCard) {
          const outroCardT = smooth(range(p, 0.84, 0.94));
          setCssVar(st, sv, "--outro-card-op", outroCardT.toFixed(3));
          setCssVar(st, sv, "--outro-card-vis", outroCardT > 0.01 ? "visible" : "hidden");
          setCssVar(st, sv, "--outro-card-ty", `${((1 - outroCardT) * 14).toFixed(1)}px`);
          setCssVar(st, sv, "--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
        }
        return;
      }

      if (this.isCinema) {
        const cs = this.el.style;
        const ev = this._elVars;
        const isMob = vw <= 900 || (vw / vh < 0.95);
        const nextTraceTop = (typeof traceReels !== "undefined" && traceReels.length) ? traceReels[0].top : (this.top + this.len);
        const passed = y >= nextTraceTop;
        if (passed !== this.lastCinemaPassed) {
          this.lastCinemaPassed = passed;
          this.el.classList.toggle("is-cinema-passed", passed);
        }
        const lineT = reduce ? 1 : smooth(range(viewportEntry, 0.18, 0.88));
        const lineFade = reduce ? 0 : smooth(range(p, 0.10, 0.30));
        setCssVar(cs, ev, "--cinema-line", lineT.toFixed(3));
        setCssVar(cs, ev, "--cinema-line-op", (lineT * (1 - lineFade)).toFixed(3));

        const entryTy = isMob && !reduce ? -(1 - smooth(viewportEntry)) * (vh * 0.12) : 0;
        setCssVar(cs, ev, "--cinema-ty", `${entryTy.toFixed(1)}px`);

        const openT = reduce ? 1 : smooth(range(p, -0.02, 0.22));
        setCssVar(cs, ev, "--cinema-clip-x", `${((1 - openT) * (isMob ? 8 : 10)).toFixed(2)}%`);
        setCssVar(cs, ev, "--cinema-clip-y", `${((1 - openT) * 48.2).toFixed(2)}%`);

        const beamOp = reduce ? 0 : Math.sin(clamp(openT, 0, 1) * Math.PI) * 0.9 * (1 - openT * 0.85);
        setCssVar(cs, ev, "--cinema-beam-op", beamOp.toFixed(3));
        setCssVar(cs, ev, "--cinema-beam-s", (0.35 + openT * 0.65).toFixed(3));

        const preludeIn = reduce ? 0 : smooth(range(viewportEntry, 0.25, 0.82));
        const preludeOut = reduce ? 1 : smooth(range(p, 0.03, 0.18));
        const preludeOp = preludeIn * (1 - preludeOut);
        setCssVar(cs, ev, "--cinema-prelude-op", preludeOp.toFixed(3));
        setCssVar(cs, ev, "--cinema-prelude-y", `${(-preludeOut * 16).toFixed(1)}px`);
        if (this.cinemaPrelude) {
          const pVis = preludeOp <= 0.005 ? "hidden" : "visible";
          if (this.cinemaPrelude._vis !== pVis) {
            this.cinemaPrelude._vis = pVis;
            this.cinemaPrelude.style.visibility = pVis;
          }
        }

        const wakeT = reduce ? 1 : smooth(range(p, -0.04, 0.14));
        const cinemaDarken = smooth(range(p, 0.910, 0.985));
        const blackoutT = reduce ? (p >= 0.98 ? 1 : 0) : smooth(range(p, 0.930, 0.996));

        this.setVisualFilter(0, (1 - wakeT) * 0.28);
        const openScale = reduce ? 1 : (1 + (1 - openT) * 0.035);
        const endScale = reduce ? 1 : (1 - blackoutT * 0.018);
        setCssVar(cs, ev, "--cinema-scale", (openScale * endScale).toFixed(4));

        const hudIn = reduce ? 1 : smooth(range(p, 0.18, 0.30));
        const hudOp = hudIn * (1 - cinemaDarken);
        setCssVar(cs, ev, "--cinema-hud-op", hudOp.toFixed(3));
        setCssVar(cs, ev, "--cinema-hud-top-y", `${((1 - hudOp) * -8).toFixed(1)}px`);
        setCssVar(cs, ev, "--cinema-hud-bot-y", `${((1 - hudOp) * 8).toFixed(1)}px`);

        const marksOp = openT * (1 - cinemaDarken) * 0.85;
        const ambientOp = openT * (1 - cinemaDarken) * 0.55;
        setCssVar(cs, ev, "--cinema-marks-op", marksOp.toFixed(3));
        setCssVar(cs, ev, "--cinema-ambient", ambientOp.toFixed(3));
        setCssVar(cs, ev, "--cinema-amb-s", (0.96 + openT * 0.04).toFixed(3));
        setCssVar(cs, ev, "--cinema-border", (openT * (1 - cinemaDarken) * 0.14).toFixed(3));
        setCssVar(cs, ev, "--cinema-shadow", (openT * (1 - cinemaDarken)).toFixed(3));
        setCssVar(cs, ev, "--cinema-veil", (0.22 + cinemaDarken * 0.25).toFixed(3));
        setCssVar(cs, ev, "--cinema-blackout", blackoutT.toFixed(3));
        return;
      }

      /* Secuencias con reencuadre (#film-01 Hero & #film-04 Comercial) usando scale GPU sin reflow ni recorte */
      const inv = 1 - morph;
      const frameScale = 1 + ((this.fullScale || 1) - 1) * inv;
      setCssVar(st, sv, "--frame-scale", frameScale.toFixed(4));
      setCssVar(st, sv, "--img-scale", (1 + inv * (this.isHero ? 0.04 : 0.05)).toFixed(4));

      if (this.isHero) {
        const veilFade = 1 - smooth(range(p, 0.0, 0.24));
        setCssVar(st, sv, "--frame-veil", veilFade.toFixed(3));
        setCssVar(st, sv, "--cover-opacity", (outro * 0.44).toFixed(3));
        this.setVisualFilter(0, 0);
      } else {
        setCssVar(st, sv, "--frame-veil", "0");
        const wake = smooth(range(p, -0.14, 0.04));
        setCssVar(st, sv, "--cover-opacity", Math.max((1 - wake) * 0.36, outro * 0.44).toFixed(3));
        this.setVisualFilter(0, 1 - wake);
      }
      setCssVar(st, sv, "--frame-opacity", "1");

      if (this.hero) {
        const stHero = smooth(range(p, 0.0, 0.22));
        this.setText(this.hero, 1 - stHero, -stHero * 3);
        const heroGone = stHero >= 0.99;
        if (heroGone !== this.lastHeroGone) {
          this.lastHeroGone = heroGone;
          this.el.classList.toggle("is-hero-hidden", heroGone);
        }
        if (!heroGone) {
          if (this.heroL1) {
            this.heroL1.style.setProperty("--hero-l1-x", `${(-stHero * 22).toFixed(1)}px`);
            this.heroL1.style.setProperty("--hero-l1-y", `${(-stHero * 14).toFixed(1)}px`);
          }
          if (this.heroL2) {
            this.heroL2.style.setProperty("--hero-l2-x", `${(stHero * 28).toFixed(1)}px`);
            this.heroL2.style.setProperty("--hero-l2-y", `${(stHero * 10).toFixed(1)}px`);
          }
          if (this.heroFoot) {
            this.heroFoot.style.setProperty("--hero-foot-y", `${(stHero * 24).toFixed(1)}px`);
            this.heroFoot.style.opacity = Math.max(0, 1 - smooth(range(p, 0.0, 0.12))).toFixed(3);
          }
        }
      }

      if (this.lead) {
        const entryShiftVh = -(1 - smooth(viewportEntry)) * 18;
        const stLead = smooth(range(p, 0.0, 0.20));
        this.setText(this.lead, 1 - stLead, entryShiftVh - stLead * 3.5);
      }

      const chrome = smooth(range(p, 0.14, 0.26));
      setCssVar(st, sv, "--chrome-gap", `${vw <= 680 ? 12 : 16}px`);
      setCssVar(st, sv, "--chrome-top-y", `${((1 - chrome) * 10).toFixed(1)}px`);
      setCssVar(st, sv, "--chrome-bot-y", `${(-(1 - chrome) * 10).toFixed(1)}px`);
      setCssVar(st, sv, "--chrome-opacity", chrome.toFixed(3));
      setCssVar(st, sv, "--chrome-vis", chrome > 0.01 ? "visible" : "hidden");

      if (this.outroCard) {
        const outroCardT = smooth(range(p, 0.83, 0.93));
        setCssVar(st, sv, "--outro-card-op", outroCardT.toFixed(3));
        setCssVar(st, sv, "--outro-card-vis", outroCardT > 0.01 ? "visible" : "hidden");
        setCssVar(st, sv, "--outro-card-ty", `${((1 - outroCardT) * 14).toFixed(1)}px`);
        setCssVar(st, sv, "--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
      }

      let shade = 0;
      for (let i = 0; i < this.chapters.length; i++) {
        const ch = this.chapters[i];
        const { n: el, r: [a, b], tick } = ch;
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (ch.lastVis !== "hidden") {
            ch.lastVis = "hidden";
            ch.lastOp = "0";
            el.style.opacity = "0";
            el.style.visibility = "hidden";
            if (tick) tick.classList.remove("is-active");
          }
          continue;
        }
        const o = smooth(Math.min(range(t, 0, 0.18), 1 - range(t, 0.82, 1)));
        shade = Math.max(shade, o);
        const vis = o > 0.01 ? "visible" : "hidden";
        const opStr = o.toFixed(3);
        if (ch.lastVis !== vis) { ch.lastVis = vis; el.style.visibility = vis; }
        if (ch.lastOp !== opStr) { ch.lastOp = opStr; el.style.opacity = opStr; }
        const tickOn = o > 0.15;
        if (tick && ch.lastTick !== tickOn) {
          ch.lastTick = tickOn;
          tick.classList.toggle("is-active", tickOn);
        }
        if (vis === "visible") {
          el.style.transform = `translate3d(0, ${((1 - o) * 10).toFixed(1)}px, 0)`;
        }
      }
      const hasGlow = shade > 0.08;
      if (hasGlow !== this.lastHasChapterGlow) {
        this.lastHasChapterGlow = hasGlow;
        this.el.classList.toggle("has-chapter-glow", hasGlow);
      }
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));

  /* ---------------------------------------------------------
     MOTOR DE ARCHIVO EN MOVIMIENTO (#archivo — Galería cinética 3D)
     --------------------------------------------------------- */
  function attachCardBank(card, set) {
    if (card.bank && card.loadedSet === set) return card.bank;
    if (card.unsubBank) { card.unsubBank(); card.unsubBank = null; }
    card.loadedSet = set;
    card.lastDrawnIdx = -1;
    card.lastDrawnExact = false;
    card.dirty = true;
    card.bank = getFrameBank(card.src, card.count, card.version, set);
    card.unsubBank = card.bank.subscribe((frameIdx, isBitmap) => {
      if (!isBitmap) return;
      const targetIdx = clamp(Math.round(card.curFrame) - 1, 0, card.count - 1);
      if (Math.abs(frameIdx - targetIdx) <= 2 || (frameIdx === targetIdx && !card.lastDrawnExact)) {
        card.dirty = true;
      }
    });
    return card.bank;
  }

  class ReelArchive {
    constructor(el) {
      this.el = el;
      this.stage = $(".reel__stage", el);
      this.deckWrap = $(".reel__deck-wrap", el);
      this.deck = $("[data-reel-deck]", el);
      this.strip = $("[data-reel-strip]", el);
      this.scrub = $(".reel__scrub", el);
      this.scrubFill = $("[data-reel-scrub-fill]", el);
      this.tcEl = $("[data-reel-tc]", el);

      this.modeLblEl = $("[data-reel-mode-lbl]", el);
      this.idxEl = $("[data-reel-idx]", el);
      this.totalEl = $("[data-reel-total]", el);
      this.topCatEl = $("[data-reel-top-cat]", el);
      this.topFpsEl = $("[data-reel-top-fps]", el);

      this.captionEl = $("[data-reel-caption]", el);
      this.capSlots = $$("[data-reel-cap-slot]", el).map((slot) => ({
        el: slot,
        num: $(".reel__cap-num", slot),
        cat: $(".reel__cap-cat", slot),
        loc: $(".reel__cap-loc", slot),
        title: $(".reel__cap-title", slot),
        desc: $(".reel__cap-desc", slot),
      }));
      this.capSlotIdx = 0;

      this.isHybrid = el.dataset.mode !== "manual";
      this.baseDuration = parseFloat(el.dataset.duration) || 12.8;
      this.autoPlayPaused = false;
      this.autoPlaySuspended = false;
      this.lastTrackedY = undefined;

      this.cards = [];
      this.thumbs = [];
      this.carouselCur = 0;
      this.progCur = 0;
      this.activeIdx = -1;
      this.tiltRx = 0;
      this.tiltRy = 0;
      this.prog = 0;
      this.set = null;
      this.isScrubbing = false;

      this.initCards();
      this.bindControls();
      this.measure();
      AssetScheduler.registerSource(this);
    }

    pickSet() {
      return "md";
    }

    initCards() {
      const cardEls = $$(".reel-card", this.deck);
      const total = cardEls.length;
      if (this.totalEl) this.totalEl.textContent = pad(total);

      cardEls.forEach((cardEl, idx) => {
        const src = cardEl.dataset.src;
        const count = Math.max(1, +(cardEl.dataset.count || 1));
        const from = clamp(+(cardEl.dataset.from || 1), 1, count);
        const to = clamp(+(cardEl.dataset.to || count), from, count);
        const version = cardEl.dataset.version || "";
        const fps = Math.max(12, +(cardEl.dataset.fps || 24));
        const span = Math.max(1, to - from + 1);
        const durSec = span / fps;
        const vParam = version ? `?v=${version}` : "";
        let aspect = 16 / 9;
        if (cardEl.dataset.aspect) {
          const parts = cardEl.dataset.aspect.split(/[/:]/).map(Number);
          if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            aspect = parts[0] / parts[1];
          }
        }

        cardEl.innerHTML = `
          <div class="reel-card__frame">
            <div class="reel-card__media">
              <canvas class="reel-card__canvas" aria-hidden="true"></canvas>
              <picture class="reel-card__poster">
                <img src="${src}/poster.jpg${vParam}" alt="" loading="${idx === 0 ? "eager" : "lazy"}" decoding="${idx === 0 ? "sync" : "async"}">
              </picture>
            </div>
            <div class="reel-card__vignette" aria-hidden="true"></div>
            <div class="reel-card__shade" aria-hidden="true"></div>
            <div class="reel-card__lead-veil" aria-hidden="true"></div>
            <div class="reel-card__marks" aria-hidden="true">
              <span class="seq__mark seq__mark--tl"></span>
              <span class="seq__mark seq__mark--tr"></span>
              <span class="seq__mark seq__mark--bl"></span>
              <span class="seq__mark seq__mark--br"></span>
            </div>
            <div class="reel-card__hud" aria-hidden="true">
              <span class="reel-card__chip reel-card__chip--idx">${pad(idx + 1)}</span>
              <span class="reel-card__chip">${durSec.toFixed(1)}s · FPV</span>
            </div>
            <span class="reel-card__prog" aria-hidden="true"><i></i></span>
          </div>
        `;

        const canvas = $(".reel-card__canvas", cardEl);
        const ctx = canvas.getContext("2d", { alpha: false });
        const progBar = $(".reel-card__prog i", cardEl);

        const item = {
          idx,
          el: cardEl,
          canvas,
          ctx,
          progBar,
          src,
          count,
          from,
          to,
          span,
          version,
          fps,
          aspect,
          cat: cardEl.dataset.cat || "Archivo FPV",
          loc: cardEl.dataset.loc || "Buenos Aires",
          title: cardEl.dataset.title || `Secuencia <em>${pad(idx + 1)}</em>`,
          desc: cardEl.dataset.desc || "",
          loadedSet: null,
          loading: false,
          lastDrawnImg: null,
          dirty: true,
          hasCanvas: false,
          lastProg: -1,
          curFrame: from,
          loopSec: 0,
          loopRate: 0,
          _css: {},
          lastThumbP: -1,
          wasExpanded: false,
        };

        cardEl.addEventListener("click", (e) => {
          if (performance.now() < this.suppressClickUntil) {
            e.preventDefault();
            return;
          }
          if (Math.abs(idx - this.carouselCur) >= 0.42) {
            this.seekToClip(idx);
          }
        });
        bindCursorTarget(cardEl);
        this.cards.push(item);

        if (this.strip) {
          const thumbBtn = document.createElement("button");
          thumbBtn.type = "button";
          thumbBtn.className = "reel__thumb";
          thumbBtn.setAttribute("role", "tab");
          thumbBtn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
          thumbBtn.setAttribute("aria-label", `Ver secuencia ${pad(idx + 1)}`);
          const thumbSrc = from > 1
            ? `${src}/md/${pad(from, 4)}.webp${vParam}`
            : `${src}/poster.jpg${vParam}`;
          thumbBtn.innerHTML = `
            <img src="${thumbSrc}" alt="" loading="lazy" decoding="async">
            <span class="reel__thumb-no">${pad(idx + 1)}</span>
            <span class="reel__thumb-bar" aria-hidden="true"></span>
          `;
          thumbBtn.addEventListener("click", () => this.seekToClip(idx));
          bindCursorTarget(thumbBtn);
          this.strip.appendChild(thumbBtn);
          this.thumbs.push(thumbBtn);
        }
      });
    }

    bindControls() {
      $$("[data-reel-toggle]", this.el).forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.togglePlayPause();
        });
        bindCursorTarget(btn);
      });

      const prevBtn = $("[data-reel-prev]", this.el);
      const nextBtn = $("[data-reel-next]", this.el);
      if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const target = Math.max(0, (this.activeIdx >= 0 ? this.activeIdx : 0) - 1);
          this.seekToClip(target);
        });
        bindCursorTarget(prevBtn);
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const target = Math.min(this.cards.length - 1, (this.activeIdx >= 0 ? this.activeIdx : 0) + 1);
          this.seekToClip(target);
        });
        bindCursorTarget(nextBtn);
      }

      if (this.scrub) {
        bindTimelineScrub(
          this.scrub,
          (r, opts) => this.seekToProgress(r, opts),
          (active) => { this.isScrubbing = active; }
        );
        this.scrub.addEventListener("keydown", (e) => {
          const step = e.shiftKey ? 0.12 : 0.04;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToProgress(clamp(this.prog + step)); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToProgress(clamp(this.prog - step)); }
        });
      }

      if (this.deckWrap) {
        let touchX = 0, touchY = 0, tracking = false;
        this.deckWrap.addEventListener("touchstart", (e) => {
          if (e.touches.length !== 1) return;
          touchX = e.touches[0].clientX;
          touchY = e.touches[0].clientY;
          tracking = true;
        }, { passive: true });
        this.deckWrap.addEventListener("touchend", (e) => {
          if (!tracking || !e.changedTouches.length) return;
          tracking = false;
          const dx = e.changedTouches[0].clientX - touchX;
          const dy = e.changedTouches[0].clientY - touchY;
          if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.35) {
            const cur = this.activeIdx >= 0 ? this.activeIdx : 0;
            const next = dx < 0 ? Math.min(this.cards.length - 1, cur + 1) : Math.max(0, cur - 1);
            if (next !== cur) this.seekToClip(next);
          }
        }, { passive: true });
      }
    }

    togglePlayPause() {
      if (this.prog >= 0.99) {
        this.autoPlayPaused = false;
        this.autoPlaySuspended = false;
        this.syncPauseUI();
        this.seekToProgress(0.01);
        playTactileTick(720, 0.025, 0.018);
        return;
      }
      this.autoPlayPaused = !this.autoPlayPaused;
      if (!this.autoPlayPaused) this.autoPlaySuspended = false;
      this.syncPauseUI();
      playTactileTick(this.autoPlayPaused ? 480 : 660, 0.02, 0.015);
    }

    syncPauseUI() {
      this.el.classList.toggle("is-paused", this.autoPlayPaused);
      if (this.modeLblEl) {
        this.modeLblEl.textContent = this.autoPlayPaused ? "Pausado" : "Auto · Activo";
      }
      $$("[data-reel-toggle]", this.el).forEach((btn) => {
        btn.setAttribute("aria-pressed", String(!this.autoPlayPaused));
      });
    }

    seekToProgress(p, opts = {}) {
      const targetP = clamp(p, 0, 1);
      const targetY = this.top + targetP * this.len;
      this.seekingUntil = performance.now() + (opts.immediate ? 120 : 780);
      if (!this.autoPlayPaused) this.autoPlaySuspended = false;
      scrollToTarget(targetY, { duration: 0.72, immediate: !!opts.immediate });
    }

    seekToClip(idx) {
      const n = Math.max(1, this.cards.length);
      const safeIdx = clamp(idx, 0, n - 1);
      const introShare = 0.11;
      const clipStart = n === 1 ? 0 : (safeIdx + (safeIdx === 0 ? 0.02 : 0.06)) / n;
      const targetP = clamp(introShare + clipStart * (1 - introShare), introShare, 0.985);
      this.seekToProgress(targetP);
      playTactileTick(620 + safeIdx * 24, 0.02, 0.014);
    }

    measure() {
      const portrait = vw / vh < 0.92 || vw <= 680;
      let w, h, step;
      if (portrait) {
        w = clamp(Math.round(vw * 0.82), 264, 540);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(160, Math.min(vh * 0.40, vh - 290));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.90);
      } else {
        w = clamp(Math.round(vw * 0.49), 380, 840);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(220, Math.min(vh * 0.46, vh - 310));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.84);
      }

      this.cardW = w;
      this.cardH = h;
      this.cardStep = step;
      this.stage.style.setProperty("--reel-w", `${w}px`);
      this.stage.style.setProperty("--reel-h", `${h}px`);

      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const dpr = Math.min(window.devicePixelRatio || 1, NET_PROFILE.maxReelDpr);
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      this.cards.forEach((c) => {
        if (c.canvas.width !== cw || c.canvas.height !== ch) {
          c.canvas.width = cw;
          c.canvas.height = ch;
          c.dirty = true;
        }
      });

      const nextSet = this.pickSet();
      if (this.set && nextSet !== this.set) {
        this.set = nextSet;
        this.cards.forEach((c) => { c.loadedSet = null; c.dirty = true; });
        if (this.activeIdx >= 0) this.loadNeighborhood(this.activeIdx);
      } else {
        this.set = nextSet;
      }
    }

    loadCard(card) {
      if (!card) return;
      const set = this.set || this.pickSet();
      attachCardBank(card, set);
      AssetScheduler.schedulePump();
    }

    loadNeighborhood(centerIdx) {
      if (!this.cards.length) return;
      const set = this.set || this.pickSet();
      const order = [centerIdx, centerIdx + 1, centerIdx - 1, centerIdx + 2];
      order.forEach((idx) => {
        if (idx >= 0 && idx < this.cards.length) attachCardBank(this.cards[idx], set);
      });
      AssetScheduler.schedulePump();
    }

    getLoadJobs(y, viewH) {
      if (!this.cards.length) return [];
      const secEnd = this.top + this.len + viewH;
      const inView = y + viewH >= this.top - viewH * 0.25 && y <= secEnd + viewH * 0.25;
      const dist = inView ? 0 : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      if (!inView && dist > viewH * 2.6 && NET_PROFILE.isConstrainedNet) return [];

      const set = this.set || this.pickSet();
      const center = this.activeIdx >= 0 ? this.activeIdx : 0;
      const jobs = [];
      this.cards.forEach((card, i) => {
        const d = Math.abs(i - center);
        if (!inView && d > 1) return;
        const bank = attachCardBank(card, set);
        const startIdx = card.from - 1;
        const endIdx = card.to - 1;
        const anchorIdx = clamp(Math.round(card.curFrame) - 1, startIdx, endIdx);
        if (inView) {
          if (i === center) {
            jobs.push({ bank, priority: 0, distance: 0, anchor: anchorIdx, start: startIdx, end: endIdx, isReel: true });
          } else if (d <= 2) {
            jobs.push({ bank, priority: d === 1 ? 1.1 : 2.1, distance: d, anchor: anchorIdx, start: startIdx, end: endIdx, isReel: true });
          } else {
            jobs.push({ bank, priority: 3.4, distance: d, anchor: startIdx, start: startIdx, end: startIdx, isReel: true });
          }
        } else {
          jobs.push({ bank, priority: i === center ? 1.2 : 3.5, distance: dist + d * 100, anchor: startIdx, start: startIdx, end: Math.min(endIdx, startIdx + 24), isReel: true });
        }
      });
      return jobs;
    }

    collectBankDistances(y, viewH, distMap) {
      const secEnd = this.top + this.len + viewH;
      const baseDist = (y + viewH >= this.top && y <= secEnd)
        ? 0
        : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      const center = this.activeIdx >= 0 ? this.activeIdx : 0;
      this.cards.forEach((c, i) => {
        if (!c.bank) return;
        const d = baseDist + Math.abs(i - center) * 200;
        const prev = distMap.get(c.bank.key);
        if (prev === undefined || d < prev) distMap.set(c.bank.key, d);
      });
    }

    nearestCached(card, frameNum) {
      if (!card.bank) return null;
      const hit = card.bank.getBestDrawable(clamp(frameNum - 1, 0, card.count - 1));
      return hit ? hit.img : null;
    }

    drawCard(card, frameFloat) {
      card.curFrame = frameFloat;
      const set = this.set || this.pickSet();
      const bank = attachCardBank(card, set);
      const targetIdx = clamp(Math.round(clamp(frameFloat, card.from, card.to)) - 1, 0, card.count - 1);
      if (card.lastDrawnIdx === targetIdx && card.lastDrawnExact && !card.dirty) return;

      const hit = bank.getBestDrawable(targetIdx);
      if (!hit || !hit.img) return;
      const img = hit.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      if (card.lastDrawnIdx === hit.frameIdx && card.lastDrawnExact === hit.exact && !card.dirty) return;

      const c = card.canvas;
      const ctx = card.ctx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, x, y, dw, dh);
      card.lastDrawnIdx = hit.frameIdx;
      card.lastDrawnExact = hit.exact;
      card.dirty = false;
      if (!card.hasCanvas) {
        card.hasCanvas = true;
        card.el.classList.add("has-canvas");
      }
    }

    setActiveClip(idx) {
      if (idx === this.activeIdx || !this.cards[idx]) return;
      const prevIdx = this.activeIdx;
      this.activeIdx = idx;
      const card = this.cards[idx];

      if (prevIdx >= 0) {
        playTactileTick(640, 0.016, 0.012);
      }

      this.cards.forEach((c, i) => c.el.classList.toggle("is-center", i === idx));
      this.thumbs.forEach((th, i) => {
        const active = i === idx;
        th.classList.toggle("is-active", active);
        th.setAttribute("aria-selected", String(active));
      });

      if (this.strip && this.thumbs[idx] && this.strip.scrollWidth > this.strip.clientWidth + 4) {
        const th = this.thumbs[idx];
        const targetLeft = th.offsetLeft - (this.strip.clientWidth - th.offsetWidth) * 0.5;
        if (this.strip.scrollTo) {
          this.strip.scrollTo({ left: Math.max(0, targetLeft), behavior: reduce ? "auto" : "smooth" });
        } else {
          this.strip.scrollLeft = Math.max(0, targetLeft);
        }
      }

      if (this.idxEl) this.idxEl.textContent = pad(idx + 1);
      if (this.topCatEl) this.topCatEl.textContent = card.cat.split("·")[0].trim();
      if (this.topFpsEl) this.topFpsEl.textContent = `${card.fps} FPS`;

      if (this.capSlots.length >= 2) {
        const fillSlot = (slot) => {
          if (slot.num) slot.num.textContent = pad(idx + 1);
          if (slot.cat) slot.cat.textContent = card.cat;
          if (slot.loc) slot.loc.textContent = card.loc;
          if (slot.title) slot.title.innerHTML = card.title;
          if (slot.desc) slot.desc.textContent = card.desc;
        };

        if (prevIdx < 0 || reduce) {
          const curSlot = this.capSlots[this.capSlotIdx];
          fillSlot(curSlot);
          curSlot.el.classList.remove("is-leaving");
          curSlot.el.classList.add("is-active");
          curSlot.el.setAttribute("aria-hidden", "false");
        } else {
          const outSlot = this.capSlots[this.capSlotIdx];
          const inIdx = 1 - this.capSlotIdx;
          const inSlot = this.capSlots[inIdx];
          this.capSlotIdx = inIdx;

          // Prepara el slot entrante en estado inicial (sin transición) antes de activarlo
          inSlot.el.style.transition = "none";
          inSlot.el.classList.remove("is-active", "is-leaving");
          fillSlot(inSlot);
          void inSlot.el.offsetWidth;
          inSlot.el.style.transition = "";

          outSlot.el.classList.remove("is-active");
          outSlot.el.classList.add("is-leaving");
          outSlot.el.setAttribute("aria-hidden", "true");

          inSlot.el.classList.add("is-active");
          inSlot.el.setAttribute("aria-hidden", "false");
        }
      }

      this.stage.style.setProperty("--reel-aura-s", idx % 2 === 0 ? "1.04" : "0.96");
      if (prevIdx < 0 && this.deckWrap && this.stage) {
        const sr = this.stage.getBoundingClientRect();
        const dr = this.deckWrap.getBoundingClientRect();
        this.deckCenterOffsetY = (sr.top + sr.height * 0.5) - (dr.top + dr.height * 0.5);
      }
      this.loadNeighborhood(idx);
    }

    update(dt) {
      const n = this.cards.length;
      if (!n) return;

      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);

      if (viewportEntry > 0 && this.activeIdx < 0) {
        this.setActiveClip(0);
      }
      if (y + vh < this.top - vh || y > this.top + this.len + vh) return;

      if (this.isHybrid && viewportEntry > 0 && rawP >= 0 && rawP < 1.05 && performance.now() > (this.seekingUntil || 0)) {
        const firstCard = this.cards[0];
        const hasFirst = !!this.nearestCached(firstCard, firstCard.from);
        runHybridScrollEngine({
          top: this.top,
          len: this.len,
          dt,
          viewportEntry,
          rawP,
          baseDuration: this.baseDuration,
          state: this,
          hasFrames: hasFirst || this.activeIdx >= 0,
          isHero: false,
        });
      }

      const targetProg = clamp(rawP, 0, 1);
      this.prog = targetProg;

      const dtSec = Math.min(dt || 0.016, 0.05);
      const isDirectSeek = this.isScrubbing || performance.now() <= (this.seekingUntil || 0);
      if (reduce) {
        this.progCur = targetProg;
      } else {
        const damp = 1 - Math.exp((isDirectSeek ? -16 : -22) * dtSec);
        this.progCur += (targetProg - this.progCur) * damp;
      }
      if (Math.abs(targetProg - this.progCur) < 0.00025) this.progCur = targetProg;

      const introShare = 0.11;
      const entryPart = smooth(range(viewportEntry, 0.12, 1)) * 0.42;
      const settlePart = this.progCur > 0 ? clamp(this.progCur / introShare, 0, 1) * 0.58 : 0;
      const introT = reduce ? (viewportEntry > 0.05 ? 1 : 0) : clamp(entryPart + settlePart, 0, 1);
      const settleEase = reduce ? 1 : (1 - Math.pow(1 - clamp((introT - 0.08) / 0.92, 0, 1), 2.5));
      const hudReveal = reduce ? 1 : smooth(range(introT, 0.54, 1.0));
      const sideReveal = reduce ? 1 : smooth(range(introT, 0.50, 1.0));
      const heroMaxFit = Math.min((vw * 0.88) / Math.max(1, this.cardW || 600), (vh * 0.78) / Math.max(1, this.cardH || 338));
      const heroScale = clamp(heroMaxFit, 1.24, 1.78);

      const carouselProg = clamp((this.progCur - introShare) / (1 - introShare), 0, 1);
      const seg = carouselProg * n;
      const segIdx = clamp(Math.floor(seg), 0, n - 1);
      const u = clamp(seg - segIdx, 0, 1);

      const dwellEnd = 0.55;
      const microDrift = 0.14;
      let carouselTarget = segIdx;
      if (segIdx < n - 1) {
        carouselTarget = u <= dwellEnd
          ? segIdx + (u / dwellEnd) * microDrift
          : segIdx + microDrift + smooth((u - dwellEnd) / (1 - dwellEnd)) * (1 - microDrift);
      }
      this.carouselCur = carouselTarget;

      const nearestIdx = clamp(Math.round(this.carouselCur), 0, n - 1);
      if (nearestIdx !== this.activeIdx) this.setActiveClip(nearestIdx);

      this.stage.style.setProperty("--reel-entry", hudReveal.toFixed(3));
      this.stage.style.setProperty("--reel-entry-y", "0px");
      this.stage.style.setProperty("--reel-hud", hudReveal.toFixed(3));
      this.stage.style.setProperty("--reel-hud-top-y", `${(-(1 - hudReveal) * 14).toFixed(1)}px`);
      this.stage.style.setProperty("--reel-hud-bot-y", `${((1 - hudReveal) * 18).toFixed(1)}px`);
      this.stage.style.setProperty("--reel-aura-op", (0.22 + 0.46 * smooth(range(introT, 0.08, 0.85))).toFixed(3));

      const targetRx = (!reduce && finePointer) ? (-normMy * 1.4) : 0;
      const targetRy = (!reduce && finePointer) ? (normMx * 1.9) : 0;
      this.tiltRx += (targetRx - this.tiltRx) * 0.1;
      this.tiltRy += (targetRy - this.tiltRy) * 0.1;

      const totalSeconds = Math.round(carouselProg * this.baseDuration);
      if (this.tcEl) this.tcEl.textContent = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
      if (this.scrubFill) this.scrubFill.style.width = `${(this.progCur * 100).toFixed(1)}%`;
      if (this.scrub) this.scrub.setAttribute("aria-valuenow", String(Math.round(this.progCur * 100)));

      this.cards.forEach((card, i) => {
        const d = i - this.carouselCur;
        const absD = Math.abs(d);
        const st = card.el.style;

        if (absD > 2.25) {
          st.setProperty("--rc-op", "0");
          st.setProperty("--rc-pe", "none");
          return;
        }

        const bell = Math.exp(-d * d * 2.1);
        let tx = d * this.cardStep * (1 - 0.04 * Math.min(absD, 2));
        let ty = (1 - bell) * 5;
        let scale = 0.80 + 0.20 * bell;
        const baseRy = clamp(-d * 9.5, -16, 16);
        let activeWeight = smooth(clamp(1 - absD * 1.25, 0, 1));
        let op = clamp(1 - Math.max(0, absD - 0.15) * 0.45, 0, 1);
        let shade = clamp((1 - bell) * 0.72, 0, 0.72);

        if (introT < 1) {
          if (i === 0) {
            const introScale = 1 + (heroScale - 1) * (1 - settleEase);
            scale *= introScale;
            ty += (1 - settleEase) * 26;
            op *= smooth(range(introT, 0.0, 0.52));
            activeWeight *= smooth(range(introT, 0.56, 0.98));
            shade = Math.max(shade, (1 - smooth(range(introT, 0.15, 0.72))) * 0.25);
          } else {
            op *= sideReveal;
            tx += (1 - sideReveal) * (this.cardW || 560) * 0.22;
          }
        }

        const rx = this.tiltRx * activeWeight;
        const ry = baseRy + this.tiltRy * activeWeight;
        const maxParallax = Math.max(4, (this.cardW || 300) * 0.032);
        const parallaxX = clamp(-d * maxParallax, -16, 16);

        st.setProperty("--rc-x", `${tx.toFixed(1)}px`);
        st.setProperty("--rc-y", `${ty.toFixed(1)}px`);
        st.setProperty("--rc-s", scale.toFixed(4));
        st.setProperty("--rc-rx", `${rx.toFixed(2)}deg`);
        st.setProperty("--rc-ry", `${ry.toFixed(2)}deg`);
        st.setProperty("--rc-op", op.toFixed(3));
        st.setProperty("--rc-shade", shade.toFixed(3));
        st.setProperty("--rc-act", activeWeight.toFixed(3));
        st.setProperty("--rc-px", `${parallaxX.toFixed(1)}px`);
        st.setProperty("--rc-ims", (1.10 - activeWeight * 0.08).toFixed(4));
        st.setProperty("--rc-pe", (absD < 1.35 && op > 0.25) ? "auto" : "none");
        st.setProperty("--rc-z", String(Math.round(50 - absD * 10)));

        const entryShare = 0.18;
        const exitShare = 0.82;
        const introDrift = 0.10;
        let clipP = 0;
        if (i < segIdx) {
          clipP = 1;
        } else if (i === segIdx) {
          if (i === 0 && i === n - 1) {
            clipP = this.progCur;
          } else if (i === 0) {
            if (this.progCur < introShare) {
              clipP = clamp(this.progCur / introShare, 0, 1) * introDrift;
            } else {
              const mainP = u <= dwellEnd
                ? (u / dwellEnd) * exitShare
                : exitShare + ((u - dwellEnd) / (1 - dwellEnd)) * (1 - exitShare);
              clipP = introDrift + mainP * (1 - introDrift);
            }
          } else if (i === n - 1) {
            clipP = entryShare + u * (1 - entryShare);
          } else {
            clipP = u <= dwellEnd
              ? entryShare + (u / dwellEnd) * (exitShare - entryShare)
              : exitShare + ((u - dwellEnd) / (1 - dwellEnd)) * (1 - exitShare);
          }
        } else if (i === segIdx + 1 && u > dwellEnd) {
          clipP = ((u - dwellEnd) / (1 - dwellEnd)) * entryShare;
        }

        const frameFloat = card.from + clipP * (card.span - 1);
        if (absD < 1.85) {
          this.drawCard(card, frameFloat);
        }

        if (Math.abs(clipP - card.lastProg) > 0.002) {
          card.lastProg = clipP;
          st.setProperty("--rc-prog", clipP.toFixed(3));
          if (this.thumbs[i]) {
            this.thumbs[i].style.setProperty("--th-p", (i === segIdx ? clipP : (i < segIdx ? 1 : 0)).toFixed(3));
          }
        }
      });
    }
  }

  const reels = $$(".reel:not(.tr-reel-layer)").map((el) => new ReelArchive(el));

  /* ---------------------------------------------------------
     MOTOR UNIFICADO: PLANIFICACIÓN EN PLANTA -> ARCHIVO EN MOVIMIENTO
     Escenario sticky único con disolución cartográfica, fusión de video
     y retroceso fluido al carrusel 3D.
     --------------------------------------------------------- */
  const TRACE_PLAN_END_P = 0.315;
  const BRIDGE_START_P = 0.29;
  const TRACE_MEDIA_END_P = 0.365;
  const BRIDGE_END_P = 0.415;
  const REEL_WAKE_P = BRIDGE_START_P + 0.28 * (BRIDGE_END_P - BRIDGE_START_P);

  class UnifiedTraceReel {
    constructor(el) {
      this.el = el;
      this.stage = $(".trace-reel__stage", el);
      this.traceMediaWrap = $("[data-tr-trace-media]", el);
      this.traceCanvas = $(".seq__canvas", this.traceMediaWrap);
      this.tracePosterImg = $(".seq__poster img", this.traceMediaWrap);
      this.traceCtx = this.traceCanvas.getContext("2d", { alpha: false });
      this.reelBgWrap = $("[data-tr-reel-bg]", el);
      this.traceOverlay = $("[data-tr-trace-overlay]", el);
      this.traceConsole = $(".trace__console", this.traceOverlay);
      this.reelLayer = $("[data-tr-reel-layer]", el);

      // Config secuencia planta (casa-greenville)
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.version = el.dataset.version || "";
      this.fps = +el.dataset.fps || 24;
      this.isHybrid = el.dataset.mode !== "manual";
      this.baseDuration = parseFloat(el.dataset.duration) || 29.5;
      this.autoPlayPaused = false;
      this.autoPlaySuspended = false;
      this.loopPaused = false;
      this.prevRawP = undefined;
      this.lastTrackedY = undefined;

      this.traceBank = null;
      this.unsubTraceBank = null;
      this.traceSet = null;
      this.traceFrameCur = 0;
      this.lastTraceFrameDrawn = -1;
      this.lastTraceDrawnExact = false;
      this.lastTraceHudFrame = -1;
      this.lastTracePctVal = -1;
      this.traceDirty = true;
      this.hasTraceCanvas = false;
      this.lastTraceBlur = -1;
      this.lastTraceGray = -1;
      this.traceCur = 0;
      this.lastTraceZone = -1;
      this.lastPreState = false;
      this.lastOverlayKey = "";
      this._ovVars = {};
      this._mediaVars = {};
      this._reelVars = {};
      this._bgVars = {};
      this._txtCache = {};
      this.isPortraitSvg = false;
      this.isOffscreen = false;
      this.traceOverlayHidden = false;
      this.reelLayerHidden = false;
      this.lastReelInteractive = false;
      this.lastWpMask = -1;
      this.lastTraceZoneUi = -1;
      this.traceBitmapsReleased = false;
      this.lastReelPct = -1;
      this.needsVisualSync = true;

      // Referencias SVG & HUD de planta
      this.tracePathCore = $("#tracePathCore", this.traceOverlay);
      this.tracePathGlow = $("#tracePathGlow", this.traceOverlay);
      this.traceDrone = $("[data-trace-drone]", this.traceOverlay);
      this.traceDroneRot = $("[data-trace-drone-rot]", this.traceOverlay);
      this.traceDroneTxt = $("[data-trace-drone-txt]", this.traceOverlay);
      this.traceWakeRing = $("[data-trace-wake]", this.traceOverlay);

      this.tracePathCoreV = $("#tracePathCoreV", this.traceOverlay);
      this.tracePathGlowV = $("#tracePathGlowV", this.traceOverlay);
      this.traceDroneV = $("[data-trace-drone-v]", this.traceOverlay);
      this.traceDroneRotV = $("[data-trace-drone-rot-v]", this.traceOverlay);
      this.traceDroneTxtV = $("[data-trace-drone-txt-v]", this.traceOverlay);
      this.traceWakeRingV = $("[data-trace-wake-v]", this.traceOverlay);

      this.tracePhasePill = $("[data-trace-phase-pill]", this.traceOverlay);
      this.traceAltEl = $("[data-trace-alt]", this.traceOverlay);
      this.traceYawEl = $("[data-trace-yaw]", this.traceOverlay);
      this.tracePlanStateEl = $("[data-trace-plan-state]", this.traceOverlay);
      this.traceDistEl = $("[data-trace-dist]", this.traceOverlay);
      this.traceRoomNameEl = $("[data-trace-room-name]", this.traceOverlay);
      this.traceTcEl = $("[data-trace-tc]", this.traceOverlay);
      this.traceFrEl = $("[data-hud-fr]", this.traceOverlay);
      this.traceScrub = $(".trace__scrub", this.traceOverlay);
      this.traceScrubFill = $("[data-scrub-fill]", this.traceOverlay);
      this.traceRooms = $$("[data-trace-room]", this.traceOverlay);
      this.traceRoomsV = $$("[data-trace-room-v]", this.traceOverlay);
      this.traceWps = $$("[data-trace-wp]", this.traceOverlay);
      this.traceWpsV = $$("[data-trace-wp-v]", this.traceOverlay);
      this.traceActs = $$("[data-trace-act]", this.traceOverlay).map((n) => ({
        n,
        r: n.dataset.traceAct.split(",").map(Number),
      }));

      this.tracePathLen = 1034;
      if (this.tracePathCore && typeof this.tracePathCore.getTotalLength === "function") {
        try {
          const len = this.tracePathCore.getTotalLength();
          if (len > 20) this.tracePathLen = len;
        } catch (_) {}
      }
      if (this.tracePathCore) {
        this.tracePathCore.style.strokeDasharray = `${this.tracePathLen}`;
        this.tracePathCore.style.strokeDashoffset = `${this.tracePathLen}`;
      }
      if (this.tracePathGlow) {
        this.tracePathGlow.style.strokeDasharray = `${this.tracePathLen}`;
        this.tracePathGlow.style.strokeDashoffset = `${this.tracePathLen}`;
      }

      this.tracePathLenV = 690;
      if (this.tracePathCoreV && typeof this.tracePathCoreV.getTotalLength === "function") {
        try {
          const lenV = this.tracePathCoreV.getTotalLength();
          if (lenV > 20) this.tracePathLenV = lenV;
        } catch (_) {}
      }
      if (this.tracePathCoreV) {
        this.tracePathCoreV.style.strokeDasharray = `${this.tracePathLenV}`;
        this.tracePathCoreV.style.strokeDashoffset = `${this.tracePathLenV}`;
      }
      if (this.tracePathGlowV) {
        this.tracePathGlowV.style.strokeDasharray = `${this.tracePathLenV}`;
        this.tracePathGlowV.style.strokeDashoffset = `${this.tracePathLenV}`;
      }

      // Referencias Archivo en Movimiento
      this.deckWrap = $(".reel__deck-wrap", this.reelLayer);
      this.deck = $("[data-reel-deck]", this.reelLayer);
      this.strip = $("[data-reel-strip]", this.reelLayer);
      this.reelScrub = $(".reel__scrub", this.reelLayer);
      this.reelScrubFill = $("[data-reel-scrub-fill]", this.reelLayer);
      this.reelTcEl = $("[data-reel-tc]", this.reelLayer);
      this.reelDuration = parseFloat(this.reelLayer.dataset.duration) || 39.0;

      this.modeLblEl = $("[data-reel-mode-lbl]", this.reelLayer);
      this.idxEl = $("[data-reel-idx]", this.reelLayer);
      this.totalEl = $("[data-reel-total]", this.reelLayer);
      this.topCatEl = $("[data-reel-top-cat]", this.reelLayer);
      this.topFpsEl = $("[data-reel-top-fps]", this.reelLayer);

      this.capSlots = $$("[data-reel-cap-slot]", this.reelLayer).map((slot) => ({
        el: slot,
        num: $(".reel__cap-num", slot),
        cat: $(".reel__cap-cat", slot),
        loc: $(".reel__cap-loc", slot),
        title: $(".reel__cap-title", slot),
        desc: $(".reel__cap-desc", slot),
      }));
      this.capSlotIdx = 0;

      this.cards = [];
      this.thumbs = [];
      this.carouselCur = 0;
      this.progCur = 0;
      this.prog = 0;
      this.activeIdx = -1;
      this.tiltRx = 0;
      this.tiltRy = 0;
      this.reelSet = null;
      this.openedPreload = false;
      this.isScrubbing = false;
      this.isHorizontalDragging = false;
      this.suppressClickUntil = 0;
      this.lastReelTcSec = -1;

      this.initCards();
      this.bindControls();
      this.measure();
      AssetScheduler.registerSource(this);
    }

    pickTraceSet() {
      const targetWidthPx = this.traceCanvas ? this.traceCanvas.width : Math.round(vw * NET_PROFILE.maxCanvasDpr);
      return pickOptimalSet({ portraitAllowed: true, targetWidthPx });
    }

    pickReelSet() {
      return "md";
    }

    initCards() {
      const cardEls = $$(".reel-card", this.deck);
      const total = cardEls.length;
      if (this.totalEl) this.totalEl.textContent = pad(total);

      cardEls.forEach((cardEl, idx) => {
        const src = cardEl.dataset.src;
        const count = Math.max(1, +(cardEl.dataset.count || 1));
        const from = clamp(+(cardEl.dataset.from || 1), 1, count);
        const to = clamp(+(cardEl.dataset.to || count), from, count);
        const version = cardEl.dataset.version || "";
        const fps = Math.max(12, +(cardEl.dataset.fps || 24));
        const span = Math.max(1, to - from + 1);
        const durSec = span / fps;
        const vParam = version ? `?v=${version}` : "";
        let aspect = 16 / 9;
        if (cardEl.dataset.aspect) {
          const parts = cardEl.dataset.aspect.split(/[/:]/).map(Number);
          if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            aspect = parts[0] / parts[1];
          }
        }

        cardEl.innerHTML = `
          <div class="reel-card__frame">
            <div class="reel-card__media">
              <canvas class="reel-card__canvas" aria-hidden="true"></canvas>
              <picture class="reel-card__poster">
                <img src="${src}/poster.jpg${vParam}" alt="" loading="${idx === 0 ? "eager" : "lazy"}" decoding="${idx === 0 ? "sync" : "async"}">
              </picture>
            </div>
            <div class="reel-card__vignette" aria-hidden="true"></div>
            <div class="reel-card__shade" aria-hidden="true"></div>
            <div class="reel-card__lead-veil" aria-hidden="true"></div>
            <div class="reel-card__marks" aria-hidden="true">
              <span class="seq__mark seq__mark--tl"></span>
              <span class="seq__mark seq__mark--tr"></span>
              <span class="seq__mark seq__mark--bl"></span>
              <span class="seq__mark seq__mark--br"></span>
            </div>
            <div class="reel-card__hud" aria-hidden="true">
              <span class="reel-card__chip reel-card__chip--idx">${pad(idx + 1)}</span>
              <span class="reel-card__chip">${durSec.toFixed(1)}s · FPV</span>
            </div>
            <span class="reel-card__prog" aria-hidden="true"><i></i></span>
          </div>
        `;

        const canvas = $(".reel-card__canvas", cardEl);
        const ctx = canvas.getContext("2d", { alpha: false });
        const progBar = $(".reel-card__prog i", cardEl);

        const item = {
          idx,
          el: cardEl,
          canvas,
          ctx,
          progBar,
          src,
          count,
          from,
          to,
          span,
          version,
          fps,
          aspect,
          cat: cardEl.dataset.cat || "Archivo FPV",
          loc: cardEl.dataset.loc || "Buenos Aires",
          title: cardEl.dataset.title || `Secuencia <em>${pad(idx + 1)}</em>`,
          desc: cardEl.dataset.desc || "",
          loadedSet: null,
          lastDrawnImg: null,
          dirty: true,
          hasCanvas: false,
          lastProg: -1,
          curFrame: from,
          loopSec: 0,
          loopRate: 0,
          _css: {},
          lastThumbP: -1,
          wasExpanded: false,
        };

        cardEl.addEventListener("click", (e) => {
          if (performance.now() < this.suppressClickUntil) {
            e.preventDefault();
            return;
          }
          if (Math.abs(idx - this.carouselCur) >= 0.42) {
            this.seekToClip(idx);
          }
        });
        bindCursorTarget(cardEl);
        this.cards.push(item);

        if (this.strip) {
          const thumbBtn = document.createElement("button");
          thumbBtn.type = "button";
          thumbBtn.className = "reel__thumb";
          thumbBtn.setAttribute("role", "tab");
          thumbBtn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
          thumbBtn.setAttribute("aria-label", `Ver secuencia ${pad(idx + 1)}`);
          const thumbSrc = from > 1
            ? `${src}/md/${pad(from, 4)}.webp${vParam}`
            : `${src}/poster.jpg${vParam}`;
          thumbBtn.innerHTML = `
            <img src="${thumbSrc}" alt="" loading="lazy" decoding="async">
            <span class="reel__thumb-no">${pad(idx + 1)}</span>
            <span class="reel__thumb-bar" aria-hidden="true"></span>
          `;
          thumbBtn.addEventListener("click", () => this.seekToClip(idx));
          bindCursorTarget(thumbBtn);
          this.strip.appendChild(thumbBtn);
          this.thumbs.push(thumbBtn);
        }
      });
    }

    bindControls() {
      // Scrub de Planificación en Planta (0..TRACE_PLAN_END_P)
      if (this.traceScrub) {
        bindTimelineScrub(
          this.traceScrub,
          (r, opts) => this.seekToUnifiedProgress(r * TRACE_PLAN_END_P, opts),
          (active) => { this.isScrubbing = active; }
        );
        this.traceScrub.addEventListener("keydown", (e) => {
          const step = (e.shiftKey ? 0.1 : 0.04) * TRACE_PLAN_END_P;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog + step, 0, TRACE_PLAN_END_P)); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog - step, 0, TRACE_PLAN_END_P)); }
        });
      }

      // Controles de Archivo en Movimiento
      $$("[data-reel-toggle]", this.reelLayer).forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.togglePlayPause();
        });
        bindCursorTarget(btn);
      });

      const prevBtn = $("[data-reel-prev]", this.reelLayer);
      const nextBtn = $("[data-reel-next]", this.reelLayer);
      if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = Math.round(this.carouselCur);
          const target = Math.max(0, cur - 1);
          this.seekToClip(target);
        });
        bindCursorTarget(prevBtn);
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = Math.round(this.carouselCur);
          const target = Math.min(this.cards.length - 1, cur + 1);
          this.seekToClip(target);
        });
        bindCursorTarget(nextBtn);
      }

      if (this.reelScrub) {
        bindTimelineScrub(
          this.reelScrub,
          (r, opts) => this.seekToUnifiedProgress(BRIDGE_END_P + r * (1 - BRIDGE_END_P), opts),
          (active) => { this.isScrubbing = active; }
        );
        this.reelScrub.addEventListener("keydown", (e) => {
          const step = (e.shiftKey ? 0.14 : 0.05) * (1 - BRIDGE_END_P);
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog + step, BRIDGE_END_P, 1)); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog - step, BRIDGE_END_P, 1)); }
        });
      }

      if (this.deckWrap) {
        let dragState = null;

        const resetDrag = () => {
          dragState = null;
          this.isHorizontalDragging = false;
          this.deckWrap.classList.remove("is-dragging");
        };

        this.deckWrap.addEventListener("pointerdown", (e) => {
          if (!this.reelLayer.classList.contains("is-interactive")) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          dragState = {
            id: e.pointerId,
            type: e.pointerType,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastT: performance.now(),
            vx: 0,
            startProg: clamp(this.prog, BRIDGE_END_P, 1),
            mode: null,
          };
        });

        this.deckWrap.addEventListener("pointermove", (e) => {
          if (!dragState || e.pointerId !== dragState.id) return;
          const dx = e.clientX - dragState.startX;
          const dy = e.clientY - dragState.startY;

          if (!dragState.mode) {
            if (dragState.type === "touch" && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.15) {
              dragState = null;
              return;
            }
            if (Math.abs(dx) > 7 && Math.abs(dx) >= Math.abs(dy) * 1.05) {
              dragState.mode = "h";
              this.isHorizontalDragging = true;
              this.deckWrap.classList.add("is-dragging");
              try { this.deckWrap.setPointerCapture(e.pointerId); } catch (_) {}
            } else {
              return;
            }
          }

          e.preventDefault();
          const now = performance.now();
          const dtMs = Math.max(4, now - dragState.lastT);
          const instVx = (e.clientX - dragState.lastX) / (dtMs / 1000);
          dragState.vx = dragState.vx * 0.55 + instVx * 0.45;
          dragState.lastX = e.clientX;
          dragState.lastT = now;

          const nCards = Math.max(2, this.cards.length);
          const progPerCard = (1 - BRIDGE_END_P) / (nCards - 1);
          const stepPx = Math.max(160, this.cardStep || 360);
          const targetP = clamp(dragState.startProg - (dx / stepPx) * progPerCard, BRIDGE_END_P, 1);
          const targetY = this.top + targetP * this.len;
          this.seekingUntil = now + 120;
          scrollToTarget(targetY, { immediate: true });
        }, { passive: false });

        const endDrag = (e) => {
          if (!dragState || e.pointerId !== dragState.id) return;
          const wasH = dragState.mode === "h";
          const vx = dragState.vx;
          try { this.deckWrap.releasePointerCapture(e.pointerId); } catch (_) {}
          resetDrag();
          if (wasH) {
            this.suppressClickUntil = performance.now() + 140;
            if (Math.abs(vx) > 140) {
              const nCards = Math.max(2, this.cards.length);
              const progPerCard = (1 - BRIDGE_END_P) / (nCards - 1);
              const stepPx = Math.max(160, this.cardStep || 360);
              const inertiaP = clamp(this.prog - ((vx * 0.22) / stepPx) * progPerCard, BRIDGE_END_P, 1);
              this.seekToUnifiedProgress(inertiaP);
            }
          }
        };

        this.deckWrap.addEventListener("pointerup", endDrag);
        this.deckWrap.addEventListener("pointercancel", endDrag);
        this.deckWrap.addEventListener("lostpointercapture", resetDrag);
      }

      if (this.reelLayer) {
        this.reelLayer.addEventListener("wheel", (e) => {
          if (!this.reelLayer.classList.contains("is-interactive")) return;
          if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 1) return;
          const curP = (scrollY() - this.top) / this.len;
          if (curP < BRIDGE_END_P - 0.015 || curP > 1.015) return;
          const nCards = Math.max(2, this.cards.length);
          const progPerCard = (1 - BRIDGE_END_P) / (nCards - 1);
          const stepPx = Math.max(200, this.cardStep || 420);
          const baseP = clamp(curP, BRIDGE_END_P, 1);
          const nextP = clamp(baseP + (e.deltaX / stepPx) * progPerCard, BRIDGE_END_P, 1);
          if (Math.abs(nextP - baseP) > 0.00005) {
            e.preventDefault();
            this.seekingUntil = performance.now() + 120;
            scrollToTarget(this.top + nextP * this.len, { immediate: true });
          }
        }, { passive: false });
      }
    }

    togglePlayPause() {
      this.loopPaused = !this.loopPaused;
      this.syncPauseUI();
      playTactileTick(this.loopPaused ? 480 : 660, 0.02, 0.015);
    }

    syncPauseUI() {
      this.reelLayer.classList.toggle("is-paused", this.loopPaused);
      if (this.modeLblEl) {
        this.modeLblEl.textContent = this.loopPaused ? "En pausa" : "Bucle · Activo";
      }
      $$("[data-reel-toggle]", this.reelLayer).forEach((btn) => {
        btn.setAttribute("aria-pressed", String(!this.loopPaused));
      });
    }

    seekToUnifiedProgress(p, opts = {}) {
      const targetP = clamp(p, 0, 1);
      const targetY = this.top + targetP * this.len;
      this.seekingUntil = performance.now() + (opts.immediate ? 120 : 780);
      if (!this.autoPlayPaused) this.autoPlaySuspended = false;
      scrollToTarget(targetY, { duration: 0.72, immediate: !!opts.immediate });
    }

    seekToClip(idx) {
      const n = Math.max(1, this.cards.length);
      const safeIdx = clamp(idx, 0, n - 1);
      const clipPos = n > 1 ? safeIdx / (n - 1) : 0;
      const targetP = clamp(BRIDGE_END_P + clipPos * (1 - BRIDGE_END_P), BRIDGE_END_P, 1);
      this.seekToUnifiedProgress(targetP);
      playTactileTick(620 + safeIdx * 24, 0.02, 0.014);
    }

    measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, NET_PROFILE.maxCanvasDpr);
      const isLandscape = vw >= vh;
      const tw = Math.min(1920, Math.round(vw * dpr));
      const th = Math.min(isLandscape ? 1080 : 1440, Math.round(vh * dpr));
      if (this.traceCanvas.width !== tw || this.traceCanvas.height !== th) {
        this.traceCanvas.width = tw;
        this.traceCanvas.height = th;
        this.traceDirty = true;
      }
      this.isPortraitSvg = vw <= 900 || (vw / Math.max(1, vh) <= 1.0);
      this.needsVisualSync = true;

      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const portrait = vw / vh < 0.92 || vw <= 680;
      let w, h, step;
      if (portrait) {
        w = clamp(Math.round(vw * 0.82), 264, 540);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(160, Math.min(vh * 0.40, vh - 290));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.90);
      } else {
        w = clamp(Math.round(vw * 0.49), 380, 840);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(220, Math.min(vh * 0.46, vh - 310));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.84);
      }

      this.cardW = w;
      this.cardH = h;
      this.cardStep = step;
      this.stage.style.setProperty("--reel-w", `${w}px`);
      this.stage.style.setProperty("--reel-h", `${h}px`);

      const rDpr = Math.min(window.devicePixelRatio || 1, NET_PROFILE.maxReelDpr);
      const cw = Math.round(w * rDpr);
      const ch = Math.round(h * rDpr);
      this.cardCw = cw;
      this.cardCh = ch;

      let deckH = h;
      this.cards.forEach((c, idx) => {
        const aspect = c.aspect || (16 / 9);
        let cardW = w;
        let cardH = h;
        if (Math.abs(aspect - 16 / 9) > 0.01) {
          if (portrait) {
            cardW = clamp(Math.round(vw * 0.82), 264, 540);
            cardH = Math.round(cardW / aspect);
            const maxCardH = Math.max(180, Math.min(vh * 0.42, vh - 280));
            if (cardH > maxCardH) {
              cardH = Math.round(maxCardH);
              cardW = Math.round(cardH * aspect);
            }
          } else {
            cardW = clamp(Math.round(vw * 0.49), 380, 840);
            cardH = Math.round(cardW / aspect);
            const maxCardH = Math.max(220, Math.min(vh * 0.46, vh - 310));
            if (cardH > maxCardH) {
              cardH = Math.round(maxCardH);
              cardW = Math.round(cardH * aspect);
            }
          }
          c.el.style.setProperty("--rc-w", `${cardW}px`);
          c.el.style.setProperty("--rc-h", `${cardH}px`);
        } else {
          c.el.style.removeProperty("--rc-w");
          c.el.style.removeProperty("--rc-h");
        }
        c.w = cardW;
        c.h = cardH;
        c.cw = Math.round(cardW * rDpr);
        c.ch = Math.round(cardH * rDpr);
        if (cardH > deckH) deckH = cardH;

        let targetCw = c.cw;
        let targetCh = c.ch;
        if (idx === 0) {
          // Mantener la relación de aspecto nativa del clip (p. ej. 8:7) para evitar doble recorte en transición
          const needW = Math.max(c.cw, Math.round(Math.max(vw, vh * aspect) * dpr));
          targetCw = Math.min(1440, needW);
          targetCh = Math.round(targetCw / aspect);
        }
        if (c.canvas.width !== targetCw || c.canvas.height !== targetCh) {
          c.canvas.width = targetCw;
          c.canvas.height = targetCh;
          c.dirty = true;
        }
      });
      this.stage.style.setProperty("--reel-h", `${deckH}px`);

      if (this.deckWrap && this.stage) {
        const sr = this.stage.getBoundingClientRect();
        const dr = this.deckWrap.getBoundingClientRect();
        this.deckCenterOffsetY = (sr.top + sr.height * 0.5) - (dr.top + dr.height * 0.5);
      }

      const nextTraceSet = this.pickTraceSet();
      if (this.traceSet && nextTraceSet !== this.traceSet) {
        this.ensureTraceBank(nextTraceSet);
      }

      const nextReelSet = this.pickReelSet(0);
      if (this.reelSet && nextReelSet !== this.reelSet) {
        this.reelSet = nextReelSet;
        this.cards.forEach((c) => { c.loadedSet = null; c.dirty = true; });
        if (this.activeIdx >= 0) this.loadNeighborhood(this.activeIdx);
      } else {
        this.reelSet = nextReelSet;
      }
      this.lastOverlayKey = "";
    }

    ensureTraceBank(set = this.pickTraceSet()) {
      if (this.traceSet === set && this.traceBank) return this.traceBank;
      if (this.unsubTraceBank) { this.unsubTraceBank(); this.unsubTraceBank = null; }
      this.traceSet = set;
      this.traceBank = getFrameBank(this.src, this.count, this.version, set);
      this.lastTraceFrameDrawn = -1;
      this.lastTraceDrawnExact = false;
      this.traceDirty = true;
      this.unsubTraceBank = this.traceBank.subscribe((frameIdx, isBitmap) => {
        if (!isBitmap) return;
        const curIdx = Math.round(this.traceFrameCur);
        if (frameIdx === 0 && !this.hasTraceCanvas) {
          this.drawTrace(0);
        }
        if (Math.abs(frameIdx - curIdx) <= 2 || (frameIdx === curIdx && !this.lastTraceDrawnExact)) {
          this.traceDirty = true;
        }
      });
      AssetScheduler.schedulePump();
      return this.traceBank;
    }

    loadTrace(set = this.pickTraceSet()) {
      this.ensureTraceBank(set);
    }

    drawTrace(pos) {
      if (!this.traceBank) return;
      const f = Math.round(clamp(pos, 0, this.count - 1));
      if (this.lastTraceFrameDrawn === f && this.lastTraceDrawnExact && !this.traceDirty) return;

      const hit = this.traceBank.getBestDrawable(f);
      if (!hit || !hit.img) return;
      const img = hit.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      if (this.lastTraceFrameDrawn === hit.frameIdx && this.lastTraceDrawnExact === hit.exact && !this.traceDirty) return;

      const c = this.traceCanvas, ctx = this.traceCtx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;

      if (!this.hasTraceCanvas) {
        this.hasTraceCanvas = true;
        this.traceMediaWrap.classList.add("has-canvas");
      }

      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, x, y, dw, dh);
      this.lastTraceFrameDrawn = hit.frameIdx;
      this.lastTraceDrawnExact = hit.exact;
      this.traceDirty = false;
    }

    setTraceFilter(blurPx, grayVal = 0) {
      const g = Math.max(0, Math.min(1, Math.round(grayVal * 20) / 20));
      if (g === this.lastTraceGray) return;
      this.lastTraceGray = g;
      const f = g > 0.02 ? `grayscale(${g})` : "none";
      this.traceCanvas.style.filter = f;
      if (this.tracePosterImg) this.tracePosterImg.style.filter = f;
    }

    loadCard(card) {
      if (!card) return;
      attachCardBank(card, this.pickReelSet(card.idx));
      AssetScheduler.schedulePump();
    }

    loadNeighborhood(centerIdx) {
      if (!this.cards.length) return;
      const set = this.pickReelSet(0);
      const order = [centerIdx, centerIdx + 1, centerIdx - 1, centerIdx + 2];
      order.forEach((idx) => {
        if (idx >= 0 && idx < this.cards.length) attachCardBank(this.cards[idx], set);
      });
      AssetScheduler.schedulePump();
    }

    getLoadJobs(y, viewH) {
      const secEnd = this.top + this.len + viewH;
      const inView = y + viewH >= this.top - viewH * 0.25 && y <= secEnd + viewH * 0.25;
      const dist = inView ? 0 : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      if (!inView && dist > viewH * 2.4) return [];

      const rawP = (y - this.top) / this.len;
      const jobs = [];
      const needTrace = rawP < BRIDGE_END_P + 0.05;
      const traceBank = needTrace ? (this.traceBank || this.ensureTraceBank()) : null;

      if (traceBank && needTrace) {
        if (inView) {
          jobs.push({
            bank: traceBank,
            priority: 0,
            distance: 0,
            anchor: clamp(Math.round(this.traceFrameCur), 0, this.count - 1),
            start: 0,
            end: this.count - 1,
            isReel: false,
          });
        } else if (dist <= viewH * 1.6) {
          const preEnd = Math.min(this.count - 1, 27);
          jobs.push({ bank: traceBank, priority: 1, distance: dist, anchor: 0, start: 0, end: preEnd, isReel: false });
          if (!NET_PROFILE.isConstrainedNet) {
            jobs.push({ bank: traceBank, priority: 2.5, distance: dist, anchor: preEnd + 1, start: 0, end: this.count - 1, isReel: false });
          }
        } else {
          jobs.push({ bank: traceBank, priority: 2.2, distance: dist, anchor: 0, start: 0, end: Math.min(this.count - 1, 23), isReel: false });
        }
      }

      const set = this.pickReelSet(0);
      const center = this.activeIdx >= 0 ? this.activeIdx : 0;
      if (inView && rawP >= 0.04 && rawP < BRIDGE_START_P - 0.05 && this.cards[0]) {
        const c0 = this.cards[0];
        const b0 = attachCardBank(c0, set);
        jobs.push({
          bank: b0,
          priority: 1,
          distance: 50,
          anchor: c0.from - 1,
          start: c0.from - 1,
          end: Math.min(c0.to - 1, c0.from - 1 + 27),
          isReel: true,
        });
      } else if (inView && rawP >= BRIDGE_START_P - 0.05) {
        this.cards.forEach((card, i) => {
          const d = Math.abs(i - center);
          if (d > 2) return;
          const bank = attachCardBank(card, set);
          const startIdx = card.from - 1;
          const endIdx = card.to - 1;
          const anchorIdx = clamp(Math.round(card.curFrame) - 1, startIdx, endIdx);
          if (i === center) {
            jobs.push({ bank, priority: 0, distance: 0, anchor: anchorIdx, start: startIdx, end: endIdx, isReel: true });
          } else if (d === 1) {
            jobs.push({ bank, priority: 1.2, distance: 1, anchor: anchorIdx, start: startIdx, end: Math.min(endIdx, anchorIdx + 24), isReel: true });
            if (!NET_PROFILE.isConstrainedNet) {
              jobs.push({ bank, priority: 2.3, distance: 1, anchor: anchorIdx, start: startIdx, end: endIdx, isReel: true });
            }
          } else if (!NET_PROFILE.isConstrainedNet) {
            jobs.push({ bank, priority: 2.6, distance: 2, anchor: startIdx, start: startIdx, end: Math.min(endIdx, startIdx + 11), isReel: true });
          }
        });
      }
      return jobs;
    }

    collectBankDistances(y, viewH, distMap) {
      const secEnd = this.top + this.len + viewH;
      const baseDist = (y + viewH >= this.top && y <= secEnd)
        ? 0
        : (y + viewH < this.top ? this.top - (y + viewH) : y - secEnd);
      if (this.traceBank) {
        const prev = distMap.get(this.traceBank.key);
        if (prev === undefined || baseDist < prev) distMap.set(this.traceBank.key, baseDist);
      }
      const center = this.activeIdx >= 0 ? this.activeIdx : 0;
      this.cards.forEach((c, i) => {
        if (!c.bank) return;
        const d = baseDist + Math.abs(i - center) * 200;
        const prev = distMap.get(c.bank.key);
        if (prev === undefined || d < prev) distMap.set(c.bank.key, d);
      });
    }

    drawCard(card, frameFloat, isExpanded = false) {
      card.curFrame = frameFloat;
      const bank = attachCardBank(card, this.pickReelSet(card.idx));
      const targetIdx = clamp(Math.round(clamp(frameFloat, card.from, card.to)) - 1, 0, card.count - 1);
      if (card.lastDrawnIdx === targetIdx && card.lastDrawnExact && !card.dirty) return;

      const hit = bank.getBestDrawable(targetIdx);
      if (!hit || !hit.img) return;
      const img = hit.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      const c = card.canvas;
      const ctx = card.ctx;
      if (card.idx === 0 && card.wasExpanded !== isExpanded) {
        card.wasExpanded = isExpanded;
        let wantW = card.cw || this.cardCw || 600;
        let wantH = card.ch || this.cardCh || 338;
        if (isExpanded) {
          const imgAspect = iw / ih;
          const needW = Math.max(wantW, Math.round(Math.max(vw, vh * imgAspect) * NET_PROFILE.maxCanvasDpr));
          wantW = Math.min(iw, needW);
          wantH = Math.min(ih, Math.round(wantW / imgAspect));
        }
        if (wantW && wantH && (c.width !== wantW || c.height !== wantH)) {
          c.width = wantW;
          c.height = wantH;
          card.dirty = true;
        }
      }

      if (card.lastDrawnIdx === hit.frameIdx && card.lastDrawnExact === hit.exact && !card.dirty) return;

      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, x, y, dw, dh);
      card.lastDrawnIdx = hit.frameIdx;
      card.lastDrawnExact = hit.exact;
      card.dirty = false;
      if (!card.hasCanvas) {
        card.hasCanvas = true;
        card.el.classList.add("has-canvas");
      }
    }

    setActiveClip(idx) {
      if (idx === this.activeIdx || !this.cards[idx]) return;
      const prevIdx = this.activeIdx;
      this.activeIdx = idx;
      const card = this.cards[idx];

      if (prevIdx >= 0) {
        playTactileTick(640, 0.016, 0.012);
      }

      this.cards.forEach((c, i) => c.el.classList.toggle("is-center", i === idx));
      this.thumbs.forEach((th, i) => {
        const active = i === idx;
        th.classList.toggle("is-active", active);
        th.setAttribute("aria-selected", String(active));
      });

      if (this.strip && this.thumbs[idx] && this.strip.scrollWidth > this.strip.clientWidth + 4) {
        const th = this.thumbs[idx];
        const targetLeft = th.offsetLeft - (this.strip.clientWidth - th.offsetWidth) * 0.5;
        if (this.strip.scrollTo) {
          this.strip.scrollTo({ left: Math.max(0, targetLeft), behavior: reduce ? "auto" : "smooth" });
        } else {
          this.strip.scrollLeft = Math.max(0, targetLeft);
        }
      }

      if (this.idxEl) this.idxEl.textContent = pad(idx + 1);
      if (this.topCatEl) this.topCatEl.textContent = card.cat.split("·")[0].trim();
      if (this.topFpsEl) this.topFpsEl.textContent = `${card.fps} FPS`;

      if (this.capSlots.length >= 2) {
        const fillSlot = (slot) => {
          if (slot.num) slot.num.textContent = pad(idx + 1);
          if (slot.cat) slot.cat.textContent = card.cat;
          if (slot.loc) slot.loc.textContent = card.loc;
          if (slot.title) slot.title.innerHTML = card.title;
          if (slot.desc) slot.desc.textContent = card.desc;
        };

        if (prevIdx < 0 || reduce) {
          const curSlot = this.capSlots[this.capSlotIdx];
          fillSlot(curSlot);
          curSlot.el.classList.remove("is-leaving");
          curSlot.el.classList.add("is-active");
          curSlot.el.setAttribute("aria-hidden", "false");
        } else {
          const outSlot = this.capSlots[this.capSlotIdx];
          const inIdx = 1 - this.capSlotIdx;
          const inSlot = this.capSlots[inIdx];
          this.capSlotIdx = inIdx;

          inSlot.el.style.transition = "none";
          inSlot.el.classList.remove("is-active", "is-leaving");
          fillSlot(inSlot);
          void inSlot.el.offsetWidth;
          inSlot.el.style.transition = "";

          outSlot.el.classList.remove("is-active");
          outSlot.el.classList.add("is-leaving");
          outSlot.el.setAttribute("aria-hidden", "true");

          inSlot.el.classList.add("is-active");
          inSlot.el.setAttribute("aria-hidden", "false");
        }
      }

      this.stage.style.setProperty("--reel-aura-s", idx % 2 === 0 ? "1.04" : "0.96");
      if (prevIdx < 0 && this.deckWrap && this.stage) {
        const sr = this.stage.getBoundingClientRect();
        const dr = this.deckWrap.getBoundingClientRect();
        this.deckCenterOffsetY = (sr.top + sr.height * 0.5) - (dr.top + dr.height * 0.5);
      }
      this.loadNeighborhood(idx);
    }

    updateTraceOverlay(traceTarget, bridgeT, rawEntryP, dt) {
      const ov = this.traceOverlay.style;
      const ovc = this._ovVars;
      const mwc = this._mediaVars;
      const tc = this._txtCache;
      const k = reduce ? 1 : (dt ? Math.min(1, 1 - Math.exp(-13 * dt)) : 0.22);
      this.traceCur += (traceTarget - this.traceCur) * k;
      if (Math.abs(traceTarget - this.traceCur) < 0.001) this.traceCur = traceTarget;
      const tp = clamp(this.traceCur, 0, 1);

      const exitHud = reduce ? (bridgeT > 0.1 ? 1 : 0) : smooth(range(bridgeT, 0.00, 0.26));
      const exitSvgFade = reduce ? (bridgeT > 0.2 ? 1 : 0) : smooth(range(bridgeT, 0.08, 0.34));
      const svgWake = reduce ? (rawEntryP >= 0 ? 1 : 0) : smooth(range(rawEntryP, 0.044, 0.080));
      const hudWake = reduce ? (rawEntryP >= 0 ? 1 : 0) : smooth(range(rawEntryP, 0.056, 0.098));
      const hudOp = hudWake * (1 - exitHud);
      const hudEnterY = !reduce ? (1 - hudWake) * 10 : 0;

      setCssVar(ov, ovc, "--trace-entry-y", "0.0px");
      setCssVar(ov, ovc, "--trace-hud-op", hudOp.toFixed(3));
      setCssVar(ov, ovc, "--trace-hud-top-y", `${((-exitHud * 14) - hudEnterY).toFixed(1)}px`);
      setCssVar(ov, ovc, "--trace-hud-bot-y", `${((exitHud * 14) + hudEnterY).toFixed(1)}px`);
      setCssVar(ov, ovc, "--trace-svg-op", ((1 - exitSvgFade) * svgWake).toFixed(3));

      const traceVisible = rawEntryP >= 0 && ((1 - exitSvgFade) * svgWake > 0.005 || hudOp > 0.005);
      const visStr = traceVisible ? "visible" : "hidden";
      if (this.traceOverlay._vis !== visStr) {
        this.traceOverlay._vis = visStr;
        this.traceOverlay.style.visibility = visStr;
      }
      this.traceOverlayHidden = !traceVisible && bridgeT >= 0.34;
      if (this.traceConsole) {
        const peStr = hudOp > 0.15 ? "auto" : "none";
        if (this.traceConsole._pe !== peStr) {
          this.traceConsole._pe = peStr;
          this.traceConsole.style.pointerEvents = peStr;
        }
      }

      const pathExitOp = (1 - smooth(range(bridgeT, 0.06, 0.30))).toFixed(3);
      let yawReading = 78;

      if (!this.isPortraitSvg) {
        const totalLen = this.tracePathLen || 1034;
        const curLen = tp * totalLen;
        const dashOffset = (totalLen - curLen).toFixed(1);
        if (this.tracePathCore) {
          if (this.tracePathCore._dash !== dashOffset) { this.tracePathCore._dash = dashOffset; this.tracePathCore.style.strokeDashoffset = dashOffset; }
          if (this.tracePathCore._op !== pathExitOp) { this.tracePathCore._op = pathExitOp; this.tracePathCore.style.opacity = pathExitOp; }
        }
        if (this.tracePathGlow) {
          if (this.tracePathGlow._dash !== dashOffset) { this.tracePathGlow._dash = dashOffset; this.tracePathGlow.style.strokeDashoffset = dashOffset; }
          if (this.tracePathGlow._op !== pathExitOp) { this.tracePathGlow._op = pathExitOp; this.tracePathGlow.style.opacity = pathExitOp; }
        }
        if (this.tracePathCore && this.traceDrone) {
          try {
            const pt = this.tracePathCore.getPointAtLength(curLen);
            const p1 = this.tracePathCore.getPointAtLength(Math.max(0, curLen - 6));
            const p2 = this.tracePathCore.getPointAtLength(Math.min(totalLen, curLen + 6));
            const tangentDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            const patioLook = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -24;
            const naveLook = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
            const coneDeg = tangentDeg + patioLook + naveLook;
            yawReading = Math.round((90 + coneDeg + 360) % 360);
            const trStr = `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`;
            if (this.traceDrone._tr !== trStr) { this.traceDrone._tr = trStr; this.traceDrone.setAttribute("transform", trStr); }
            if (this.traceDroneRot) {
              const rotStr = `rotate(${coneDeg.toFixed(1)})`;
              if (this.traceDroneRot._rot !== rotStr) { this.traceDroneRot._rot = rotStr; this.traceDroneRot.setAttribute("transform", rotStr); }
            }
          } catch (_) {}
        }
      } else if (this.tracePathCoreV) {
        const totalLenV = this.tracePathLenV || 690;
        const curLenV = tp * totalLenV;
        const dashOffsetV = (totalLenV - curLenV).toFixed(1);
        if (this.tracePathCoreV._dash !== dashOffsetV) { this.tracePathCoreV._dash = dashOffsetV; this.tracePathCoreV.style.strokeDashoffset = dashOffsetV; }
        if (this.tracePathCoreV._op !== pathExitOp) { this.tracePathCoreV._op = pathExitOp; this.tracePathCoreV.style.opacity = pathExitOp; }
        if (this.tracePathGlowV) {
          if (this.tracePathGlowV._dash !== dashOffsetV) { this.tracePathGlowV._dash = dashOffsetV; this.tracePathGlowV.style.strokeDashoffset = dashOffsetV; }
          if (this.tracePathGlowV._op !== pathExitOp) { this.tracePathGlowV._op = pathExitOp; this.tracePathGlowV.style.opacity = pathExitOp; }
        }
        if (this.traceDroneV) {
          try {
            const ptV = this.tracePathCoreV.getPointAtLength(curLenV);
            const p1V = this.tracePathCoreV.getPointAtLength(Math.max(0, curLenV - 6));
            const p2V = this.tracePathCoreV.getPointAtLength(Math.min(totalLenV, curLenV + 6));
            const tangentDegV = Math.atan2(p2V.y - p1V.y, p2V.x - p1V.x) * (180 / Math.PI);
            const patioLookV = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -20;
            const naveLookV = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
            const coneDegV = (tangentDegV - 90) + patioLookV + naveLookV;
            yawReading = Math.round((tangentDegV + patioLookV + naveLookV + 360) % 360);
            const trStrV = `translate(${ptV.x.toFixed(1)}, ${ptV.y.toFixed(1)})`;
            if (this.traceDroneV._tr !== trStrV) { this.traceDroneV._tr = trStrV; this.traceDroneV.setAttribute("transform", trStrV); }
            if (this.traceDroneRotV) {
              const rotStrV = `rotate(${coneDegV.toFixed(1)})`;
              if (this.traceDroneRotV._rot !== rotStrV) { this.traceDroneRotV._rot = rotStrV; this.traceDroneRotV.setAttribute("transform", rotStrV); }
            }
          } catch (_) {}
        }
      }

      // Desdibujado arquitectónico inverso en la transición de salida (Beat 1: se limpia antes de abrir Nordelta)
      const retract3 = 1 - smooth(range(bridgeT, 0.00, 0.20));
      const retract2 = 1 - smooth(range(bridgeT, 0.04, 0.25));
      const retract1 = 1 - smooth(range(bridgeT, 0.08, 0.30));
      const retractGrid = 1 - smooth(range(bridgeT, 0.02, 0.28));
      const retractPlan = 1 - smooth(range(bridgeT, 0.10, 0.34));

      const darkenBase = reduce ? 1 : smooth(range(tp, 0.11, 0.26));
      const darkenBridge = smooth(range(bridgeT, 0.02, 0.36)) * 0.34;
      setCssVar(this.traceMediaWrap.style, mwc, "--trace-darken-op", clamp(darkenBase + darkenBridge, 0, 1).toFixed(3));
      setCssVar(this.traceMediaWrap.style, mwc, "--trace-base-veil-op", (0.38 + 0.62 * darkenBase).toFixed(3));

      const extOp = (reduce ? 1 : smooth(range(tp, 0.15, 0.25))) * retractGrid;
      const flightOp = (reduce ? 1 : smooth(range(tp, 0.14, 0.23))) * (1 - exitSvgFade);
      setCssVar(ov, ovc, "--trace-ext-op", extOp.toFixed(3));
      setCssVar(ov, ovc, "--trace-flight-op", flightOp.toFixed(3));
      setCssVar(ov, ovc, "--trace-grid-op", ((reduce ? 1 : smooth(range(tp, 0.145, 0.26))) * retractGrid).toFixed(3));
      setCssVar(ov, ovc, "--trace-plan-op", ((reduce ? 1 : smooth(range(tp, 0.155, 0.245))) * retractPlan).toFixed(3));
      setCssVar(ov, ovc, "--trace-draw-1", ((reduce ? 1 : smooth(range(tp, 0.155, 0.29))) * retract1).toFixed(3));
      setCssVar(ov, ovc, "--trace-draw-2", ((reduce ? 1 : smooth(range(tp, 0.205, 0.35))) * retract2).toFixed(3));
      setCssVar(ov, ovc, "--trace-draw-3", ((reduce ? 1 : smooth(range(tp, 0.255, 0.40))) * retract3).toFixed(3));
      setCssVar(ov, ovc, "--trace-sec1-op", ((reduce ? 1 : smooth(range(tp, 0.155, 0.25))) * retractPlan).toFixed(3));
      setCssVar(ov, ovc, "--trace-sec2-op", ((reduce ? 1 : smooth(range(tp, 0.205, 0.31))) * retractPlan).toFixed(3));
      setCssVar(ov, ovc, "--trace-sec3-op", ((reduce ? 1 : smooth(range(tp, 0.255, 0.36))) * retractPlan).toFixed(3));
      setCssVar(ov, ovc, "--trace-ghost-op", (((reduce ? 0.42 : 0.12 + 0.32 * smooth(range(tp, 0.16, 0.30)))) * (1 - smooth(range(tp, 0.92, 0.99))) * retractGrid).toFixed(3));

      const wakeWave = range(tp, 0.16, 0.32);
      const activeWake = this.isPortraitSvg ? this.traceWakeRingV : this.traceWakeRing;
      if (activeWake) {
        if (wakeWave > 0 && wakeWave < 1) {
          activeWake.setAttribute("r", (10 + smooth(wakeWave) * (this.isPortraitSvg ? 150 : 195)).toFixed(1));
          activeWake.setAttribute("stroke-opacity", (Math.sin(wakeWave * Math.PI) * 0.56).toFixed(3));
        } else if (activeWake._op0 !== true) {
          activeWake._op0 = true;
          activeWake.setAttribute("stroke-opacity", "0");
        }
        if (wakeWave > 0 && wakeWave < 1) activeWake._op0 = false;
      }

      const introFocus = reduce ? 0 : (1 - smooth(range(rawEntryP, 0.042, 0.098)));
      let camX = 0, camY = 0, camScale = 1;
      if (this.isPortraitSvg || vw <= 768) {
        camY = (0.35 - tp * 0.70) * 16 + introFocus * 12;
        camScale = 1 + introFocus * 0.065 + exitSvgFade * 0.10;
      } else {
        camScale = 1 + introFocus * 0.085 + exitSvgFade * 0.13;
        camX = introFocus * 36;
        camY = introFocus * 10;
      }
      setCssVar(ov, ovc, "--trace-cam-x", `${camX.toFixed(1)}px`);
      setCssVar(ov, ovc, "--trace-cam-y", `${camY.toFixed(1)}px`);
      setCssVar(ov, ovc, "--trace-cam-scale", camScale.toFixed(4));
      setCssVar(ov, ovc, "--trace-cam-rx", "0deg");
      setCssVar(ov, ovc, "--trace-cam-ry", "0deg");

      const zoneIdx = tp < 0.24 ? 0 : (tp < 0.50 ? 1 : (tp < 0.78 ? 2 : 3));
      if (zoneIdx !== this.lastTraceZoneUi) {
        this.lastTraceZoneUi = zoneIdx;
        const activeRoomNum = zoneIdx === 1 ? "2" : (zoneIdx === 2 ? "3" : (zoneIdx === 3 ? "4" : "1"));
        this.traceRooms.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoom === activeRoomNum));
        this.traceRoomsV.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoomV === activeRoomNum));
        const phaseLabels = ["01 · Aproximación", "02 · Acceso y umbral", "03 · Recorrido interior", "04 · Salida al parque"];
        const roomLabels = ["Aproximación Exterior", "Ingreso Principal", "Espacio Central", "Jardín & Agua"];
        const planStates = ["Exterior", "Ingreso", "Interior", "Completado"];
        setTextCached(this.tracePhasePill, tc, "pill", phaseLabels[zoneIdx]);
        setTextCached(this.traceRoomNameEl, tc, "room", roomLabels[zoneIdx]);
        setTextCached(this.tracePlanStateEl, tc, "plan", planStates[zoneIdx]);
      }

      if (zoneIdx !== this.lastTraceZone) {
        if (this.lastTraceZone !== -1 && rawEntryP > 0.02 && bridgeT < 0.15) playTactileTick(620 + zoneIdx * 55, 0.025, 0.018);
        this.lastTraceZone = zoneIdx;
      }

      const wpThresholds = [0.0, 0.25, 0.41, 0.59, 0.79, 0.96];
      let wpMask = 0;
      for (let idx = 0; idx < wpThresholds.length; idx++) {
        if (tp >= wpThresholds[idx]) wpMask |= (1 << idx);
      }
      if (wpMask !== this.lastWpMask) {
        this.lastWpMask = wpMask;
        this.traceWps.forEach((wp, idx) => wp.classList.toggle("is-reached", (wpMask & (1 << idx)) !== 0));
        this.traceWpsV.forEach((wp, idx) => wp.classList.toggle("is-reached", (wpMask & (1 << idx)) !== 0));
      }

      const rippleIn = smooth(range(tp, 0.76, 0.96));
      const rippleExit = smooth(range(bridgeT, 0.00, 0.42));
      const rippleOp = rippleIn * (1 - rippleExit);
      setCssVar(ov, ovc, "--trace-ripple-op", rippleOp.toFixed(3));
      setCssVar(ov, ovc, "--trace-ripple-s", (0.82 + rippleIn * 0.36 + rippleExit * 1.25).toFixed(3));

      const meters = (tp * 64.8).toFixed(1);
      const altM = tp < 0.22 ? (1.85 - (tp / 0.22) * 0.15) : (tp < 0.78 ? 1.70 : (1.70 - ((tp - 0.78) / 0.22) * 0.25));
      const droneTxt = `${meters}m · +${altM.toFixed(2)}m`;
      setTextCached(this.isPortraitSvg ? this.traceDroneTxtV : this.traceDroneTxt, tc, "dTxt", droneTxt);
      setTextCached(this.traceDistEl, tc, "dist", `${meters} m`);
      setTextCached(this.traceAltEl, tc, "alt", `+${altM.toFixed(2)} m`);
      setTextCached(this.traceYawEl, tc, "yaw", `${pad(yawReading, 3)}° E`);
      setTextCached(this.traceTcEl, tc, "tc", `00:${pad(Math.min(14, Math.floor(tp * 14)))}`);

      for (let i = 0; i < this.traceActs.length; i++) {
        const act = this.traceActs[i];
        const { n: el, r: [a, b] } = act;
        const t = (tp - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (act.lastVis !== "hidden") {
            act.lastVis = "hidden";
            act.lastOp = "0";
            el.style.opacity = "0";
            el.style.visibility = "hidden";
          }
          continue;
        }
        const fadeIn = a < 0 ? range(t, 0, 0.14) : range(t, 0, 0.2);
        const fadeOut = b > 1 ? 1 : (1 - range(t, 0.8, 1));
        const o = smooth(Math.min(fadeIn, fadeOut)) * (1 - exitHud);
        const vis = o <= 0.005 ? "hidden" : "visible";
        const opStr = o.toFixed(3);
        if (act.lastVis !== vis) { act.lastVis = vis; el.style.visibility = vis; }
        if (act.lastOp !== opStr) { act.lastOp = opStr; el.style.opacity = opStr; }
        if (vis === "visible") {
          el.style.transform = `translate3d(0, ${((0.5 - t) * 10).toFixed(1)}px, 0)`;
        }
      }
    }

    update(dt, isScrolling = true) {
      const nCards = this.cards.length;
      if (!nCards) return;

      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);

      if (viewportEntry > 0 && !this.traceSet) this.loadTrace();
      if (viewportEntry > 0 && this.activeIdx < 0) this.setActiveClip(0);
      if (y + vh < this.top - vh || y > this.top + this.len + vh) {
        if (!this.isOffscreen) {
          this.isOffscreen = true;
          this.el.classList.add("is-offscreen");
        }
        return;
      }
      if (this.isOffscreen) {
        this.isOffscreen = false;
        this.el.classList.remove("is-offscreen");
      }

      if (viewportEntry <= 0 || rawP < 0) {
        if (rawP < -0.005 || viewportEntry < 0.95) {
          this.autoPlaySuspended = false;
          this.subpixelAcc = 0;
          this.lastTrackedY = undefined;
        }
        if (!this.lastPreState || this.traceDirty) {
          this.lastPreState = true;
          this.needsVisualSync = true;
          this.traceOverlayHidden = false;
          this.reelLayerHidden = false;
          this.prog = 0;
          this.progCur = 0;
          this.traceCur = 0;
          this.traceFrameCur = 0;
          const mws = this.traceMediaWrap.style;
          const mwc = this._mediaVars;
          setCssVar(mws, mwc, "--tr-trace-media-op", "0");
          setCssVar(mws, mwc, "--img-scale", "1.075");
          setCssVar(mws, mwc, "--trace-base-veil-op", "0.38");
          setCssVar(mws, mwc, "--trace-darken-op", "0");
          setCssVar(mws, mwc, "--trace-entry-veil-op", "1");
          setCssVar(mws, mwc, "--trace-entry-veil-s", "1");
          mws.visibility = "hidden";
          this.setTraceFilter(0, 0.55);
          setCssVar(this.reelBgWrap.style, this._bgVars, "--tr-reel-bg-op", "0");
          this.reelLayer.style.visibility = "hidden";
          if (this.lastReelInteractive) {
            this.lastReelInteractive = false;
            this.reelLayer.classList.remove("is-interactive");
          }
          this.updateTraceOverlay(0, 0, -0.05, 0.016);
          if (viewportEntry > 0) {
            this.drawTrace(0);
            this.lastTraceFrameDrawn = 0;
          }
        }
        this.prevRawP = rawP;
        return;
      }

      const wasPre = this.lastPreState;
      this.lastPreState = false;
      if (rawP >= 1.08) {
        this.progCur = 1;
      }

      if (this.prevRawP !== undefined && this.prevRawP >= BRIDGE_END_P && rawP < BRIDGE_END_P) {
        this.autoPlaySuspended = true;
      }
      this.prevRawP = rawP;

      if (this.isHybrid && viewportEntry > 0 && rawP >= 0 && rawP < BRIDGE_END_P && performance.now() > (this.seekingUntil || 0)) {
        const curTraceIdx = clamp(Math.round(this.traceFrameCur), 0, this.count - 1);
        const hasTrace = !!(this.traceBank && this.traceBank.hasContiguousAhead(curTraceIdx, 6));
        const firstCard = this.cards[0];
        const hasFirstCard = !!(firstCard && firstCard.bank && firstCard.bank.hasContiguousAhead(0, 6));
        const traceEndLen = Math.max(1, this.len * BRIDGE_END_P);
        const traceRawP = rawP / BRIDGE_END_P;

        runHybridScrollEngine({
          top: this.top,
          len: traceEndLen,
          dt,
          viewportEntry,
          rawP: traceRawP,
          baseDuration: this.baseDuration * BRIDGE_END_P,
          speedScale: rawP < REEL_WAKE_P ? 0.85 : 0.92,
          peekPx: 0,
          minSpeed: 0.42,
          state: this,
          hasFrames: rawP < BRIDGE_START_P ? hasTrace : (hasTrace || hasFirstCard),
          isHero: false,
        });
      } else if (rawP >= BRIDGE_END_P) {
        this.lastTrackedY = y;
        this.subpixelAcc = 0;
      }

      const targetProg = clamp(rawP, 0, 1);
      this.prog = targetProg;

      const dtSec = Math.min(dt || 0.016, 0.05);
      const isDirectSeek = this.isScrubbing || this.isHorizontalDragging || performance.now() <= (this.seekingUntil || 0);
      const prevProgCur = this.progCur;
      if (reduce) {
        this.progCur = targetProg;
      } else {
        const dampRate = this.isHorizontalDragging ? -30 : (isDirectSeek ? -16 : -22);
        const damp = 1 - Math.exp(dampRate * dtSec);
        this.progCur += (targetProg - this.progCur) * damp;
      }
      if (Math.abs(targetProg - this.progCur) < 0.00025) this.progCur = targetProg;
      const progMoved = Math.abs(this.progCur - prevProgCur) > 0.0001 || wasPre || this.needsVisualSync;

      // 1) Progreso del plano SVG y del video de planta
      const tracePlanProg = clamp(this.progCur / TRACE_PLAN_END_P, 0, 1);
      const traceVideoProg = clamp(this.progCur / TRACE_MEDIA_END_P, 0, 1);

      // 2) Puente de fusión unificada (0 -> 1 entre BRIDGE_START_P y BRIDGE_END_P)
      const bridgeT = reduce
        ? (this.progCur >= BRIDGE_START_P ? 1 : 0)
        : clamp((this.progCur - BRIDGE_START_P) / (BRIDGE_END_P - BRIDGE_START_P), 0, 1);

      // Sólo actualizar la capa de planta mientras no haya salido completamente de escena
      if (bridgeT < 0.62) {
        this.traceBitmapsReleased = false;
        const targetTraceF = traceVideoProg * (this.count - 1);
        const tk = reduce ? 1 : (1 - Math.exp(-26 * dtSec));
        this.traceFrameCur += (targetTraceF - this.traceFrameCur) * tk;
        if (Math.abs(targetTraceF - this.traceFrameCur) < 0.002) this.traceFrameCur = targetTraceF;

        const traceEntryWake = reduce ? (rawP >= 0 ? 1 : 0) : smooth(range(rawP, 0.0, 0.015));
        const veilOpen = reduce ? (rawP >= 0 ? 1 : 0) : smooth(range(rawP, 0.0, 0.018));
        const traceMediaFade = traceEntryWake * (1 - smooth(range(bridgeT, 0.22, 0.56)));
        const traceMediaScale = (reduce ? 1.02 : (1.075 - traceEntryWake * 0.055)) + range(bridgeT, 0.0, 0.56) * 0.045;
        const traceMediaGray = (reduce ? 0 : (1 - traceEntryWake) * 0.55) + smooth(range(bridgeT, 0.10, 0.48)) * 0.5;

        const mws = this.traceMediaWrap.style;
        const mwc = this._mediaVars;
        setCssVar(mws, mwc, "--tr-trace-media-op", traceMediaFade.toFixed(3));
        setCssVar(mws, mwc, "--img-scale", traceMediaScale.toFixed(4));
        setCssVar(mws, mwc, "--trace-entry-veil-op", (1 - veilOpen).toFixed(3));
        setCssVar(mws, mwc, "--trace-entry-veil-s", (1 + veilOpen * 0.55).toFixed(3));
        const tmVis = traceMediaFade <= 0.005 ? "hidden" : "visible";
        if (this.traceMediaWrap._vis !== tmVis) { this.traceMediaWrap._vis = tmVis; mws.visibility = tmVis; }
        this.setTraceFilter(0, traceMediaGray);

        if (traceMediaFade > 0.005 && (Math.abs(this.traceFrameCur - this.lastTraceFrameDrawn) > 0.002 || this.traceDirty)) {
          this.drawTrace(this.traceFrameCur);
          this.lastTraceFrameDrawn = this.traceFrameCur;

          const f = Math.round(this.traceFrameCur);
          if (f !== this.lastTraceHudFrame) {
            this.lastTraceHudFrame = f;
            setTextCached(this.traceFrEl, this._txtCache, "tFr", pad(f + 1, 3));
            if (Math.abs(f - (this.lastTracePumpFrame ?? -999)) >= 4) {
              this.lastTracePumpFrame = f;
              AssetScheduler.schedulePump();
            }
          }
          const pctVal = Math.round(tracePlanProg * 1000) / 10;
          if (pctVal !== this.lastTracePctVal) {
            this.lastTracePctVal = pctVal;
            if (this.traceScrubFill) this.traceScrubFill.style.width = `${pctVal}%`;
            if (this.traceScrub) this.traceScrub.setAttribute("aria-valuenow", String(Math.round(pctVal)));
          }
        }
      } else {
        if (this.traceMediaWrap._vis !== "hidden") {
          this.traceMediaWrap._vis = "hidden";
          this.traceMediaWrap.style.visibility = "hidden";
          setCssVar(this.traceMediaWrap.style, this._mediaVars, "--tr-trace-media-op", "0");
        }
        if (!this.traceBitmapsReleased && this.traceBank) {
          this.traceBitmapsReleased = true;
          this.traceBank.releaseBitmaps();
        }
      }

      if (bridgeT < 0.42 || !this.traceOverlayHidden || progMoved) {
        if (bridgeT < 0.99 || !this.traceOverlayHidden) {
          this.updateTraceOverlay(tracePlanProg, bridgeT, rawP, dtSec);
        }
      }

      // 3) Archivo en Movimiento: saltar completamente si el carrusel aún está oculto
      if (bridgeT <= 0.20) {
        if (!this.reelLayerHidden) {
          this.reelLayerHidden = true;
          setCssVar(this.reelBgWrap.style, this._bgVars, "--tr-reel-bg-op", "0");
          this.reelLayer.style.visibility = "hidden";
          if (this.lastReelInteractive) {
            this.lastReelInteractive = false;
            this.reelLayer.classList.remove("is-interactive");
            setCssVar(this.reelLayer.style, this._reelVars, "--tr-reel-pe", "none");
          }
        }
        this.needsVisualSync = false;
        return;
      }
      this.reelLayerHidden = false;

      const backdropReveal = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.50, 0.92));
      const videoDissolve = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.24, 0.46));
      const leadVeilOp = reduce ? 0 : (1 - smooth(range(bridgeT, 0.40, 0.86))) * 0.92;
      const mediaWake = reduce ? 1 : smooth(range(bridgeT, 0.26, 0.64));
      const pbRaw = range(bridgeT, 0.48, 1.00);
      const pullbackEase = reduce ? 1 : (pbRaw < 0.5 ? 4 * pbRaw * pbRaw * pbRaw : 1 - Math.pow(-2 * pbRaw + 2, 3) / 2);
      const chromeReveal = reduce ? 1 : smooth(range(bridgeT, 0.68, 0.98));
      const sideReveal = reduce ? 1 : smooth(range(bridgeT, 0.68, 1.00));
      const hudReveal = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.74, 1.00));

      setCssVar(this.reelBgWrap.style, this._bgVars, "--tr-reel-bg-op", backdropReveal.toFixed(3));
      if (this.reelLayer._vis !== "visible") {
        this.reelLayer._vis = "visible";
        this.reelLayer.style.visibility = "visible";
      }
      const isInteractive = bridgeT >= 0.78;
      if (isInteractive !== this.lastReelInteractive) {
        this.lastReelInteractive = isInteractive;
        this.reelLayer.classList.toggle("is-interactive", isInteractive);
        setCssVar(this.reelLayer.style, this._reelVars, "--tr-reel-pe", isInteractive ? "auto" : "none");
      }

      const carouselProg = clamp((this.progCur - BRIDGE_END_P) / (1 - BRIDGE_END_P), 0, 1);
      this.carouselCur = nCards > 1 ? carouselProg * (nCards - 1) : 0;

      const nearestIdx = clamp(Math.round(this.carouselCur), 0, nCards - 1);
      if (nearestIdx !== this.activeIdx) this.setActiveClip(nearestIdx);

      const rl = this.reelLayer.style;
      const rlc = this._reelVars;
      setCssVar(rl, rlc, "--reel-hud", hudReveal.toFixed(3));
      setCssVar(rl, rlc, "--reel-hud-top-y", `${(-(1 - hudReveal) * 14).toFixed(1)}px`);
      setCssVar(rl, rlc, "--reel-hud-bot-y", `${((1 - hudReveal) * 18).toFixed(1)}px`);
      setCssVar(this.reelBgWrap.style, this._bgVars, "--reel-aura-op", (0.65 * backdropReveal).toFixed(3));

      const reelPct = Math.round(carouselProg * 1000) / 10;
      if (reelPct !== this.lastReelPct) {
        this.lastReelPct = reelPct;
        if (this.reelScrubFill) this.reelScrubFill.style.width = `${reelPct.toFixed(1)}%`;
        if (this.reelScrub) this.reelScrub.setAttribute("aria-valuenow", String(Math.round(reelPct)));
      }

      const needLayoutCss = progMoved || this.needsVisualSync;

      for (let i = 0; i < nCards; i++) {
        const card = this.cards[i];
        const d = i - this.carouselCur;
        const absD = Math.abs(d);
        const st = card.el.style;
        const cc = card._css;

        if (absD > 2.25) {
          if (!card.isHiddenOut) {
            card.isHiddenOut = true;
            setCssVar(st, cc, "--rc-op", "0");
            setCssVar(st, cc, "--rc-pe", "none");
            card.loopRate = 0;
            if (this.thumbs[i] && card.lastThumbP !== 0) {
              card.lastThumbP = 0;
              this.thumbs[i].style.setProperty("--th-p", "0");
            }
          }
          continue;
        }
        card.isHiddenOut = false;

        if (needLayoutCss) {
          const bell = Math.exp(-d * d * 2.1);
          let tx = d * this.cardStep * (1 - 0.04 * Math.min(absD, 2));
          let ty = (1 - bell) * 5;
          let scale = 0.80 + 0.20 * bell;
          const baseRy = clamp(-d * 9.5, -16, 16);
          let activeWeight = smooth(clamp(1 - absD * 1.25, 0, 1));
          let op = clamp(1 - Math.max(0, absD - 0.15) * 0.38, 0, 1);
          let shade = clamp((1 - bell) * 0.56, 0, 0.58);

          let rcChrome = 1;
          let rcRadius = 5;
          let rcBorderOp = i === nearestIdx ? 0.28 : 0.16;
          let rcBgOp = 1;
          let rcLeadVeil = 0;
          let innerScale = 1.10 - activeWeight * 0.08;
          let tiltFactor = activeWeight;

          if (bridgeT < 1) {
            if (i === 0) {
              const targetW = card.w || this.cardW;
              const targetH = card.h || this.cardH;
              const curW = targetW + (vw - targetW) * (1 - pullbackEase);
              const curH = targetH + (vh - targetH) * (1 - pullbackEase);
              setCssVar(st, cc, "--rc-w", `${curW.toFixed(1)}px`);
              setCssVar(st, cc, "--rc-h", `${curH.toFixed(1)}px`);
              ty += (this.deckCenterOffsetY || 0) * (1 - pullbackEase);
              scale = 1;
              op *= videoDissolve;
              activeWeight *= chromeReveal;
              tiltFactor = chromeReveal;
              shade = 0;
              rcChrome = chromeReveal;
              rcRadius = chromeReveal * 5;
              rcBorderOp = chromeReveal * 0.28;
              rcBgOp = chromeReveal;
              rcLeadVeil = leadVeilOp;
              innerScale = 1.02 + (1 - mediaWake) * 0.03;
            } else {
              op *= sideReveal;
              tx += (1 - sideReveal) * (this.cardW || 560) * 0.24;
            }
          } else if (i === 0 && !card.settledSize) {
            card.settledSize = true;
            if (card.w && card.h && (card.w !== this.cardW || card.h !== this.cardH)) {
              setCssVar(st, cc, "--rc-w", `${card.w}px`);
              setCssVar(st, cc, "--rc-h", `${card.h}px`);
            } else {
              delete cc["--rc-w"];
              delete cc["--rc-h"];
              st.removeProperty("--rc-w");
              st.removeProperty("--rc-h");
            }
          }
          if (bridgeT < 1 && i === 0) card.settledSize = false;

          const maxParallax = Math.max(4, (this.cardW || 300) * 0.032);
          const parallaxX = clamp(-d * maxParallax, -16, 16);

          setCssVar(st, cc, "--rc-x", `${tx.toFixed(1)}px`);
          setCssVar(st, cc, "--rc-y", `${ty.toFixed(1)}px`);
          setCssVar(st, cc, "--rc-s", scale.toFixed(4));
          setCssVar(st, cc, "--rc-rx", "0deg");
          setCssVar(st, cc, "--rc-ry", `${baseRy.toFixed(2)}deg`);
          setCssVar(st, cc, "--rc-op", op.toFixed(3));
          setCssVar(st, cc, "--rc-shade", shade.toFixed(3));
          setCssVar(st, cc, "--rc-lead-veil", rcLeadVeil.toFixed(3));
          setCssVar(st, cc, "--rc-act", activeWeight.toFixed(3));
          setCssVar(st, cc, "--rc-chrome", rcChrome.toFixed(3));
          setCssVar(st, cc, "--rc-radius", `${rcRadius.toFixed(2)}px`);
          setCssVar(st, cc, "--rc-border-op", rcBorderOp.toFixed(3));
          setCssVar(st, cc, "--rc-bg-op", rcBgOp.toFixed(3));
          setCssVar(st, cc, "--rc-px", `${parallaxX.toFixed(1)}px`);
          setCssVar(st, cc, "--rc-ims", innerScale.toFixed(4));
          setCssVar(st, cc, "--rc-pe", (isInteractive && absD < 1.35 && op > 0.25) ? "auto" : "none");
          setCssVar(st, cc, "--rc-z", String(Math.round(50 - absD * 10)));
        }

        const clipDur = Math.max(0.1, card.span / card.fps);
        let clipP = 0;

        if (i === 0 && bridgeT < 1) {
          clipP = clamp((bridgeT - 0.20) / 0.80, 0, 1);
          card.loopSec = clipP * clipDur;
          card.loopRate = 1;
        } else {
          const isCenterCard = i === nearestIdx && bridgeT >= 1 && !this.loopPaused && !reduce;
          const targetRate = isCenterCard ? 1 : 0;
          const rateK = Math.min(1, dtSec * (isCenterCard ? 14 : 10));
          card.loopRate += (targetRate - card.loopRate) * rateK;
          if (Math.abs(targetRate - card.loopRate) < 0.005) card.loopRate = targetRate;

          if (card.loopRate > 0.001) {
            card.loopSec = (card.loopSec + dtSec * card.loopRate) % clipDur;
          }
          clipP = clamp((card.loopSec % clipDur) / clipDur, 0, 1);
        }

        const frameFloat = card.from + clipP * (card.span - 1);
        if (absD < 1.85 && (i > 0 || viewportEntry > 0)) {
          const prevInt = Math.round(card.curFrame);
          const nextInt = Math.round(frameFloat);
          if (nextInt !== prevInt || card.dirty || !card.hasCanvas) {
            this.drawCard(card, frameFloat, i === 0 && bridgeT < 1);
            if (nextInt !== prevInt && Math.abs(nextInt - (card.lastPumpInt ?? -999)) >= 4) {
              card.lastPumpInt = nextInt;
              AssetScheduler.schedulePump();
            }
          } else {
            card.curFrame = frameFloat;
          }
        }

        if (Math.abs(clipP - card.lastProg) > 0.008) {
          card.lastProg = clipP;
          setCssVar(st, cc, "--rc-prog", clipP.toFixed(3));
        }
        if (this.thumbs[i]) {
          const tpVal = i === nearestIdx ? Math.round(clipP * 125) / 125 : 0;
          if (tpVal !== card.lastThumbP) {
            card.lastThumbP = tpVal;
            this.thumbs[i].style.setProperty("--th-p", tpVal.toFixed(3));
          }
        }
      }
      this.needsVisualSync = false;

      const activeCard = this.cards[nearestIdx];
      if (this.reelTcEl && activeCard) {
        const activeDur = Math.max(1, activeCard.span / activeCard.fps);
        const curSec = Math.floor(activeCard.loopSec % activeDur);
        if (curSec !== this.lastReelTcSec) {
          this.lastReelTcSec = curSec;
          this.reelTcEl.textContent = `${pad(Math.floor(curSec / 60))}:${pad(curSec % 60)}`;
        }
      }
    }
  }

  const traceReels = $$(".trace-reel").map((el) => new UnifiedTraceReel(el));

  /* ---------------------------------------------------------
     PRELOADER INTELIGENTE (Buffer contiguo de apertura + decodificación GPU)
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  const tStart = performance.now();
  let loadTarget = 0, loadShown = 0, ready = false;

  function tickLoader(now) {
    if (ready) return;
    const minT = reduce ? 0 : 850;
    const timeCap = clamp((now - tStart) / minT);
    const goal = Math.min(loadTarget, reduce ? 1 : timeCap);
    loadShown += (goal - loadShown) * 0.16;
    if (goal - loadShown < 0.004) loadShown = goal;
    if (loaderCount) loaderCount.textContent = pad(Math.round(loadShown * 100), 3);
    if (loaderBar) loaderBar.style.transform = `scaleX(${loadShown.toFixed(4)})`;
    if (loadShown >= 0.996) return setReady();
    requestAnimationFrame(tickLoader);
  }
  requestAnimationFrame(tickLoader);

  function setReady() {
    if (ready) return;
    ready = true;
    window.__onBankProgress = null;
    window.__onBankDecode = null;
    if (loaderCount) loaderCount.textContent = "100";
    if (loaderBar) loaderBar.style.transform = "scaleX(1)";
    body.classList.add("is-loaded");
    const openCurtains = () => {
      body.classList.add("is-ready");
      body.classList.remove("is-loading");
      if (lenis) lenis.start();
      measureAll();
      AssetScheduler.schedulePump();
    };
    if (reduce) {
      openCurtains();
    } else {
      setTimeout(openCurtains, 260);
    }
  }

  const getObsRoot = () => (scrollContainer && isVerticalScroller()) ? scrollContainer : null;

  if (sequences.length) {
    const heroSeq = sequences[0];
    const heroBank = heroSeq.ensureBank();
    const preloadGoal = Math.min(heroSeq.count, NET_PROFILE.isConstrainedNet ? 28 : 54);
    const decodeGoal = Math.min(18, preloadGoal);

    const updateHeroPreloadProgress = () => {
      if (ready) return;
      const loadedContig = heroBank.contiguousLoadedFrom(0);
      const decodedContig = heroBank.contiguousDecodedFrom(0);
      const fetchP = clamp(loadedContig / preloadGoal, 0, 1);
      const decodeP = clamp(decodedContig / decodeGoal, 0, 1);
      loadTarget = Math.max(loadTarget, fetchP * 0.85 + decodeP * 0.15);
      if (loadedContig >= preloadGoal && decodedContig >= decodeGoal) {
        loadTarget = 1;
      }
    };

    window.__onBankProgress = (b) => { if (b === heroBank) updateHeroPreloadProgress(); };
    window.__onBankDecode = (b) => { if (b === heroBank) updateHeroPreloadProgress(); };
    AssetScheduler.schedulePump();

    // Tope de seguridad sólo para conexiones extremadamente lentas u offline
    setTimeout(() => { if (!ready) loadTarget = 1; }, 7500);
  } else {
    loadTarget = 1;
  }

  /* ---------------------------------------------------------
     Revelados inmediatos
     --------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      revealIO.unobserve(en.target);
    });
  }, { root: getObsRoot(), rootMargin: "0px 0px 10% 0px", threshold: 0.01 });

  const cardRevealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      cardRevealIO.unobserve(en.target);
    });
  }, { root: getObsRoot(), rootMargin: "0px 0px -6% 0px", threshold: 0.08 });

  $$("[data-reveal], [data-lines]").forEach((el) => {
    const sib = el.parentElement ? $$(":scope > [data-reveal]", el.parentElement) : [];
    const idx = sib.indexOf(el);
    if (el.classList.contains("rep-card")) {
      const colStep = vw > 1120 ? (idx % 3) : (vw > 680 ? (idx % 2) : 0);
      el.style.setProperty("--d", `${colStep * 0.09}s`);
      cardRevealIO.observe(el);
      return;
    }
    if (idx > 0) el.style.setProperty("--d", `${Math.min(idx, 5) * 0.07}s`);
    revealIO.observe(el);
  });

  /* ---------------------------------------------------------
     Índice y Anclas
     --------------------------------------------------------- */
  const indexBtn = $(".nav__index");
  const indexEl = $("#index");
  const previewImgs = $$(".index__preview img");

  function setIndex(open) {
    if (open) {
      previewImgs.forEach((img) => {
        if (img.dataset.src && !img.src) {
          img.src = img.dataset.src;
          img.removeAttribute("data-src");
        }
      });
    }
    body.classList.toggle("index-open", open);
    if (indexBtn) indexBtn.setAttribute("aria-expanded", String(open));
    if (indexEl) indexEl.setAttribute("aria-hidden", String(!open));
    if (lenis) open ? lenis.stop() : lenis.start();
  }
  if (indexBtn) indexBtn.addEventListener("click", () => setIndex(!body.classList.contains("index-open")));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && body.classList.contains("index-open")) setIndex(false); });

  $$(".index__list a").forEach((a, i) => {
    a.addEventListener("mouseenter", () => {
      previewImgs.forEach((img, j) => img.classList.toggle("is-active", j === i));
    });
  });

  function goTo(href) {
    if (!href || href === "#") return;
    let target = href === "#top" ? 0 : $(href);
    if (target === null) return;
    if (href === "#trazado" && traceReels.length) {
      const tr = traceReels[0];
      tr.autoPlaySuspended = false;
      target = tr.top + Math.round(tr.len * 0.088);
    }
    const wasOpen = body.classList.contains("index-open");
    if (wasOpen) {
      setIndex(false);
      setTimeout(() => scrollToTarget(target, { immediate: true }), 550);
    } else {
      scrollToTarget(target);
    }
  }

  $$("a[href^='#']").forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (href && href.length > 1 && (href === "#top" || $(href))) {
        e.preventDefault();
        goTo(href);
      }
    });
  });

  const heroScrollBtn = $(".hero__scroll");
  if (heroScrollBtn) {
    heroScrollBtn.addEventListener("click", () => {
      const step = Math.max(window.innerHeight * 0.32, 240);
      scrollToTarget(scrollY() + step, { duration: 1.0 });
    });
  }

  /* ---------------------------------------------------------
     Atmósfera sonora
     --------------------------------------------------------- */
  const soundBtn = $("#soundToggle");
  let audioCtx = null, master = null, filter = null, audioOn = false;

  function initAudio() {
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    master.connect(audioCtx.destination);
    filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(160, audioCtx.currentTime);
    filter.Q.setValueAtTime(0.9, audioCtx.currentTime);
    filter.connect(master);
    [[55, 0.34, 0], [82.4, 0.15, 2], [110.2, 0.06, -3]].forEach(([f, g, det]) => {
      const o = audioCtx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f, audioCtx.currentTime);
      o.detune.setValueAtTime(det, audioCtx.currentTime);
      const gn = audioCtx.createGain();
      gn.gain.value = g;
      o.connect(gn); gn.connect(filter);
      o.start();
    });
  }

  function toggleAudio() {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    audioOn = !audioOn;
    soundBtn.classList.toggle("is-on", audioOn);
    soundBtn.setAttribute("aria-pressed", String(audioOn));
    const now = audioCtx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(audioOn ? 0.22 : 0.0001, now + (audioOn ? 1.4 : 0.8));
  }
  if (soundBtn) soundBtn.addEventListener("click", toggleAudio);

  function playTactileTick(freq = 520, dur = 0.03, gainVal = 0.035) {
    if (!audioOn || !audioCtx) return;
    try {
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gn = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gn.gain.setValueAtTime(gainVal, now);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gn);
      gn.connect(master || audioCtx.destination);
      osc.start(now);
      osc.stop(now + dur);
    } catch (_) {}
  }

  /* ---------------------------------------------------------
     Reloj & Copiar Correo
     --------------------------------------------------------- */
  const clockEl = $("[data-clock]");
  function updateClock() {
    if (!clockEl) return;
    try {
      clockEl.textContent = new Date().toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch (_) {}
  }
  updateClock();
  setInterval(updateClock, 15000);

  const copyMailBtn = $("[data-copy-mail]");
  const copyMailTxt = $("[data-copy-txt]");
  let copyTimer = null;
  if (copyMailBtn) {
    copyMailBtn.addEventListener("click", () => {
      const email = copyMailBtn.dataset.copyMail || "hola@furlan.film";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).catch(() => {});
      }
      copyMailBtn.classList.add("is-copied");
      if (copyMailTxt) copyMailTxt.textContent = `Copiado · ${email}`;
      playTactileTick(740, 0.04, 0.03);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyMailBtn.classList.remove("is-copied");
        if (copyMailTxt) copyMailTxt.textContent = "Copiar dirección de correo";
      }, 2600);
    });
  }

  /* ---------------------------------------------------------
     Modal de YouTube
     --------------------------------------------------------- */
  const vmodal = $("#videoModal");
  const vmodalFrame = $("[data-vmodal-frame]", vmodal);
  const vmodalTitle = $("[data-vmodal-title]", vmodal);

  function getYouTubeEmbedUrl(rawUrl) {
    if (!rawUrl) return "";
    const match = rawUrl.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    const videoId = match && match[2].length === 11 ? match[2] : "";
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1` : rawUrl;
  }

  function openVideoModal(url, title = "Film cinematográfico") {
    if (!vmodal || !vmodalFrame) return;
    if (vmodalTitle) vmodalTitle.textContent = title;
    vmodalFrame.src = getYouTubeEmbedUrl(url);
    vmodal.classList.add("is-open");
    vmodal.setAttribute("aria-hidden", "false");
    body.classList.add("modal-open");
    if (lenis) lenis.stop();
  }

  function closeVideoModal() {
    if (!vmodal || !vmodalFrame) return;
    vmodal.classList.remove("is-open");
    vmodal.setAttribute("aria-hidden", "true");
    vmodalFrame.src = "";
    body.classList.remove("modal-open");
    if (lenis) lenis.start();
  }

  $$("[data-video-trigger]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openVideoModal(btn.dataset.videoTrigger, btn.dataset.videoTitle || "Film cinematográfico");
    });
  });

  $$("[data-vmodal-close]").forEach((el) => el.addEventListener("click", closeVideoModal));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && vmodal && vmodal.classList.contains("is-open")) closeVideoModal();
  });

  /* ---------------------------------------------------------
     Referencias editoriales & Medidas
     --------------------------------------------------------- */
  const navEl = $(".nav");
  const navSecLinks = $$("[data-nav-sec]").map((a) => ({
    link: a,
    id: a.dataset.navSec,
    sec: $(`#${a.dataset.navSec}`),
    docTop: 0,
    height: 0,
  }));

  const estudioSec = $("#estudio");
  const solarSun = $("[data-solar-sun]");
  const solarDeg = $("[data-solar-deg]");
  const solarHour = $("[data-solar-hour]");
  const principlesFill = $("[data-principles-fill]");
  const principleCards = $$("[data-principle]");

  const metodoSec = $("#metodo");
  const stepsGrid = metodoSec ? $(".steps", metodoSec) : null;
  const methodBar = $("[data-method-bar]");
  const methodNodes = $$("[data-method-node]");
  const methodSteps = $$("[data-method-step]");
  const methodPhase = $("[data-method-phase]");
  const METHOD_PHASE_NAMES = [
    "01 · Análisis espacial",
    "02 · Diseño de trayectoria",
    "03 · Rodaje FPV",
    "04 · Máster y entrega 4K",
  ];
  let lastMethodIdx = -1;

  const footSec = $(".foot");
  const footMark = $("[data-foot-mark]");

  let estudioDocTop = 0, estudioHeight = 0;
  let stepsGridDocTop = 0, stepsGridHeight = 0;
  let footDocTop = 0, footHeight = 0;

  function measureEditorial() {
    const scroll = scrollY();
    navSecLinks.forEach((item) => {
      if (item.sec) {
        item.docTop = item.sec.getBoundingClientRect().top + scroll;
        item.height = item.sec.offsetHeight;
      }
    });
    if (estudioSec) {
      estudioDocTop = estudioSec.getBoundingClientRect().top + scroll;
      estudioHeight = estudioSec.offsetHeight;
    }
    principleCards.forEach((c) => {
      c._docTop = c.getBoundingClientRect().top + scroll;
      c._height = c.offsetHeight;
    });
    if (stepsGrid) {
      stepsGridDocTop = stepsGrid.getBoundingClientRect().top + scroll;
      stepsGridHeight = stepsGrid.offsetHeight;
    }
    if (footSec) {
      footDocTop = footSec.getBoundingClientRect().top + scroll;
      footHeight = footSec.offsetHeight;
    }
    wordBlocks.forEach((b) => {
      b.docTop = b.el.getBoundingClientRect().top + scroll;
      b.height = b.el.offsetHeight;
    });
    lineBlocks.forEach((b) => {
      b.docTop = b.el.getBoundingClientRect().top + scroll;
      b.height = b.el.offsetHeight;
    });
  }

  function measureSeqs() {
    sequences.forEach((s) => { s.measure(); s.dirty = true; });
    reels.forEach((r) => r.measure());
    traceReels.forEach((tr) => { tr.measure(); tr.traceDirty = true; });
  }

  let needsEditorialSync = true;
  function measureAll() {
    vw = innerWidth;
    vh = innerHeight;
    root.style.setProperty("--vh", `${vh}px`);
    measureEditorial();
    measureSeqs();
    needsEditorialSync = true;
  }

  let rT, lastW = vw;
  addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      if (!finePointer && innerWidth === lastW && Math.abs(innerHeight - vh) < 120) return;
      lastW = innerWidth;
      measureAll();
    }, 140);
  });
  addEventListener("load", measureAll);
  if (document.fonts) document.fonts.ready.then(measureAll);
  measureAll();

  /* ---------------------------------------------------------
     Loop principal (60fps, pausado en segundo plano, sin escrituras DOM en reposo)
     --------------------------------------------------------- */
  let last = performance.now();
  let lastY = 0, lastPumpY = -9999, lastPumpT = 0, navAcc = 0, currentNavId = "";
  let isNavHidden = false;
  let rafId = 0;
  let lastEstLitMask = -1;
  const edTxtCache = {};

  function loop(now) {
    rafId = 0;
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (lenis && !isVerticalScroller()) lenis.raf(now);
    const y = scrollY();
    const dy = y - lastY;
    const isScrolling = Math.abs(dy) > 0.05;

    if (Math.abs(y - lastPumpY) > 120 || (isScrolling && now - lastPumpT > 250)) {
      lastPumpY = y;
      lastPumpT = now;
      AssetScheduler.schedulePump();
    }

    if (finePointer && cursor && (Math.abs(mx - cx) > 0.05 || Math.abs(my - cy) > 0.05 || Math.abs(mx - rx) > 0.05 || Math.abs(my - ry) > 0.05)) {
      cx += (mx - cx) * 0.22;
      cy += (my - cy) * 0.22;
      rx += (mx - rx) * 0.11;
      ry += (my - ry) * 0.11;
      cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      if (cursorRing) {
        const cVel = Math.hypot(mx - rx, my - ry);
        cursorRing.style.setProperty("--ring-dx", `${(rx - cx).toFixed(1)}px`);
        cursorRing.style.setProperty("--ring-dy", `${(ry - cy).toFixed(1)}px`);
        cursorRing.style.setProperty("--ring-scale", (1 + Math.min(0.22, cVel * 0.0032)).toFixed(3));
      }
    }

    if (isScrolling || needsEditorialSync) {
      if (isScrolling) {
        navAcc = Math.sign(dy) === Math.sign(navAcc) ? navAcc + dy : dy;
        let shouldHide = isNavHidden;
        if (y < 100) shouldHide = false;
        else if (dy < -6 || navAcc < -12) shouldHide = false;
        else if (navAcc > 35 && dy > 0) shouldHide = true;

        if (shouldHide !== isNavHidden) {
          isNavHidden = shouldHide;
          if (navEl) navEl.classList.toggle("is-hidden", isNavHidden);
          body.classList.toggle("nav-hidden", isNavHidden);
        }

        if (navSecLinks.length) {
          let activeId = "";
          const probeY = vh * 0.38;
          for (let i = 0; i < navSecLinks.length; i++) {
            const item = navSecLinks[i];
            if (!item.sec) continue;
            const sTop = item.docTop - y;
            if (sTop <= probeY && sTop + item.height >= probeY * 0.5) activeId = item.id;
          }
          if (activeId !== currentNavId) {
            currentNavId = activeId;
            navSecLinks.forEach((item) => item.link.classList.toggle("is-current", item.id === activeId));
          }
        }
      }

      if (estudioSec) {
        const erTop = estudioDocTop - y;
        const erBottom = erTop + estudioHeight;
        if (erBottom > -80 && erTop < vh + 80) {
          const estP = clamp((vh * 0.85 - erTop) / Math.max(1, estudioHeight + vh * 0.25));
          const axisP = clamp((vh * 0.78 - erTop) / Math.max(1, estudioHeight * 0.88));
          estudioSec.style.setProperty("--estudio-axis", axisP.toFixed(3));
          estudioSec.style.setProperty("--solar-dash", (185 * (1 - estP)).toFixed(1));

          if (solarSun) {
            const theta = Math.PI * (1 - estP);
            solarSun.setAttribute("cx", (70 + 58 * Math.cos(theta)).toFixed(1));
            solarSun.setAttribute("cy", (64 - 58 * Math.sin(theta)).toFixed(1));
          }
          setTextCached(solarDeg, edTxtCache, "sDeg", `${Math.round(12 + Math.sin(estP * Math.PI) * 56)}°`);
          if (solarHour) {
            const totalMin = Math.round(450 + estP * 675);
            setTextCached(solarHour, edTxtCache, "sHour", `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)} ART`);
          }
          if (principlesFill) {
            const prP = clamp((vh * 0.68 - erTop - estudioHeight * 0.28) / Math.max(1, estudioHeight * 0.45));
            principlesFill.style.transform = `scaleX(${prP.toFixed(3)})`;
          }
          let litMask = 0;
          principleCards.forEach((card, idx) => {
            const crTop = (card._docTop || 0) - y;
            const crH = card._height || 200;
            const cp = clamp((vh * 0.86 - crTop) / Math.max(1, crH * 1.15));
            card.style.setProperty("--path-dash", (120 * (1 - cp)).toFixed(1));
            if (cp > 0.35) litMask |= (1 << idx);
            if (!reduce) {
              const rel = (crTop + crH * 0.5 - vh * 0.5) / vh;
              card.style.setProperty("--prin-y", `${(rel * (6 + (idx - 1) * 5)).toFixed(1)}px`);
            }
          });
          if (litMask !== lastEstLitMask) {
            lastEstLitMask = litMask;
            principleCards.forEach((card, idx) => card.classList.toggle("is-lit", (litMask & (1 << idx)) !== 0));
          }
        }
      }

      if (metodoSec && stepsGrid) {
        const mrTop = stepsGridDocTop - y;
        const mrBottom = mrTop + stepsGridHeight;
        if (mrBottom > -80 && mrTop < vh + 80) {
          const mp = clamp((vh * 0.65 - mrTop) / Math.max(1, stepsGridHeight * 0.92));
          if (methodBar) methodBar.style.transform = `scaleX(${mp.toFixed(4)})`;
          const activeIdx = clamp(Math.floor(mp * 3.99), 0, 3);
          if (activeIdx !== lastMethodIdx) {
            lastMethodIdx = activeIdx;
            methodNodes.forEach((n, idx) => n.classList.toggle("is-active", idx <= activeIdx));
            methodSteps.forEach((s, idx) => s.classList.toggle("is-active-step", idx === activeIdx));
            if (methodPhase && METHOD_PHASE_NAMES[activeIdx]) methodPhase.textContent = METHOD_PHASE_NAMES[activeIdx];
          }
        }
      }

      if (footSec && footMark && !reduce) {
        const frTop = footDocTop - y;
        const frBottom = frTop + footHeight;
        if (frBottom > -60 && frTop < vh + 60) {
          const fp = clamp((vh - frTop) / Math.max(1, footHeight + vh * 0.35));
          footMark.style.setProperty("--foot-y", `${((1 - fp) * 16).toFixed(1)}px`);
          footMark.style.setProperty("--foot-shine", `${(15 + fp * 75).toFixed(1)}%`);
        }
      }

      wordBlocks.forEach((b) => {
        const rTop = b.docTop - y;
        const rBottom = rTop + b.height;
        if (rTop > vh + 80 || rBottom < -80) return;
        const start = vh * 0.85;
        const end = vh * 0.45 - b.height * 0.3;
        const p = Math.pow(clamp((start - rTop) / Math.max(1, start - end)), 1.25);
        if (Math.abs(p - b.lastP) < 0.002) return;
        b.lastP = p;
        const head = p * (b.words.length + 1.4);
        b.words.forEach((w, i) => {
          const op = (0.35 + clamp((head - i) / 1.4) * 0.65).toFixed(3);
          w.style.setProperty("--o", op);
        });
      });

      if (!reduce) {
        lineBlocks.forEach((b) => {
          const rTop = b.docTop - y;
          const rBottom = rTop + b.height;
          if (rBottom < -60 || rTop > vh + 60) return;
          const relY = (rTop + b.height * 0.5 - vh * 0.5) / vh;
          if (b.lines[0]) b.lines[0].style.setProperty("--ln-shift", `${(relY * -10).toFixed(1)}px`);
          if (b.lines[1]) b.lines[1].style.setProperty("--ln-shift", `${(relY * 14).toFixed(1)}px`);
        });
      }
      needsEditorialSync = false;
    }

    for (let i = 0; i < sequences.length; i++) sequences[i].update(dt, isScrolling);
    for (let i = 0; i < reels.length; i++) reels[i].update(dt, isScrolling);
    for (let i = 0; i < traceReels.length; i++) traceReels[i].update(dt, isScrolling);

    lastY = y;
    rafId = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !rafId) {
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  });
  rafId = requestAnimationFrame(loop);
})();
