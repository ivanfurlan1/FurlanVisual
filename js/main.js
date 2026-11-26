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

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const body = document.body;
  const root = document.documentElement;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  let vw = innerWidth, vh = innerHeight;
  root.style.setProperty("--vh", `${vh}px`);

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
      e.preventDefault();
      e.stopPropagation();
      activeId = e.pointerId;
      try { scrubEl.setPointerCapture(e.pointerId); } catch (_) {}
      setScrubbing(true);
      const r = ratioFromClientX(e.clientX);
      if (r !== null) onSeek(r, { immediate: e.pointerType !== "mouse" });
    }, { passive: false });

    scrubEl.addEventListener("pointermove", (e) => {
      if (activeId !== e.pointerId) return;
      e.preventDefault();
      const r = ratioFromClientX(e.clientX);
      if (r !== null) onSeek(r, { immediate: true });
    }, { passive: false });

    const endScrub = (e) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      try { scrubEl.releasePointerCapture(e.pointerId); } catch (_) {}
      setScrubbing(false);
    };
    scrubEl.addEventListener("pointerup", endScrub);
    scrubEl.addEventListener("pointercancel", endScrub);
    scrubEl.addEventListener("lostpointercapture", () => {
      if (activeId !== null) {
        activeId = null;
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

      this.frames = [];
      this.cur = 0;
      this.lastCur = -1;
      this.lastFrame = -1;
      this.token = 0;
      this.lastBlur = -1;
      this.lastGray = -1;
      this.lastScrollPos = undefined;
      this.tiltRx = 0;
      this.tiltRy = 0;

      if (this.isHybrid && !this.isTrace && this.media) {
        this.media.addEventListener("click", (e) => {
          if (e.target.closest("button, a, [data-video-trigger], .seq__outro-card, .seq__scrub")) return;
          this.togglePlayPause();
        });
      }
      this.bindScrub();
      this.measure();
      if (!this.isHero && !this.isKinetic && !this.isCinema) this.setVisualFilter(10, 1);
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
      if (this.isKinetic || this.isCinema) return "lg";
      return vw / vh < 0.9 ? "pt" : "lg";
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.min(1920, Math.round(vw * dpr));
      const h = Math.min(1680, Math.round(vh * dpr));
      if (!this.isKinetic && !this.isCinema && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.dirty = true;
      }
      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const t = this.target();
      this.tw = t.tw;
      this.th = t.th;
      this.stage.style.setProperty("--tw", `${t.tw}px`);
      this.stage.style.setProperty("--th", `${t.th}px`);

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
        this.set = null;
        this.load(set);
      }
    }

    order() {
      const n = this.count, seen = new Uint8Array(n), out = [];
      out.push(0); seen[0] = 1;
      for (let i = 3; i < n; i += 3) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      if (!seen[n - 1]) { seen[n - 1] = 1; out.push(n - 1); }
      for (let i = 1; i < n; i += 2) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      for (let i = 0; i < n; i++) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      return out;
    }

    load(set = this.pickSet(), onProgress) {
      if (this.set === set && this.frames.length) return;
      this.set = set;
      const token = ++this.token;
      this.frames = new Array(this.count);
      const queue = this.order();
      const first = Math.min(18, Math.ceil(this.count * 0.25));
      let qi = 0, done = 0;
      const parallel = 4;

      const next = () => {
        if (token !== this.token || qi >= queue.length) return;
        const i = queue[qi++];
        const img = new Image();
        img.decoding = "async";
        const finish = (ok) => {
          if (token !== this.token) return;
          if (ok) this.frames[i] = img;
          done++;
          if (onProgress) onProgress(Math.min(1, done / first));
          if (i === 0 && ok) {
            this.el.classList.add("has-canvas");
            this.draw(0);
          }
          if (Math.abs(i - Math.round(this.cur)) <= 2) this.dirty = true;
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        const vParam = this.version ? `?v=${this.version}` : "";
        img.src = `${this.src}/${set}/${pad(i + 1, 4)}.webp${vParam}`;
      };
      for (let k = 0; k < parallel; k++) next();
    }

    nearest(i) {
      const f = this.frames;
      if (f[i]) return f[i];
      for (let d = 1; d < this.count; d++) {
        if (f[i - d]) return f[i - d];
        if (f[i + d]) return f[i + d];
      }
      return null;
    }

    draw(pos) {
      const f = Math.round(clamp(pos, 0, this.count - 1));
      const img = this.nearest(f);
      if (!img || !img.naturalWidth) return;
      if (this.lastDrawnImg === img && !this.dirty) return;

      const c = this.canvas, ctx = this.ctx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;

      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;

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
      this.lastDrawnImg = img;
      this.dirty = false;
    }

    setVisualFilter(blurPx, grayVal = 0) {
      const b = Math.max(0, Math.round(blurPx * 10) / 10);
      const g = Math.max(0, Math.min(1, Math.round(grayVal * 100) / 100));
      if (b === this.lastBlur && g === this.lastGray) return;
      this.lastBlur = b;
      this.lastGray = g;
      const parts = [];
      if (b > 0.05) parts.push(`blur(${b}px)`);
      if (g > 0.01) parts.push(`grayscale(${g})`);
      const f = parts.length ? parts.join(" ") : "none";
      this.canvas.style.filter = f;
      if (this.posterImg) this.posterImg.style.filter = f;
    }

    setText(el, o, ty) {
      el.style.opacity = o.toFixed(3);
      el.style.transform = ty ? `translate3d(0, ${ty.toFixed(2)}vh, 0)` : "none";
      el.style.visibility = o <= 0.001 ? "hidden" : "visible";
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

    update(dt) {
      const n = this.count;
      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);
      const st = this.stage.style;

      if (!this.set && viewportEntry > 0) this.load();
      if (y + vh < this.top - vh || y > this.top + this.len + vh) return;

      if (!this.isHero && viewportEntry <= 0) {
        this.cur = 0;
        this.progress = 0;
        if (this.isKinetic) {
          st.setProperty("--kseq-clip-x", "28%");
          st.setProperty("--kseq-clip-y", "6%");
          st.setProperty("--kseq-ty", "0px");
          st.setProperty("--kseq-curtain-y", "0px");
          st.setProperty("--kseq-scale", "0.94");
          st.setProperty("--kseq-hud-op", "0");
          st.setProperty("--kseq-inner-hud", "0");
          st.setProperty("--outro-card-op", "0");
          st.setProperty("--outro-card-pe", "none");
          if (this.kWingL) { this.kWingL.style.opacity = "1"; this.kWingL.style.transform = "translate3d(0,0,0)"; }
          if (this.kWingR) { this.kWingR.style.opacity = "1"; this.kWingR.style.transform = "translate3d(0,0,0)"; }
        }
        if (this.isCinema) {
          const cs = this.el.style;
          cs.setProperty("--cinema-line", "0");
          cs.setProperty("--cinema-line-op", "0");
          cs.setProperty("--cinema-clip-x", "10%");
          cs.setProperty("--cinema-clip-y", "48.2%");
          cs.setProperty("--cinema-ty", "0px");
          cs.setProperty("--cinema-scale", "1.035");
          cs.setProperty("--cinema-beam-op", "0.35");
          cs.setProperty("--cinema-beam-s", "0.35");
          cs.setProperty("--cinema-prelude-op", "1");
          cs.setProperty("--cinema-prelude-y", "0px");
          cs.setProperty("--cinema-hud-op", "0");
          cs.setProperty("--cinema-marks-op", "0");
          cs.setProperty("--cinema-ambient", "0");
          cs.setProperty("--cinema-border", "0.08");
          cs.setProperty("--cinema-shadow", "0.4");
          cs.setProperty("--cinema-blackout", "0");
          this.el.classList.remove("is-cinema-passed");
          if (this.cinemaPrelude) this.cinemaPrelude.style.visibility = "visible";
          this.setVisualFilter(4, 0.25);
        }
        if (this.isTrace) {
          this.traceCur = 0;
          this.updateTrace(0, -0.2, 0, 0.016);
        }
        if (this.lastCur !== 0 || this.dirty) {
          this.draw(0);
          this.lastCur = 0;
          this.dirty = false;
        }
        return;
      }

      const exitRange = 0.2;
      const pinMaxProg = 0.9;

      if (rawP >= 1.0 + exitRange) {
        this.cur = n - 1;
        this.progress = 1;
        if (this.isTrace) {
          this.traceCur = 1;
          this.updateTrace(1, 1.0 + exitRange, 1, 0.016);
        }
        if (this.isKinetic) {
          st.setProperty("--kseq-clip-x", "0%");
          st.setProperty("--kseq-clip-y", "0%");
          st.setProperty("--kseq-scale", "1");
          st.setProperty("--kseq-hud-op", "0.2");
          st.setProperty("--kseq-inner-hud", "0");
          if (this.kWingL) this.kWingL.style.opacity = "0";
          if (this.kWingR) this.kWingR.style.opacity = "0";
        }
        if (this.isCinema) {
          const cs = this.el.style;
          cs.setProperty("--cinema-line", "1");
          cs.setProperty("--cinema-line-op", "0");
          cs.setProperty("--cinema-clip-x", "0%");
          cs.setProperty("--cinema-clip-y", "0%");
          cs.setProperty("--cinema-scale", "0.982");
          cs.setProperty("--cinema-beam-op", "0");
          cs.setProperty("--cinema-prelude-op", "0");
          cs.setProperty("--cinema-hud-op", "0");
          cs.setProperty("--cinema-marks-op", "0");
          cs.setProperty("--cinema-ambient", "0");
          cs.setProperty("--cinema-border", "0");
          cs.setProperty("--cinema-shadow", "0");
          cs.setProperty("--cinema-blackout", "1");
          this.el.classList.add("is-cinema-passed");
          if (this.cinemaPrelude) this.cinemaPrelude.style.visibility = "hidden";
          if (this.lastCur !== n - 1 || this.dirty) {
            this.draw(n - 1);
            this.lastCur = n - 1;
            this.dirty = false;
          }
        }
        if (this.outroCard) {
          st.setProperty("--cover-opacity", "0.36");
          st.setProperty("--frame-opacity", "1");
          st.setProperty("--chrome-opacity", "1");
          st.setProperty("--chrome-vis", "visible");
          st.setProperty("--outro-card-op", "1");
          st.setProperty("--outro-card-ty", "0px");
          st.setProperty("--outro-card-pe", "auto");
        }
        if (this.scrubFill) this.scrubFill.style.width = "100%";
        return;
      }

      const p = rawP;
      let prog = 0;

      if (this.isHybrid) {
        const baseDuration = this.customDuration || (this.isHero ? 7.2 : (this.isKinetic ? 12.5 : (this.isCinema ? 13.5 : (this.isTrace ? 10.8 : 9.8))));
        const nextTraceTop = (this.isCinema && typeof traceReels !== "undefined" && traceReels.length) ? traceReels[0].top : (this.top + this.len);
        const cinemaPeek = this.isCinema ? Math.max(2, (nextTraceTop - (this.top + this.len)) + 2) : undefined;
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
            hasFrames: this.frames && (this.frames[0] || this.nearest(0)),
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
      if (this.lastScrollPos === undefined) this.lastScrollPos = y;
      const scrolling = Math.abs(y - this.lastScrollPos) > 0.2;
      this.lastScrollPos = y;

      let eff = targetF;
      if (!scrolling && Math.abs(targetF - this.cur) < 0.25) eff = Math.round(targetF);
      this.cur += (eff - this.cur) * k;
      if (Math.abs(eff - this.cur) < 0.002) this.cur = eff;

      if (Math.abs(this.cur - this.lastCur) > 0.002 || this.dirty) {
        this.draw(this.cur);
        this.lastCur = this.cur;

        const f = Math.round(this.cur);
        if (f !== this.lastFrame) {
          this.lastFrame = f;
          const sec = Math.floor(f / this.fps);
          const fr = f % this.fps;
          if (this.tcEl) this.tcEl.textContent = `${pad(sec)}:${pad(fr)}`;
          if (this.frEl) this.frEl.textContent = pad(f + 1, 3);
        }
        const pctVal = Math.round(prog * 1000) / 10;
        if (pctVal !== this.lastPctVal) {
          this.lastPctVal = pctVal;
          if (this.scrubFill) this.scrubFill.style.width = `${pctVal}%`;
          if (this.scrub) this.scrub.setAttribute("aria-valuenow", String(Math.round(pctVal)));
        }
      }

      if (this.isFullscreen) {
        st.setProperty("--frame-w", `${vw}px`);
        st.setProperty("--frame-h", `${vh}px`);
        st.setProperty("--img-scale", "1.02");
        st.setProperty("--frame-opacity", "1");
        this.setVisualFilter(0, 0);
        if (this.isTrace) this.updateTrace(prog, p, viewportEntry, dt);
        return;
      }

      if (this.isKinetic) {
        const isMob = vw <= 900 || (vw / vh < 0.95);
        const openT = smooth(range(p, 0.02, 0.42));
        st.setProperty("--kseq-clip-x", `${((1 - openT) * (isMob ? 24 : 30)).toFixed(2)}%`);
        st.setProperty("--kseq-clip-y", `${((1 - openT) * 6).toFixed(2)}%`);

        const wakeT = smooth(range(p, -0.10, 0.08));
        const outro = smooth(range(prog, 0.88, 1.0));
        st.setProperty("--cover-opacity", Math.max((1 - wakeT) * 0.24, outro * 0.36).toFixed(3));
        st.setProperty("--frame-opacity", "1");
        this.setVisualFilter(Math.max((1 - wakeT) * 8, outro * 5), 1 - wakeT);

        const wingMove = smooth(range(p, 0.02, 0.42));
        const wingOp = 1 - smooth(range(p, 0.22, 0.40));
        const wingShiftX = wingMove * (isMob ? vw * 0.22 : vw * 0.20);
        if (this.kWingL) {
          this.kWingL.style.opacity = wingOp.toFixed(3);
          this.kWingL.style.transform = `translate3d(${(-wingShiftX).toFixed(1)}px, 0, 0)`;
          this.kWingL.style.visibility = wingOp <= 0.005 ? "hidden" : "visible";
        }
        if (this.kWingR) {
          this.kWingR.style.opacity = wingOp.toFixed(3);
          this.kWingR.style.transform = `translate3d(${wingShiftX.toFixed(1)}px, 0, 0)`;
          this.kWingR.style.visibility = wingOp <= 0.005 ? "hidden" : "visible";
        }

        const mobEntryShiftY = isMob ? (-(1 - smooth(viewportEntry)) * (vh * 0.16)) : 0;
        st.setProperty("--kseq-ty", `${mobEntryShiftY.toFixed(1)}px`);
        st.setProperty("--kseq-curtain-y", `${mobEntryShiftY.toFixed(1)}px`);
        st.setProperty("--kseq-scale", (0.94 + openT * 0.06).toFixed(4));

        const hudOp = smooth(range(p, 0.28, 0.44)) * (1 - smooth(range(p, 0.88, 0.96)));
        st.setProperty("--kseq-hud-op", hudOp.toFixed(3));
        st.setProperty("--kseq-hud-y", `${((1 - hudOp) * -8).toFixed(1)}px`);
        st.setProperty("--kseq-bot-y", `${((1 - hudOp) * 8).toFixed(1)}px`);
        st.setProperty("--kseq-inner-hud", (openT * (1 - outro)).toFixed(3));

        if (this.kPhase) {
          this.kPhase.textContent = p < 0.22
            ? "Apertura"
            : (p < 0.56 ? "Aproximación" : (p < 0.84 ? "Interior" : "Film Máster 4K"));
        }

        if (this.outroCard) {
          const outroCardT = smooth(range(p, 0.84, 0.94));
          st.setProperty("--outro-card-op", outroCardT.toFixed(3));
          st.setProperty("--outro-card-ty", `${((1 - outroCardT) * 14).toFixed(1)}px`);
          st.setProperty("--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
        }
        return;
      }

      if (this.isCinema) {
        const cs = this.el.style;
        const isMob = vw <= 900 || (vw / vh < 0.95);
        const nextTraceTop = (typeof traceReels !== "undefined" && traceReels.length) ? traceReels[0].top : (this.top + this.len);
        this.el.classList.toggle("is-cinema-passed", y >= nextTraceTop);
        const lineT = reduce ? 1 : smooth(range(viewportEntry, 0.18, 0.88));
        const lineFade = reduce ? 0 : smooth(range(p, 0.10, 0.30));
        cs.setProperty("--cinema-line", lineT.toFixed(3));
        cs.setProperty("--cinema-line-op", (lineT * (1 - lineFade)).toFixed(3));

        const entryTy = isMob && !reduce ? -(1 - smooth(viewportEntry)) * (vh * 0.12) : 0;
        cs.setProperty("--cinema-ty", `${entryTy.toFixed(1)}px`);

        const openT = reduce ? 1 : smooth(range(p, -0.02, 0.22));
        cs.setProperty("--cinema-clip-x", `${((1 - openT) * (isMob ? 8 : 10)).toFixed(2)}%`);
        cs.setProperty("--cinema-clip-y", `${((1 - openT) * 48.2).toFixed(2)}%`);

        const beamOp = reduce ? 0 : Math.sin(clamp(openT, 0, 1) * Math.PI) * 0.9 * (1 - openT * 0.85);
        cs.setProperty("--cinema-beam-op", beamOp.toFixed(3));
        cs.setProperty("--cinema-beam-s", (0.35 + openT * 0.65).toFixed(3));

        const preludeIn = reduce ? 0 : smooth(range(viewportEntry, 0.25, 0.82));
        const preludeOut = reduce ? 1 : smooth(range(p, 0.03, 0.18));
        const preludeOp = preludeIn * (1 - preludeOut);
        cs.setProperty("--cinema-prelude-op", preludeOp.toFixed(3));
        cs.setProperty("--cinema-prelude-y", `${(-preludeOut * 16).toFixed(1)}px`);
        if (this.cinemaPrelude) this.cinemaPrelude.style.visibility = preludeOp <= 0.005 ? "hidden" : "visible";

        const wakeT = reduce ? 1 : smooth(range(p, -0.04, 0.14));
        const cinemaDarken = smooth(range(p, 0.902, 0.970));
        const blackoutT = reduce ? (p >= 0.97 ? 1 : 0) : smooth(range(p, 0.918, 0.980));

        this.setVisualFilter((1 - wakeT) * 4.5, (1 - wakeT) * 0.28);
        const openScale = reduce ? 1 : (1 + (1 - openT) * 0.035);
        const endScale = reduce ? 1 : (1 - blackoutT * 0.018);
        cs.setProperty("--cinema-scale", (openScale * endScale).toFixed(4));

        const hudIn = reduce ? 1 : smooth(range(p, 0.18, 0.30));
        const hudOp = hudIn * (1 - cinemaDarken);
        cs.setProperty("--cinema-hud-op", hudOp.toFixed(3));
        cs.setProperty("--cinema-hud-top-y", `${((1 - hudOp) * -8).toFixed(1)}px`);
        cs.setProperty("--cinema-hud-bot-y", `${((1 - hudOp) * 8).toFixed(1)}px`);

        const marksOp = openT * (1 - cinemaDarken) * 0.85;
        const ambientOp = openT * (1 - cinemaDarken) * 0.55;
        cs.setProperty("--cinema-marks-op", marksOp.toFixed(3));
        cs.setProperty("--cinema-ambient", ambientOp.toFixed(3));
        cs.setProperty("--cinema-amb-s", (0.96 + openT * 0.04).toFixed(3));
        cs.setProperty("--cinema-border", (openT * (1 - cinemaDarken) * 0.14).toFixed(3));
        cs.setProperty("--cinema-shadow", (openT * (1 - cinemaDarken)).toFixed(3));
        cs.setProperty("--cinema-veil", (0.22 + cinemaDarken * 0.25).toFixed(3));
        cs.setProperty("--cinema-blackout", blackoutT.toFixed(3));
        return;
      }

      /* Secuencias con reencuadre (#film-01 Hero & #film-04 Comercial) */
      const morph = smooth(range(p, 0.0, 0.26));
      const inv = 1 - morph;
      st.setProperty("--frame-w", `${(this.tw + (vw - this.tw) * inv).toFixed(1)}px`);
      st.setProperty("--frame-h", `${(this.th + (vh - this.th) * inv).toFixed(1)}px`);
      st.setProperty("--img-scale", (1 + inv * (this.isHero ? 0.04 : 0.05)).toFixed(4));

      const outro = smooth(range(prog, 0.86, 1.0));
      const tiltEnvelope = morph * (1 - outro);
      const targetRx = (!reduce && finePointer) ? (-normMy * 1.6 * tiltEnvelope) : 0;
      const targetRy = (!reduce && finePointer) ? (normMx * 2.2 * tiltEnvelope) : 0;
      this.tiltRx += (targetRx - this.tiltRx) * 0.1;
      this.tiltRy += (targetRy - this.tiltRy) * 0.1;
      st.setProperty("--seq-rx", `${this.tiltRx.toFixed(2)}deg`);
      st.setProperty("--seq-ry", `${this.tiltRy.toFixed(2)}deg`);

      if (this.isHero) {
        const veilFade = 1 - smooth(range(p, 0.0, 0.24));
        st.setProperty("--frame-veil", veilFade.toFixed(3));
        st.setProperty("--cover-opacity", (outro * 0.38).toFixed(3));
        this.setVisualFilter(outro * 4.5, 0);
      } else {
        st.setProperty("--frame-veil", "0");
        const wake = smooth(range(p, -0.14, 0.04));
        st.setProperty("--cover-opacity", Math.max((1 - wake) * 0.28, outro * 0.38).toFixed(3));
        this.setVisualFilter(Math.max((1 - wake) * 10, outro * 6), 1 - wake);
      }
      st.setProperty("--frame-opacity", "1");

      if (this.hero) {
        const stHero = smooth(range(p, 0.0, 0.22));
        this.setText(this.hero, 1 - stHero, -stHero * 3);
        const hTitle = $(".hero__title", this.hero);
        if (hTitle) {
          const l1 = $(".hero__line:nth-child(1)", hTitle);
          const l2 = $(".hero__line--2", hTitle);
          if (l1) {
            l1.style.setProperty("--hero-l1-x", `${(-stHero * 22).toFixed(1)}px`);
            l1.style.setProperty("--hero-l1-y", `${(-stHero * 14).toFixed(1)}px`);
          }
          if (l2) {
            l2.style.setProperty("--hero-l2-x", `${(stHero * 28).toFixed(1)}px`);
            l2.style.setProperty("--hero-l2-y", `${(stHero * 10).toFixed(1)}px`);
          }
        }
        const hFoot = $(".hero__foot", this.hero);
        if (hFoot) {
          hFoot.style.setProperty("--hero-foot-y", `${(stHero * 24).toFixed(1)}px`);
          hFoot.style.opacity = Math.max(0, 1 - smooth(range(p, 0.0, 0.12))).toFixed(3);
        }
      }

      if (this.lead) {
        const entryShiftVh = -(1 - smooth(viewportEntry)) * 18;
        const stLead = smooth(range(p, 0.0, 0.20));
        this.setText(this.lead, 1 - stLead, entryShiftVh - stLead * 3.5);
      }

      const chrome = smooth(range(p, 0.14, 0.26));
      st.setProperty("--chrome-gap", `${vw <= 680 ? 12 : 16}px`);
      st.setProperty("--chrome-top-y", `${((1 - chrome) * 10).toFixed(1)}px`);
      st.setProperty("--chrome-bot-y", `${(-(1 - chrome) * 10).toFixed(1)}px`);
      st.setProperty("--chrome-opacity", chrome.toFixed(3));
      st.setProperty("--chrome-vis", chrome > 0.01 ? "visible" : "hidden");

      if (this.outroCard) {
        const outroCardT = smooth(range(p, 0.83, 0.93));
        st.setProperty("--outro-card-op", outroCardT.toFixed(3));
        st.setProperty("--outro-card-ty", `${((1 - outroCardT) * 14).toFixed(1)}px`);
        st.setProperty("--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
      }

      let shade = 0;
      this.chapters.forEach(({ n: el, r: [a, b], tick }) => {
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
          if (tick) tick.classList.remove("is-active");
          return;
        }
        const o = smooth(Math.min(range(t, 0, 0.18), 1 - range(t, 0.82, 1)));
        shade = Math.max(shade, o);
        el.style.visibility = o > 0.01 ? "visible" : "hidden";
        el.style.opacity = o.toFixed(3);
        if (tick) tick.classList.toggle("is-active", o > 0.15);
        el.style.transform = `translate3d(0, ${((1 - o) * 10).toFixed(1)}px, 0)`;
      });
      this.el.classList.toggle("has-chapter-glow", shade > 0.08);
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));

  /* ---------------------------------------------------------
     MOTOR DE ARCHIVO EN MOVIMIENTO (#archivo — Galería cinética 3D)
     --------------------------------------------------------- */
  const reelFrameCache = new Map();
  const reelInFlight = new Set();

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
      this.openedPreload = false;
      this.isScrubbing = false;

      this.initCards();
      this.bindControls();
      this.measure();
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
            <div class="reel-card__state-pill" aria-hidden="true">
              <svg class="reel__ico-pause" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.5" height="10" rx="0.6"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.6"/></svg>
              <svg class="reel__ico-play" viewBox="0 0 16 16" fill="currentColor"><polygon points="4.5,3 13,8 4.5,13"/></svg>
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
        };

        cardEl.addEventListener("click", () => {
          if (Math.abs(idx - this.carouselCur) < 0.42) {
            this.togglePlayPause();
          } else {
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
        w = clamp(Math.round(vw * 0.86), 280, 560);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(160, Math.min(vh * 0.40, vh - 290));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.92);
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

      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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

    orderRange(from, to) {
      const span = to - from + 1;
      const seen = new Uint8Array(span);
      const out = [];
      const push = (f) => {
        const idx = f - from;
        if (idx >= 0 && idx < span && !seen[idx]) {
          seen[idx] = 1;
          out.push(f);
        }
      };
      push(from);
      for (let f = from + 3; f <= to; f += 3) push(f);
      push(to);
      for (let f = from + 1; f <= to; f += 2) push(f);
      for (let f = from; f <= to; f++) push(f);
      return out;
    }

    loadCard(card) {
      if (!card) return;
      const set = this.set || this.pickSet();
      if (card.loadedSet === set) return;
      card.loadedSet = set;

      const queue = this.orderRange(card.from, card.to);
      let qi = 0;
      const parallel = 3;
      const vParam = card.version ? `?v=${card.version}` : "";

      const step = () => {
        while (qi < queue.length) {
          const frameNum = queue[qi++];
          const key = `${card.src}|${set}|${frameNum}`;
          if (reelFrameCache.has(key)) {
            if (frameNum === card.from) card.dirty = true;
            continue;
          }
          if (reelInFlight.has(key)) continue;
          reelInFlight.add(key);

          const img = new Image();
          img.decoding = "async";
          const finish = (ok) => {
            reelInFlight.delete(key);
            if (ok) {
              reelFrameCache.set(key, img);
              this.cards.forEach((other) => {
                if (other.src === card.src && Math.abs(frameNum - Math.round(other.curFrame)) <= 2) {
                  other.dirty = true;
                }
              });
            }
            step();
          };
          img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
          img.onerror = () => finish(false);
          img.src = `${card.src}/${set}/${pad(frameNum, 4)}.webp${vParam}`;
          return;
        }
      };
      for (let k = 0; k < parallel; k++) step();
    }

    preloadOpeningFrames() {
      if (this.openedPreload) return;
      this.openedPreload = true;
      const set = this.set || this.pickSet();
      this.cards.forEach((card) => {
        const key = `${card.src}|${set}|${card.from}`;
        if (reelFrameCache.has(key) || reelInFlight.has(key)) return;
        reelInFlight.add(key);
        const vParam = card.version ? `?v=${card.version}` : "";
        const img = new Image();
        img.decoding = "async";
        const done = (ok) => {
          reelInFlight.delete(key);
          if (ok) {
            reelFrameCache.set(key, img);
            card.dirty = true;
          }
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => done(true));
        img.onerror = () => done(false);
        img.src = `${card.src}/${set}/${pad(card.from, 4)}.webp${vParam}`;
      });
    }

    loadNeighborhood(centerIdx) {
      if (!this.cards.length) return;
      this.preloadOpeningFrames();
      const order = [centerIdx, centerIdx + 1, centerIdx - 1, centerIdx + 2];
      order.forEach((idx) => {
        if (idx >= 0 && idx < this.cards.length) this.loadCard(this.cards[idx]);
      });
    }

    nearestCached(card, frameNum) {
      const set = this.set || this.pickSet();
      const direct = reelFrameCache.get(`${card.src}|${set}|${frameNum}`);
      if (direct) return direct;
      for (let d = 1; d < card.span; d++) {
        if (frameNum - d >= card.from) {
          const prev = reelFrameCache.get(`${card.src}|${set}|${frameNum - d}`);
          if (prev) return prev;
        }
        if (frameNum + d <= card.to) {
          const next = reelFrameCache.get(`${card.src}|${set}|${frameNum + d}`);
          if (next) return next;
        }
      }
      return null;
    }

    drawCard(card, frameFloat) {
      card.curFrame = frameFloat;
      const target = Math.round(clamp(frameFloat, card.from, card.to));
      const img = this.nearestCached(card, target);
      if (!img || !img.naturalWidth) return;
      if (card.lastDrawnImg === img && !card.dirty) return;

      const c = card.canvas;
      const ctx = card.ctx;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;

      if (card.idx === 0) {
        if (c.width !== iw || c.height !== ih) {
          c.width = iw;
          c.height = ih;
        }
        ctx.drawImage(img, 0, 0, iw, ih);
      } else {
        const cw = c.width, ch = c.height;
        if (!cw || !ch) return;
        const s = Math.max(cw / iw, ch / ih);
        const dw = iw * s, dh = ih * s;
        const x = (cw - dw) / 2, y = (ch - dh) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.drawImage(img, x, y, dw, dh);
      }
      card.lastDrawnImg = img;
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
        this.strip.scrollLeft = Math.max(0, targetLeft);
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
          st.setProperty("--rc-filter", "none");
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
        let blurPx = 0;

        if (introT < 1) {
          if (i === 0) {
            const introScale = 1 + (heroScale - 1) * (1 - settleEase);
            scale *= introScale;
            ty += (1 - settleEase) * 26;
            blurPx = (1 - settleEase) * 22;
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
        st.setProperty("--rc-filter", blurPx > 0.15 ? `blur(${blurPx.toFixed(1)}px)` : "none");
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
      this.entryAtmo = $("[data-tr-entry-atmo]", el);
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
      this.lastTrackedY = undefined;

      this.traceFrames = [];
      this.traceSet = null;
      this.traceToken = 0;
      this.traceFrameCur = 0;
      this.lastTraceFrameDrawn = -1;
      this.lastTraceHudFrame = -1;
      this.lastTracePctVal = -1;
      this.traceDirty = true;
      this.hasTraceCanvas = false;
      this.lastTraceBlur = -1;
      this.lastTraceGray = -1;
      this.traceCur = 0;
      this.lastTraceZone = -1;

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

      this.initCards();
      this.bindControls();
      this.measure();
    }

    pickTraceSet() {
      return vw / vh < 0.9 ? "pt" : "lg";
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
            <div class="reel-card__state-pill" aria-hidden="true">
              <svg class="reel__ico-pause" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.5" height="10" rx="0.6"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.6"/></svg>
              <svg class="reel__ico-play" viewBox="0 0 16 16" fill="currentColor"><polygon points="4.5,3 13,8 4.5,13"/></svg>
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
        };

        cardEl.addEventListener("click", () => {
          if (Math.abs(idx - this.carouselCur) < 0.42) {
            this.togglePlayPause();
          } else {
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

      if (this.reelScrub) {
        bindTimelineScrub(
          this.reelScrub,
          (r, opts) => this.seekToUnifiedProgress(BRIDGE_END_P + r * (1 - BRIDGE_END_P), opts),
          (active) => { this.isScrubbing = active; }
        );
        this.reelScrub.addEventListener("keydown", (e) => {
          const step = (e.shiftKey ? 0.12 : 0.04) * (1 - BRIDGE_END_P);
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog + step, BRIDGE_END_P, 1)); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToUnifiedProgress(clamp(this.prog - step, BRIDGE_END_P, 1)); }
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
        this.seekToUnifiedProgress(BRIDGE_END_P);
        playTactileTick(720, 0.025, 0.018);
        return;
      }
      this.autoPlayPaused = !this.autoPlayPaused;
      if (!this.autoPlayPaused) this.autoPlaySuspended = false;
      this.syncPauseUI();
      playTactileTick(this.autoPlayPaused ? 480 : 660, 0.02, 0.015);
    }

    syncPauseUI() {
      this.reelLayer.classList.toggle("is-paused", this.autoPlayPaused);
      if (this.modeLblEl) {
        this.modeLblEl.textContent = this.autoPlayPaused ? "Pausado" : "Auto · Activo";
      }
      $$("[data-reel-toggle]", this.reelLayer).forEach((btn) => {
        btn.setAttribute("aria-pressed", String(!this.autoPlayPaused));
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
      const clipStart = safeIdx === 0 ? 0 : (safeIdx + 0.06) / n;
      const targetP = clamp(BRIDGE_END_P + clipStart * (1 - BRIDGE_END_P), BRIDGE_END_P, 0.985);
      this.seekToUnifiedProgress(targetP);
      playTactileTick(620 + safeIdx * 24, 0.02, 0.014);
    }

    measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const tw = Math.min(1920, Math.round(vw * dpr));
      const th = Math.min(1680, Math.round(vh * dpr));
      if (this.traceCanvas.width !== tw || this.traceCanvas.height !== th) {
        this.traceCanvas.width = tw;
        this.traceCanvas.height = th;
        this.traceDirty = true;
      }

      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const portrait = vw / vh < 0.92 || vw <= 680;
      let w, h, step;
      if (portrait) {
        w = clamp(Math.round(vw * 0.86), 280, 560);
        h = Math.round(w * (9 / 16));
        const maxH = Math.max(160, Math.min(vh * 0.40, vh - 290));
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.round(h * (16 / 9));
        }
        step = Math.round(w * 0.92);
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

      const rDpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const cw = Math.round(w * rDpr);
      const ch = Math.round(h * rDpr);
      this.cards.forEach((c, idx) => {
        // La tarjeta 01 conserva su proporción nativa (p. ej. 8:7) para adaptarse fluida entre vertical completo y 16:9
        const targetCw = idx === 0 ? (c.canvas.width > 400 ? c.canvas.width : 1372) : cw;
        const targetCh = idx === 0 ? (c.canvas.height > 400 ? c.canvas.height : 1200) : ch;
        if (c.canvas.width !== targetCw || c.canvas.height !== targetCh) {
          c.canvas.width = targetCw;
          c.canvas.height = targetCh;
          c.dirty = true;
        }
      });

      if (this.deckWrap && this.stage) {
        const sr = this.stage.getBoundingClientRect();
        const dr = this.deckWrap.getBoundingClientRect();
        this.deckCenterOffsetY = (sr.top + sr.height * 0.5) - (dr.top + dr.height * 0.5);
      }

      const nextTraceSet = this.pickTraceSet();
      if (this.traceSet && nextTraceSet !== this.traceSet) {
        this.traceSet = null;
        this.loadTrace(nextTraceSet);
      }

      const nextReelSet = this.pickReelSet(0);
      if (this.reelSet && nextReelSet !== this.reelSet) {
        this.reelSet = nextReelSet;
        this.cards.forEach((c) => { c.loadedSet = null; c.dirty = true; });
        if (this.activeIdx >= 0) this.loadNeighborhood(this.activeIdx);
      } else {
        this.reelSet = nextReelSet;
      }
    }

    orderTrace() {
      const n = this.count, seen = new Uint8Array(n), out = [];
      out.push(0); seen[0] = 1;
      for (let i = 3; i < n; i += 3) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      if (!seen[n - 1]) { seen[n - 1] = 1; out.push(n - 1); }
      for (let i = 1; i < n; i += 2) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      for (let i = 0; i < n; i++) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      return out;
    }

    loadTrace(set = this.pickTraceSet()) {
      if (this.traceSet === set && this.traceFrames.length) return;
      this.traceSet = set;
      const token = ++this.traceToken;
      this.traceFrames = new Array(this.count);
      const queue = this.orderTrace();
      let qi = 0;
      let loadedCount = 0;
      let startedCard0 = false;
      const parallel = 5;

      const kickCard0 = () => {
        if (startedCard0 || token !== this.traceToken || !this.cards.length) return;
        startedCard0 = true;
        this.loadCard(this.cards[0], 2);
      };

      const next = () => {
        if (token !== this.traceToken || qi >= queue.length) return;
        const i = queue[qi++];
        const img = new Image();
        img.decoding = "async";
        const finish = (ok) => {
          if (token !== this.traceToken) return;
          if (ok) {
            this.traceFrames[i] = img;
            loadedCount++;
            if (loadedCount >= 55) kickCard0();
          }
          if (i === 0 && ok) {
            this.traceMediaWrap.classList.add("has-canvas");
            this.drawTrace(0);
          }
          if (Math.abs(i - Math.round(this.traceFrameCur)) <= 2) this.traceDirty = true;
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        const vParam = this.version ? `?v=${this.version}` : "";
        img.src = `${this.src}/${set}/${pad(i + 1, 4)}.webp${vParam}`;
      };
      for (let k = 0; k < parallel; k++) next();

      // Solo el primer frame de tarjeta 01 de inmediato; el resto tras asegurar fluidez de planta
      if (this.cards.length) {
        this.preloadOpeningFrames();
        setTimeout(kickCard0, 650);
      }
    }

    nearestTrace(i) {
      const f = this.traceFrames;
      if (f[i]) return f[i];
      for (let d = 1; d < this.count; d++) {
        if (f[i - d]) return f[i - d];
        if (f[i + d]) return f[i + d];
      }
      return null;
    }

    drawTrace(pos) {
      const f = Math.round(clamp(pos, 0, this.count - 1));
      const img = this.nearestTrace(f);
      if (!img || !img.naturalWidth) return;
      if (this.lastTraceImg === img && !this.traceDirty) return;

      const c = this.traceCanvas, ctx = this.traceCtx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;

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
      this.lastTraceImg = img;
      this.traceDirty = false;
    }

    setTraceFilter(blurPx, grayVal = 0) {
      const b = Math.max(0, Math.round(blurPx * 10) / 10);
      const g = Math.max(0, Math.min(1, Math.round(grayVal * 100) / 100));
      if (b === this.lastTraceBlur && g === this.lastTraceGray) return;
      this.lastTraceBlur = b;
      this.lastTraceGray = g;
      const parts = [];
      if (b > 0.05) parts.push(`blur(${b}px)`);
      if (g > 0.01) parts.push(`grayscale(${g})`);
      const f = parts.length ? parts.join(" ") : "none";
      this.traceCanvas.style.filter = f;
      if (this.tracePosterImg) this.tracePosterImg.style.filter = f;
    }

    orderRange(from, to) {
      const span = to - from + 1;
      const seen = new Uint8Array(span);
      const out = [];
      const push = (f) => {
        const idx = f - from;
        if (idx >= 0 && idx < span && !seen[idx]) {
          seen[idx] = 1;
          out.push(f);
        }
      };
      push(from);
      for (let f = from + 3; f <= to; f += 3) push(f);
      push(to);
      for (let f = from + 1; f <= to; f += 2) push(f);
      for (let f = from; f <= to; f++) push(f);
      return out;
    }

    loadCard(card, parallelCount = 3) {
      if (!card) return;
      const set = this.pickReelSet(card.idx);
      if (card.loadedSet === set) return;
      card.loadedSet = set;

      const queue = this.orderRange(card.from, card.to);
      let qi = 0;
      const parallel = parallelCount;
      const vParam = card.version ? `?v=${card.version}` : "";

      const step = () => {
        while (qi < queue.length) {
          const frameNum = queue[qi++];
          const key = `${card.src}|${set}|${frameNum}`;
          if (reelFrameCache.has(key)) {
            if (frameNum === card.from) card.dirty = true;
            continue;
          }
          if (reelInFlight.has(key)) continue;
          reelInFlight.add(key);

          const img = new Image();
          img.decoding = "async";
          const finish = (ok) => {
            reelInFlight.delete(key);
            if (ok) {
              reelFrameCache.set(key, img);
              this.cards.forEach((other) => {
                if (other.src === card.src && Math.abs(frameNum - Math.round(other.curFrame)) <= 2) {
                  other.dirty = true;
                }
              });
            }
            step();
          };
          img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
          img.onerror = () => finish(false);
          img.src = `${card.src}/${set}/${pad(frameNum, 4)}.webp${vParam}`;
          return;
        }
      };
      for (let k = 0; k < parallel; k++) step();
    }

    preloadOpeningFrames() {
      if (this.openedPreload) return;
      this.openedPreload = true;
      this.cards.slice(0, 3).forEach((card) => {
        const set = this.pickReelSet(card.idx);
        const key = `${card.src}|${set}|${card.from}`;
        if (reelFrameCache.has(key) || reelInFlight.has(key)) return;
        reelInFlight.add(key);
        const vParam = card.version ? `?v=${card.version}` : "";
        const img = new Image();
        img.decoding = "async";
        const done = (ok) => {
          reelInFlight.delete(key);
          if (ok) {
            reelFrameCache.set(key, img);
            card.dirty = true;
          }
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => done(true));
        img.onerror = () => done(false);
        img.src = `${card.src}/${set}/${pad(card.from, 4)}.webp${vParam}`;
      });
    }

    loadNeighborhood(centerIdx) {
      if (!this.cards.length) return;
      this.preloadOpeningFrames();
      const order = [centerIdx, centerIdx + 1, centerIdx - 1, centerIdx + 2];
      order.forEach((idx) => {
        if (idx >= 0 && idx < this.cards.length) this.loadCard(this.cards[idx]);
      });
    }

    nearestCached(card, frameNum) {
      const set = this.pickReelSet(card.idx);
      const direct = reelFrameCache.get(`${card.src}|${set}|${frameNum}`);
      if (direct) return direct;
      for (let d = 1; d < card.span; d++) {
        if (frameNum - d >= card.from) {
          const prev = reelFrameCache.get(`${card.src}|${set}|${frameNum - d}`);
          if (prev) return prev;
        }
        if (frameNum + d <= card.to) {
          const next = reelFrameCache.get(`${card.src}|${set}|${frameNum + d}`);
          if (next) return next;
        }
      }
      return null;
    }

    drawCard(card, frameFloat) {
      card.curFrame = frameFloat;
      const target = Math.round(clamp(frameFloat, card.from, card.to));
      const img = this.nearestCached(card, target);
      if (!img || !img.naturalWidth) return;
      if (card.lastDrawnImg === img && !card.dirty) return;

      const c = card.canvas;
      const ctx = card.ctx;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;

      if (card.idx === 0) {
        if (c.width !== iw || c.height !== ih) {
          c.width = iw;
          c.height = ih;
        }
        ctx.drawImage(img, 0, 0, iw, ih);
      } else {
        const cw = c.width, ch = c.height;
        if (!cw || !ch) return;
        const s = Math.max(cw / iw, ch / ih);
        const dw = iw * s, dh = ih * s;
        const x = (cw - dw) / 2, y = (ch - dh) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.drawImage(img, x, y, dw, dh);
      }
      card.lastDrawnImg = img;
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
        this.strip.scrollLeft = Math.max(0, targetLeft);
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
      const k = reduce ? 1 : (dt ? Math.min(1, 1 - Math.exp(-13 * dt)) : 0.22);
      this.traceCur += (traceTarget - this.traceCur) * k;
      if (Math.abs(traceTarget - this.traceCur) < 0.001) this.traceCur = traceTarget;
      const tp = clamp(this.traceCur, 0, 1);

      const exitHud = reduce ? (bridgeT > 0.1 ? 1 : 0) : smooth(range(bridgeT, 0.00, 0.26));
      const exitSvgFade = reduce ? (bridgeT > 0.2 ? 1 : 0) : smooth(range(bridgeT, 0.08, 0.34));
      const entryShiftY = 0;
      const svgWake = reduce ? (rawEntryP >= 0 ? 1 : 0) : smooth(range(rawEntryP, 0.044, 0.080));
      const hudWake = reduce ? (rawEntryP >= 0 ? 1 : 0) : smooth(range(rawEntryP, 0.056, 0.098));
      const hudOp = hudWake * (1 - exitHud);
      const hudEnterY = !reduce ? (1 - hudWake) * 10 : 0;

      ov.setProperty("--trace-entry-y", `${entryShiftY.toFixed(1)}px`);
      ov.setProperty("--trace-hud-op", hudOp.toFixed(3));
      ov.setProperty("--trace-hud-top-y", `${((-exitHud * 14) - hudEnterY).toFixed(1)}px`);
      ov.setProperty("--trace-hud-bot-y", `${((exitHud * 14) + hudEnterY).toFixed(1)}px`);
      ov.setProperty("--trace-svg-op", ((1 - exitSvgFade) * svgWake).toFixed(3));
      const entrySvgBlur = !reduce ? (1 - svgWake) * 3.2 : 0;
      const svgBlur = entrySvgBlur + exitSvgFade * 3.5;
      ov.setProperty("--trace-svg-filter", svgBlur > 0.1 ? `blur(${svgBlur.toFixed(1)}px)` : "none");

      const traceVisible = rawEntryP >= 0 && ((1 - exitSvgFade) * svgWake > 0.005 || hudOp > 0.005);
      this.traceOverlay.style.visibility = traceVisible ? "visible" : "hidden";
      if (this.traceConsole) {
        this.traceConsole.style.pointerEvents = hudOp > 0.15 ? "auto" : "none";
      }

      const totalLen = this.tracePathLen || 1034;
      const curLen = tp * totalLen;
      const dashOffset = (totalLen - curLen).toFixed(1);
      const pathExitOp = (1 - smooth(range(bridgeT, 0.06, 0.30))).toFixed(3);
      if (this.tracePathCore) {
        this.tracePathCore.style.strokeDashoffset = dashOffset;
        this.tracePathCore.style.opacity = pathExitOp;
      }
      if (this.tracePathGlow) {
        this.tracePathGlow.style.strokeDashoffset = dashOffset;
        this.tracePathGlow.style.opacity = pathExitOp;
      }

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
        this.tracePathCoreV.style.opacity = pathExitOp;
        if (this.tracePathGlowV) {
          this.tracePathGlowV.style.strokeDashoffset = dashOffsetV;
          this.tracePathGlowV.style.opacity = pathExitOp;
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
            if (window.matchMedia && window.matchMedia("(max-aspect-ratio: 9/10)").matches) {
              yawReading = Math.round((tangentDegV + patioLookV + naveLookV + 360) % 360);
            }
            this.traceDroneV.setAttribute("transform", `translate(${ptV.x.toFixed(1)}, ${ptV.y.toFixed(1)})`);
            if (this.traceDroneRotV) this.traceDroneRotV.setAttribute("transform", `rotate(${coneDegV.toFixed(1)})`);
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
      this.traceMediaWrap.style.setProperty("--trace-darken-op", clamp(darkenBase + darkenBridge, 0, 1).toFixed(3));
      this.traceMediaWrap.style.setProperty("--trace-base-veil-op", (0.38 + 0.62 * darkenBase).toFixed(3));

      const extOp = (reduce ? 1 : smooth(range(tp, 0.15, 0.25))) * retractGrid;
      const flightOp = (reduce ? 1 : smooth(range(tp, 0.14, 0.23))) * (1 - exitSvgFade);
      ov.setProperty("--trace-ext-op", extOp.toFixed(3));
      ov.setProperty("--trace-flight-op", flightOp.toFixed(3));
      ov.setProperty("--trace-grid-op", ((reduce ? 1 : smooth(range(tp, 0.145, 0.26))) * retractGrid).toFixed(3));
      ov.setProperty("--trace-plan-op", ((reduce ? 1 : smooth(range(tp, 0.155, 0.245))) * retractPlan).toFixed(3));
      ov.setProperty("--trace-draw-1", ((reduce ? 1 : smooth(range(tp, 0.155, 0.29))) * retract1).toFixed(3));
      ov.setProperty("--trace-draw-2", ((reduce ? 1 : smooth(range(tp, 0.205, 0.35))) * retract2).toFixed(3));
      ov.setProperty("--trace-draw-3", ((reduce ? 1 : smooth(range(tp, 0.255, 0.40))) * retract3).toFixed(3));
      ov.setProperty("--trace-sec1-op", ((reduce ? 1 : smooth(range(tp, 0.155, 0.25))) * retractPlan).toFixed(3));
      ov.setProperty("--trace-sec2-op", ((reduce ? 1 : smooth(range(tp, 0.205, 0.31))) * retractPlan).toFixed(3));
      ov.setProperty("--trace-sec3-op", ((reduce ? 1 : smooth(range(tp, 0.255, 0.36))) * retractPlan).toFixed(3));
      ov.setProperty("--trace-ghost-op", (((reduce ? 0.42 : 0.12 + 0.32 * smooth(range(tp, 0.16, 0.30)))) * (1 - smooth(range(tp, 0.92, 0.99))) * retractGrid).toFixed(3));

      const wakeWave = range(tp, 0.16, 0.32);
      if (this.traceWakeRing) {
        if (wakeWave > 0 && wakeWave < 1) {
          this.traceWakeRing.setAttribute("r", (10 + smooth(wakeWave) * 195).toFixed(1));
          this.traceWakeRing.setAttribute("stroke-opacity", (Math.sin(wakeWave * Math.PI) * 0.56).toFixed(3));
        } else {
          this.traceWakeRing.setAttribute("stroke-opacity", "0");
        }
      }
      if (this.traceWakeRingV) {
        if (wakeWave > 0 && wakeWave < 1) {
          this.traceWakeRingV.setAttribute("r", (10 + smooth(wakeWave) * 150).toFixed(1));
          this.traceWakeRingV.setAttribute("stroke-opacity", (Math.sin(wakeWave * Math.PI) * 0.56).toFixed(3));
        } else {
          this.traceWakeRingV.setAttribute("stroke-opacity", "0");
        }
      }

      const introFocus = reduce ? 0 : (1 - smooth(range(rawEntryP, 0.042, 0.098)));
      let camX = 0, camY = 0, camScale = 1, camRx = 0, camRy = 0;
      if (vw / vh < 0.95 || vw <= 768) {
        camY = (0.35 - tp * 0.70) * 16 + introFocus * 12;
        camScale = 1 + introFocus * 0.065 + exitSvgFade * 0.10;
      } else {
        camScale = 1 + introFocus * 0.085 + exitSvgFade * 0.13;
        camX = introFocus * 36 + (finePointer && !reduce ? normMx * -7 * (1 - exitSvgFade) : 0);
        camY = introFocus * 10 + (finePointer && !reduce ? normMy * -5 * (1 - exitSvgFade) : 0);
        camRx = finePointer && !reduce ? -normMy * 1.2 * (1 - exitSvgFade) : 0;
        camRy = finePointer && !reduce ? normMx * 1.6 * (1 - exitSvgFade) : 0;
      }
      ov.setProperty("--trace-cam-x", `${camX.toFixed(1)}px`);
      ov.setProperty("--trace-cam-y", `${camY.toFixed(1)}px`);
      ov.setProperty("--trace-cam-scale", camScale.toFixed(4));
      ov.setProperty("--trace-cam-rx", `${camRx.toFixed(2)}deg`);
      ov.setProperty("--trace-cam-ry", `${camRy.toFixed(2)}deg`);

      const zoneIdx = tp < 0.24 ? 0 : (tp < 0.50 ? 1 : (tp < 0.78 ? 2 : 3));
      const activeRoomNum = zoneIdx === 1 ? "2" : (zoneIdx === 2 ? "3" : (zoneIdx === 3 ? "4" : "1"));
      this.traceRooms.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoom === activeRoomNum));
      this.traceRoomsV.forEach((r) => r.classList.toggle("is-active", r.dataset.traceRoomV === activeRoomNum));

      if (zoneIdx !== this.lastTraceZone) {
        if (this.lastTraceZone !== -1 && rawEntryP > 0.02 && bridgeT < 0.15) playTactileTick(620 + zoneIdx * 55, 0.025, 0.018);
        this.lastTraceZone = zoneIdx;
      }

      const wpThresholds = [0.0, 0.25, 0.41, 0.59, 0.79, 0.96];
      this.traceWps.forEach((wp, idx) => wp.classList.toggle("is-reached", tp >= (wpThresholds[idx] || 0)));
      this.traceWpsV.forEach((wp, idx) => wp.classList.toggle("is-reached", tp >= (wpThresholds[idx] || 0)));

      // Ondas de agua en 05 · Lámina de agua se expanden suavemente hacia la piscina de Nordelta
      const rippleIn = smooth(range(tp, 0.76, 0.96));
      const rippleExit = smooth(range(bridgeT, 0.00, 0.42));
      const rippleOp = rippleIn * (1 - rippleExit);
      ov.setProperty("--trace-ripple-op", rippleOp.toFixed(3));
      ov.setProperty("--trace-ripple-s", (0.82 + rippleIn * 0.36 + rippleExit * 1.25).toFixed(3));

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
        const o = smooth(Math.min(fadeIn, fadeOut)) * (1 - exitHud);
        el.style.visibility = o <= 0.005 ? "hidden" : "visible";
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((0.5 - t) * 10).toFixed(1)}px, 0)`;
      });
    }

    update(dt) {
      const nCards = this.cards.length;
      if (!nCards) return;

      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);

      if (viewportEntry > 0 && !this.traceSet) this.loadTrace();
      if (viewportEntry > 0 && this.activeIdx < 0) this.setActiveClip(0);
      if (y + vh < this.top - vh || y > this.top + this.len + vh) return;

      if (viewportEntry <= 0 || rawP < 0) {
        if (rawP < -0.005 || viewportEntry < 0.95) {
          this.autoPlaySuspended = false;
          this.subpixelAcc = 0;
          this.lastTrackedY = undefined;
        }
        this.prog = 0;
        this.progCur = 0;
        this.traceCur = 0;
        this.traceFrameCur = 0;
        this.traceMediaWrap.style.setProperty("--tr-trace-media-op", "0");
        this.traceMediaWrap.style.setProperty("--img-scale", "1.075");
        this.traceMediaWrap.style.setProperty("--trace-base-veil-op", "0.38");
        this.traceMediaWrap.style.setProperty("--trace-darken-op", "0");
        this.traceMediaWrap.style.setProperty("--trace-entry-veil-op", "1");
        this.traceMediaWrap.style.setProperty("--trace-entry-veil-s", "0.72");
        this.traceMediaWrap.style.visibility = "hidden";
        if (this.entryAtmo) {
          this.entryAtmo.style.setProperty("--trace-atmo-op", "0");
          this.entryAtmo.style.visibility = "hidden";
        }
        this.setTraceFilter(7.5, 0.55);
        this.reelBgWrap.style.setProperty("--tr-reel-bg-op", "0");
        this.reelLayer.style.visibility = "hidden";
        this.reelLayer.classList.remove("is-interactive");
        this.updateTraceOverlay(0, 0, -0.05, 0.016);
        if (viewportEntry > 0 && (this.lastTraceFrameDrawn !== 0 || this.traceDirty)) {
          this.drawTrace(0);
          this.lastTraceFrameDrawn = 0;
        }
        return;
      }

      if (rawP >= 1.08) {
        this.progCur = 1;
      }

      // Si el usuario vuelve a Planificación en Planta, reestablecemos pausa de Archivo si estaba activa
      if (rawP < TRACE_PLAN_END_P - 0.04 && this.autoPlayPaused) {
        this.autoPlayPaused = false;
        this.syncPauseUI();
      }

      if (this.isHybrid && viewportEntry > 0 && rawP >= 0 && rawP < 1.05 && performance.now() > (this.seekingUntil || 0)) {
        const hasTrace = this.traceFrames && (this.traceFrames[0] || this.nearestTrace(0));
        const firstCard = this.cards[0];
        const hasFirstCard = !!this.nearestCached(firstCard, firstCard.from);

        const card0EndP = BRIDGE_END_P + (1 / nCards) * (1 - BRIDGE_END_P);
        const reelSpeed = rawP < REEL_WAKE_P ? 0.85 : (rawP < card0EndP ? 0.92 : 0.48);
        runHybridScrollEngine({
          top: this.top,
          len: this.len,
          dt,
          viewportEntry,
          rawP,
          baseDuration: this.baseDuration,
          speedScale: reelSpeed,
          state: this,
          hasFrames: rawP < BRIDGE_START_P ? !!hasTrace : !!(hasTrace || hasFirstCard),
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

      // 1) Progreso del plano SVG (0 -> 1 hasta TRACE_PLAN_END_P) y del video de planta (0 -> 1 hasta TRACE_MEDIA_END_P)
      const tracePlanProg = clamp(this.progCur / TRACE_PLAN_END_P, 0, 1);
      const traceVideoProg = clamp(this.progCur / TRACE_MEDIA_END_P, 0, 1);

      // 2) Puente de fusión unificada (0 -> 1 entre BRIDGE_START_P y BRIDGE_END_P)
      const bridgeT = reduce
        ? (this.progCur >= BRIDGE_START_P ? 1 : 0)
        : clamp((this.progCur - BRIDGE_START_P) / (BRIDGE_END_P - BRIDGE_START_P), 0, 1);

      // Dibujar secuencia de planta (casa-greenville) a ritmo lineal constante mientras sea visible
      const targetTraceF = traceVideoProg * (this.count - 1);
      const tk = reduce ? 1 : (1 - Math.exp(-26 * dtSec));
      if (this.lastScrollPos === undefined) this.lastScrollPos = y;
      const scrolling = Math.abs(y - this.lastScrollPos) > 0.2;
      this.lastScrollPos = y;

      let effTrace = targetTraceF;
      if (!scrolling && Math.abs(targetTraceF - this.traceFrameCur) < 0.25) effTrace = Math.round(targetTraceF);
      this.traceFrameCur += (effTrace - this.traceFrameCur) * tk;
      if (Math.abs(effTrace - this.traceFrameCur) < 0.002) this.traceFrameCur = effTrace;

      // Atmósfera & horizonte óptico: acompaña el descenso del velo oscuro justo antes de dibujar el plano
      if (this.entryAtmo) {
        const horizonDraw = reduce ? 0 : smooth(range(rawP, 0.032, 0.062));
        const horizonOp = reduce ? 0 : Math.sin(clamp(range(rawP, 0.032, 0.080), 0, 1) * Math.PI) * 0.85;
        const auraIn = reduce ? 0 : smooth(range(rawP, 0.004, 0.034));
        const auraOut = reduce ? 0 : smooth(range(rawP, 0.065, 0.125));
        const auraOp = auraIn * (1 - auraOut * 0.85);
        const atmoOp = Math.max(horizonOp, auraOp);
        const as = this.entryAtmo.style;
        as.setProperty("--trace-atmo-op", atmoOp.toFixed(3));
        as.setProperty("--trace-aura-op", auraOp.toFixed(3));
        as.setProperty("--trace-aura-s", (0.86 + auraIn * 0.18).toFixed(3));
        as.setProperty("--trace-horizon-op", horizonOp.toFixed(3));
        as.setProperty("--trace-horizon-s", horizonDraw.toFixed(3));
        this.entryAtmo.style.visibility = atmoOp <= 0.005 ? "hidden" : "visible";
      }

      // Media de planta: emerge sola desde el negro al principio, antes de que aparezcan el velo oscuro y el plano
      const traceEntryWake = reduce ? (rawP >= 0 ? 1 : 0) : smooth(range(rawP, 0.003, 0.042));
      const veilOpen = reduce ? (rawP >= 0 ? 1 : 0) : smooth(range(rawP, 0.003, 0.046));
      const traceMediaFade = traceEntryWake * (1 - smooth(range(bridgeT, 0.22, 0.56)));
      const traceMediaScale = (reduce ? 1.02 : (1.075 - traceEntryWake * 0.055)) + range(bridgeT, 0.0, 0.56) * 0.045;
      const traceMediaBlur = (reduce ? 0 : (1 - traceEntryWake) * 7.5) + smooth(range(bridgeT, 0.14, 0.56)) * 6.5;
      const traceMediaGray = (reduce ? 0 : (1 - traceEntryWake) * 0.55) + smooth(range(bridgeT, 0.10, 0.48)) * 0.5;

      this.traceMediaWrap.style.setProperty("--tr-trace-media-op", traceMediaFade.toFixed(3));
      this.traceMediaWrap.style.setProperty("--img-scale", traceMediaScale.toFixed(4));
      this.traceMediaWrap.style.setProperty("--trace-entry-veil-op", (1 - veilOpen).toFixed(3));
      this.traceMediaWrap.style.setProperty("--trace-entry-veil-s", (0.72 + veilOpen * 0.78).toFixed(3));
      this.traceMediaWrap.style.visibility = traceMediaFade <= 0.005 ? "hidden" : "visible";
      this.setTraceFilter(traceMediaBlur, traceMediaGray);

      if (traceMediaFade > 0.005 && (Math.abs(this.traceFrameCur - this.lastTraceFrameDrawn) > 0.002 || this.traceDirty)) {
        this.drawTrace(this.traceFrameCur);
        this.lastTraceFrameDrawn = this.traceFrameCur;

        const f = Math.round(this.traceFrameCur);
        if (f !== this.lastTraceHudFrame) {
          this.lastTraceHudFrame = f;
          if (this.traceFrEl) this.traceFrEl.textContent = pad(f + 1, 3);
        }
        const pctVal = Math.round(tracePlanProg * 1000) / 10;
        if (pctVal !== this.lastTracePctVal) {
          this.lastTracePctVal = pctVal;
          if (this.traceScrubFill) this.traceScrubFill.style.width = `${pctVal}%`;
          if (this.traceScrub) this.traceScrub.setAttribute("aria-valuenow", String(Math.round(pctVal)));
        }
      }

      this.updateTraceOverlay(tracePlanProg, bridgeT, rawP, dtSec);

      // 3) Archivo en Movimiento (Beat 2: despertar con velo oscuro -> Beat 3: repliegue adaptativo 8:7 -> 16:9)
      const backdropReveal = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.50, 0.92));
      const videoDissolve = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.28, 0.56));
      const leadVeilOp = reduce ? 0 : (1 - smooth(range(bridgeT, 0.46, 0.92))) * 0.92;
      const mediaWake = reduce ? 1 : smooth(range(bridgeT, 0.30, 0.74));
      const pbRaw = range(bridgeT, 0.48, 1.00);
      const pullbackEase = reduce ? 1 : (pbRaw < 0.5 ? 4 * pbRaw * pbRaw * pbRaw : 1 - Math.pow(-2 * pbRaw + 2, 3) / 2);
      const chromeReveal = reduce ? 1 : smooth(range(bridgeT, 0.68, 0.98));
      const sideReveal = reduce ? 1 : smooth(range(bridgeT, 0.68, 1.00));
      const hudReveal = reduce ? (bridgeT > 0 ? 1 : 0) : smooth(range(bridgeT, 0.74, 1.00));

      this.reelBgWrap.style.setProperty("--tr-reel-bg-op", backdropReveal.toFixed(3));
      this.reelLayer.style.visibility = bridgeT <= 0.22 ? "hidden" : "visible";
      const isInteractive = bridgeT >= 0.78;
      this.reelLayer.classList.toggle("is-interactive", isInteractive);
      this.reelLayer.style.setProperty("--tr-reel-pe", isInteractive ? "auto" : "none");

      const carouselProg = clamp((this.progCur - BRIDGE_END_P) / (1 - BRIDGE_END_P), 0, 1);
      const seg = carouselProg * nCards;
      const segIdx = clamp(Math.floor(seg), 0, nCards - 1);
      const u = clamp(seg - segIdx, 0, 1);

      const dwellEnd = 0.80;
      const microDrift = 0;
      let carouselTarget = segIdx;
      if (segIdx < nCards - 1) {
        carouselTarget = u <= dwellEnd
          ? segIdx
          : segIdx + smooth((u - dwellEnd) / (1 - dwellEnd));
      }
      this.carouselCur = carouselTarget;

      const nearestIdx = clamp(Math.round(this.carouselCur), 0, nCards - 1);
      if (nearestIdx !== this.activeIdx) this.setActiveClip(nearestIdx);

      const rl = this.reelLayer.style;
      rl.setProperty("--reel-hud", hudReveal.toFixed(3));
      rl.setProperty("--reel-hud-top-y", `${(-(1 - hudReveal) * 14).toFixed(1)}px`);
      rl.setProperty("--reel-hud-bot-y", `${((1 - hudReveal) * 18).toFixed(1)}px`);
      this.reelBgWrap.style.setProperty("--reel-aura-op", (0.65 * backdropReveal).toFixed(3));

      const targetRx = (!reduce && finePointer) ? (-normMy * 1.4) : 0;
      const targetRy = (!reduce && finePointer) ? (normMx * 1.9) : 0;
      this.tiltRx += (targetRx - this.tiltRx) * 0.1;
      this.tiltRy += (targetRy - this.tiltRy) * 0.1;

      const totalSeconds = Math.round(carouselProg * this.reelDuration);
      if (this.reelTcEl) this.reelTcEl.textContent = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
      if (this.reelScrubFill) this.reelScrubFill.style.width = `${(carouselProg * 100).toFixed(1)}%`;
      if (this.reelScrub) this.reelScrub.setAttribute("aria-valuenow", String(Math.round(carouselProg * 100)));

      this.cards.forEach((card, i) => {
        const d = i - this.carouselCur;
        const absD = Math.abs(d);
        const st = card.el.style;

        if (absD > 2.25) {
          st.setProperty("--rc-op", "0");
          st.setProperty("--rc-pe", "none");
          st.setProperty("--rc-filter", "none");
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
        let blurPx = 0;

        let rcChrome = 1;
        let rcRadius = 5;
        let rcBorderOp = i === nearestIdx ? 0.28 : 0.16;
        let rcShadowOp = 0.56;
        let rcBgOp = 1;
        let rcLeadVeil = 0;
        let mediaFilter = "none";
        let innerScale = 1.10 - activeWeight * 0.08;
        let tiltFactor = activeWeight;

        if (bridgeT < 1) {
          if (i === 0) {
            const curW = this.cardW + (vw - this.cardW) * (1 - pullbackEase);
            const curH = this.cardH + (vh - this.cardH) * (1 - pullbackEase);
            st.setProperty("--rc-w", `${curW.toFixed(1)}px`);
            st.setProperty("--rc-h", `${curH.toFixed(1)}px`);
            ty += (this.deckCenterOffsetY || 0) * (1 - pullbackEase);
            scale = 1;
            op *= videoDissolve;
            activeWeight *= chromeReveal;
            tiltFactor = chromeReveal;
            shade = 0;
            rcChrome = chromeReveal;
            rcRadius = chromeReveal * 5;
            rcBorderOp = chromeReveal * 0.28;
            rcShadowOp = chromeReveal * 0.56;
            rcBgOp = chromeReveal;
            rcLeadVeil = leadVeilOp;
            const mBlur = (1 - mediaWake) * 5.5;
            const mGray = (1 - mediaWake) * 0.45;
            if (mBlur > 0.1 || mGray > 0.01) {
              const parts = [];
              if (mBlur > 0.1) parts.push(`blur(${mBlur.toFixed(1)}px)`);
              if (mGray > 0.01) parts.push(`grayscale(${mGray.toFixed(2)})`);
              mediaFilter = parts.join(" ");
            }
            innerScale = 1.02 + (1 - mediaWake) * 0.03;
          } else {
            op *= sideReveal;
            tx += (1 - sideReveal) * (this.cardW || 560) * 0.24;
          }
        } else if (i === 0) {
          st.removeProperty("--rc-w");
          st.removeProperty("--rc-h");
        }

        const rx = this.tiltRx * tiltFactor;
        const ry = baseRy + this.tiltRy * tiltFactor;
        const maxParallax = Math.max(4, (this.cardW || 300) * 0.032);
        const parallaxX = clamp(-d * maxParallax, -16, 16);

        st.setProperty("--rc-x", `${tx.toFixed(1)}px`);
        st.setProperty("--rc-y", `${ty.toFixed(1)}px`);
        st.setProperty("--rc-s", scale.toFixed(4));
        st.setProperty("--rc-rx", `${rx.toFixed(2)}deg`);
        st.setProperty("--rc-ry", `${ry.toFixed(2)}deg`);
        st.setProperty("--rc-op", op.toFixed(3));
        st.setProperty("--rc-filter", blurPx > 0.15 ? `blur(${blurPx.toFixed(1)}px)` : "none");
        st.setProperty("--rc-media-filter", mediaFilter);
        st.setProperty("--rc-shade", shade.toFixed(3));
        st.setProperty("--rc-lead-veil", rcLeadVeil.toFixed(3));
        st.setProperty("--rc-act", activeWeight.toFixed(3));
        st.setProperty("--rc-chrome", rcChrome.toFixed(3));
        st.setProperty("--rc-radius", `${rcRadius.toFixed(2)}px`);
        st.setProperty("--rc-border-op", rcBorderOp.toFixed(3));
        st.setProperty("--rc-shadow-op", rcShadowOp.toFixed(3));
        st.setProperty("--rc-bg-op", rcBgOp.toFixed(3));
        st.setProperty("--rc-px", `${parallaxX.toFixed(1)}px`);
        st.setProperty("--rc-ims", innerScale.toFixed(4));
        st.setProperty("--rc-pe", (isInteractive && absD < 1.35 && op > 0.25) ? "auto" : "none");
        st.setProperty("--rc-z", String(Math.round(50 - absD * 10)));

        // Card 0 inicia en REEL_WAKE_P; los siguientes pre-arrancan al entrar (t/(1+t)) manteniendo velocidad constante sin saltos
        const entryShare = (1 - dwellEnd) / (2 - dwellEnd);
        const card0EndP = BRIDGE_END_P + (1 / nCards) * (1 - BRIDGE_END_P);
        let clipP = 0;
        if (i < segIdx) {
          clipP = 1;
        } else if (i === segIdx) {
          if (i === 0 && i === nCards - 1) {
            clipP = clamp((this.progCur - REEL_WAKE_P) / Math.max(0.01, 1 - REEL_WAKE_P), 0, 1);
          } else if (i === 0) {
            clipP = clamp((this.progCur - REEL_WAKE_P) / Math.max(0.01, card0EndP - REEL_WAKE_P), 0, 1);
          } else {
            clipP = entryShare + u * (1 - entryShare);
          }
        } else if (i === segIdx + 1 && u > dwellEnd) {
          clipP = ((u - dwellEnd) / (1 - dwellEnd)) * entryShare;
        }

        const frameFloat = card.from + clipP * (card.span - 1);
        if (absD < 1.85 && (i > 0 || viewportEntry > 0)) {
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

  const traceReels = $$(".trace-reel").map((el) => new UnifiedTraceReel(el));

  /* ---------------------------------------------------------
     PRELOADER ÁGIL
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  const tStart = performance.now();
  let loadTarget = 0, loadShown = 0, ready = false;

  function tickLoader(now) {
    if (ready) return;
    const minT = reduce ? 0 : 950;
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
    if (loaderCount) loaderCount.textContent = "100";
    if (loaderBar) loaderBar.style.transform = "scaleX(1)";
    body.classList.add("is-loaded");
    const openCurtains = () => {
      body.classList.add("is-ready");
      body.classList.remove("is-loading");
      if (lenis) lenis.start();
      measureAll();
    };
    if (reduce) {
      openCurtains();
    } else {
      setTimeout(openCurtains, 260);
    }
  }

  const getObsRoot = () => (scrollContainer && isVerticalScroller()) ? scrollContainer : null;

  if (sequences.length) {
    sequences[0].load(undefined, (p) => { loadTarget = Math.max(loadTarget, p); });

    const seqLoader = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const s = sequences.find((x) => x.el === en.target);
        if (s && !s.set) s.load();
        seqLoader.unobserve(en.target);
      });
    }, { root: getObsRoot(), rootMargin: "1100px 0px" });
    sequences.slice(1).forEach((s) => seqLoader.observe(s.el));
  } else {
    loadTarget = 1;
  }

  if (reels.length) {
    const reelLoader = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const r = reels.find((x) => x.el === en.target);
        if (r) r.loadNeighborhood(0);
        reelLoader.unobserve(en.target);
      });
    }, { root: getObsRoot(), rootMargin: "1100px 0px" });
    reels.forEach((r) => reelLoader.observe(r.el));
  }
  if (traceReels.length) {
    const trLoader = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const tr = traceReels.find((x) => x.el === en.target);
        if (tr) {
          tr.loadTrace();
          tr.loadNeighborhood(0);
        }
        trLoader.unobserve(en.target);
      });
    }, { root: getObsRoot(), rootMargin: "1200px 0px" });
    traceReels.forEach((tr) => trLoader.observe(tr.el));
  }
  setTimeout(() => { loadTarget = 1; }, 2200);

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

  function measureAll() {
    vw = innerWidth;
    vh = innerHeight;
    root.style.setProperty("--vh", `${vh}px`);
    measureEditorial();
    measureSeqs();
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
     Loop principal (60fps)
     --------------------------------------------------------- */
  let last = performance.now();
  let lastY = 0, navAcc = 0, currentNavId = "";
  let isNavHidden = false;

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (lenis && !isVerticalScroller()) lenis.raf(now);
    const y = scrollY();
    const dy = y - lastY;
    const isScrolling = Math.abs(dy) > 0.05;

    if (finePointer && cursor) {
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
        if (solarDeg) solarDeg.textContent = `${Math.round(12 + Math.sin(estP * Math.PI) * 56)}°`;
        if (solarHour) {
          const totalMin = Math.round(450 + estP * 675);
          solarHour.textContent = `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)} ART`;
        }
        if (principlesFill) {
          const prP = clamp((vh * 0.68 - erTop - estudioHeight * 0.28) / Math.max(1, estudioHeight * 0.45));
          principlesFill.style.transform = `scaleX(${prP.toFixed(3)})`;
        }
        principleCards.forEach((card, idx) => {
          const crTop = (card._docTop || 0) - y;
          const crH = card._height || 200;
          const cp = clamp((vh * 0.86 - crTop) / Math.max(1, crH * 1.15));
          card.style.setProperty("--path-dash", (120 * (1 - cp)).toFixed(1));
          card.classList.toggle("is-lit", cp > 0.35);
          if (!reduce) {
            const rel = (crTop + crH * 0.5 - vh * 0.5) / vh;
            card.style.setProperty("--prin-y", `${(rel * (6 + (idx - 1) * 5)).toFixed(1)}px`);
          }
        });
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

    sequences.forEach((s) => s.update(dt));
    reels.forEach((r) => r.update(dt));
    traceReels.forEach((tr) => tr.update(dt));

    lastY = y;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
