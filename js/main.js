/* =========================================================
   FURLAN — CINE DE ARQUITECTURA
   Motor de proyección, scroll y microinteracciones.
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
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 1,
      smoothWheel: true,
    });
    lenis.stop();
  }
  const scrollContainer = $("#top");
  const isVerticalScroller = () => vw <= 900 || (window.matchMedia && window.matchMedia("(max-aspect-ratio: 1/1)").matches);

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
      scrollContainer.scrollTo({ top: y, behavior: reduce || opts.immediate ? "auto" : "smooth" });
    } else if (lenis) {
      lenis.scrollTo(y, { duration: opts.duration || 1.8, immediate: !!opts.immediate });
    } else {
      window.scrollTo({ top: y, behavior: reduce || opts.immediate ? "auto" : "smooth" });
    }
  }



  /* ---------------------------------------------------------
     Cursor con anillo óptico inercial y micro-física magnética
     --------------------------------------------------------- */
  const cursor = $(".cursor");
  const cursorRing = $(".cursor__ring");
  const cursorLabel = $(".cursor__label");
  let mx = -200, my = -200, cx = -200, cy = -200, rx = -200, ry = -200;
  let normMx = 0, normMy = 0;

  if (finePointer && cursor) {
    body.classList.add("has-cursor");
    addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;
      normMx = (mx / Math.max(1, vw) - 0.5) * 2;
      normMy = (my / Math.max(1, vh) - 0.5) * 2;
    }, { passive: true });

    const bindCursor = (el) => {
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
    };
    $$("a, button, .seq__scrub, [data-cursor]").forEach(bindCursor);

    // Atracción magnética sutil en controles clave
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
     Texto palabra por palabra (tinta que aparece con el scroll)
     --------------------------------------------------------- */
  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = "";
    const allWords = [];
    nodes.forEach((n) => {
      const isEl = n.nodeType === 1;
      const text = n.textContent;
      const words = text.split(/\s+/).filter(Boolean);
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
      if (idx < allWords.length - 1) {
        el.appendChild(document.createTextNode(" "));
      }
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

  const quoteMark = $(".quote__mark");

  /* ---------------------------------------------------------
     MOTOR DE SECUENCIAS
     Pantalla completa → encuadre de proyección.
     Obra I: nítida con velo. Obras II–IV: nacen del negro,
     desenfocadas, y se revelan mientras se reencuadran.
     --------------------------------------------------------- */
  class Sequence {
    constructor(el) {
      this.el = el;
      this.isHero = el.classList.contains("seq--hero");
      this.isFullscreen = el.classList.contains("seq--fullscreen");
      this.isTrace = el.classList.contains("seq--trace");
      this.isKinetic = el.classList.contains("seq--kinetic");
      this.isFiesta = el.id === "film-02" || el.classList.contains("seq--fiesta");
      this.isHybrid = el.dataset.mode === "hybrid" || el.classList.contains("seq--trace") || el.id === "trazado" || el.id === "film-04";
      this.autoPlayPaused = false;
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.version = el.dataset.version || "";
      this.fps = +el.dataset.fps || 25;
      this.durationSec = Math.round(this.count / this.fps);

      this.stage = $(".seq__stage", el);
      this.media = $(".seq__media", el);
      this.canvas = $(".seq__canvas", el);
      this.posterImg = $(".seq__poster img", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.hero = $("[data-seq-hero]", el);
      this.lead = $("[data-seq-lead]", el);

      // Elementos específicos de secuencia Cinética (Obra III · Casa Hudson)
      if (this.isKinetic) {
        this.kWingL = $("[data-kseq-wing-l]", el);
        this.kWingR = $("[data-kseq-wing-r]", el);
        this.kLoupeBox = $("[data-kseq-loupe-box]", el);
        this.kLoupeCanvas = $("[data-kseq-loupe]", el);
        this.kLoupeCtx = this.kLoupeCanvas ? this.kLoupeCanvas.getContext("2d", { alpha: false }) : null;
        if (this.kLoupeCanvas) {
          this.kLoupeCanvas.width = 360;
          this.kLoupeCanvas.height = 414;
        }
        this.kPanel1 = $("[data-kseq-panel-1]", el);
        this.kPanel2 = $("[data-kseq-panel-2]", el);
        this.kCota1 = $("[data-kseq-cota-1]", el);
        this.kCota2 = $("[data-kseq-cota-2]", el);
        this.kPhase = $("[data-kseq-phase]", el);
        this.kDist = $("[data-kseq-dist]", el);
        this.kFocal = $("[data-kseq-focal]", el);
        this.kCropLabel = $("[data-kseq-crop-label]", el);
      }

      // Elementos específicos de secuencia de Fiestas & Eventos (Obra II · Vonharv + Randa I & II)
      if (this.isFiesta) {
        this.randaBox = $("[data-seq-randa]", el);
        this.randaFlare = $(".seq__randa-flare", el);
        this.randaCanvases = [
          $("[data-randa-canvas='1']", el),
          $("[data-randa-canvas='2']", el),
        ];
        this.randaCtxs = this.randaCanvases.map((c) => (c ? c.getContext("2d", { alpha: false }) : null));
        this.randaPosters = $$(".seq__randa-poster", el);
        this.randaCards = $$(".seq__randa-card", el);
        this.randaBadge = $(".seq__randa-badge", el);
        this.randaTc = $("[data-randa-tc]", el);
        this.randaFr1 = $("[data-randa-fr='1']", el);
        this.randaFr2 = $("[data-randa-fr='2']", el);
        this.randaCount = 208;
        this.randa1Frames = [];
        this.randa2Frames = [];
        this.randaLoaded = false;
        this.randaLoading = false;
        this.randaCur = 0;
        this.lastRandaCur = -1;
        this.lastRandaFr = -1;
        this._randaCompleteSet = false;
      }

      // Elementos específicos de secuencia Fullscreen
      this.fsOverlay = $(".seq-fs__overlay", el);
      this.fsActs = $$(".seq-fs__act", el).map((n) => ({
        n,
        r: n.dataset.fsAct.split(",").map(Number),
      }));
      this.fsBar = $("[data-fs-bar]", el);
      this.fsTc = $("[data-fs-tc]", el);
      this.fsRailDots = $$("[data-fs-rail-dot]", el);
      this.fsRailFill1 = $("[data-fs-rail-fill]", el);
      this.fsRailFill2 = $("[data-fs-rail-fill-2]", el);

      // Elementos específicos de Cartografía de Vuelo y Planta Arquitectónica (#trazado)
      if (this.isTrace) {
        this.traceCamera = $("[data-trace-camera]", el);
        this.tracePathCore = $("#tracePathCore", el);
        this.tracePathGlow = $("#tracePathGlow", el);
        this.tracePathGhost = $("#tracePathGhost", el);
        this.traceDrone = $("[data-trace-drone]", el);
        this.traceDroneRot = $("[data-trace-drone-rot]", el);
        this.traceDroneTxt = $("[data-trace-drone-txt]", el);
        this.traceWakeRing = $("[data-trace-wake]", el);

        // Elementos formato vertical (mobile / portrait)
        this.tracePathCoreV = $("#tracePathCoreV", el);
        this.tracePathGlowV = $("#tracePathGlowV", el);
        this.tracePathGhostV = $("#tracePathGhostV", el);
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
        this.traceRooms = $$("[data-trace-room]", el);
        this.traceRoomsV = $$("[data-trace-room-v]", el);
        this.traceWps = $$("[data-trace-wp]", el);
        this.traceWpsV = $$("[data-trace-wp-v]", el);
        this.traceActs = $$("[data-trace-act]", el).map((n) => ({
          n,
          r: n.dataset.traceAct.split(",").map(Number),
        }));
        this.traceSecBtns = $$("[data-trace-jump]", el);
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

        if (this.traceSecBtns && this.traceSecBtns.length) {
          this.traceSecBtns.forEach((btn) => {
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              const targetP = parseFloat(btn.dataset.traceJump) || 0;
              this.seekToProgress(clamp(targetP));
              playTactileTick(680, 0.025, 0.02);
            });
          });
        }

        // Motor híbrido: Entrada con scroll + Colchón sticky nativo + Proyección autónoma asistida
        this.isHybrid = true;
        this.autoPlayProg = 0;
        this.autoPlayActive = false;
        this.autoPlayPaused = false;
        this.entranceComplete = false;
        this.inView = false;
        this.entranceScrubMax = 0.16;
        this.scrollBoost = 0;
        this.loopHoldTimer = 0;
        this.takeoverTimer = 0;
        this.takeoverMode = "auto";
        this.lastHybridY = undefined;

        this.traceTakeover = $("[data-trace-takeover]", el);
        this.traceTakeoverRing = $("[data-trace-takeover-ring]", el);
        this.traceTakeoverTitle = $("[data-trace-takeover-title]", el);
        this.traceTakeoverSub = $("[data-trace-takeover-sub]", el);
        this.traceRadialProg = $("[data-trace-radial-prog]", el);
        this.traceTcEl = $("[data-trace-tc]", el);
        this.traceSegBtns = $$("[data-trace-seg]", el);
        this.traceSegFills = $$("[data-trace-seg-fill]", el);

        this.traceStatusBadge = $("[data-trace-status-badge]", el);
        this.traceStatusText = $("[data-trace-status-text]", el);
        this.tracePlayToggle = $("[data-trace-play-toggle]", el);
        this.tracePlayIcon = $("[data-trace-play-icon]", el);
        this.tracePlayLabel = $("[data-trace-play-label]", el);
        this.traceSkipBtn = $("[data-trace-skip-btn]", el);
        this.traceHeaderSkip = $("[data-trace-header-skip]", el);
        this.traceHint = $("[data-trace-hint]", el);

        if (this.tracePlayToggle) {
          this.tracePlayToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            this.togglePlayPause();
          });
        }

        if (this.traceSkipBtn) {
          this.traceSkipBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.skipSection();
          });
        }

        if (this.traceHeaderSkip) {
          this.traceHeaderSkip.addEventListener("click", (e) => {
            e.stopPropagation();
            this.skipSection();
          });
        }

        if (this.media) {
          this.media.addEventListener("click", () => {
            if (this.entranceComplete) {
              this.togglePlayPause();
            }
          });
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
      if (this.outroCard) {
        this.gleamAngle = 45;
        this.outroGleamOp = 0;
      }

      // Generar marcas de capítulo sobre la línea de tiempo
      if (this.scrubTrack && this.chapters.length && !this.isKinetic) {
        const pStart = this.isHero ? 0.0 : -0.16;
        const pEnd = 0.88;
        this.chapters.forEach((ch) => {
          const tick = document.createElement("span");
          tick.className = "seq__ch-tick";
          const posPct = clamp((ch.r[0] - pStart) / (pEnd - pStart)) * 100;
          tick.style.left = `${posPct.toFixed(1)}%`;
          this.scrubTrack.appendChild(tick);
          ch.tick = tick;
        });
      }

      if (this.isFiesta && this.scrubTrack) {
        const tickR = document.createElement("span");
        tickR.className = "seq__ch-tick";
        tickR.style.left = "42%";
        this.scrubTrack.appendChild(tickR);
      }

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
      this.isLoupeVisible = false;

      if (this.isHybrid && !this.isTrace && this.media) {
        this.media.addEventListener("click", () => {
          this.togglePlayPause();
        });
      }
      this.bindScrub();
      this.measure();
      if (!this.isHero) this.setVisualFilter(16, 1);
    }

    bindScrub() {
      if (!this.scrub) return;
      const fromEvent = (e) => {
        const rect = this.scrub.getBoundingClientRect();
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        if (x === undefined) return;
        this.seekToProgress(clamp((x - rect.left) / rect.width));
      };
      const start = (e, moveEv, endEv) => {
        if (!e.target.closest("[data-trace-jump]")) {
          fromEvent(e);
        }
        const onMove = (ev) => fromEvent(ev);
        const onEnd = () => {
          removeEventListener(moveEv, onMove);
          removeEventListener(endEv, onEnd);
        };
        addEventListener(moveEv, onMove, { passive: true });
        addEventListener(endEv, onEnd);
      };
      this.scrub.addEventListener("mousedown", (e) => start(e, "mousemove", "mouseup"));
      this.scrub.addEventListener("touchstart", (e) => start(e, "touchmove", "touchend"), { passive: true });
      this.scrub.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 0.1 : 0.04;
        const cur = this.progress || 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.seekToProgress(clamp(cur + step)); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.seekToProgress(clamp(cur - step)); }
      });
    }

    seekToProgress(progress) {
      const targetP = clamp(progress, 0, 1);
      const targetY = this.top + targetP * this.len;
      if (scrollContainer && isVerticalScroller()) scrollToTarget(targetY, { duration: 0.6 });
      else if (lenis) lenis.scrollTo(targetY, { duration: 0.6 });
      else scrollToTarget(targetY, { duration: 0.6 });
    }

    togglePlayPause() {
      if (!this.isHybrid) return;
      if (this.progress >= 0.99) {
        this.seekToProgress(0.01);
        this.autoPlayPaused = false;
        playTactileTick(720, 0.025, 0.02);
        return;
      }
      this.autoPlayPaused = !this.autoPlayPaused;
      playTactileTick(this.autoPlayPaused ? 480 : 660, 0.02, 0.015);
      this.updateControlsUI();
    }

    restartAutoPlay() {
      this.seekToProgress(0.01);
      this.autoPlayPaused = false;
      this.autoPlayActive = true;
      playTactileTick(720, 0.025, 0.02);
      this.updateControlsUI();
    }

    skipSection() {
      playTactileTick(560, 0.025, 0.02);
      this.takeoverTimer = 0;
      if (this.traceTakeover) this.traceTakeover.classList.remove("is-visible");
      const nextTarget = this.el.nextElementSibling || $("#film-03") || $("#film-02");
      if (nextTarget) {
        scrollToTarget(nextTarget, { duration: 1.15 });
      } else {
        const nextY = this.top + this.len + vh;
        scrollToTarget(nextY, { duration: 1.15 });
      }
    }

    updateControlsUI() {
      // Interfaz limpia: la barra de tiempo y telemetría de recorrido se actualizan directamente
    }

    pickSet() {
      if (this.isKinetic) return "lg";
      return vw / vh < 0.9 ? "pt" : "lg";
    }

    /* Tamaño del encuadre final (16:9 horizontal / 9:16 vertical) */
    target() {
      const portrait = vw / vh < 0.9 || vw <= 640;
      let tw, th;
      if (portrait) {
        // En vertical / móvil: proporción equilibrada con mayor presencia visual y margen compacto
        th = Math.min(vh * 0.68, 660);
        tw = th * 9 / 16;
        if (tw > vw * 0.90) { tw = vw * 0.90; th = tw * 16 / 9; }
      } else {
        // En horizontal / escritorio: encuadre de cine amplio y de alto impacto
        tw = Math.min(vw * 0.88, 1480);
        th = tw * 9 / 16;
        const maxH = Math.min(vh * 0.74, vh - 190);
        if (th > maxH) { th = maxH; tw = th * 16 / 9; }
      }
      return { tw: Math.round(tw), th: Math.round(th) };
    }

    measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.min(1920, Math.round(vw * dpr));
      const h = Math.min(1680, Math.round(vh * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.dirty = true;
      }
      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const t = this.target();
      this.tw = t.tw; this.th = t.th;
      this.stage.style.setProperty("--tw", `${t.tw}px`);
      this.stage.style.setProperty("--th", `${t.th}px`);

      if (this.isKinetic) {
        const isMob = vw <= 900 || (vw / vh < 0.95);
        let kw, kh;
        if (isMob) {
          kw = Math.min(vw * 0.92, 580);
          kh = Math.round(kw * (9 / 16));
          const maxKh = Math.min(vh * 0.44, vh - 180);
          if (kh > maxKh) {
            kh = maxKh;
            kw = Math.round(kh * (16 / 9));
          }
        } else {
          kw = Math.min(vw * 0.58, 1020);
          kh = Math.round(kw * (9 / 16));
          const maxKh = Math.min(vh * 0.64, vh - 210);
          if (kh > maxKh) {
            kh = maxKh;
            kw = Math.round(kh * (16 / 9));
          }
        }
        this.kw = Math.round(kw);
        this.kh = Math.round(kh);
        this.stage.style.setProperty("--kseq-w", `${this.kw}px`);
        this.stage.style.setProperty("--kseq-h", `${this.kh}px`);

        // Canvas 16:9 exacto para la secuencia cinética: 0 crop y 0 zoom tanto en móvil como en escritorio
        const cw = Math.round(this.kw * dpr);
        const ch = Math.round(this.kh * dpr);
        if (this.canvas.width !== cw || this.canvas.height !== ch) {
          this.canvas.width = cw;
          this.canvas.height = ch;
          this.dirty = true;
        }
      }

      if (this.isFiesta && this.randaCanvases) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.randaCanvases.forEach((c) => {
          if (!c) return;
          const rect = c.getBoundingClientRect();
          const cw = Math.round((rect.width || 540) * dpr);
          const ch = Math.round((rect.height || 304) * dpr);
          if (c.width !== cw || c.height !== ch) {
            c.width = cw;
            c.height = ch;
          }
        });
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
      // Paso 1: Cobertura densa inicial cada 2 fotogramas (paso 2 = 12fps continuo de inmediato)
      for (let i = 2; i < n; i += 2) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      if (!seen[n - 1]) { seen[n - 1] = 1; out.push(n - 1); }
      // Paso 2: Intercalar fotogramas impares restantes para fluidez completa
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
      const first = Math.min(40, Math.ceil(this.count / 2));
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
          if (Math.abs(i - Math.round(this.cur)) <= 2) {
            this.dirty = true;
          }
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        const vParam = this.version ? `?v=${this.version}` : (this.count ? `?v=${this.count}` : "");
        img.src = `${this.src}/${set}/${pad(i + 1, 4)}.webp${vParam}`;
      };
      for (let k = 0; k < parallel; k++) next();
    }

    nearest(i) {
      const f = this.frames;
      if (f[i]) return f[i];
      const targetSet = this.set || this.pickSet();
      const donor = typeof sequences !== "undefined" && sequences[0];
      if (donor && donor !== this && donor.src === this.src && donor.set === targetSet && donor.frames && donor.frames[i]) {
        return donor.frames[i];
      }
      for (let d = 1; d < this.count; d++) {
        if (f[i - d]) return f[i - d];
        if (f[i + d]) return f[i + d];
        if (donor && donor !== this && donor.src === this.src && donor.set === targetSet && donor.frames) {
          if (donor.frames[i - d]) return donor.frames[i - d];
          if (donor.frames[i + d]) return donor.frames[i + d];
        }
      }
      return null;
    }

    draw(pos) {
      const n = this.count;
      const f = Math.round(clamp(pos, 0, n - 1));

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

    loadRanda() {
      if (this.randaLoading || this.randaLoaded) return;
      this.randaLoading = true;
      const count = this.randaCount || 208;
      this.randa1Frames = new Array(count);
      this.randa2Frames = new Array(count);

      const loadSeq = (slug, targetArr, cardIdx) => {
        const queue = [0];
        for (let i = 3; i < count; i += 3) queue.push(i);
        if (!queue.includes(count - 1)) queue.push(count - 1);
        for (let i = 1; i < count; i++) {
          if (!queue.includes(i)) queue.push(i);
        }

        let qi = 0;
        const parallel = 3;
        const next = () => {
          if (qi >= queue.length) return;
          const idx = queue[qi++];
          const img = new Image();
          img.decoding = "async";
          const finish = (ok) => {
            if (ok) targetArr[idx] = img;
            if (idx === 0 && ok) {
              if (this.randaCards && this.randaCards[cardIdx]) {
                this.randaCards[cardIdx].classList.add("has-canvas");
              }
              this.drawRanda(0);
            }
            next();
          };
          img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
          img.onerror = () => finish(false);
          img.src = `assets/seq/${slug}/lg/${pad(idx + 1, 4)}.webp?v=1792892959`;
        };
        for (let k = 0; k < parallel; k++) next();
      };

      loadSeq("randa1", this.randa1Frames, 0);
      loadSeq("randa2", this.randa2Frames, 1);
      this.randaLoaded = true;
    }

    nearestRanda(num, i) {
      const f = num === 1 ? this.randa1Frames : this.randa2Frames;
      if (!f) return null;
      if (f[i]) return f[i];
      for (let d = 1; d < this.randaCount; d++) {
        if (f[i - d]) return f[i - d];
        if (f[i + d]) return f[i + d];
      }
      return null;
    }

    drawRanda(pos) {
      if (!this.randaCanvases) return;
      const n = this.randaCount;
      const f = Math.round(clamp(pos, 0, n - 1));

      if (!this.lastRandaImgs) this.lastRandaImgs = [];

      [1, 2].forEach((num, idx) => {
        const c = this.randaCanvases[idx];
        const ctx = this.randaCtxs[idx];
        if (!c || !ctx) return;

        const img = this.nearestRanda(num, f);
        if (!img || !img.naturalWidth) return;
        if (this.lastRandaImgs[idx] === img) return;

        const cw = c.width, ch = c.height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.drawImage(img, 0, 0, cw, ch);
        this.lastRandaImgs[idx] = img;
      });
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

    setBlur(px) {
      this.setVisualFilter(px, 0);
    }

    setText(el, o, ty, blur) {
      el.style.opacity = o.toFixed(3);
      el.style.transform = ty ? `translate3d(0, ${ty.toFixed(2)}vh, 0)` : "none";
      el.style.filter = blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "none";
      el.style.visibility = o <= 0.001 ? "hidden" : "visible";
    }

    updateOutroGleam(p, dt) {
      if (!this.outroCard) return;

      // Despierta de forma sutil justo cuando la secuencia termina y la pantalla se funde a negro (p >= 0.74)
      const inRange = p >= 0.74 && p < 1.25;
      const targetOp = inRange
        ? (p >= 1.0 ? Math.max(0, 1 - (p - 1.0) * 4) : smooth(range(p, 0.74, 0.84)))
        : 0;

      if (targetOp <= 0.001) {
        if (this.outroGleamOp !== 0) {
          this.outroCard.style.setProperty("--outro-gleam-op", "0");
          this.outroGleamOp = 0;
        }
        return;
      }

      // Los destellos del contorno giran exclusivamente ligados al scroll (arriba y abajo)
      const targetAngle = 45 + (p - 0.74) * 540;

      if (this.gleamAngle === undefined) this.gleamAngle = targetAngle;
      const kAngle = dt ? Math.min(1, 1 - Math.exp(-14 * dt)) : 0.20;

      let diff = (targetAngle - this.gleamAngle) % 360;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this.gleamAngle += diff * kAngle;

      this.outroGleamOp = targetOp;
      this.outroCard.style.setProperty("--outro-gleam-op", targetOp.toFixed(3));
      this.outroCard.style.setProperty("--gradient-angle", `${this.gleamAngle.toFixed(1)}deg`);
    }

    updateTrace(traceTarget, p, viewportEntry, dt) {
      const st = this.stage.style;
      const k = reduce ? 1 : (dt ? Math.min(1, 1 - Math.exp(-13 * dt)) : 0.22);
      this.traceCur += (traceTarget - this.traceCur) * k;
      if (Math.abs(traceTarget - this.traceCur) < 0.001) this.traceCur = traceTarget;
      const tp = clamp(this.traceCur, 0, 1);

      // Desplazamiento de entrada y visibilidad de HUD
      const entryShiftY = -(1 - smooth(viewportEntry)) * (vh * 0.14);
      const outro = smooth(range(p, 0.92, 1.15));
      const hudOp = smooth(range(viewportEntry, 0.10, 0.58)) * (1 - outro * 0.85);
      st.setProperty("--trace-entry-y", `${entryShiftY.toFixed(1)}px`);
      st.setProperty("--trace-hud-op", hudOp.toFixed(3));

      // 1. Posición milimétrica del punto óptico y dibujo progresivo del recorrido
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

          // Lógica de encuadre cinematográfico horizontal:
          // Al cruzar el umbral (tp: 0.22 -> 0.44), el cono óptico gira sutilmente hacia el Patio de Luz Norte (-24°).
          // Al recorrer la Nave Principal (tp: 0.46 -> 0.76), barre suavemente hacia el estar y comedor (+16°).
          const patioLook = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -24;
          const naveLook = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
          const coneDeg = tangentDeg + patioLook + naveLook;
          yawReading = Math.round((90 + coneDeg + 360) % 360);

          this.traceDrone.setAttribute("transform", `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
          if (this.traceDroneRot) {
            this.traceDroneRot.setAttribute("transform", `rotate(${coneDeg.toFixed(1)})`);
          }
        } catch (_) {}
      }

      // 1b. Posición y ángulo para formato Vertical (Mobile / Portrait)
      if (this.tracePathCoreV) {
        const totalLenV = this.tracePathLenV || 690;
        const curLenV = tp * totalLenV;
        const dashOffsetV = (totalLenV - curLenV).toFixed(1);
        if (this.tracePathCoreV) this.tracePathCoreV.style.strokeDashoffset = dashOffsetV;
        if (this.tracePathGlowV) this.tracePathGlowV.style.strokeDashoffset = dashOffsetV;

        if (this.traceDroneV) {
          try {
            const ptV = this.tracePathCoreV.getPointAtLength(curLenV);
            const p1V = this.tracePathCoreV.getPointAtLength(Math.max(0, curLenV - 6));
            const p2V = this.tracePathCoreV.getPointAtLength(Math.min(totalLenV, curLenV + 6));
            const tangentDegV = Math.atan2(p2V.y - p1V.y, p2V.x - p1V.x) * (180 / Math.PI);

            // Giro sutil del cono óptico en vertical:
            // Al bajar por el Umbral (tp: 0.22 -> 0.44), mira hacia el Patio de Luz a la derecha (-20°)
            // Al transitar la Nave (tp: 0.46 -> 0.76), barre hacia el Estar a la izquierda (+16°)
            const patioLookV = Math.sin(range(tp, 0.22, 0.44) * Math.PI) * -20;
            const naveLookV = Math.sin(range(tp, 0.46, 0.76) * Math.PI) * 16;
            const coneDegV = (tangentDegV - 90) + patioLookV + naveLookV;

            if (window.matchMedia && window.matchMedia("(max-aspect-ratio: 9/10)").matches) {
              yawReading = Math.round((tangentDegV + patioLookV + naveLookV + 360) % 360);
            }

            this.traceDroneV.setAttribute("transform", `translate(${ptV.x.toFixed(1)}, ${ptV.y.toFixed(1)})`);
            if (this.traceDroneRotV) {
              this.traceDroneRotV.setAttribute("transform", `rotate(${coneDegV.toFixed(1)})`);
            }
          } catch (_) {}
        }
      }

      // 2. Emergencia progresiva de la planta arquitectónica (despierta cuando el punto llega al pórtico)
      const darkT = smooth(range(tp, 0.12, 0.28));
      st.setProperty("--trace-darken-op", darkT.toFixed(3));

      const gridOp = smooth(range(tp, 0.14, 0.26));
      const planOp = smooth(range(tp, 0.15, 0.23));
      const draw1 = smooth(range(tp, 0.15, 0.28));
      const draw2 = smooth(range(tp, 0.21, 0.35));
      const draw3 = smooth(range(tp, 0.27, 0.41));
      const sec1Op = smooth(range(tp, 0.15, 0.24));
      const sec2Op = smooth(range(tp, 0.20, 0.30));
      const sec3Op = smooth(range(tp, 0.26, 0.37));
      const ghostOp = (0.14 + 0.32 * smooth(range(tp, 0.18, 0.32))) * (1 - smooth(range(tp, 0.92, 0.99)));

      st.setProperty("--trace-grid-op", gridOp.toFixed(3));
      st.setProperty("--trace-plan-op", planOp.toFixed(3));
      st.setProperty("--trace-draw-1", draw1.toFixed(3));
      st.setProperty("--trace-draw-2", draw2.toFixed(3));
      st.setProperty("--trace-draw-3", draw3.toFixed(3));
      st.setProperty("--trace-sec1-op", sec1Op.toFixed(3));
      st.setProperty("--trace-sec2-op", sec2Op.toFixed(3));
      st.setProperty("--trace-sec3-op", sec3Op.toFixed(3));
      st.setProperty("--trace-ghost-op", ghostOp.toFixed(3));

      // Onda sutil de activación en el umbral cuando aparece el plano
      const wakeWave = range(tp, 0.15, 0.30);
      if (this.traceWakeRing) {
        if (wakeWave > 0 && wakeWave < 1) {
          const r = 10 + smooth(wakeWave) * 195;
          const op = Math.sin(wakeWave * Math.PI) * 0.52;
          this.traceWakeRing.setAttribute("r", r.toFixed(1));
          this.traceWakeRing.setAttribute("stroke-opacity", op.toFixed(3));
        } else {
          this.traceWakeRing.setAttribute("stroke-opacity", "0");
        }
      }
      if (this.traceWakeRingV) {
        if (wakeWave > 0 && wakeWave < 1) {
          const r = 10 + smooth(wakeWave) * 150;
          const op = Math.sin(wakeWave * Math.PI) * 0.52;
          this.traceWakeRingV.setAttribute("r", r.toFixed(1));
          this.traceWakeRingV.setAttribute("stroke-opacity", op.toFixed(3));
        } else {
          this.traceWakeRingV.setAttribute("stroke-opacity", "0");
        }
      }

      // 3. Cámara espacial sobre la planta (seguimiento sutil + parallax de puntero)
      const isPortrait = vw / vh < 0.95 || vw <= 768;
      let camX = 0, camY = 0, camScale = 1, camRx = 0, camRy = 0;
      if (isPortrait) {
        camScale = 1;
        camX = 0;
        camY = (0.35 - tp * 0.70) * 18;
      } else if (vw <= 860) {
        camScale = 1.06;
        camX = (0.42 - tp * 0.84) * (vw * 0.18);
      } else {
        const introFocus = 1 - smooth(range(tp, 0.12, 0.36));
        camScale = 1 + introFocus * 0.055;
        camX = introFocus * 46 + (finePointer && !reduce ? normMx * -7 : 0);
        camY = finePointer && !reduce ? normMy * -5 : 0;
        camRx = finePointer && !reduce ? -normMy * 1.3 : 0;
        camRy = finePointer && !reduce ? normMx * 1.8 : 0;
      }
      st.setProperty("--trace-cam-x", `${camX.toFixed(1)}px`);
      st.setProperty("--trace-cam-y", `${camY.toFixed(1)}px`);
      st.setProperty("--trace-cam-scale", camScale.toFixed(4));
      st.setProperty("--trace-cam-rx", `${camRx.toFixed(2)}deg`);
      st.setProperty("--trace-cam-ry", `${camRy.toFixed(2)}deg`);

      // 4. Activación de sectores de la casa, waypoints y ondas en espejo de agua
      const zoneIdx = tp < 0.22 ? 0 : (tp < 0.44 ? 1 : (tp < 0.78 ? 2 : 3));
      const activeRoomNum = zoneIdx === 1 ? "2" : (zoneIdx === 2 ? "3" : (zoneIdx === 3 ? "4" : "1"));
      if (this.traceRooms && this.traceRooms.length) {
        this.traceRooms.forEach((r) => {
          r.classList.toggle("is-active", r.dataset.traceRoom === activeRoomNum);
        });
      }
      if (this.traceRoomsV && this.traceRoomsV.length) {
        this.traceRoomsV.forEach((r) => {
          r.classList.toggle("is-active", r.dataset.traceRoomV === activeRoomNum);
        });
      }
      if (this.traceSecBtns && this.traceSecBtns.length) {
        this.traceSecBtns.forEach((btn, idx) => {
          btn.classList.toggle("is-active", idx === zoneIdx);
        });
      }
      // Actualizar los 4 segmentos de progreso por capítulo en tiempo real
      const segRanges = [
        [0.0, 0.22],
        [0.22, 0.48],
        [0.48, 0.76],
        [0.76, 1.0],
      ];
      if (this.traceSegFills && this.traceSegFills.length) {
        this.traceSegFills.forEach((fill, idx) => {
          const [s0, s1] = segRanges[idx] || [0, 1];
          const segP = clamp((tp - s0) / (s1 - s0), 0, 1);
          fill.style.width = `${(segP * 100).toFixed(1)}%`;
        });
      }
      if (this.traceSegBtns && this.traceSegBtns.length) {
        this.traceSegBtns.forEach((btn, idx) => {
          const [, s1] = segRanges[idx] || [0, 1];
          btn.classList.toggle("is-active", idx === zoneIdx);
          btn.classList.toggle("is-done", tp >= s1 - 0.005);
        });
      }
      const ringOffset = (1 - tp).toFixed(3);
      if (this.traceRadialProg) {
        this.traceRadialProg.setAttribute("stroke-dashoffset", ringOffset);
      }
      if (this.traceTakeoverRing) {
        this.traceTakeoverRing.setAttribute("stroke-dashoffset", ringOffset);
      }
      if (this.traceTcEl) {
        const curSec = Math.min(14, Math.floor(tp * 14));
        const tcStr = `00:${pad(curSec)}`;
        if (this.traceTcEl.textContent !== tcStr) this.traceTcEl.textContent = tcStr;
      }
      if (zoneIdx !== this.lastTraceZone) {
        if (this.lastTraceZone !== -1 && viewportEntry > 0.2) {
          playTactileTick(620 + zoneIdx * 55, 0.025, 0.018);
        }
        this.lastTraceZone = zoneIdx;
      }

      if (this.traceWps && this.traceWps.length) {
        const wpThresholds = [0.0, 0.25, 0.41, 0.59, 0.79, 0.96];
        this.traceWps.forEach((wp, idx) => {
          wp.classList.toggle("is-reached", tp >= (wpThresholds[idx] || 0));
        });
      }
      if (this.traceWpsV && this.traceWpsV.length) {
        const wpThresholdsV = [0.0, 0.25, 0.41, 0.59, 0.79, 0.96];
        this.traceWpsV.forEach((wp, idx) => {
          wp.classList.toggle("is-reached", tp >= (wpThresholdsV[idx] || 0));
        });
      }

      const rippleT = smooth(range(tp, 0.76, 0.96));
      st.setProperty("--trace-ripple-op", rippleT.toFixed(3));
      st.setProperty("--trace-ripple-s", (0.82 + rippleT * 0.36).toFixed(3));

      // 5. Telemetría en tiempo real acoplada al punto y al cabezal
      const meters = (tp * 64.8).toFixed(1);
      const altM = tp < 0.22
        ? (1.85 - (tp / 0.22) * 0.15)
        : (tp < 0.78 ? 1.70 : (1.70 - ((tp - 0.78) / 0.22) * 0.25));

      if (this.traceDroneTxt) this.traceDroneTxt.textContent = `${meters}m · +${altM.toFixed(2)}m`;
      if (this.traceDroneTxtV) this.traceDroneTxtV.textContent = `${meters}m · +${altM.toFixed(2)}m`;
      if (this.traceDistEl) this.traceDistEl.textContent = `${meters} m`;
      if (this.traceAltEl) this.traceAltEl.textContent = `+${altM.toFixed(2)} m`;
      if (this.traceYawEl) this.traceYawEl.textContent = `${pad(yawReading, 3)}° E`;

      const phaseLabels = [
        "Fase I · Trazo en el Vacío",
        "Fase II · Ingreso a la Planta",
        "Fase III · Recorrido Interior",
        "Fase IV · Espejo de Agua",
      ];
      const roomLabels = [
        "Aproximación Exterior",
        "Umbral & Patio de Luz",
        "Nave Principal & Galería",
        "Lámina de Agua · Horizonte",
      ];
      const planStates = [
        "En aproximación",
        "Planta desplegada · 1:100",
        "Tránsito interior",
        "Cartografía completa",
      ];
      if (this.tracePhasePill && this.tracePhasePill.textContent !== phaseLabels[zoneIdx]) {
        this.tracePhasePill.textContent = phaseLabels[zoneIdx];
      }
      if (this.traceRoomNameEl && this.traceRoomNameEl.textContent !== roomLabels[zoneIdx]) {
        this.traceRoomNameEl.textContent = roomLabels[zoneIdx];
      }
      if (this.tracePlanStateEl && this.tracePlanStateEl.textContent !== planStates[zoneIdx]) {
        this.tracePlanStateEl.textContent = planStates[zoneIdx];
      }

      // 6. Actos editoriales sincronizados en el pie
      if (this.traceActs && this.traceActs.length) {
        const evalP = this.isHybrid ? tp : p;
        this.traceActs.forEach(({ n: el, r: [a, b] }) => {
          const t = (evalP - a) / (b - a);
          if (t <= 0 || t >= 1) {
            if (el.style.opacity !== "0") {
              el.style.opacity = "0";
              el.style.visibility = "hidden";
              el.style.filter = "none";
            }
            return;
          }
          const fadeIn = a < 0 ? range(t, 0, 0.14) : range(t, 0, 0.22);
          const fadeOut = b > 1 ? 1 : (1 - range(t, 0.78, 1));
          const o = smooth(Math.min(fadeIn, fadeOut));
          const driftY = (0.5 - t) * 14;
          const blurPx = Math.max(0, (1 - o) * 1.8).toFixed(1);

          el.style.visibility = o <= 0.005 ? "hidden" : "visible";
          el.style.opacity = o.toFixed(3);
          el.style.transform = `translate3d(0, ${driftY.toFixed(1)}px, 0)`;
          el.style.filter = blurPx > 0.15 ? `blur(${blurPx}px)` : "none";
        });
      }
    }

    update(dt) {
      const n = this.count;
      const isHero = this.isHero;
      const isFullscreen = this.isFullscreen;
      const y = scrollY();

      // Rango de evaluación extendido:
      // Permite que la secuencia empiece a reproducirse y a despertar desde el primer píxel en que asoma
      // por debajo de la pantalla (viewportEntry > 0), evitando cualquier vacío en negro o arranque tardío.
      const rawP = (y - this.top) / this.len;
      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);
      const st = this.stage.style;

      if (!this.set && viewportEntry > 0) {
        this.load();
      }

      // Fuera de pantalla: no trabajar.
      if (y + vh < this.top - vh || y > this.top + this.len + vh) {
        this.inView = false;
        return;
      }
      this.inView = true;

      /* ---- ESTADO CERO ABSOLUTO (Solo cuando aún no asoma en el viewport: viewportEntry <= 0) ---- */
      if (!isHero && viewportEntry <= 0) {
        this.cur = 0;
        this.progress = 0;
        if (this.isKinetic) {
          const isMob = vw <= 900 || (vw / vh < 0.95);
          const initEntryShiftY = isMob ? -vh * 0.28 : 0;
          st.setProperty("--kseq-clip-x", isMob ? "30%" : "36%");
          st.setProperty("--kseq-clip-y", "6%");
          st.setProperty("--kseq-tx", "0px");
          st.setProperty("--kseq-ty", `${initEntryShiftY.toFixed(1)}px`);
          st.setProperty("--kseq-curtain-y", `${initEntryShiftY.toFixed(1)}px`);
          st.setProperty("--kseq-scale", "0.94");
          st.setProperty("--kseq-ry", "0deg");
          st.setProperty("--kseq-hud-op", "0");
          st.setProperty("--kseq-inner-hud", "0");
          st.setProperty("--kseq-axis-x", "0px");
          st.setProperty("--cover-opacity", "0.35");
          st.setProperty("--frame-opacity", "1");
          st.setProperty("--outro-card-op", "0");
          st.setProperty("--outro-card-pe", "none");
          this.setVisualFilter(10, 1);
          if (this.kWingL) { this.kWingL.style.opacity = "1"; this.kWingL.style.transform = "translate3d(0,0,0)"; }
          if (this.kWingR) { this.kWingR.style.opacity = "1"; this.kWingR.style.transform = "translate3d(0,0,0)"; }
          if (this.kPanel1) this.kPanel1.style.opacity = "0";
          if (this.kPanel2) this.kPanel2.style.opacity = "0";
          if (this.kLoupeBox) this.kLoupeBox.style.opacity = "0";
          if (this.scrubFill) this.scrubFill.style.width = "0%";
          if (this.lastCur !== 0 || this.dirty) {
            this.draw(0);
            this.lastCur = 0;
            this.dirty = false;
          }
        }
        if (this.isFiesta) {
          st.setProperty("--fiesta-glow-op", "0");
          st.setProperty("--fiesta-solid-op", "0");
          st.setProperty("--randa-op", "0");
          st.setProperty("--randa-vis", "hidden");
          st.setProperty("--randa-scale", "0.92");
          st.setProperty("--randa-ty", "18px");
          st.setProperty("--randa-flare-op", "0");
          st.setProperty("--cover-opacity", "0.32");
          st.setProperty("--img-scale", "1.0");
          this.setVisualFilter(10, 1);
          this.randaCur = 0;
          this.drawRanda(0);
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

      /* ---- CONTINUIDAD Y RANGO EXTENDIDO ----
         Para que ninguna secuencia se corte o se congele al deslizar hacia la siguiente sección,
         el tramo fijado (0 <= rawP <= 1.0) cubre el 89% del relato cinematográfico.
         Al superar 1.0 y comenzar a desenganchar hacia la siguiente escena, la secuencia continúa
         reproduciéndose en el tramo de salida (1.0 < rawP <= 1.0 + exitRange) con una desaceleración
         cinematográfica suave (ease-out). Así, mientras vas deslizando hacia la siguiente obra,
         la anterior sigue viva y en movimiento continuo, sin cortes ni pausas toscas. */
      const exitRange = 0.22;
      const pinMaxProg = 0.89;

      /* ---- FINAL ABSOLUTO (Solo cuando ya superó completamente el tramo de desenganche: rawP >= 1.0 + exitRange) ---- */
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
          st.setProperty("--kseq-tx", "0px");
          st.setProperty("--kseq-ty", "0px");
          st.setProperty("--kseq-curtain-y", "0px");
          st.setProperty("--kseq-scale", "1");
          st.setProperty("--kseq-ry", "0deg");
          st.setProperty("--kseq-hud-op", "0");
          st.setProperty("--kseq-inner-hud", "0");
          if (this.kWingL) this.kWingL.style.opacity = "0";
          if (this.kWingR) this.kWingR.style.opacity = "0";
          if (this.kPanel1) this.kPanel1.style.opacity = "0";
          if (this.kPanel2) this.kPanel2.style.opacity = "0";
          if (this.kLoupeBox) this.kLoupeBox.style.opacity = "0";
        }
        if (this.outroCard) {
          st.setProperty("--cover-opacity", "0.38");
          st.setProperty("--frame-opacity", "1");
          st.setProperty("--chrome-opacity", "1");
          st.setProperty("--chrome-vis", "visible");
          st.setProperty("--outro-card-op", "1");
          st.setProperty("--outro-card-ty", "0px");
          st.setProperty("--outro-card-pe", "auto");
          this.setVisualFilter(5, 0);
          this.updateOutroGleam(rawP, dt);
        } else {
          st.setProperty("--cover-opacity", "0.32");
          st.setProperty("--frame-opacity", "1");
          st.setProperty("--chrome-opacity", "0");
          st.setProperty("--chrome-vis", "hidden");
          st.setProperty("--fs-header-op", "0");
          st.setProperty("--fs-footer-op", "0");
          st.setProperty("--outro-card-op", "0");
          st.setProperty("--outro-card-pe", "none");
          this.setVisualFilter(6, 0);
        }
        if (this.isFiesta) {
          st.setProperty("--fiesta-glow-op", "1");
          st.setProperty("--fiesta-glow-scale", "1.85");
          st.setProperty("--fiesta-solid-op", "1");
          st.setProperty("--randa-op", "0");
          st.setProperty("--randa-vis", "hidden");
          st.setProperty("--randa-scale", "0.96");
          st.setProperty("--randa-ty", "-22px");
          st.setProperty("--randa-flare-op", "0");
          st.setProperty("--cover-opacity", "0.85");
          st.setProperty("--img-scale", "1.10");
          this.setVisualFilter(10, 0);
          this.randaCur = this.randaCount - 1;
          this.drawRanda(this.randaCur);
        }
        if (this.scrubFill) this.scrubFill.style.width = "100%";
        if (this.fsBar) this.fsBar.style.width = "100%";
        return;
      }

      /* ---- RANGO ACTIVO (viewportEntry > 0 y rawP < 1.0 + exitRange) ---- */
      const p = rawP;
      let prog = 0;

      if (this.isHybrid) {
        const dtSec = Math.min(dt || 0.016, 0.04);
        const inActiveZone = rawP >= 0 && rawP < 1.0;

        const hasMinFrames = this.frames && (this.frames[0] || this.nearest(0));
        // Auto-reproducción suave y continua dentro del tramo fijado (espera a tener fotogramas listos)
        if (inActiveZone && !this.autoPlayPaused && hasMinFrames) {
          // Ralentización cinematográfica suave hacia el final de la secuencia (ease-out):
          let speedFactor = 1.0;
          const isAnacleto = this.el.id === "film-04";
          if (isAnacleto) {
            // Para Anacleto: desaceleración sutil y elegante en el tramo final (rawP > 0.85)
            if (rawP > 0.85) {
              const tDecel = clamp((rawP - 0.85) / (1.0 - 0.85), 0, 1);
              speedFactor = Math.max(0.60, 1.0 - Math.pow(tDecel, 1.25) * 0.40);
            }
          } else if (rawP > 0.74) {
            // Para Cartografía de Vuelo (#trazado): curva suave natural
            const tDecel = clamp((rawP - 0.74) / (1.0 - 0.74), 0, 1);
            speedFactor = Math.max(0.48, 1.0 - Math.pow(tDecel, 1.35) * 0.52);
          }

          // Duración calibrada para reproducción automática:
          // Anacleto (~10.2s): ritmo fluido, natural y equilibrado (ni lento ni acelerado en exceso)
          const spanProg = 0.895; // (pinEndProg 0.95 - preShare 0.055)
          const naturalSec = (this.count / (this.fps || 24));
          const baseDuration = isAnacleto ? 10.2 : (naturalSec * spanProg);
          const autoSpeed = (this.len / Math.max(4, baseDuration)) * speedFactor;
          const autoDy = autoSpeed * dtSec;

          if (lenis && !isVerticalScroller()) {
            // Transición unificada sin cortes ni detenciones intermedias en escritorio Lenis:
            const targetY = lenis.targetScroll !== undefined ? lenis.targetScroll : y;
            const userDiff = targetY - y;

            if (userDiff < -2) {
              // El usuario está desplazando deliberadamente hacia atrás (reversa)
              const userRevLead = -userDiff;
              const revDy = userRevLead * (1 - Math.exp(-18 * dtSec));
              const nextY = Math.max(this.top, y - revDy);
              const remainingRev = Math.max(0, userRevLead - revDy);
              lenis.scrollTo(nextY, { immediate: true });
              if (remainingRev > 0.5) {
                lenis.targetScroll = nextY - remainingRev;
              }
            } else {
              // Avance continuo: la velocidad es SIEMPRE al menos autoDy.
              // Si el usuario scrolleó hacia abajo, se suma el impulso con amortiguación suave.
              const userForwardLead = Math.max(0, userDiff);
              const userDy = userForwardLead * (1 - Math.exp(-14 * dtSec));
              const totalDy = autoDy + userDy;
              const nextY = Math.min(this.top + this.len, y + totalDy);
              const remainingLead = Math.max(0, userForwardLead - userDy);
              lenis.scrollTo(nextY, { immediate: true });
              if (remainingLead > 0.5) {
                lenis.targetScroll = nextY + remainingLead;
              }
            }
          } else {
            // Modo vertical / móvil (#top) o scroll nativo sin Lenis:
            // Acumulador de subpíxeles con despacho entero para garantizar avance continuo sin micro-frenos
            const scroller = (scrollContainer && isVerticalScroller()) ? scrollContainer : window;
            const currentY = (scrollContainer && isVerticalScroller()) ? scrollContainer.scrollTop : window.scrollY;
            if (currentY < this.top + this.len) {
              if (isUserTouching) {
                this.subpixelAcc = 0;
              } else {
                this.subpixelAcc = (this.subpixelAcc || 0) + autoDy;
                if (this.subpixelAcc >= 1) {
                  const intStep = Math.floor(this.subpixelAcc);
                  this.subpixelAcc -= intStep;
                  const nextY = Math.min(this.top + this.len, currentY + intStep);
                  if (scroller === window) {
                    window.scrollTo(0, nextY);
                  } else {
                    scroller.scrollTop = nextY;
                  }
                }
              }
            }
          }
        }

        // Continuidad cinemática de autor:
        // 1. Aproximación con scroll (pPlayStart -> 0.0): la escena despierta y se mueve con el deslizado antes de fijarse.
        // 2. Tramo fijado (0.0 -> 1.0): se reproduce sola y acelera al scrollear hacia abajo con desaceleración orgánica.
        // 3. Salida extendida (1.0 -> 1.0 + exitRange): desengancha suavemente hacia la siguiente obra mientras culmina el film.
        const pPlayStart = -Math.min(0.55, (vh * 0.85) / this.len);
        const preShare = 0.055;
        const pinEndProg = 0.95;

        if (rawP < pPlayStart) {
          prog = 0;
        } else if (rawP < 0.0) {
          const u = clamp((rawP - pPlayStart) / (-pPlayStart));
          prog = preShare * Math.pow(u, 1.35);
        } else if (rawP <= 1.0) {
          prog = preShare + rawP * (pinEndProg - preShare);
        } else {
          const exitT = clamp((rawP - 1.0) / exitRange);
          prog = pinEndProg + Math.sin(exitT * Math.PI * 0.5) * (1.0 - pinEndProg);
        }
      } else if (isHero) {
        if (p <= 0.0) {
          prog = 0;
        } else if (p <= 1.0) {
          prog = p * pinMaxProg;
        } else {
          const exitT = clamp((p - 1.0) / exitRange);
          prog = pinMaxProg + Math.sin(exitT * Math.PI * 0.5) * (1.0 - pinMaxProg);
        }
      } else if (this.isFiesta) {
        if (p >= 0.15 && !this.randaLoaded) this.loadRanda();
        // Vonharv: se reproduce como un plano continuo de apertura que culmina en p = 0.44
        if (p < 0.0) {
          const u = clamp((p + 0.15) / 0.15);
          prog = 0.05 * Math.pow(u, 1.35);
        } else {
          prog = clamp(p / 0.44, 0, 1);
        }
      } else {
        const pPlayStart = -Math.min(0.55, (vh * (isFullscreen ? 0.85 : 0.75)) / this.len);
        const preShare = 0.055; // 5.5% de los fotogramas en todo el tramo previo

        if (p < pPlayStart) {
          prog = 0;
        } else if (p < 0.0) {
          const u = clamp((p - pPlayStart) / (-pPlayStart));
          prog = preShare * Math.pow(u, 1.35);
        } else if (p <= 1.0) {
          prog = preShare + p * (pinMaxProg - preShare);
        } else {
          const exitT = clamp((p - 1.0) / exitRange);
          prog = pinMaxProg + Math.sin(exitT * Math.PI * 0.5) * (1.0 - pinMaxProg);
        }
      }

      prog = clamp(prog, 0, 1);
      this.progress = prog;

      const targetF = prog * (n - 1);
      const k = reduce ? 1 : (this.isHybrid ? (1 - Math.exp(-28 * dt)) : (1 - Math.exp(-12 * dt)));

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
          if (this.fsTc) this.fsTc.textContent = `00:${pad(sec)}`;
        }
        const pctVal = Math.round(prog * 1000) / 10;
        if (pctVal !== this.lastPctVal) {
          this.lastPctVal = pctVal;
          const pct = `${pctVal}%`;
          if (this.scrubFill) this.scrubFill.style.width = pct;
          if (this.fsBar) this.fsBar.style.width = pct;
          if (this.scrub) this.scrub.setAttribute("aria-valuenow", String(Math.round(pctVal)));
        }
      }

      /* =======================================================
         RAMA 1: SECUENCIA FULLSCREEN CONTINUA (VISIÓN NOCTURNA)
         El video arranca visible e inmediato desde que asoma en pantalla,
         iniciando en blanco y negro y con desenfoque, y disolviéndose suavemente
         a color pleno y foco a medida que el usuario va deslizando.
         ======================================================= */
      if (isFullscreen) {
        st.setProperty("--frame-w", `${vw}px`);
        st.setProperty("--frame-h", `${vh}px`);
        st.setProperty("--img-scale", "1.02");

        const outro = this.isHybrid ? 0 : smooth(range(p, 0.88, 0.99));
        // Ni bien comienza a reproducirse la secuencia, disolver desenfoque y blanco/negro
        const wake = this.isHybrid
          ? (this.entranceComplete ? 1 : smooth(viewportEntry))
          : smooth(range(p, -0.18, 0.04));
        const cover = Math.max((1 - wake) * 0.20, outro * 0.32);
        const blur = Math.max((1 - wake) * 12, outro * 6);
        const gray = 1 - wake;

        st.setProperty("--cover-opacity", cover.toFixed(3));
        st.setProperty("--frame-opacity", "1");
        this.setVisualFilter(blur, gray);

        // Contra-desplazamiento de entrada + compactación inicial que se abre al fijarse
        const entryShiftY = this.isHybrid ? 0 : -(1 - smooth(viewportEntry)) * (vh * 0.18);
        const compactLayout = this.isHybrid ? 0 : 1 - smooth(range(p, -0.06, 0.16));
        const headCompactY = compactLayout * (vh * 0.07);
        const footCompactY = -compactLayout * (vh * 0.07);
        st.setProperty("--fs-entry-y", `${entryShiftY.toFixed(1)}px`);
        st.setProperty("--fs-head-y", `${headCompactY.toFixed(1)}px`);
        st.setProperty("--fs-foot-y", `${footCompactY.toFixed(1)}px`);

        const fsHudOp = smooth(range(viewportEntry, 0.10, 0.60)) * (1 - outro);
        st.setProperty("--fs-header-op", fsHudOp.toFixed(3));
        st.setProperty("--fs-footer-op", fsHudOp.toFixed(3));

        // Actualizar riel vertical de actos laterales
        if (this.fsRailFill1) {
          this.fsRailFill1.style.transform = `scaleY(${clamp(range(p, 0.18, 0.44)).toFixed(3)})`;
        }
        if (this.fsRailFill2) {
          this.fsRailFill2.style.transform = `scaleY(${clamp(range(p, 0.50, 0.76)).toFixed(3)})`;
        }
        if (this.fsRailDots && this.fsRailDots.length) {
          const activeIdx = p < 0.35 ? 0 : (p < 0.68 ? 1 : 2);
          this.fsRailDots.forEach((d, idx) => d.classList.toggle("is-active", idx === activeIdx));
        }

        this.fsActs.forEach(({ n: el, r: [a, b] }) => {
          const t = (p - a) / (b - a);
          if (t <= 0 || t >= 1) {
            if (el.style.opacity !== "0") {
              el.style.opacity = "0";
              el.style.filter = "none";
            }
            return;
          }
          const o = smooth(Math.min(range(t, 0, 0.18), 1 - range(t, 0.82, 1)));
          el.style.opacity = o.toFixed(3);

          // Flotación cinemática continua con el scroll:
          const driftY = (t - 0.5) * -28;
          const introY = (1 - o) * (t < 0.5 ? 18 : -14);
          el.style.transform = `translate3d(0, calc(-50% + ${(driftY + introY).toFixed(1)}px), 0)`;

          const fsBlur = Math.max(0, (1 - o) * 2.2).toFixed(1);
          el.style.filter = fsBlur > 0.15 ? `blur(${fsBlur}px)` : "none";
        });

        if (this.isTrace) {
          const traceTarget = prog;
          this.updateTrace(traceTarget, p, viewportEntry, dt);
        }

        return;
      }

      /* =======================================================
         RAMA 1.5: SECUENCIA CINÉTICA · OBRA III (CASA HUDSON)
         Apertura por hendidura vertical, telón tipográfico monumental partido,
         desplazamiento escenográfico lateral (Izquierda -> Derecha)
         y lupa óptica 2.1x en contrapunto.
         ======================================================= */
      if (this.isKinetic) {
        const isMob = vw <= 900 || (vw / vh < 0.95);

        // 0. Progreso de aproximación / entrada al viewport
        const entryProgress = clamp((y + vh - this.top) / vh, 0, 1);

        // 1. Apertura de la hendidura central (-0.06 -> 0.24)
        // La hendidura comienza en 30% / 36% y se estira horizontalmente con el scroll
        const openT = smooth(range(p, -0.06, 0.24));
        const clipX = ((1 - openT) * (isMob ? 30 : 36)).toFixed(2);
        const clipY = ((1 - openT) * 6).toFixed(2);
        st.setProperty("--kseq-clip-x", `${clipX}%`);
        st.setProperty("--kseq-clip-y", `${clipY}%`);

        // Revelado cromático y óptico original:
        const wakeT = smooth(range(p, -0.14, 0.04));
        const outro = smooth(range(prog, 0.88, 1.0));
        const cover = Math.max((1 - wakeT) * 0.32, outro * 0.38);
        const blur = Math.max((1 - wakeT) * 10, outro * 8);
        const gray = 1 - wakeT;
        st.setProperty("--cover-opacity", cover.toFixed(3));
        st.setProperty("--frame-opacity", "1");
        this.setVisualFilter(blur, gray);

        // 2. Telón tipográfico monumental partido (se abre hacia los bordes)
        // Posición y separación original exacta de las alas "Casa" y "Hudson":
        const wingMove = smooth(range(p, -0.02, 0.25));
        const wingOp = 1 - smooth(range(p, 0.08, 0.23));
        const wingShiftX = wingMove * (isMob ? vw * 0.24 : vw * 0.22);
        const wingBlur = (wingMove * 6).toFixed(1);
        if (this.kWingL) {
          this.kWingL.style.opacity = wingOp.toFixed(3);
          this.kWingL.style.transform = `translate3d(${(-wingShiftX).toFixed(1)}px, 0, 0)`;
          this.kWingL.style.filter = wingMove > 0.05 ? `blur(${wingBlur}px)` : "none";
          this.kWingL.style.visibility = wingOp <= 0.005 ? "hidden" : "visible";
        }
        if (this.kWingR) {
          this.kWingR.style.opacity = wingOp.toFixed(3);
          this.kWingR.style.transform = `translate3d(${wingShiftX.toFixed(1)}px, 0, 0)`;
          this.kWingR.style.filter = wingMove > 0.05 ? `blur(${wingBlur}px)` : "none";
          this.kWingR.style.visibility = wingOp <= 0.005 ? "hidden" : "visible";
        }

        // 3. Coreografía espacial del escenario principal y desplazamiento adaptativo de entrada
        const toLeft = smooth(range(p, 0.18, 0.34)) * (1 - smooth(range(p, 0.48, 0.62)));
        const toRight = smooth(range(p, 0.50, 0.65)) * (1 - smooth(range(p, 0.80, 0.91)));

        const maxShiftX = isMob ? 0 : vw * 0.145;
        const ptrX = (!isMob && finePointer && !reduce) ? normMx * 8 * (1 - outro) : 0;
        const ptrY = (!isMob && finePointer && !reduce) ? normMy * 6 * (1 - outro) : 0;

        // Desplazamiento adaptativo en vertical / móvil:
        // En la aproximación (entryProgress < 1), eleva suavemente el telón y escenario para anticipar la llegada sin hueco negro.
        // Una vez fijada la sección (p >= 0), el recuadro y el título permanecen estrictamente fijos en el centro de la pantalla.
        const mobEntryShiftY = isMob ? (-(1 - smooth(entryProgress)) * (vh * 0.28)) : 0;

        const stageTx = isMob ? 0 : ((-toLeft * maxShiftX) + (toRight * maxShiftX) + ptrX);
        const stageTy = (isMob ? mobEntryShiftY : ((toLeft * -10) + (toRight * 8))) + ptrY;
        const stageScale = isMob ? (0.94 + openT * 0.06) : (0.94 + openT * 0.06 - toLeft * 0.05 + toRight * 0.04);
        const stageRy = isMob ? 0 : (toLeft * 4.2 - toRight * 4.2 + (finePointer && !reduce ? normMx * 1.6 : 0));

        st.setProperty("--kseq-tx", `${stageTx.toFixed(1)}px`);
        st.setProperty("--kseq-ty", `${stageTy.toFixed(1)}px`);
        st.setProperty("--kseq-curtain-y", `${stageTy.toFixed(1)}px`);
        st.setProperty("--kseq-scale", stageScale.toFixed(4));
        st.setProperty("--kseq-ry", `${stageRy.toFixed(2)}deg`);
        st.setProperty("--kseq-axis-x", `${(stageTx * 0.65).toFixed(1)}px`);
        st.setProperty("--img-scale", "1");

        // 4. HUD perimetral e interno
        const hudOp = isMob
          ? (smooth(range(entryProgress, 0.35, 0.92)) * (1 - smooth(range(p, 0.88, 0.96))))
          : (smooth(range(p, 0.12, 0.24)) * (1 - smooth(range(p, 0.88, 0.96))));
        st.setProperty("--kseq-hud-op", hudOp.toFixed(3));
        st.setProperty("--kseq-hud-y", `${((1 - hudOp) * -8).toFixed(1)}px`);
        st.setProperty("--kseq-bot-y", `${((1 - hudOp) * 8).toFixed(1)}px`);
        st.setProperty("--kseq-inner-hud", (smooth(range(p, 0.18, 0.28)) * (1 - outro)).toFixed(3));

        // 5. Paneles editoriales en contrapunto (Acto I a la derecha, Acto II a la izquierda)
        // En vertical aparecen directamente debajo del recuadro de forma estable y bien emplazada, sin derivas verticales
        if (this.kPanel1) {
          const t1 = (p - 0.21) / (0.54 - 0.21);
          if (t1 <= 0 || t1 >= 1) {
            this.kPanel1.style.opacity = "0";
            this.kPanel1.style.visibility = "hidden";
          } else {
            const o1 = smooth(Math.min(range(t1, 0, 0.22), 1 - range(t1, 0.78, 1)));
            this.kPanel1.style.visibility = "visible";
            this.kPanel1.style.opacity = o1.toFixed(3);
            this.kPanel1.style.transform = isMob
              ? "translate3d(0, 0, 0)"
              : `translate3d(0, calc(-50% + ${((0.5 - t1) * 36).toFixed(1)}px), 0)`;
            if (this.kCota1) this.kCota1.style.transform = `scaleX(${clamp(t1 * 1.25).toFixed(3)})`;
          }
        }

        if (this.kPanel2) {
          const t2 = (p - 0.53) / (0.85 - 0.53);
          if (t2 <= 0 || t2 >= 1) {
            this.kPanel2.style.opacity = "0";
            this.kPanel2.style.visibility = "hidden";
          } else {
            const o2 = smooth(Math.min(range(t2, 0, 0.22), 1 - range(t2, 0.78, 1)));
            this.kPanel2.style.visibility = "visible";
            this.kPanel2.style.opacity = o2.toFixed(3);
            this.kPanel2.style.transform = isMob
              ? "translate3d(0, 0, 0)"
              : `translate3d(0, calc(-50% + ${((0.5 - t2) * 36).toFixed(1)}px), 0)`;
            if (this.kCota2) this.kCota2.style.transform = `scaleX(${clamp(t2 * 1.25).toFixed(3)})`;
          }
        }

// Lupa óptica removida

        // 7. Lecturas dinámicas de telemetría arquitectónica
        if (this.kDist) {
          const distM = (18.4 - prog * 17.2).toFixed(1);
          this.kDist.textContent = `${distM} m`;
        }
        if (this.kPhase) {
          const phaseTxt = p < 0.21
            ? "Apertura de Umbral"
            : (p < 0.53 ? "Acto I · Volumetría y Fachada" : (p < 0.84 ? "Acto II · Eje de Ingreso" : "Film Máster 4K"));
          if (this.kPhase.textContent !== phaseTxt) this.kPhase.textContent = phaseTxt;
        }
        if (this.kFocal) {
          const focalTxt = p < 0.52 ? "Óptica 18mm T2.0 · Panorámico" : "Óptica 28mm T1.5 · Aproximación";
          if (this.kFocal.textContent !== focalTxt) this.kFocal.textContent = focalTxt;
        }
        if (this.kCropLabel) {
          const cropTxt = p < 0.52 ? "Hormigón & Piedra" : "Doble Altura · Acceso";
          if (this.kCropLabel.textContent !== cropTxt) this.kCropLabel.textContent = cropTxt;
        }

        // 8. Tarjeta de cierre cinematográfica (YouTube Outro)
        if (this.outroCard) {
          const outroCardT = smooth(range(p, 0.84, 0.94));
          st.setProperty("--outro-card-op", outroCardT.toFixed(3));
          st.setProperty("--outro-card-ty", `${((1 - outroCardT) * 16).toFixed(1)}px`);
          st.setProperty("--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
          this.updateOutroGleam(p, dt);
        }
        return;
      }

      /* =======================================================
         RAMA 2: SECUENCIAS CON REENCUADRE (01, 02, 04)
         ======================================================= */
      // El reencuadre inicia suavemente conforme se avanza
      const morph = smooth(range(p, 0.0, 0.26));
      const inv = 1 - morph;
      const curW = this.tw + (vw - this.tw) * inv;
      const curH = this.th + (vh - this.th) * inv;
      st.setProperty("--frame-w", `${curW.toFixed(1)}px`);
      st.setProperty("--frame-h", `${curH.toFixed(1)}px`);
      st.setProperty("--img-scale", (1 + inv * (isHero ? 0.04 : 0.05)).toFixed(4));

      // Salida al final:
      // Si la secuencia tiene tarjeta de cierre (outroCard), el fondo se atenúa a un velo traslúcido
      // (cover 0.38) en lugar de negro absoluto, manteniendo la arquitectura viva detrás del cristal.
      const outro = this.outroCard ? smooth(range(prog, 0.88, 1.0)) : smooth(range(p, 0.86, 0.98));

      // Inclinación 3D sutil cuando el lienzo está reencuadrado en la sala de proyección
      const tiltEnvelope = morph * (1 - outro);
      const targetRx = (!reduce && finePointer) ? (-normMy * 1.8 * tiltEnvelope) : 0;
      const targetRy = (!reduce && finePointer) ? (normMx * 2.4 * tiltEnvelope) : 0;
      this.tiltRx += (targetRx - this.tiltRx) * 0.1;
      this.tiltRy += (targetRy - this.tiltRy) * 0.1;
      st.setProperty("--seq-rx", `${this.tiltRx.toFixed(2)}deg`);
      st.setProperty("--seq-ry", `${this.tiltRy.toFixed(2)}deg`);

      let cover, blur, gray;
      if (isHero) {
        const veilFade = 1 - smooth(range(p, 0.0, 0.24));
        st.setProperty("--frame-veil", veilFade.toFixed(3));
        cover = outro * 0.38;
        blur = outro * 5;
        gray = 0;
      } else {
        st.setProperty("--frame-veil", "0");
        // Ni bien comienza a reproducirse la secuencia (p > -0.14), empieza de inmediato a desaparecer
        // el desenfoque óptico y el blanco y negro, disolviéndose rápido hacia el color pleno
        const wake = smooth(range(p, -0.14, 0.04));
        cover = Math.max((1 - wake) * 0.26, outro * 0.38);
        blur = Math.max((1 - wake) * 12, outro * 8);
        gray = 1 - wake;
      }
      st.setProperty("--cover-opacity", cover.toFixed(3));
      st.setProperty("--frame-opacity", this.outroCard ? "1" : (1 - outro * 0.65).toFixed(3));
      this.setVisualFilter(blur, gray);

      /* Textos frontales */
      if (this.hero) {
        const t = range(p, 0.0, 0.22);
        const stHero = smooth(t);
        this.setText(this.hero, 1 - stHero, -stHero * 3, stHero * 3.5);

        const hMeta = $(".hero__meta", this.hero);
        if (hMeta) {
          const metaOp = Math.max(0, 1 - smooth(range(p, 0.0, 0.11)));
          hMeta.style.opacity = metaOp.toFixed(3);
          hMeta.style.transform = `translate3d(0, ${(-stHero * 18).toFixed(1)}px, 0)`;
        }

        // Apertura espacial cinemática de las líneas del título
        const hTitle = $(".hero__title", this.hero);
        if (hTitle) {
          const l1 = $(".hero__line:nth-child(1)", hTitle);
          const l2 = $(".hero__line--2", hTitle);
          if (l1) {
            l1.style.setProperty("--hero-l1-x", `${(-stHero * 24).toFixed(1)}px`);
            l1.style.setProperty("--hero-l1-y", `${(-stHero * 16).toFixed(1)}px`);
          }
          if (l2) {
            l2.style.setProperty("--hero-l2-x", `${(stHero * 32).toFixed(1)}px`);
            l2.style.setProperty("--hero-l2-y", `${(stHero * 12).toFixed(1)}px`);
          }
        }
        const hFoot = $(".hero__foot", this.hero);
        if (hFoot) {
          hFoot.style.setProperty("--hero-foot-y", `${(stHero * 26).toFixed(1)}px`);
          hFoot.style.opacity = Math.max(0, 1 - smooth(range(p, 0.0, 0.12))).toFixed(3);
        }
      }
      if (this.lead) {
        // Contra-desplazamiento en la aproximación (viewportEntry: 0 -> 1) para que el título
        // de Obra II y Obra IV aparezca inmediatamente en la parte alta al deslizar
        const entryShiftVh = -(1 - smooth(viewportEntry)) * 18;
        const t = range(p, 0.0, 0.20);
        const stLead = smooth(t);
        this.setText(this.lead, 1 - stLead, entryShiftVh - stLead * 3.5, stLead * 4.5);

        const leadTitle = $(".lead__title", this.lead);
        if (leadTitle) {
          leadTitle.style.setProperty("--lead-ty", `${(-stLead * 28).toFixed(1)}px`);
          leadTitle.style.setProperty("--lead-scale", (1 - stLead * 0.03).toFixed(3));
        }
        const leadLines = $$(".lead__no i", this.lead);
        if (leadLines.length) {
          const lineW = Math.max(14, Math.round(36 * (1 - stLead * 0.6)));
          leadLines.forEach((l) => l.style.setProperty("--lead-line-w", `${lineW}px`));
        }
      }

      /* Rótulo, marcas y HUD compactos alrededor del cuadro y separándose suavemente */
      const chrome = smooth(range(p, 0.14, 0.26));
      const chromeGap = vw <= 640 ? 12 : 16;
      st.setProperty("--chrome-gap", `${chromeGap}px`);
      st.setProperty("--chrome-top-y", `${((1 - chrome) * 10).toFixed(1)}px`);
      st.setProperty("--chrome-bot-y", `${(-(1 - chrome) * 10).toFixed(1)}px`);

      if (this.isFiesta) {
        // En Obra II (Fiestas & Eventos):
        // 1. Proyección nítida de Vonharv y desvanecimiento previo del rótulo/marcas:
        //    El plano aéreo se reproduce nítido y claro sin desenfoque prematuro.
        //    Hacia p = 0.19..0.25, el rótulo y marcas se desvanecen suavemente para dejar limpia la toma antes del destello.
        const vonharvFade = 1 - smooth(range(p, 0.18, 0.24));
        const chromeOp = chrome * vonharvFade;
        st.setProperty("--chrome-opacity", chromeOp.toFixed(3));
        st.setProperty("--chrome-vis", chromeOp > 0.01 ? "visible" : "hidden");

        // 2. Reflejo blanco expansivo desde el centro hacia afuera (degradado ultra difuso, sin líneas ni límites):
        //    Inicia un poquitito antes (en p = 0.258, en el punto exacto del fogonazo blanco de Vonharv),
        //    con una transición suave, amplia y saboreable (hasta p = 0.298).
        //    Nace como un resplandor en degradé suave desde el centro (scale 0.12) y se abre en abanico
        //    360° hacia los extremos (scale 1.85) con un halo óptico completamente difuminado, consolidando
        //    la base blanca sólida (solidOp = 1.0 en p = 0.298) para tapar por completo y limpiamente a Vonharv.
        const glowT = range(p, 0.252, 0.292);
        const glowProg = smooth(glowT);
        const glowOp = smooth(range(p, 0.252, 0.268));
        const glowScale = 0.12 + Math.pow(glowProg, 0.70) * 1.73;
        const solidOp = smooth(range(p, 0.274, 0.292));

        st.setProperty("--fiesta-glow-op", glowOp.toFixed(3));
        st.setProperty("--fiesta-glow-scale", glowScale.toFixed(4));
        st.setProperty("--fiesta-solid-op", solidOp.toFixed(3));

        // 3. Aparición del díptico Randa (Randa I & II) sobre el fondo blanco:
        //    Una vez que el reflejo en degradé barrió la pantalla y consolidó el blanco puro (a partir de p = 0.300),
        //    emergen las dos secuencias horizontales apiladas una arriba de la otra sobre el lienzo blanco.
        const randaIntro = smooth(range(p, 0.294, 0.384));
        const randaOutro = smooth(range(p, 0.88, 1.20));

        const randaOp = randaIntro * (1 - smooth(range(p, 1.06, 1.22)));
        const randaScale = (0.96 + randaIntro * 0.04) - randaOutro * 0.035;
        const randaTy = (1 - randaIntro) * 20 - randaOutro * 22;
        const randaBlur = (randaOutro * 3.5).toFixed(1);

        st.setProperty("--randa-op", randaOp.toFixed(3));
        st.setProperty("--randa-scale", randaScale.toFixed(4));
        st.setProperty("--randa-ty", `${randaTy.toFixed(1)}px`);
        st.setProperty("--randa-blur", `${randaBlur}px`);
        st.setProperty("--randa-vis", randaOp > 0.005 ? "visible" : "hidden");

        // Desplazamiento simétrico de las tarjetas (separación sutil en profundidad durante el cierre hacia #obra)
        if (this.randaCards && this.randaCards.length >= 2) {
          const splitShift = (1 - randaIntro) * 16;
          const exitParting = randaOutro * 14;
          this.randaCards[0].style.transform = `translate3d(0, ${(-splitShift - exitParting).toFixed(1)}px, 0)`;
          this.randaCards[1].style.transform = `translate3d(0, ${(splitShift + exitParting).toFixed(1)}px, 0)`;
        }

        const cardBorderOp = (0.14 + (1 - randaOutro) * 0.14).toFixed(2);
        st.setProperty("--randa-card-border", `rgba(13, 13, 12, ${cardBorderOp})`);
        const cardGlowOp = (0.12 * Math.sin(randaOutro * Math.PI)).toFixed(3);
        st.setProperty("--randa-card-glow", `rgba(162, 113, 78, ${cardGlowOp})`);

        if (this.randaBadge) {
          if (p >= 0.94) {
            if (!this._randaCompleteSet) {
              this.randaBadge.innerHTML = '<span class="seq__randa-dot" aria-hidden="true"></span><span>Registro completado · Fiestas & Eventos</span>';
              this._randaCompleteSet = true;
            }
          } else {
            if (this._randaCompleteSet) {
              this.randaBadge.innerHTML = '<span class="seq__randa-dot" aria-hidden="true"></span><span>Extensión de rodaje · Fiestas & Eventos</span>';
              this._randaCompleteSet = false;
            }
          }
        }

        // 4. Reproducción sincronizada de Randa 1 y Randa 2:
        //    Comienza una vez que Randa aparece sobre el fondo blanco (a partir de p = 0.300),
        //    avanza fluidamente y continúa reproduciéndose en desaceleración suave
        //    mientras el usuario comienza a deslizar hacia #obra, manteniendo el movimiento vivo en la salida
        let pRanda = 0;
        if (p < 0.294) {
          pRanda = 0;
        } else if (p <= 1.0) {
          const randaPinT = clamp((p - 0.294) / (1.0 - 0.294));
          pRanda = randaPinT * 0.88;
        } else {
          const exitT = clamp((p - 1.0) / exitRange);
          pRanda = 0.88 + Math.sin(exitT * Math.PI * 0.5) * 0.12;
        }
        pRanda = clamp(pRanda, 0, 1);
        const targetRandaF = pRanda * (this.randaCount - 1);
        const kRanda = reduce ? 1 : 1 - Math.exp(-12 * dt);
        this.randaCur += (targetRandaF - this.randaCur) * kRanda;
        this.drawRanda(this.randaCur);

        const fR = Math.round(this.randaCur);
        if (fR !== this.lastRandaFr) {
          this.lastRandaFr = fR;
          const frTxt = pad(fR + 1, 3);
          if (this.randaFr1) this.randaFr1.textContent = frTxt;
          if (this.randaFr2) this.randaFr2.textContent = frTxt;
          const secR = Math.floor(fR / 24);
          const frR = fR % 24;
          if (this.randaTc) this.randaTc.textContent = `${pad(secR)}:${pad(frR)}`;
        }

        // El scrubber global muestra el avance completo de la sección
        if (this.scrubFill) this.scrubFill.style.width = `${(clamp(pRanda, 0, 1) * 100).toFixed(2)}%`;
      } else {
        st.setProperty("--chrome-opacity", chrome.toFixed(3));
        st.setProperty("--chrome-vis", chrome > 0.01 ? "visible" : "hidden");

        if (this.outroCard) {
          const outroCardT = smooth(range(p, 0.84, 0.94));
          st.setProperty("--outro-card-op", outroCardT.toFixed(3));
          st.setProperty("--outro-card-ty", `${((1 - outroCardT) * 16).toFixed(1)}px`);
          st.setProperty("--outro-card-pe", outroCardT > 0.2 ? "auto" : "none");
          this.updateOutroGleam(p, dt);
        }
      }

      /* Capítulos */
      let shade = 0;
      this.chapters.forEach(({ n: el, r: [a, b], tick }) => {
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (el.style.opacity !== "0") {
            el.style.opacity = "0";
            el.style.filter = "none";
          }
          el.style.setProperty("--ch-prog", "0");
          if (tick) tick.classList.remove("is-active");
          return;
        }
        const o = smooth(Math.min(range(t, 0, 0.16), 1 - range(t, 0.84, 1)));
        shade = Math.max(shade, o);
        el.style.opacity = o.toFixed(3);
        if (tick) tick.classList.toggle("is-active", o > 0.15);

        // Micro-desplazamiento vertical continuo y línea de cota arquitectónica
        const floatY = ((1 - o) * (t < 0.5 ? 12 : -8) + (t - 0.5) * -10).toFixed(1);
        el.style.transform = `translate3d(0, ${floatY}px, 0)`;
        el.style.setProperty("--ch-prog", o.toFixed(3));

        const chBlur = Math.max(0, (1 - o) * 2.2).toFixed(1);
        el.style.filter = chBlur > 0.2 ? `blur(${chBlur}px)` : "none";
      });
      st.setProperty("--shade", shade.toFixed(3));
      this.el.classList.toggle("has-chapter-glow", shade > 0.08);
    }
  }

  /* ---------------------------------------------------------
     FORMATO DUAL CENTRADO (16:9 ↔ 9:16)
     Metamorfosis matemática exacta desde 16:9 a 9:16 en el centro
     --------------------------------------------------------- */
  class FormatShowcaseSequence {
    constructor(el) {
      this.el = el;
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.version = el.dataset.version || "";
      this.fps = +el.dataset.fps || 25;

      this.stage = $(".format-showcase__stage", el);
      this.box = $(".format-showcase__box", el);
      this.player = $(".format-showcase__player", el);
      this.canvas = $(".format-showcase__canvas", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });

      this.badgeRatio = $("[data-format-ratio]", el);
      this.badgeStatus = $("[data-format-status]", el);
      this.resEl = $("[data-format-res]", el);
      this.fill = $("[data-format-fill]", el);
      this.frEl = $("[data-format-fr]", el);

      this.frames = [];
      this.cur = 0;
      this.lastCur = -1;
      this.dirty = true;
      this.token = 0;

      this.measure();
    }

    measure() {
      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(Math.min(vw * 0.88, 1060) * dpr);
      const ch = Math.round(cw * (1680 / 1920));
      if (this.canvas && (this.canvas.width !== cw || this.canvas.height !== ch)) {
        this.canvas.width = cw;
        this.canvas.height = ch;
      }
      this.dirty = true;
    }

    load() {
      if (this.frames.length) return;
      const heroSeq = sequences[0];
      if (heroSeq && heroSeq.src === this.src && heroSeq.frames && heroSeq.frames.length && heroSeq.set === "lg") {
        this.frames = heroSeq.frames;
        this.draw(0);
        return;
      }
      this.frames = new Array(this.count);
      const token = ++this.token;
      const queue = [0];
      for (let i = 3; i < this.count; i += 3) queue.push(i);
      if (!queue.includes(this.count - 1)) queue.push(this.count - 1);
      for (let i = 1; i < this.count; i++) {
        if (!queue.includes(i)) queue.push(i);
      }

      let qi = 0;
      const parallel = 4;
      const next = () => {
        if (token !== this.token || qi >= queue.length) return;
        const i = queue[qi++];
        const img = new Image();
        img.decoding = "async";
        const finish = (ok) => {
          if (token !== this.token) return;
          if (ok) {
            this.frames[i] = img;
            if (i === 0) this.draw(0);
            this.dirty = true;
          }
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        const vParam = this.version ? `?v=${this.version}` : (this.count ? `?v=${this.count}` : "");
        img.src = `${this.src}/lg/${pad(i + 1, 4)}.webp${vParam}`;
      };
      for (let k = 0; k < parallel; k++) next();
    }

    nearest(i) {
      if (this.frames[i]) return this.frames[i];
      const heroSeq = sequences[0];
      if (heroSeq && heroSeq.src === this.src && heroSeq.set === "lg" && heroSeq.frames && heroSeq.frames[i]) return heroSeq.frames[i];
      for (let d = 1; d < this.count; d++) {
        if (this.frames[i - d]) return this.frames[i - d];
        if (this.frames[i + d]) return this.frames[i + d];
        if (heroSeq && heroSeq.src === this.src && heroSeq.set === "lg" && heroSeq.frames) {
          if (heroSeq.frames[i - d]) return heroSeq.frames[i - d];
          if (heroSeq.frames[i + d]) return heroSeq.frames[i + d];
        }
      }
      return null;
    }

    draw(pos) {
      const f = Math.round(clamp(pos, 0, this.count - 1));
      const img = this.nearest(f);
      if (!img || !img.naturalWidth) return;
      if (this.lastDrawnImg === img) return;

      const c = this.canvas, ctx = this.ctx;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, 0, 0, cw, ch);
      this.lastDrawnImg = img;
    }

    update(dt) {
      if (!this.frames || !this.frames.length) this.load();
      const y = scrollY();
      if (y + vh < this.top - vh || y > this.top + this.len + vh) return;

      if (!this.frames.length) this.load();

      const viewportEntry = clamp((y + vh - this.top) / vh, 0, 1);
      const rawP = (y - this.top) / this.len;
      const p = clamp(rawP, 0, 1);

      // Pre-roll cinematográfico en aproximación previa + continuidad viva en la salida:
      const pPlayStart = -Math.min(0.50, (vh * 0.70) / this.len);
      const preShare = 0.055;
      const pinMaxProg = 0.88;
      const exitRange = 0.22;
      let prog = 0;
      if (rawP < pPlayStart) {
        prog = 0;
      } else if (rawP < 0) {
        const u = clamp((rawP - pPlayStart) / (-pPlayStart));
        prog = preShare * Math.pow(u, 1.35);
      } else if (rawP <= 1.0) {
        prog = preShare + rawP * (pinMaxProg - preShare);
      } else {
        const exitT = clamp((rawP - 1.0) / exitRange);
        prog = pinMaxProg + Math.sin(exitT * Math.PI * 0.5) * (1.0 - pinMaxProg);
      }
      prog = clamp(prog, 0, 1);

      // Contra-desplazamiento al entrar desde #servicios: el grupo compacto (título + reproductor 16:9 + barra)
      // arranca en la parte alta del bloque entrante (sin vacío) y se centra suavemente al fijarse.
      if (this.stage) {
        const entryShiftY = -(1 - smooth(viewportEntry)) * (vh * 0.16);
        this.stage.style.setProperty("--format-group-y", `${entryShiftY.toFixed(1)}px`);
      }

      const targetF = prog * (this.count - 1);
      const k = reduce ? 1 : 1 - Math.exp(-12 * dt);
      this.cur += (targetF - this.cur) * k;
      if (Math.abs(targetF - this.cur) < 0.002) this.cur = targetF;

      // Metamorfosis: inicia en 16:9 exacto, muta gradualmente y culmina en 9:16 exacto
      // Al estar header, box y footer agrupados (flex: 0 0 auto), conforme el player crece verticalmente
      // de 16:9 a 9:16, el propio crecimiento empuja de forma orgánica y progresiva el título y la barra.
      const morphT = smooth(range(p, 0.02, 0.72));
      const ratioH = 16 / 9; // 1.777778
      const ratioV = 9 / 16; // 0.5625
      const curRatio = ratioH + (ratioV - ratioH) * morphT;

      const isMobile = vw < 640;
      const isTablet = vw < 1024;
      const maxBoxW = Math.min(vw * (isMobile ? 0.90 : (isTablet ? 0.84 : 0.74)), 1060);
      const maxBoxH = Math.min(vh * (isMobile ? 0.48 : (isTablet ? 0.50 : 0.52)), 560);

      // Dimensiones guía para 16:9 y 9:16 (Open Gate sensor guides)
      if (this.box && !isMobile) {
        const ghH = Math.min(maxBoxH, maxBoxW / ratioH);
        const ghW = ghH * ratioH;
        const gvH = maxBoxH;
        const gvW = gvH * ratioV;
        const guideOp = Math.sin(morphT * Math.PI) * 0.85;
        this.box.style.setProperty("--guide-h-w", `${Math.round(ghW)}px`);
        this.box.style.setProperty("--guide-h-h", `${Math.round(ghH)}px`);
        this.box.style.setProperty("--guide-v-w", `${Math.round(gvW)}px`);
        this.box.style.setProperty("--guide-v-h", `${Math.round(gvH)}px`);
        this.box.style.setProperty("--guide-op", guideOp.toFixed(3));
      }

      const wForMaxH = maxBoxH * curRatio;
      let fw, fh;
      if (wForMaxH <= maxBoxW) {
        fh = maxBoxH;
        fw = wForMaxH;
      } else {
        fw = maxBoxW;
        fh = fw / curRatio;
      }

      fw = Math.round(fw);
      fh = Math.round(fh);

      this.player.style.setProperty("--player-w", `${fw}px`);
      this.player.style.setProperty("--player-h", `${fh}px`);

      if (Math.abs(this.cur - this.lastCur) > 0.002 || this.dirty) {
        this.draw(this.cur);
        this.lastCur = this.cur;
        this.dirty = false;

        const f = Math.round(this.cur);
        if (this.frEl) this.frEl.textContent = pad(f + 1, 3);
        if (this.fill) this.fill.style.width = `${(p * 100).toFixed(1)}%`;
      }

      if (this.resEl) {
        const resW = Math.round(3840 + (2160 - 3840) * morphT);
        const resH = Math.round(2160 + (3840 - 2160) * morphT);
        this.resEl.textContent = `${resW} × ${resH} PX`;
      }

      if (this.badgeRatio) {
        if (morphT < 0.10) {
          this.badgeRatio.textContent = "16:9";
          if (this.badgeStatus) this.badgeStatus.textContent = "Máster Horizontal";
        } else if (morphT > 0.90) {
          this.badgeRatio.textContent = "9:16";
          if (this.badgeStatus) this.badgeStatus.textContent = "Corte Vertical Nativo";
        } else {
          this.badgeRatio.textContent = "16:9 ↔ 9:16";
          if (this.badgeStatus) this.badgeStatus.textContent = "Transformación en vivo";
        }
      }
    }
  }

  /* ---------------------------------------------------------
     COREOGRAFÍA ESPACIAL DE VUELO (3D Matrix Sequence)
     Transición 3D de entrada rápida, nivelación en encuadre central,
     expansión continua a pantalla completa como fondo inmersivo.
     --------------------------------------------------------- */
  class FlightChoreographySequence {
    constructor(el) {
      this.el = el;
      this.src = el.dataset.src || "assets/seq/epecuen";
      this.count = +el.dataset.count || 179;
      this.fps = +el.dataset.fps || 24;

      this.stage = $(".choreo__stage", el);
      this.stageBox = $(".choreo__stage-box", el);
      this.deck = $("[data-choreo-deck]", el);
      this.canvas = $("[data-choreo-canvas]", el);
      this.ctx = this.canvas ? this.canvas.getContext("2d", { alpha: false }) : null;

      this.bpCanvas = $("[data-choreo-blueprint]", el);
      this.bpCtx = this.bpCanvas ? this.bpCanvas.getContext("2d") : null;

      this.livePhaseEl = $("[data-choreo-live-phase]", el);
      this.ruler = $("[data-choreo-ruler]", el);
      this.progressFill = $("[data-choreo-progress-fill]", el);
      this.progressTrack = $(".choreo__progress-track", el);
      this.frEl = $("[data-choreo-fr]", el);
      this.tcEl = $("[data-choreo-tc]", el);
      this.statusPill = $("[data-choreo-status-pill]", el);
      this.phaseLabel = $("[data-choreo-phase-label]", el);

      this.speedEl = $("[data-choreo-speed]", el);
      this.altEl = $("[data-choreo-alt]", el);
      this.dynEl = $("[data-choreo-dyn]", el);
      this.coordsEl = $("[data-choreo-coords]", el);
      this.pitchEl = $("[data-choreo-pitch]", el);
      this.rollEl = $("[data-choreo-roll]", el);
      this.horizonEl = $("[data-choreo-horizon]", el);

      this.outroCard = $("[data-choreo-outro]", el);
      this.outroGleamOp = 0;

      this.cur = 0;
      this.lastCur = -1;
      this.lastAct = -1;
      this.lastTickFr = -1;
      this.dirty = true;
      this.isPortrait = false;
      this.fullScale = 1.0;
      this.expandShiftY = 0;

      this.mouseTargetX = 0;
      this.mouseTargetY = 0;
      this.mouseCurrentX = 0;
      this.mouseCurrentY = 0;

      this.frames = [];
      this.token = 0;

      this.initRuler();
      this.bindEvents();
      this.measure();
    }

    load() {
      if (this.frames && this.frames.length) return;
      const heroSeq = sequences[0];
      if (heroSeq && heroSeq.src === this.src && heroSeq.frames && heroSeq.frames.length && heroSeq.set === "lg") {
        this.frames = heroSeq.frames;
        this.drawVideo(0);
        return;
      }
      this.frames = new Array(this.count);
      const token = ++this.token;
      const queue = [0];
      for (let i = 3; i < this.count; i += 3) queue.push(i);
      if (!queue.includes(this.count - 1)) queue.push(this.count - 1);
      for (let i = 1; i < this.count; i++) {
        if (!queue.includes(i)) queue.push(i);
      }

      let qi = 0;
      const parallel = 4;
      const next = () => {
        if (token !== this.token || qi >= queue.length) return;
        const i = queue[qi++];
        const img = new Image();
        img.decoding = "async";
        const finish = (ok) => {
          if (token !== this.token) return;
          if (ok) {
            this.frames[i] = img;
            if (i === 0) this.dirty = true;
          }
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        const vParam = this.version ? `?v=${this.version}` : (this.count ? `?v=${this.count}` : "");
        img.src = `${this.src}/lg/${pad(i + 1, 4)}.webp${vParam}`;
      };
      for (let k = 0; k < parallel; k++) next();
    }

    initRuler() {
      if (!this.ruler) return;
      const distances = ["0.5m", "1.0m", "1.5m", "2.0m", "2.5m", "3.0m", "4.0m", "5.0m", "8.0m", "12m", "∞"];
      const frag = document.createDocumentFragment();
      for (let i = 0; i <= 60; i++) {
        const tick = document.createElement("span");
        if (i % 6 === 0) {
          tick.className = "choreo__lens-tick choreo__lens-tick--major";
          const distIdx = Math.floor(i / 6);
          if (distances[distIdx]) {
            const lbl = document.createElement("span");
            lbl.textContent = distances[distIdx];
            tick.appendChild(lbl);
          }
        } else if (i % 3 === 0) {
          tick.className = "choreo__lens-tick choreo__lens-tick--med";
        } else {
          tick.className = "choreo__lens-tick";
        }
        frag.appendChild(tick);
      }
      this.ruler.appendChild(frag);
    }

    bindEvents() {
      if (this.progressTrack) {
        const seek = (e) => {
          const rect = this.progressTrack.getBoundingClientRect();
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          if (clientX === undefined) return;
          const p = clamp((clientX - rect.left) / rect.width);
          const y = this.top + p * this.len;
          if (scrollContainer && isVerticalScroller()) scrollToTarget(y, { immediate: true });
          else if (lenis) lenis.scrollTo(y, { immediate: true });
          else window.scrollTo(0, y);
        };
        this.progressTrack.addEventListener("click", seek);
      }

      if (finePointer && this.stage) {
        this.stage.addEventListener("mousemove", (e) => {
          const rect = this.stage.getBoundingClientRect();
          this.mouseTargetX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
          this.mouseTargetY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        }, { passive: true });
        this.stage.addEventListener("mouseleave", () => {
          this.mouseTargetX = 0;
          this.mouseTargetY = 0;
        });
      }
    }

    measure() {
      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.isPortrait = (vw / vh < 0.9) || (vw <= 768);

      let deckW, deckH;
      if (this.isPortrait) {
        // En vertical / móvil: formato 8:7 nativo Open Gate de máxima resolución
        const availH = Math.max(200, vh - 220);
        const maxDeckWByHeight = Math.round(availH * (8 / 7));
        deckW = Math.round(Math.min(vw * 0.88, 340, maxDeckWByHeight));
        deckH = Math.round(deckW * (7 / 8));
      } else {
        // En horizontal / escritorio: ratio 16:9 amplio respetando despeje superior e inferior
        const navClearance = Math.min(108, Math.max(88, vh * 0.11));
        const botPad = Math.min(26, Math.max(16, vh * 0.025));
        const reservedV = navClearance + botPad + 185;
        const availH = Math.max(220, Math.floor(vh - reservedV));
        const maxDeckWByHeight = Math.round(availH * (16 / 9));
        deckW = Math.round(Math.min(vw * 0.82, 1020, maxDeckWByHeight));
        deckH = Math.round(deckW * 9 / 16);
      }

      this.deckW = deckW;
      this.deckH = deckH;
      this.fullScale = Math.max(vw / deckW, vh / deckH) * 1.08;

      if (this.isPortrait) {
        this.approachShiftY = Math.max(0, Math.min(185, Math.round((vh - 80 - (deckH + 148)) * 0.48)));
      } else {
        this.approachShiftY = Math.max(0, Math.min(115, Math.round((vh - 96 - (deckH + 156)) * 0.45)));
      }

      if (this.stage) {
        this.stage.style.setProperty("--deck-w", `${deckW}px`);
        this.stage.style.setProperty("--deck-h", `${deckH}px`);
      }
      if (this.deck) {
        this.deck.style.setProperty("--deck-w", `${deckW}px`);
        this.deck.style.setProperty("--deck-h", `${deckH}px`);
      }

      // Dimensiones de máxima resolución para que al expandirse a pantalla completa se mantenga cristalino
      const targetW = Math.max(deckW * this.fullScale, vw);
      let cw, ch;
      if (this.isPortrait) {
        // Formato 8:7 nativo Open Gate (1920x1680)
        cw = Math.round(Math.min(targetW, 1920) * dpr);
        ch = Math.round(cw * (7 / 8));
      } else {
        cw = Math.round(Math.min(targetW, 1920) * dpr);
        ch = Math.round(cw * (9 / 16));
      }

      [this.canvas, this.bpCanvas].forEach((c) => {
        if (c && (c.width !== cw || c.height !== ch)) {
          c.width = cw;
          c.height = ch;
        }
      });

      // El stage-box está centrado en el centro geométrico de la pantalla (50% / 50%)
      this.expandShiftY = 0;

      this.dirty = true;
    }

    getChoreoFrame(frameIdx) {
      const f = Math.round(clamp(frameIdx, 0, this.count - 1));
      if (this.frames && this.frames[f] && this.frames[f].naturalWidth) {
        return this.frames[f];
      }
      if (this.frames && this.frames.length) {
        for (let d = 1; d < 25; d++) {
          if (f - d >= 0 && this.frames[f - d]?.naturalWidth) return this.frames[f - d];
          if (f + d < this.count && this.frames[f + d]?.naturalWidth) return this.frames[f + d];
        }
      }
      const heroSeq = sequences[0];
      if (heroSeq && heroSeq.src === this.src && heroSeq.frames && heroSeq.frames[f] && heroSeq.frames[f].naturalWidth) {
        return heroSeq.frames[f];
      }
      if (heroSeq && typeof heroSeq.nearest === "function" && heroSeq.src === this.src) {
        return heroSeq.nearest(f);
      }
      return null;
    }

    drawImageCover(ctx, img, cw, ch) {
      if (!ctx || !img || !img.naturalWidth) return;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const targetAspect = cw / ch;
      const imgAspect = iw / ih;

      let cropW, cropH;
      if (targetAspect >= imgAspect) {
        cropW = iw;
        cropH = Math.round(iw / targetAspect);
      } else {
        cropH = ih;
        cropW = Math.round(ih * targetAspect);
      }
      const cropX = Math.max(0, Math.round((iw - cropW) / 2));
      const cropY = Math.max(0, Math.round((ih - cropH) / 2));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cw, ch);
    }

    drawVideo(pos) {
      if (!this.canvas || !this.ctx) return;
      const img = this.getChoreoFrame(pos);
      if (!img || !img.naturalWidth) return;
      if (this.lastDrawnImg === img) return;
      this.drawImageCover(this.ctx, img, this.canvas.width, this.canvas.height);
      this.lastDrawnImg = img;
    }

    drawBlueprint(p) {
      if (!this.bpCanvas || !this.bpCtx) return;
      const ctx = this.bpCtx;
      const w = this.bpCanvas.width, h = this.bpCanvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "#090b0d";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(236, 232, 225, 0.06)";
      ctx.lineWidth = 1;
      const step = Math.round(Math.min(w, h) / 12);
      for (let x = step; x < w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = step; y < h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(236, 232, 225, 0.35)";

      if (this.isPortrait) {
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(w * 0.10, h * 0.06, w * 0.80, h * 0.88);
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(236, 232, 225, 0.05)";
        ctx.fillRect(w * 0.16, h * 0.12, w * 0.68, h * 0.22);
        ctx.strokeRect(w * 0.16, h * 0.12, w * 0.68, h * 0.22);

        ctx.fillStyle = "rgba(162, 113, 78, 0.14)";
        ctx.fillRect(w * 0.38, h * 0.34, w * 0.24, h * 0.06);
        ctx.strokeRect(w * 0.38, h * 0.34, w * 0.24, h * 0.06);

        ctx.fillRect(w * 0.16, h * 0.40, w * 0.68, h * 0.24);
        ctx.strokeRect(w * 0.16, h * 0.40, w * 0.68, h * 0.24);

        ctx.fillStyle = "rgba(120, 180, 220, 0.15)";
        ctx.strokeStyle = "rgba(140, 200, 240, 0.5)";
        ctx.fillRect(w * 0.22, h * 0.68, w * 0.56, h * 0.20);
        ctx.strokeRect(w * 0.22, h * 0.68, w * 0.56, h * 0.20);
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(w * 0.05, h * 0.12, w * 0.90, h * 0.76);
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(236, 232, 225, 0.04)";
        ctx.fillRect(w * 0.20, h * 0.22, w * 0.22, h * 0.56);
        ctx.strokeRect(w * 0.20, h * 0.22, w * 0.22, h * 0.56);

        ctx.fillRect(w * 0.46, h * 0.26, w * 0.26, h * 0.48);
        ctx.strokeRect(w * 0.46, h * 0.26, w * 0.26, h * 0.48);

        ctx.fillStyle = "rgba(162, 113, 78, 0.12)";
        ctx.fillRect(w * 0.42, h * 0.38, w * 0.04, h * 0.24);
        ctx.strokeRect(w * 0.42, h * 0.38, w * 0.04, h * 0.24);

        ctx.fillStyle = "rgba(120, 180, 220, 0.15)";
        ctx.strokeStyle = "rgba(140, 200, 240, 0.5)";
        ctx.fillRect(w * 0.75, h * 0.30, w * 0.16, h * 0.40);
        ctx.strokeRect(w * 0.75, h * 0.30, w * 0.16, h * 0.40);
      }

      const getPos = (t) => {
        if (this.isPortrait) {
          const py0 = { x: w * 0.50, y: h * 0.08 };
          const py1 = { x: w * 0.50, y: h * 0.30 };
          const py3 = { x: w * 0.50, y: h * 0.70 };
          const py4 = { x: w * 0.50, y: h * 0.86 };
          const omt = 1 - t;
          return {
            x: w * 0.50 + Math.sin(t * Math.PI * 2) * (w * 0.06),
            y: omt * omt * omt * py0.y + 3 * omt * omt * t * py1.y + 3 * omt * t * t * py3.y + t * t * t * py4.y,
          };
        } else {
          const p0 = { x: w * 0.08, y: h * 0.50 };
          const p1 = { x: w * 0.30, y: h * 0.50 };
          const p2 = { x: w * 0.44, y: h * 0.48 };
          const p3 = { x: w * 0.62, y: h * 0.45 };
          const p4 = { x: w * 0.84, y: h * 0.50 };
          if (t <= 0.5) {
            const u = t * 2, omt = 1 - u;
            return {
              x: omt * omt * p0.x + 2 * omt * u * p1.x + u * u * p2.x,
              y: omt * omt * p0.y + 2 * omt * u * p1.y + u * u * p2.y,
            };
          } else {
            const u = (t - 0.5) * 2, omt = 1 - u;
            return {
              x: omt * omt * p2.x + 2 * omt * u * p3.x + u * u * p4.x,
              y: omt * omt * p2.y + 2 * omt * u * p3.y + u * u * p4.y,
            };
          }
        }
      };

      ctx.strokeStyle = "rgba(236, 232, 225, 0.2)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let s = 0; s <= 40; s++) {
        const pt = getPos(s / 40);
        if (s === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "#e2ddd4";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(236, 232, 225, 0.7)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const steps = Math.max(1, Math.round(p * 40));
      for (let s = 0; s <= steps; s++) {
        const pt = getPos(s / 40);
        if (s === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      const dronePt = getPos(p);
      const nextPt = getPos(Math.min(1, p + 0.02));
      const angle = Math.atan2(nextPt.y - dronePt.y, nextPt.x - dronePt.x);

      ctx.save();
      ctx.translate(dronePt.x, dronePt.y);
      ctx.rotate(angle);

      const fovLen = Math.round(Math.min(w, h) * 0.12);
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, fovLen);
      grad.addColorStop(0, "rgba(236, 232, 225, 0.45)");
      grad.addColorStop(1, "rgba(236, 232, 225, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, fovLen, -0.65, 0.65);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#ece8e1";
      ctx.lineWidth = 1.5;
      ctx.fillStyle = "#a2714e";
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    }

    update(dt) {
      if (!this.frames || !this.frames.length) this.load();
      const y = scrollY();
      const approachWindow = Math.max(260, vh * 0.78);
      const exitWindow = Math.max(260, vh * 0.65);

      if (y + vh < this.top - approachWindow || y > this.top + this.len + exitWindow + vh) return;

      const isApproaching = y < this.top;
      const isExiting = y > this.top + this.len;
      const isPinned = !isApproaching && !isExiting;

      const entryProgress = clamp(1 - (this.top - y) / approachWindow);
      const p = clamp((y - this.top) / this.len);
      const exitProgress = isExiting ? clamp((y - (this.top + this.len)) / exitWindow) : 0;

      const pinnedEndF = 24 + Math.round(0.88 * (this.count - 1 - 24));
      let targetF;
      if (isApproaching) {
        targetF = entryProgress * 24;
      } else if (isPinned) {
        targetF = 24 + p * (pinnedEndF - 24);
      } else {
        targetF = pinnedEndF + Math.sin(exitProgress * Math.PI * 0.5) * (this.count - 1 - pinnedEndF);
      }

      const k = reduce ? 1 : 1 - Math.exp(-14 * dt);
      this.cur += (targetF - this.cur) * k;
      if (Math.abs(targetF - this.cur) < 0.002) this.cur = targetF;

      if (finePointer) {
        this.mouseCurrentX += (this.mouseTargetX - this.mouseCurrentX) * 0.08;
        this.mouseCurrentY += (this.mouseTargetY - this.mouseCurrentY) * 0.08;
      } else {
        this.mouseCurrentX = 0;
        this.mouseCurrentY = 0;
      }

      const groupShiftY = isApproaching
        ? (-(1 - smooth(entryProgress)) * (this.approachShiftY || 0))
        : 0;

      if (this.stage) {
        this.stage.style.setProperty("--choreo-group-y", `${groupShiftY.toFixed(1)}px`);
        this.stage.style.setProperty("--choreo-head-y", "0px");
        this.stage.style.setProperty("--choreo-foot-y", "0px");
      }

      let deckRx = 0, deckRy = 0, deckRz = 0, deckScale = 1;
      let bpZ = -100, bpOpacity = 0;
      let mediaZ = 0;
      let hudZ = 0;
      let exitGlare = 0;
      let activeAct = 0;
      let phaseTxt = "Aproximación y Nivelación 3D";
      let tExpand = 0;

      const baseScale = this.isPortrait ? 1.02 : 1.0;
      const fullScale = (this.fullScale || Math.max(vw / Math.max(1, this.deckW || 1), vh / Math.max(1, this.deckH || 1))) * 1.08;

      if (isApproaching) {
        // ENTRADA: Inicia en 3D y se va nivelando con el scroll
        activeAct = 0;
        phaseTxt = "Aproximación y Nivelación 3D";
        const tLevel = smooth(entryProgress);
        const oneMinus = 1 - tLevel;

        if (this.isPortrait) {
          deckRx = oneMinus * 18;
          deckRy = oneMinus * -18;
          deckRz = oneMinus * 1.5;
          bpZ = oneMinus * -90;
          hudZ = oneMinus * 50;
          deckScale = 0.94 + tLevel * (baseScale - 0.94);
        } else {
          deckRx = oneMinus * 20;
          deckRy = oneMinus * -24;
          deckRz = oneMinus * 2;
          bpZ = oneMinus * -125;
          hudZ = oneMinus * 85;
          deckScale = 0.92 + tLevel * (baseScale - 0.92);
        }
        bpOpacity = oneMinus * 0.95;
        mediaZ = oneMinus * 12;
        tExpand = 0;

      } else if (isPinned) {
        // TRAMO FIJADO: El deck permanece 100% plano (0deg), estabilizado y sin inclinación
        deckRx = 0;
        deckRy = 0;
        deckRz = 0;
        bpOpacity = 0;
        hudZ = 0;
        exitGlare = 0;

        // Expansión continua a pantalla completa:
        // En p <= 0.20: recuadro centrado en tamaño base.
        // En p de 0.20 a 0.40: se agranda progresivamente hasta cubrir toda la pantalla.
        // En p >= 0.40: queda como fondo de pantalla de toda la pantalla durante el resto del vuelo.
        tExpand = smooth(range(p, 0.20, 0.40));
        deckScale = baseScale + tExpand * (fullScale - baseScale);

        if (p <= 0.20) {
          activeAct = 1;
          phaseTxt = "Acto I · Vuelo Estabilizado";
        } else if (p < 0.40) {
          activeAct = 2;
          phaseTxt = "Acto II · Expansión Inmersiva";
        } else if (p <= 0.85) {
          activeAct = 2;
          phaseTxt = "Acto II · Vuelo a Pantalla Completa";
        } else {
          activeAct = 3;
          phaseTxt = "Acto III · Telemetría y Cierre de Vuelo";
        }

      } else {
        // SALIDA: El video se mantiene en pantalla completa como fondo continuo y transiciona suavemente hacia la siguiente obra
        activeAct = 4;
        phaseTxt = "Descenso · Siguiente Obra";
        tExpand = 1;
        deckScale = fullScale;
        deckRx = 0;
        deckRy = 0;
        deckRz = 0;
        bpOpacity = 0;
        const tExit = smooth(exitProgress);
        exitGlare = tExit * 0.45;
      }

      // Parallax de raton sutil atenuado al estar a pantalla completa
      if (!reduce && activeAct !== 1) {
        const mouseWeight = 1 - tExpand * 0.8;
        deckRx += this.mouseCurrentY * -3.5 * mouseWeight;
        deckRy += this.mouseCurrentX * 5.0 * mouseWeight;
      }

      // Variables reactivas en el Deck y Stage
      const frameBorderOp = 0.18 * (1 - tExpand);
      const frameShadowOp = 0.75 * (1 - tExpand);
      const frameRadius = 2 * (1 - tExpand);
      const hudOp = 1 - tExpand;

      if (this.stage) {
        this.stage.style.setProperty("--choreo-expand", tExpand.toFixed(3));
      }

      if (this.deck) {
        const deckTy = (this.expandShiftY || 0) * tExpand;
        this.deck.style.setProperty("--deck-ty", `${deckTy.toFixed(1)}px`);
        this.deck.style.setProperty("--deck-rx", `${deckRx.toFixed(2)}deg`);
        this.deck.style.setProperty("--deck-ry", `${deckRy.toFixed(2)}deg`);
        this.deck.style.setProperty("--deck-rz", `${deckRz.toFixed(2)}deg`);
        this.deck.style.setProperty("--deck-scale", `${deckScale.toFixed(3)}`);
        this.deck.style.setProperty("--bp-z", `${bpZ.toFixed(1)}px`);
        this.deck.style.setProperty("--bp-opacity", `${bpOpacity.toFixed(2)}`);
        this.deck.style.setProperty("--media-z", `${mediaZ.toFixed(1)}px`);
        this.deck.style.setProperty("--hud-z", `${hudZ.toFixed(1)}px`);
        this.deck.style.setProperty("--sat-opacity", "0");
        this.deck.style.setProperty("--exit-glare", `${exitGlare.toFixed(2)}`);
        this.deck.style.setProperty("--choreo-border-op", frameBorderOp.toFixed(3));
        this.deck.style.setProperty("--choreo-shadow-op", frameShadowOp.toFixed(3));
        this.deck.style.setProperty("--choreo-radius", `${frameRadius.toFixed(1)}px`);
        this.deck.style.setProperty("--choreo-hud-op", hudOp.toFixed(3));
      }

      if (activeAct !== this.lastAct) {
        this.lastAct = activeAct;
        playTactileTick(600 + activeAct * 60, 0.03, 0.04);
      }

      const curIntFr = Math.round(this.cur);
      if (Math.abs(curIntFr - this.lastTickFr) >= 14) {
        this.lastTickFr = curIntFr;
        playTactileTick(880, 0.015, 0.012);
      }

      const tExitVal = isExiting ? smooth(exitProgress) : 0;
      const speed = isApproaching
        ? (12.0 + entryProgress * 4.4)
        : (isPinned
          ? (16.4 + 5.2 * Math.sin(p * Math.PI) + 1.1 * Math.cos(p * Math.PI * 4))
          : ((16.4 + 5.2 * Math.sin(Math.PI) + 1.1) * (1 - tExitVal) + 4.2 * tExitVal));
      const alt = isApproaching
        ? (2.40 - entryProgress * 0.52)
        : (isPinned
          ? Math.max(0.9, 1.88 - 0.76 * smooth(p) + 0.12 * Math.sin(p * Math.PI * 5))
          : (1.12 * (1 - tExitVal) + 0.85 * tExitVal));
      const pitch = isApproaching
        ? (-8.0 + entryProgress * 4.2)
        : (isPinned ? (-3.8 + 4.9 * p) : (1.1 * (1 - tExitVal) - 0.4 * tExitVal));
      const roll = isApproaching
        ? (-4.0 * (1 - entryProgress))
        : (isPinned ? (-3.2 * Math.sin(p * Math.PI * 3)) : (-1.2 * (1 - tExitVal)));
      const dyn = isApproaching
        ? 0.06
        : (isPinned ? (0.08 + 0.14 * Math.abs(Math.cos(p * Math.PI * 3))) : (0.08 * (1 - tExitVal) + 0.02 * tExitVal));
      const coordX = isApproaching
        ? (12.4 + entryProgress * 2.0).toFixed(1)
        : (isPinned ? (12.4 + p * 16.8).toFixed(1) : (29.2 + tExitVal * 2.6).toFixed(1));
      const coordY = isApproaching
        ? (-14.2 + entryProgress * 1.5).toFixed(1)
        : (isPinned ? (-14.2 + p * 8.5).toFixed(1) : (-5.7 + tExitVal * 1.2).toFixed(1));

      if (this.speedEl) this.speedEl.textContent = speed.toFixed(1);
      if (this.altEl) this.altEl.textContent = alt.toFixed(2);
      if (this.dynEl) this.dynEl.textContent = dyn.toFixed(2);
      if (this.pitchEl) this.pitchEl.textContent = `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`;
      if (this.rollEl) this.rollEl.textContent = `ROLL ${roll >= 0 ? "+" : ""}${roll.toFixed(1)}°`;
      if (this.coordsEl) this.coordsEl.textContent = `X: +${coordX}m · Y: ${coordY}m · Z: +${alt.toFixed(2)}m`;
      if (this.horizonEl) this.horizonEl.style.setProperty("--horizon-roll", `${roll.toFixed(2)}deg`);
      if (this.phaseLabel) this.phaseLabel.textContent = phaseTxt;
      if (this.livePhaseEl) this.livePhaseEl.textContent = phaseTxt;

      const effectiveP = isApproaching
        ? (entryProgress * 0.10)
        : (isPinned ? p : (0.88 + Math.sin(exitProgress * Math.PI * 0.5) * 0.12));
      if (this.ruler) {
        const rulerTx = (-effectiveP * 320).toFixed(1);
        this.ruler.style.setProperty("--ruler-tx", `${rulerTx}px`);
      }

      if (this.progressFill) {
        this.progressFill.style.width = isApproaching ? "0%" : `${(effectiveP * 100).toFixed(1)}%`;
      }

      const curFr = Math.round(this.cur);
      if (this.frEl) this.frEl.textContent = pad(curFr + 1, 3);
      if (this.tcEl) {
        const elapsedSec = (curFr / this.fps);
        const mm = Math.floor(elapsedSec / 60);
        const ss = Math.floor(elapsedSec % 60);
        const ms = Math.floor((elapsedSec % 1) * 100);
        this.tcEl.textContent = `${pad(mm, 2)}:${pad(ss, 2)}.${pad(ms, 2)}`;
      }
      if (this.statusPill) {
        this.statusPill.textContent = phaseTxt;
      }

      if (this.outroCard) {
        let outroT = 0;
        if (isPinned) {
          outroT = smooth(range(p, 0.78, 0.91));
        } else if (isExiting) {
          outroT = smooth(range(1 - exitProgress, 0.05, 0.40));
        }
        this.outroCard.style.setProperty("--outro-card-op", outroT.toFixed(3));
        this.outroCard.style.setProperty("--outro-card-ty", `${((1 - outroT) * 16).toFixed(1)}px`);
        this.outroCard.style.setProperty("--outro-card-pe", outroT > 0.2 ? "auto" : "none");
        if (this.stage) {
          this.stage.style.setProperty("--choreo-head-op", (1 - outroT * 0.85).toFixed(3));
          this.stage.style.setProperty("--choreo-foot-op", (1 - outroT * 0.85).toFixed(3));
        }
        if (outroT > 0.02) {
          this.updateOutroGleam(p, dt);
        }
      }

      if (Math.abs(this.cur - this.lastCur) > 0.002 || this.dirty) {
        this.drawVideo(this.cur);
        this.drawBlueprint(effectiveP);
        this.lastCur = this.cur;
        this.dirty = false;
      }
    }

    updateOutroGleam(p, dt) {
      if (!this.outroCard) return;
      const targetOp = smooth(range(p, 0.78, 0.88));
      if (targetOp <= 0.001) {
        if (this.outroGleamOp !== 0) {
          this.outroCard.style.setProperty("--outro-gleam-op", "0");
          this.outroGleamOp = 0;
        }
        return;
      }
      const targetAngle = 45 + (p - 0.78) * 540;
      if (this.gleamAngle === undefined) this.gleamAngle = targetAngle;
      const kAngle = dt ? Math.min(1, 1 - Math.exp(-14 * dt)) : 0.20;
      let diff = (targetAngle - this.gleamAngle) % 360;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this.gleamAngle += diff * kAngle;
      this.outroGleamOp = targetOp;
      this.outroCard.style.setProperty("--outro-gleam-op", targetOp.toFixed(3));
      this.outroCard.style.setProperty("--gradient-angle", `${this.gleamAngle.toFixed(1)}deg`);
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));
  const formatEl = $(".format-showcase");
  const formatSeq = formatEl ? new FormatShowcaseSequence(formatEl) : null;
  const choreoEl = $(".choreo");
  const choreoSeq = choreoEl ? new FlightChoreographySequence(choreoEl) : null;

  /* ---------------------------------------------------------
     PRELOADER — contador suave con duración mínima
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  const tStart = performance.now();
  let loadTarget = 0, loadShown = 0, ready = false;

  function tickLoader(now) {
    if (ready) return;
    const minT = reduce ? 0 : 3400;
    const timeCap = clamp((now - tStart) / minT);
    const goal = Math.min(loadTarget, reduce ? 1 : timeCap);
    loadShown += (goal - loadShown) * 0.08;
    if (goal - loadShown < 0.002) loadShown = goal;
    if (loaderCount) loaderCount.textContent = pad(Math.round(loadShown * 100), 3);
    if (loaderBar) loaderBar.style.transform = `scaleX(${loadShown.toFixed(4)})`;
    if (loadShown >= 0.999) return setReady();
    requestAnimationFrame(tickLoader);
  }
  requestAnimationFrame(tickLoader);

  function setReady() {
    if (ready) return;
    ready = true;
    if (loaderCount) loaderCount.textContent = "100";
    if (loaderBar) loaderBar.style.transform = "scaleX(1)";
    body.classList.add("is-ready");
    body.classList.remove("is-loading");
    if (lenis) lenis.start();
    measureAll();
    // Archivo: precarga diferida para que la galería horizontal no tenga saltos.
    setTimeout(() => $$(".arc img").forEach((img) => { img.loading = "eager"; }), 2500);
  }

  if (sequences.length) {
    let p0 = 0, p1 = 0;
    const updateBoth = () => { loadTarget = Math.max(loadTarget, (p0 + p1) * 0.5); };
    sequences[0].load(undefined, (p) => { p0 = p; updateBoth(); });

    // Cartografía de Vuelo (#trazado) se precarga durante la pantalla de carga inicial
    if (sequences[1]) {
      sequences[1].load(undefined, (p) => { p1 = p; updateBoth(); });
    }

    // Precarga anticipada de Anacleto (Obra IV) en segundo plano para que esté lista al llegar
    setTimeout(() => {
      const anacleto = sequences.find((s) => s.el && (s.el.id === "film-04" || (s.src && s.src.includes("anacleto"))));
      if (anacleto && !anacleto.set) anacleto.load();
    }, 1500);

    const obsRoot = (scrollContainer && isVerticalScroller()) ? scrollContainer : null;
    const seqLoader = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const s = sequences.find((x) => x.el === en.target);
        if (s && !s.set) s.load();
        seqLoader.unobserve(en.target);
      });
    }, { root: obsRoot, rootMargin: "1600px 0px" });
    sequences.slice(1).forEach((s) => seqLoader.observe(s.el));

    if (choreoEl) {
      const choreoObs = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && choreoSeq) {
            choreoSeq.load();
            choreoObs.unobserve(en.target);
          }
        });
      }, { rootMargin: "1600px 0px" });
      choreoObs.observe(choreoEl);
    }
    if (formatEl) {
      const formatObs = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && formatSeq) {
            formatSeq.load();
            formatObs.unobserve(en.target);
          }
        });
      }, { rootMargin: "900px 0px" });
      formatObs.observe(formatEl);
    }
  } else {
    loadTarget = 1;
  }
  setTimeout(() => { loadTarget = 1; }, 6000);

  /* ---------------------------------------------------------
     Portadas de obra: aparecen apenas el escenario se acerca
     --------------------------------------------------------- */
  const nearIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) en.target.classList.add("is-near");
      else if (en.boundingClientRect.top > 0) en.target.classList.remove("is-near");
    });
  }, { rootMargin: "120px 0px 40px 0px" });
  sequences.filter((s) => !s.isHero).forEach((s) => nearIO.observe(s.el));

  /* ---------------------------------------------------------
     Revelados inmediatos al entrar en pantalla
     --------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      revealIO.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -2% 0px", threshold: 0.02 });

  $$("[data-reveal], [data-lines], .rimg").forEach((el) => {
    const sib = el.parentElement ? $$(":scope > [data-reveal]", el.parentElement) : [];
    const idx = sib.indexOf(el);
    if (idx > 0) el.style.setProperty("--d", `${Math.min(idx, 6) * 0.09}s`);
    revealIO.observe(el);
  });

  /* Destello satinado en títulos al centrarse con el scroll */
  const shimmerTitles = $$(".hero__title, .display, .contact__title");
  const shimmerIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      en.target.classList.toggle("is-shimmer", en.isIntersecting);
    });
  }, { rootMargin: "-18% 0px -18% 0px", threshold: 0.1 });
  shimmerTitles.forEach((t) => shimmerIO.observe(t));

  /* ---------------------------------------------------------
     Índice (overlay)
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

  /* ---------------------------------------------------------
     Anclas
     --------------------------------------------------------- */
  function goTo(href) {
    if (!href || href === "#") return;
    const target = href === "#top" ? 0 : $(href);
    if (target === null) return;
    const wasOpen = body.classList.contains("index-open");
    if (wasOpen) {
      setIndex(false);
      setTimeout(() => scrollToTarget(target, { immediate: true }), 650);
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
  $$("[data-goto]").forEach((el) => el.addEventListener("click", () => goTo(el.dataset.goto)));

  const heroScrollBtn = $(".hero__scroll");
  if (heroScrollBtn) {
    heroScrollBtn.addEventListener("click", () => {
      const step = Math.max(window.innerHeight * 0.75, 450);
      scrollToTarget(scrollY() + step, { duration: 1.4 });
    });
  }

  /* ---------------------------------------------------------
     Servicios: imagen asociada a la fila activa + obturador y telemetría
     --------------------------------------------------------- */
  const servicesSec = $("#servicios");
  const svcList = $(".svc", servicesSec);
  const svcRows = $$(".svc__row");
  const svcImgs = $$(".services__fig img");
  const svcFig = $(".services__fig");
  const svcN = $("[data-svc-n]");
  const svcSpec = $("[data-svc-spec]");
  const svcLens = $("[data-svc-lens]");
  const svcLabel = $("[data-svc-label]");
  const svcBar = $("[data-svc-bar]");
  let svcActive = 0, svcHover = -1;
  let svcSecDocTop = 0, svcSecHeight = 0, svcListDocTop = 0, svcListHeight = 0;

  function measureSvc() {
    if (!servicesSec) return;
    const scroll = scrollY();
    svcSecDocTop = servicesSec.getBoundingClientRect().top + scroll;
    svcSecHeight = servicesSec.offsetHeight;
    if (svcList) {
      svcListDocTop = svcList.getBoundingClientRect().top + scroll;
      svcListHeight = svcList.offsetHeight;
    }
    svcRows.forEach((r) => {
      r._docTop = r.getBoundingClientRect().top + scroll;
      r._height = r.offsetHeight;
    });
  }

  function setSvc(i) {
    if (i === svcActive) return;
    svcActive = i;
    svcRows.forEach((r, j) => r.classList.toggle("is-active", j === i));
    svcImgs.forEach((img, j) => img.classList.toggle("is-active", j === i));
    if (svcN) svcN.textContent = pad(i + 1);
    const activeRow = svcRows[i];
    if (activeRow) {
      if (svcSpec && activeRow.dataset.svcSpec) svcSpec.textContent = activeRow.dataset.svcSpec;
      if (svcLens && activeRow.dataset.svcLens) svcLens.textContent = activeRow.dataset.svcLens;
      if (svcLabel && activeRow.dataset.svcLabel) svcLabel.textContent = activeRow.dataset.svcLabel;
    }
    playTactileTick(610 + i * 55, 0.025, 0.02);
  }
  if (finePointer) {
    svcRows.forEach((row, i) => {
      row.addEventListener("mouseenter", () => { svcHover = i; setSvc(i); });
      row.addEventListener("mouseleave", () => { svcHover = -1; });
    });
  }
  function updateSvc() {
    if (!svcRows.length) return;
    const y = scrollY();
    const srTop = svcSecDocTop - y;
    const srBottom = srTop + svcSecHeight;
    if (srBottom < -100 || srTop > vh + 100) return;

    if (svcList) {
      const lrTop = svcListDocTop - y;
      const listProg = clamp((vh * 0.58 - lrTop) / Math.max(1, svcListHeight));
      if (svcBar) svcBar.style.transform = `scaleX(${listProg.toFixed(4)})`;
      if (svcFig && !reduce) {
        const py = (listProg - 0.5) * -18;
        svcFig.style.setProperty("--svc-py", `${py.toFixed(1)}px`);
      }
    }

    const mid = vh * 0.5;
    let best = svcActive, bestD = Infinity;
    svcRows.forEach((r, i) => {
      const bTop = (r._docTop || 0) - y;
      const rH = r._height || 60;
      const rowProg = clamp((vh * 0.72 - bTop) / Math.max(1, rH * 1.15));
      r.style.setProperty("--row-prog", rowProg.toFixed(3));
      const d = Math.abs(bTop + rH / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (svcHover < 0) setSvc(best);
  }

  /* ---------------------------------------------------------
     Repertorio: carrusel horizontal continuo de secuencias vivas
     --------------------------------------------------------- */
  class RepertorioCard {
    constructor(el) {
      this.el = el;
      this.src = el.dataset.src;
      this.count = parseInt(el.dataset.count, 10) || 100;
      this.version = el.dataset.version || "";
      this.step = parseInt(el.dataset.step, 10) || 2;
      this.fps = parseInt(el.dataset.fps, 10) || 24;
      this.canvas = $(".rep-card__canvas", el);
      this.poster = $(".rep-card__poster", el);
      this.ctx = this.canvas ? this.canvas.getContext("2d", { alpha: false }) : null;
      this.tcEl = $("[data-card-tc]", el);
      this.fillEl = $("[data-card-fill]", el);

      this.frames = [];
      this.totalFrames = Math.ceil(this.count / this.step);
      this.frameIndices = [];
      for (let i = 0; i < this.totalFrames; i++) {
        const rawIdx = Math.min(this.count, 1 + i * this.step);
        this.frameIndices.push(rawIdx);
      }

      this.currentPos = Math.random() * this.totalFrames;
      this.loaded = false;
      this.loading = false;
      this.hasDrawn = false;
      this.lastIdx = -1;

      if (this.canvas) {
        this.canvas.width = 640;
        this.canvas.height = 360;
      }
    }

    loadFrames() {
      if (this.loaded || this.loading) return;
      this.loading = true;
      let loadedCount = 0;
      const total = this.frameIndices.length;
      let qIdx = 0;
      const parallel = 2;

      const loadNext = () => {
        if (qIdx >= total) return;
        const i = qIdx++;
        const rawIdx = this.frameIndices[i];
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          this.frames[i] = img;
          loadedCount++;
          if (loadedCount >= 1 && !this.hasDrawn) {
            this.el.classList.add("has-canvas");
            this.draw(i);
            this.hasDrawn = true;
          }
          if (loadedCount >= total) {
            this.loaded = true;
            this.loading = false;
          }
          loadNext();
        };
        img.onerror = () => {
          loadedCount++;
          if (loadedCount >= total) {
            this.loaded = true;
            this.loading = false;
          }
          loadNext();
        };
        const vParam = this.version ? `?v=${this.version}` : (this.count ? `?v=${this.count}` : "");
        img.src = `${this.src}/md/${pad(rawIdx, 4)}.webp${vParam}`;
      };

      for (let k = 0; k < parallel; k++) loadNext();
    }

    draw(frameIndex) {
      if (!this.ctx || !this.canvas) return;
      let img = this.frames[frameIndex];
      if (!img) {
        for (let d = 1; d < this.totalFrames; d++) {
          if (this.frames[frameIndex - d]) { img = this.frames[frameIndex - d]; break; }
          if (this.frames[frameIndex + d]) { img = this.frames[frameIndex + d]; break; }
        }
      }
      if (!img || !img.naturalWidth) return;

      const cw = this.canvas.width;
      const ch = this.canvas.height;
      if (!cw || !ch) return;

      const iw = img.naturalWidth, ih = img.naturalHeight;
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      this.ctx.drawImage(img, x, y, dw, dh);
    }

    update(dt, scrollVelocity, isVisible) {
      if (!isVisible) return;
      if (!this.loading && !this.loaded) {
        this.loadFrames();
      }

      const playbackSpeed = this.fps / this.step;
      const scrubFactor = scrollVelocity * 0.45;
      this.currentPos = (this.currentPos + dt * playbackSpeed + scrubFactor) % this.totalFrames;
      if (this.currentPos < 0) this.currentPos += this.totalFrames;

      const curIdx = Math.floor(this.currentPos);
      if (curIdx !== this.lastIdx) {
        this.draw(curIdx);
        this.lastIdx = curIdx;

        if (this.tcEl) {
          const rawFrame = this.frameIndices[curIdx] || 1;
          const totalSec = Math.floor(rawFrame / this.fps);
          const remFr = rawFrame % this.fps;
          this.tcEl.textContent = `00:${pad(totalSec, 2)}:${pad(remFr, 2)}`;
        }

        if (this.fillEl) {
          const progress = this.currentPos / this.totalFrames;
          this.fillEl.style.transform = `scaleX(${progress.toFixed(3)})`;
        }
      }
    }
  }

  const repertorio = $(".repertorio");
  const repTrack = $("[data-repertorio-track]");
  const repCards = $$("[data-rep-card]").map((el) => new RepertorioCard(el));
  const repTrackFill = $("[data-rep-track-fill]");
  const repActiveIdx = $("[data-rep-active-idx]");
  let isMobileRep = false;
  let repDist = 0, repInitialY = 0, repX = 0, repY = 0, repSkew = 0, lastRepP = 0;
  let repDocTop = 0, repHeight = 0;

  function measureRepertorio() {
    if (!repertorio || !repTrack) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    isMobileRep = vw <= 768;
    const scroll = scrollY();

    repDocTop = repertorio.getBoundingClientRect().top + scroll;
    repHeight = repertorio.offsetHeight;

    repCards.forEach((c) => {
      if (c.canvas) {
        const rect = c.canvas.getBoundingClientRect();
        if (rect.width > 50) {
          const w = Math.round(rect.width * dpr);
          const h = Math.round(rect.height * dpr);
          if (c.canvas.width !== w || c.canvas.height !== h) {
            c.canvas.width = w;
            c.canvas.height = h;
            if (c.lastIdx >= 0) c.draw(c.lastIdx);
          }
        }
      }
      c._offsetLeft = c.el.offsetLeft;
      c._offsetTop = c.el.offsetTop;
      c._width = c.el.offsetWidth;
      c._height = c.el.offsetHeight;
    });

    if (isMobileRep) {
      // Agrupamiento inicial compacto debajo del encabezado en pantalla móvil:
      // La primera tarjeta se sitúa justo debajo de .repertorio__head (sin espacio vacío intermedio),
      // permitiendo ver de entrada la Obra 01 completa y la Obra 02 asomando inmediatamente debajo.
      const firstCard = repCards[0] ? repCards[0].el : null;
      const cardRect = firstCard ? firstCard.getBoundingClientRect() : null;
      const cardH = (cardRect && cardRect.height > 50) ? cardRect.height : 265;
      const stepH = cardH + 20; // altura tarjeta + gap
      const totalDist = (repCards.length - 1) * stepH;

      const repHead = $(".repertorio__head", repertorio);
      const headH = repHead ? repHead.offsetHeight : 66;
      repDist = totalDist;
      repInitialY = Math.max(138, Math.round(68 + headH + 16));
      repY = repInitialY;
      repertorio.style.height = `${Math.round(totalDist * 1.35 + vh)}px`;
    } else {
      // Modo Horizontal para escritorios / pantallas panorámicas
      repDist = Math.max(0, repTrack.scrollWidth - vw + 40);
      repertorio.style.height = `${Math.round(repDist + vh * 1.25)}px`;
    }
    repHeight = repertorio.offsetHeight;
  }

  if ("IntersectionObserver" in window && repertorio) {
    const repObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          if (repCards[0]) repCards[0].loadFrames();
          if (repCards[1]) repCards[1].loadFrames();
          repObserver.disconnect();
        }
      });
    }, { rootMargin: "400px 0px" });
    repObserver.observe(repertorio);
  }

  function updateRepertorio(dt) {
    if (!repertorio || !repTrack) return;
    const y = scrollY();
    const rTop = repDocTop - y;
    const rBottom = rTop + repHeight;
    if (rBottom < -120 || rTop > vh + 120) return;

    const viewportEntry = clamp((vh - rTop) / vh, 0, 1);
    const entryShiftY = -(1 - smooth(viewportEntry)) * (isMobileRep ? vh * 0.10 : vh * 0.15);
    repertorio.style.setProperty("--rep-entry-y", `${entryShiftY.toFixed(1)}px`);

    const p = clamp(-rTop / Math.max(1, repHeight - vh), 0, 1);
    const vel = (p - lastRepP) * 100;
    lastRepP = p;

    if (repTrackFill) {
      repTrackFill.style.transform = `scaleX(${p.toFixed(4)})`;
    }

    if (isMobileRep) {
      // ==========================================
      // MODO VERTICAL CINEMATOGRÁFICO COMPACTO (Móvil)
      // ==========================================
      const targetY = repInitialY - (p * repDist);
      repY += (targetY - repY) * 0.16;
      repSkew += (clamp(-vel * 1.2, -2.5, 2.5) - repSkew) * 0.12;

      repTrack.style.setProperty("--ry", `${repY.toFixed(1)}px`);
      repTrack.style.setProperty("--rx", "0px");
      repTrack.style.setProperty("--rep-skew", `${repSkew.toFixed(2)}deg`);

      const firstCardH = (repCards[0] && repCards[0]._height) ? repCards[0]._height : 260;
      const focusShift = smooth(range(p, 0.0, 0.25));
      const midY = (repInitialY + firstCardH * 0.5) * (1 - focusShift) + (vh * 0.46) * focusShift;
      const halfH = vh * 0.46;

      let closestCardIdx = 0;
      let minCardDist = Infinity;

      repCards.forEach((card, idx) => {
        const cardH = card._height || 260;
        const stageCardCenterY = repY + (card._offsetTop || 0) + cardH * 0.5;
        const screenCardCenterY = Math.max(0, rTop) + stageCardCenterY;
        const isVisible = (screenCardCenterY + cardH * 0.5) > -80 && (screenCardCenterY - cardH * 0.5) < vh + 80;
        card.update(dt, Math.abs(vel), isVisible);

        const distToCenter = Math.abs(stageCardCenterY - midY);
        if (distToCenter < minCardDist) {
          minCardDist = distToCenter;
          closestCardIdx = idx;
        }

        // Foco visual cinematográfico: tarjeta activa al 100%, tarjetas contiguas claramente visibles
        const normDist = clamp(distToCenter / halfH, 0, 1);
        card.el.style.setProperty("--card-opacity", (1 - normDist * 0.45).toFixed(2));
        card.el.style.setProperty("--card-scale", (1 - normDist * 0.06).toFixed(3));
      });

      if (repActiveIdx) {
        repActiveIdx.textContent = pad(closestCardIdx + 1, 2);
      }

    } else {
      // ==========================================
      // MODO HORIZONTAL CINEMATOGRÁFICO (Escritorio)
      // ==========================================
      repSkew += (clamp(-vel * 1.8, -2.5, 2.5) - repSkew) * 0.12;
      const targetX = -p * repDist;
      repX += (targetX - repX) * 0.15;

      repTrack.style.setProperty("--rx", `${repX.toFixed(1)}px`);
      repTrack.style.setProperty("--ry", "0px");
      repTrack.style.setProperty("--rep-skew", `${repSkew.toFixed(2)}deg`);

      const midX = vw / 2;
      let closestCardIdx = 0;
      let minCardDist = Infinity;

      repCards.forEach((card, idx) => {
        const cardCenterX = repX + (card._offsetLeft || 0) + (card._width || 420) / 2;
        const isVisible = (cardCenterX + (card._width || 420) / 2) > -150 && (cardCenterX - (card._width || 420) / 2) < vw + 150;
        card.update(dt, Math.abs(vel), isVisible);

        const distToMid = Math.abs(cardCenterX - midX);
        if (distToMid < minCardDist) {
          minCardDist = distToMid;
          closestCardIdx = idx;
        }

        card.el.style.removeProperty("--card-opacity");
        card.el.style.removeProperty("--card-scale");
      });

      if (repActiveIdx) {
        repActiveIdx.textContent = pad(closestCardIdx + 1, 2);
      }
    }
  }

  /* ---------------------------------------------------------
     Atmósfera sonora (Web Audio)
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
    master.gain.exponentialRampToValueAtTime(audioOn ? 0.22 : 0.0001, now + (audioOn ? 1.6 : 0.9));
  }
  if (soundBtn) soundBtn.addEventListener("click", toggleAudio);

  /* Pulsos acústicos táctiles suaves para interacción y coreografía */
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
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     Reloj de Buenos Aires
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

  /* ---------------------------------------------------------
     Modal de Fotograma (Darkroom Still Lightbox) + Copiar Correo
     --------------------------------------------------------- */
  const smodal = $("#stillModal");
  const smodalImg = $("[data-smodal-img]", smodal);
  const smodalCaption = $("[data-smodal-caption]", smodal);

  function openStillModal(src, caption = "") {
    if (!smodal || !smodalImg || !src) return;
    smodalImg.src = src;
    smodalImg.alt = caption || "Fotograma de archivo";
    if (smodalCaption) smodalCaption.textContent = caption;
    smodal.classList.add("is-open");
    smodal.setAttribute("aria-hidden", "false");
    body.classList.add("modal-open");
    playTactileTick(580, 0.03, 0.025);
    if (lenis) lenis.stop();
  }

  function closeStillModal() {
    if (!smodal || !smodalImg) return;
    smodal.classList.remove("is-open");
    smodal.setAttribute("aria-hidden", "true");
    body.classList.remove("modal-open");
    if (lenis) lenis.start();
  }

  $$("[data-still-src]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-video-trigger], a")) return;
      const src = el.dataset.stillSrc;
      const cap = el.dataset.stillCaption || "";
      openStillModal(src, cap);
    });
  });

  $$("[data-smodal-close]").forEach((el) => {
    el.addEventListener("click", () => closeStillModal());
  });

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
        if (copyMailTxt) copyMailTxt.textContent = "Copiar dirección al portapapeles";
      }, 2800);
    });
  }

  /* ---------------------------------------------------------
     Modal de Reproducción Cinemática (YouTube)
     --------------------------------------------------------- */
  const vmodal = $("#videoModal");
  const vmodalFrame = $("[data-vmodal-frame]", vmodal);
  const vmodalTitle = $("[data-vmodal-title]", vmodal);

  function getYouTubeEmbedUrl(rawUrl) {
    if (!rawUrl) return "";
    let videoId = "";
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = rawUrl.match(regExp);
    if (match && match[2].length === 11) {
      videoId = match[2];
    }
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1` : rawUrl;
  }

  function openVideoModal(url, title = "Film cinematográfico") {
    if (!vmodal || !vmodalFrame) return;
    const embedUrl = getYouTubeEmbedUrl(url);
    if (vmodalTitle) vmodalTitle.textContent = title;
    vmodalFrame.src = embedUrl;
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
      const url = btn.dataset.videoTrigger;
      const title = btn.dataset.videoTitle || "Film cinematográfico";
      openVideoModal(url, title);
    });
  });

  $$("[data-vmodal-close]").forEach((el) => {
    el.addEventListener("click", () => closeVideoModal());
  });

  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (vmodal && vmodal.classList.contains("is-open")) closeVideoModal();
      if (smodal && smodal.classList.contains("is-open")) closeStillModal();
    }
  });

  /* ---------------------------------------------------------
     Referencias de coreografía editorial en scroll
     --------------------------------------------------------- */
  const navEl = $(".nav");
  const parallaxEls = $$("[data-parallax]");
  const navSecLinks = $$("[data-nav-sec]").map((a) => ({
    link: a,
    id: a.dataset.navSec,
    sec: $(`#${a.dataset.navSec}`),
    docTop: 0,
    height: 0,
  }));

  /* ---------------------------------------------------------
     Estudio: Secuencia de fondo sutil (Casa del Lago) con velo blanco
     --------------------------------------------------------- */
  class EstudioBackground {
    constructor(secEl) {
      this.sec = secEl;
      if (!this.sec) return;
      this.canvas = $(".statement__bg-canvas", this.sec);
      if (!this.canvas) return;
      this.bgEl = $(".statement__bg", this.sec);
      this.ctx = this.canvas ? this.canvas.getContext("2d", { alpha: false }) : null;
      this.src = "assets/seq/casa-del-lago";
      this.count = 134;
      this.version = "1792737474";
      this.frames = new Array(this.count);
      this.loaded = false;
      this.loading = false;
      this.hasCanvas = false;
      this.curP = 0;
      this.targetP = 0;
      this.lastPos = -1;
      this.lastRamp = -1;
      this.dirty = true;
      this.token = 0;
      this.set = null;
      this.loadedOnce = false;

      this.measure();
      this.initObserver();
    }

    pickSet() {
      return vw / vh < 0.9 ? "pt" : "md";
    }

    measure() {
      if (!this.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(vw * dpr);
      const h = Math.round(vh * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.dirty = true;
      }
      const set = this.pickSet();
      if (this.set && set !== this.set) {
        this.set = null;
        this.frames = new Array(this.count);
        this.loaded = false;
        this.loading = false;
        this.load();
      }
    }

    initObserver() {
      if (!this.sec) return;
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              this.load();
              io.disconnect();
            }
          });
        }, { rootMargin: "800px 0px" });
        io.observe(this.sec);
      }
    }

    order() {
      const n = this.count;
      const seen = new Uint8Array(n);
      const out = [0];
      seen[0] = 1;
      for (let i = 3; i < n; i += 3) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      if (!seen[n - 1]) { seen[n - 1] = 1; out.push(n - 1); }
      for (let i = 1; i < n; i++) {
        if (!seen[i]) { seen[i] = 1; out.push(i); }
      }
      return out;
    }

    load() {
      if (this.loading || this.loaded) return;
      const set = this.pickSet();
      this.set = set;
      this.loading = true;
      const token = ++this.token;
      const queue = this.order();
      let qi = 0;
      let loadedCount = 0;
      const parallel = 3;

      const next = () => {
        if (token !== this.token || qi >= queue.length) return;
        const i = queue[qi++];
        const img = new Image();
        img.decoding = "async";
        const finish = (ok) => {
          if (token !== this.token) return;
          if (ok) {
            this.frames[i] = img;
            loadedCount++;
            if (!this.hasCanvas) {
              this.draw(0);
            } else {
              this.dirty = true;
            }
          }
          if (loadedCount >= this.count) {
            this.loaded = true;
            this.loading = false;
          }
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
      if (!this.ctx || !this.canvas) return;
      const n = this.count;
      const f = Math.round(clamp(pos, 0, n - 1));

      const img = this.nearest(f);
      if (!img || !img.naturalWidth) return;
      if (this.lastDrawnImg === img && !this.dirty) return;

      const cw = this.canvas.width;
      const ch = this.canvas.height;
      if (!cw || !ch) return;

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return;

      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s;
      const dh = ih * s;
      const x = (cw - dw) / 2;
      const y = (ch - dh) / 2;

      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, x, y, dw, dh);
      this.lastDrawnImg = img;
      this.dirty = false;

      if (!this.hasCanvas) {
        this.hasCanvas = true;
        if (this.bgEl) this.bgEl.classList.add("has-canvas");
      }
    }

    update(targetProgress) {
      if (reduce) {
        if (!this.loadedOnce) {
          this.loadedOnce = true;
          this.draw(0);
        }
        return;
      }
      this.targetP = clamp(targetProgress, 0, 1);
      this.curP += (this.targetP - this.curP) * 0.18;
      const framePos = this.curP * (this.count - 1);
      if (Math.abs(framePos - this.lastPos) > 0.02 || this.dirty) {
        this.lastPos = framePos;
        this.dirty = false;
        this.draw(framePos);
      }

      // Progresión gradual hacia el blanco denso ("más opaco, menos transparente"):
      // Al inicio (0.0 -> 0.12) se mantiene visible como ahora.
      // Entre 0.12 y 0.78 se va haciendo cada vez más blanco y opaco.
      // Al llegar a 0.78+ (antes del final de la sección) alcanza el blanco denso previo.
      const rampProgress = clamp((this.curP - 0.12) / 0.66, 0, 1);
      const rampVal = rampProgress * rampProgress * (3 - 2 * rampProgress);
      if (this.bgEl && Math.abs(rampVal - this.lastRamp) > 0.005) {
        this.lastRamp = rampVal;
        this.bgEl.style.setProperty("--estudio-veil-ramp", rampVal.toFixed(3));
      }
    }
  }

  // #estudio — Carta de Incidencia Solar y Principios Vectoriales
  const estudioSec = $("#estudio");
  const estudioBg = estudioSec ? new EstudioBackground(estudioSec) : null;
  const solarSun = $("[data-solar-sun]");
  const solarDeg = $("[data-solar-deg]");
  const solarHour = $("[data-solar-hour]");
  const principlesFill = $("[data-principles-fill]");
  const principleCards = $$("[data-principle]");

  // #metodo — Plan de Vuelo y Riel de Fases
  const metodoSec = $("#metodo");
  const stepsGrid = metodoSec ? $(".steps", metodoSec) : null;
  const methodBar = $("[data-method-bar]");
  const methodNodes = $$("[data-method-node]");
  const methodSteps = $$("[data-method-step]");
  const methodPhase = $("[data-method-phase]");
  const METHOD_PHASE_NAMES = [
    "FASE 01 · RELEVAMIENTO SOLAR",
    "FASE 02 · RODAJE EQUIPO MÍNIMO",
    "FASE 03 · MONTAJE & SONIDO",
    "FASE 04 · COLOR & ENTREGA",
  ];
  let lastMethodIdx = -1;

  // .quote — Plomada óptica y #contacto — Sello monumental
  const quoteSec = $(".quote");
  const quotePlumb = $("[data-quote-plumb]");
  const footSec = $(".foot");
  const footMark = $("[data-foot-mark]");

  let estudioDocTop = 0, estudioHeight = 0;
  let stepsGridDocTop = 0, stepsGridHeight = 0;
  let quoteDocTop = 0, quoteHeight = 0, quoteMarkDocTop = 0, quoteMarkHeight = 0;
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
      if (estudioBg) estudioBg.measure();
    }
    principleCards.forEach((c) => {
      c._docTop = c.getBoundingClientRect().top + scroll;
      c._height = c.offsetHeight;
    });

    if (stepsGrid) {
      stepsGridDocTop = stepsGrid.getBoundingClientRect().top + scroll;
      stepsGridHeight = stepsGrid.offsetHeight;
    }

    if (quoteSec) {
      quoteDocTop = quoteSec.getBoundingClientRect().top + scroll;
      quoteHeight = quoteSec.offsetHeight;
    }
    if (quoteMark) {
      quoteMarkDocTop = quoteMark.getBoundingClientRect().top + scroll;
      quoteMarkHeight = quoteMark.offsetHeight;
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

    parallaxEls.forEach((el) => {
      el._docTop = el.getBoundingClientRect().top + scroll;
      el._height = el.offsetHeight;
      if (!el._img) el._img = $("img", el) || el.firstElementChild;
      if (el._f === undefined) el._f = +el.dataset.parallax || 0.06;
    });
  }

  /* ---------------------------------------------------------
     Medidas
     --------------------------------------------------------- */
  function measureSeqs() {
    sequences.forEach((s) => { s.measure(); s.dirty = true; });
    if (formatSeq) formatSeq.measure();
    if (choreoSeq) choreoSeq.measure();
  }
  function measureAll() {
    vw = innerWidth; vh = innerHeight;
    root.style.setProperty("--vh", `${vh}px`);
    measureSvc();
    measureRepertorio();
    measureEditorial();
    measureSeqs();
  }

  let rT, lastW = vw;
  addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      // En móvil, la barra del navegador cambia la altura: sólo re-medir si cambia el ancho o mucho la altura.
      if (!finePointer && innerWidth === lastW && Math.abs(innerHeight - vh) < 120) return;
      lastW = innerWidth;
      measureAll();
    }, 140);
  });
  addEventListener("load", measureAll);
  if (document.fonts) document.fonts.ready.then(measureAll);
  measureAll();

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

    // Cursor con doble resorte inercial (núcleo + anillo desfasado)
    if (finePointer && cursor) {
      cx += (mx - cx) * 0.22;
      cy += (my - cy) * 0.22;
      rx += (mx - rx) * 0.11;
      ry += (my - ry) * 0.11;
      cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      if (cursorRing) {
        const ringDx = rx - cx;
        const ringDy = ry - cy;
        const cVel = Math.hypot(mx - rx, my - ry);
        const rScale = 1 + Math.min(0.22, cVel * 0.0032);
        cursorRing.style.setProperty("--ring-dx", `${ringDx.toFixed(1)}px`);
        cursorRing.style.setProperty("--ring-dy", `${ringDy.toFixed(1)}px`);
        cursorRing.style.setProperty("--ring-scale", rScale.toFixed(3));
      }
    }

    // Navegación: se retira al bajar, vuelve al subir + indicador de capítulo activo
    if (isScrolling) {
      navAcc = Math.sign(dy) === Math.sign(navAcc) ? navAcc + dy : dy;
      let shouldHide = isNavHidden;
      if (y < 100) {
        shouldHide = false;
      } else if (dy < -6 || navAcc < -12) {
        shouldHide = false;
      } else if (navAcc > 35 && dy > 0) {
        shouldHide = true;
      }

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
          const sBottom = sTop + item.height;
          if (sTop <= probeY && sBottom >= probeY * 0.5) {
            activeId = item.id;
          }
        }
        if (activeId !== currentNavId) {
          currentNavId = activeId;
          navSecLinks.forEach((item) => {
            item.link.classList.toggle("is-current", item.id === activeId);
          });
        }
      }
    }

    // #estudio: Carta de incidencia solar + vectores arquitectónicos de 1px + fondo secuencial Casa del Lago
    if (estudioSec) {
      const erTop = estudioDocTop - y;
      const erBottom = erTop + estudioHeight;
      if (erBottom > -80 && erTop < vh + 80) {
        const estP = clamp((vh * 0.85 - erTop) / Math.max(1, estudioHeight + vh * 0.25));
        const axisP = clamp((vh * 0.78 - erTop) / Math.max(1, estudioHeight * 0.88));
        const sunX = 16 + estP * 68;
        const sunY = 16 + Math.sin(estP * Math.PI) * 32;
        estudioSec.style.setProperty("--sun-x", `${sunX.toFixed(1)}%`);
        estudioSec.style.setProperty("--sun-y", `${sunY.toFixed(1)}%`);
        estudioSec.style.setProperty("--estudio-axis", axisP.toFixed(3));

        if (estudioBg) {
          const bgSpan = Math.max(1, estudioHeight + vh * 0.2);
          const bgP = clamp((vh * 0.92 - erTop) / bgSpan, 0, 1);
          estudioBg.update(bgP);
        }

        const dash = 185 * (1 - estP);
        estudioSec.style.setProperty("--solar-dash", dash.toFixed(1));
        if (solarSun) {
          const theta = Math.PI * (1 - estP);
          const cxSun = 70 + 58 * Math.cos(theta);
          const cySun = 64 - 58 * Math.sin(theta);
          solarSun.setAttribute("cx", cxSun.toFixed(1));
          solarSun.setAttribute("cy", cySun.toFixed(1));
        }
        if (solarDeg) {
          const altDeg = Math.round(12 + Math.sin(estP * Math.PI) * 56);
          solarDeg.textContent = `${altDeg}°`;
        }
        if (solarHour) {
          const totalMin = Math.round(450 + estP * 675); // 07:30 -> 18:45 ART
          const hh = pad(Math.floor(totalMin / 60));
          const mm = pad(totalMin % 60);
          solarHour.textContent = `${hh}:${mm} ART`;
        }
        if (principlesFill) {
          const prP = clamp((vh * 0.68 - erTop - estudioHeight * 0.32) / Math.max(1, estudioHeight * 0.45));
          principlesFill.style.transform = `scaleX(${prP.toFixed(3)})`;
        }
        principleCards.forEach((card, idx) => {
          const crTop = (card._docTop || 0) - y;
          const crH = card._height || 200;
          const cp = clamp((vh * 0.86 - crTop) / Math.max(1, crH * 1.15));
          const pDash = 120 * (1 - cp);
          card.style.setProperty("--path-dash", pDash.toFixed(1));
          card.classList.toggle("is-lit", cp > 0.35);
          if (!reduce) {
            const rel = (crTop + crH * 0.5 - vh * 0.5) / vh;
            const stagger = (idx - 1) * 6;
            card.style.setProperty("--prin-y", `${(rel * (8 + stagger)).toFixed(1)}px`);
          }
        });
      }
    }

    // #metodo: Riel de fases y telemetría de rodaje
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
          if (methodPhase && METHOD_PHASE_NAMES[activeIdx]) {
            methodPhase.textContent = METHOD_PHASE_NAMES[activeIdx];
          }
        }
      }
    }

    // .quote: Plomada arquitectónica + #contacto: Sello especular
    if (quoteSec && quotePlumb) {
      const qrTop = quoteDocTop - y;
      const qrBottom = qrTop + quoteHeight;
      if (qrBottom > -40 && qrTop < vh + 40) {
        const qp = clamp((vh * 0.78 - qrTop) / Math.max(1, quoteHeight * 0.75));
        quotePlumb.style.transform = `scaleY(${qp.toFixed(3)})`;
      }
    }
    if (footSec && footMark && !reduce) {
      const frTop = footDocTop - y;
      const frBottom = frTop + footHeight;
      if (frBottom > -60 && frTop < vh + 60) {
        const fp = clamp((vh - frTop) / Math.max(1, footHeight + vh * 0.35));
        const fy = (1 - fp) * 18;
        const fShine = 15 + fp * 75;
        footMark.style.setProperty("--foot-y", `${fy.toFixed(1)}px`);
        footMark.style.setProperty("--foot-shine", `${fShine.toFixed(1)}%`);
      }
    }

    // Tinta analógica y foco óptico continuo palabra por palabra (encendido inmediato al asomar)
    wordBlocks.forEach((b) => {
      const rTop = b.docTop - y;
      const rBottom = rTop + b.height;
      if (rTop > vh + 80 || rBottom < -80) return;

      const start = vh * 0.96;
      const end = vh * 0.58 - b.height * 0.35;
      const raw = clamp((start - rTop) / Math.max(1, start - end));
      const p = Math.pow(raw, 1.35);

      if (Math.abs(p - b.lastP) < 0.001) return;
      b.lastP = p;

      const total = b.words.length;
      const spread = 1.3;
      const head = p * (total + spread);

      b.words.forEach((w, i) => {
        const wProg = clamp((head - i) / spread);
        const op = (0.28 + wProg * 0.72).toFixed(3);
        const bl = ((1 - wProg) * 1.4).toFixed(1);
        w.style.setProperty("--o", op);
        w.style.setProperty("--bl", `${bl}px`);
      });
    });

    // Parallax tipográfico desacoplado en títulos de gran escala
    if (!reduce) {
      lineBlocks.forEach((b) => {
        const rTop = b.docTop - y;
        const rBottom = rTop + b.height;
        if (rBottom < -60 || rTop > vh + 60) return;
        const relY = (rTop + b.height * 0.5 - vh * 0.5) / vh;
        if (b.lines[0]) {
          b.lines[0].style.setProperty("--ln-shift", `${(relY * -12).toFixed(1)}px`);
        }
        if (b.lines[1]) {
          b.lines[1].style.setProperty("--ln-shift", `${(relY * 16).toFixed(1)}px`);
        }
      });

      if (quoteMark) {
        const qrTop = quoteMarkDocTop - y;
        const qrBottom = qrTop + quoteMarkHeight;
        if (qrBottom > -40 && qrTop < vh + 40) {
          const qShift = (qrTop + quoteMarkHeight * 0.5 - vh * 0.5) * 0.06;
          quoteMark.style.setProperty("--quote-mark-y", `${qShift.toFixed(1)}px`);
        }
      }
    }

    // Parallax interno de imágenes + respiración óptica de lente (.rimg)
    parallaxEls.forEach((el) => {
      const rTop = el._docTop - y;
      const rBottom = rTop + el._height;
      if (rBottom < 0 || rTop > vh) return;
      const f = el._f;
      const centerDist = rTop + el._height / 2 - vh / 2;
      const off = centerDist * -f;
      const img = el._img;
      if (img) {
        img.style.setProperty("--py", `${off.toFixed(1)}px`);
        const zoom = 1 + Math.min(0.055, (Math.abs(centerDist) / Math.max(1, vh)) * 0.075);
        img.style.setProperty("--rimg-zoom", zoom.toFixed(3));
      }
    });

    sequences.forEach((s) => s.update(dt));
    if (formatSeq) formatSeq.update(dt);
    if (choreoSeq) choreoSeq.update(dt);
    updateSvc();
    updateRepertorio(dt);

    if (audioOn && filter) {
      const target = Math.min(420, 160 + Math.abs(dy) * 1.6);
      filter.frequency.setTargetAtTime(target, audioCtx.currentTime, 0.25);
    }

    lastY = y;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
