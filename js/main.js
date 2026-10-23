/* =========================================================
   FURLAN — CINE AÉREO DE ARQUITECTURA
   Motor de interacción, visualización cinematográfica
   y experiencia fluida de scroll.
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

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  let vw = innerWidth, vh = innerHeight;

  /* ---------------------------------------------------------
     Scroll suave (Lenis en escritorio)
     --------------------------------------------------------- */
  let lenis = null;
  if (window.Lenis && !reduce && finePointer) {
    lenis = new window.Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 1.1,
      touchMultiplier: 1.3,
      smoothWheel: true,
    });
    lenis.stop();
  }
  const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

  function scrollToTarget(target) {
    const y = typeof target === "number" ? target : target.getBoundingClientRect().top + scrollY();
    if (lenis) lenis.scrollTo(y, { duration: 1.5 });
    else window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  }

  /* ---------------------------------------------------------
     Cursor personalizado ultra-fino
     --------------------------------------------------------- */
  const cursorRing = $(".custom-cursor");
  const cursorDot = $(".cursor-dot");
  let mouseX = -100, mouseY = -100;
  let ringX = -100, ringY = -100;

  if (finePointer && cursorRing && cursorDot) {
    body.classList.add("cursor-active");

    window.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursorDot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
    });

    const updateCursor = () => {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      requestAnimationFrame(updateCursor);
    };
    requestAnimationFrame(updateCursor);

    $$("a, button, .seq__scrub, .svc__row").forEach((el) => {
      el.addEventListener("mouseenter", () => {
        body.classList.add("cursor-hover");
        const action = el.dataset.cursor || "";
        cursorRing.textContent = action;
      });
      el.addEventListener("mouseleave", () => {
        body.classList.remove("cursor-hover");
        cursorRing.textContent = "";
      });
    });
  }

  /* ---------------------------------------------------------
     Partición de textos para revelado palabra por palabra
     --------------------------------------------------------- */
  function splitWords(el, wrap) {
    const nodes = Array.from(el.childNodes);
    el.textContent = "";
    let i = 0;
    const add = (word, tag) => {
      if (!word) return;
      const inner = tag ? document.createElement(tag) : null;
      if (inner) inner.textContent = word;
      el.appendChild(wrap(inner || document.createTextNode(word), i++));
      el.appendChild(document.createTextNode(" "));
    };
    nodes.forEach((n) => {
      if (n.nodeType === 3) n.textContent.split(/\s+/).forEach((w) => add(w));
      else if (n.nodeType === 1) n.textContent.split(/\s+/).forEach((w) => add(w, n.tagName.toLowerCase()));
    });
    return i;
  }

  $$("[data-split]").forEach((el) => {
    splitWords(el, (node, i) => {
      const w = document.createElement("span");
      const s = document.createElement("span");
      w.className = "w";
      s.style.setProperty("--i", i);
      s.appendChild(node);
      w.appendChild(s);
      return w;
    });
  });

  const wordBlocks = $$("[data-words]").map((el) => {
    splitWords(el, (node) => {
      const s = document.createElement("span");
      s.className = "wd";
      s.appendChild(node);
      return s;
    });
    return { el, words: $$(".wd", el), visible: false, last: -1 };
  });

  /* ---------------------------------------------------------
     MOTOR DE SECUENCIAS CINEMATOGRÁFICAS
     Marco acotado + transiciones ópticas orgánicas
     --------------------------------------------------------- */
  class Sequence {
    constructor(el) {
      this.el = el;
      this.id = el.id || "";
      this.isHero = el.classList.contains("seq--hero");
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.fps = +el.dataset.fps || 25;
      this.durationSec = Math.round(this.count / this.fps);

      this.stage = $(".seq__stage", el);
      this.media = $(".seq__media", el);
      this.canvas = $(".seq__canvas", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.hero = $("[data-seq-hero]", el);

      this.chapters = $$(".chapter", el).map((n) => ({
        n,
        r: n.dataset.range.split(",").map(Number),
      }));

      this.tcEl = $("[data-tc]", el);
      this.frEl = $("[data-hud-fr]", el);
      this.scrub = $(".seq__scrub", el);
      this.scrubFill = $("[data-scrub-fill]", el);
      this.scrubDot = $("[data-scrub-dot]", el);

      this.frames = [];
      this.cur = 0;
      this.lastCur = -1;
      this.lastFrame = -1;
      this.token = 0;
      this.p = -1;
      this.isScrubbing = false;

      this.bindScrub();
      this.measure();
    }

    bindScrub() {
      if (!this.scrub) return;

      const handleScrub = (e) => {
        const rect = this.scrub.getBoundingClientRect();
        const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
        if (clientX === undefined) return;
        const pos = clamp((clientX - rect.left) / rect.width);
        this.seekToProgress(pos);
      };

      this.scrub.addEventListener("mousedown", (e) => {
        this.isScrubbing = true;
        handleScrub(e);
        const onMove = (ev) => { if (this.isScrubbing) handleScrub(ev); };
        const onUp = () => {
          this.isScrubbing = false;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      this.scrub.addEventListener("touchstart", (e) => {
        this.isScrubbing = true;
        handleScrub(e);
        const onTouchMove = (ev) => { if (this.isScrubbing) handleScrub(ev); };
        const onTouchEnd = () => {
          this.isScrubbing = false;
          window.removeEventListener("touchmove", onTouchMove);
          window.removeEventListener("touchend", onTouchEnd);
        };
        window.addEventListener("touchmove", onTouchMove, { passive: true });
        window.addEventListener("touchend", onTouchEnd);
      }, { passive: true });
    }

    seekToProgress(progress) {
      const pStart = this.isHero ? 0.04 : 0.02;
      const pEnd = 0.94;
      const targetP = pStart + progress * (pEnd - pStart);
      const targetScroll = this.top + targetP * this.len;
      if (lenis) {
        lenis.scrollTo(targetScroll, { immediate: true });
      } else {
        window.scrollTo(0, targetScroll);
      }
    }

    pickSet() {
      if (vw / vh < 0.9) return "pt";
      return "lg";
    }

    measure() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const isPortrait = vw / vh < 0.9 || vw <= 768;

      let w, h;
      if (this.isHero) {
        w = vw;
        h = vh;
      } else {
        w = isPortrait ? Math.min(vw * 0.84, 380) : Math.min(vw * 0.86, 1120);
        h = isPortrait ? Math.round(w * 16 / 9) : Math.round(w * 9 / 16);
      }

      const canvasW = Math.round(w * dpr);
      const canvasH = Math.round(h * dpr);

      if (this.canvas.width !== canvasW || this.canvas.height !== canvasH) {
        this.canvas.width = canvasW;
        this.canvas.height = canvasH;
        this.dirty = true;
      }

      this.top = this.el.offsetTop;
      this.len = Math.max(1, this.el.offsetHeight - vh);

      const set = this.pickSet();
      if (this.set && (set === "pt") !== (this.set === "pt")) {
        this.load(set);
      }
    }

    order() {
      const n = this.count, seen = new Uint8Array(n), out = [];
      [16, 8, 4, 2, 1].forEach((step) => {
        for (let i = 0; i < n; i += step) {
          if (!seen[i]) { seen[i] = 1; out.push(i); }
        }
      });
      if (!seen[n - 1]) out.push(n - 1);
      return out;
    }

    load(set = this.pickSet(), onProgress) {
      this.set = set;
      const token = ++this.token;
      this.frames = new Array(this.count);
      const queue = this.order();
      const first = Math.min(6, Math.max(3, Math.ceil(this.count / 24)));
      let qi = 0, done = 0;
      const parallel = vw < 900 ? 4 : 6;

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
          if (i === 0 && ok) this.el.classList.add("has-canvas");
          this.dirty = true;
          next();
        };
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => finish(true));
        img.onerror = () => finish(false);
        img.src = `${this.src}/${set}/${pad(i + 1, 4)}.webp`;
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
      const n = this.count;
      const clampedPos = Math.max(0, Math.min(n - 1, pos));
      const f0 = Math.floor(clampedPos);
      const f1 = Math.min(n - 1, f0 + 1);
      const blend = clampedPos - f0;

      const img0 = this.nearest(f0);
      if (!img0) return;

      const c = this.canvas;
      const cw = c.width, ch = c.height;
      const iw = img0.naturalWidth, ih = img0.naturalHeight;
      if (!iw || !ih) return;

      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";

      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.globalAlpha = 1.0;
      this.ctx.drawImage(img0, x, y, dw, dh);

      if (f1 !== f0 && blend > 0.005) {
        const img1 = this.frames[f1];
        if (img1 && img1.complete && img1.naturalWidth) {
          const alpha = blend * blend * (3 - 2 * blend);
          this.ctx.globalAlpha = alpha;
          this.ctx.drawImage(img1, x, y, dw, dh);
        }
      }
    }

    update(y, dt) {
      const n = this.count;
      const isHero = this.isHero;
      const currentY = scrollY();
      const p = clamp((currentY - this.top) / this.len);

      // Reproducción inmediata con el avance del scroll
      const pStart = isHero ? 0.01 : 0.0;
      const pEnd = 0.94;

      let prog;
      if (p <= pStart) {
        prog = 0;
      } else if (p >= pEnd) {
        prog = 1;
      } else {
        prog = (p - pStart) / (pEnd - pStart);
      }

      const target = prog * (n - 1);
      const lambda = (p >= pEnd || p <= pStart) ? 14 : 10;
      const k = reduce ? 1 : (1 - Math.exp(-lambda * dt));

      if (this.lastScrollPos === undefined) this.lastScrollPos = currentY;
      const isUserScrolling = Math.abs(currentY - this.lastScrollPos) > 0.2;
      this.lastScrollPos = currentY;

      let effectiveTarget = target;
      if (!isUserScrolling && Math.abs(target - this.cur) < 0.25) {
        effectiveTarget = Math.round(target);
      }

      this.cur += (effectiveTarget - this.cur) * k;
      if (Math.abs(effectiveTarget - this.cur) < 0.002) {
        this.cur = effectiveTarget;
      }

      if (Math.abs(this.cur - this.lastCur) > 0.002 || this.dirty) {
        this.draw(this.cur);
        this.lastCur = this.cur;
        this.dirty = false;

        const displayFrame = Math.round(this.cur);
        if (displayFrame !== this.lastFrame) {
          this.lastFrame = displayFrame;
          const currentSec = Math.floor(displayFrame / this.fps);
          if (this.tcEl) {
            this.tcEl.textContent = `00:${pad(currentSec)} / 00:${pad(this.durationSec)}`;
          }
          if (this.frEl) {
            this.frEl.textContent = pad(displayFrame + 1, 3);
          }
        }

        const pct = (prog * 100).toFixed(2);
        if (this.scrubFill) this.scrubFill.style.width = `${pct}%`;
        if (this.scrubDot) this.scrubDot.style.left = `${pct}%`;
      }

      if (Math.abs(p - this.p) < 0.0001) return;
      this.p = p;
      const st = this.stage.style;

      if (isHero) {
        // =======================================================
        // FILM 01 (HERO + PROYECCIÓN)
        // Comienza a pantalla completa bajo velo oscuro elegante.
        // Se enmarca orgánicamente al hacer scroll hacia el viewport.
        // Se desvanece suavemente al final entregando la siguiente sección.
        // =======================================================
        const heroMorph = smooth(range(p, 0.02, 0.16));
        const invMorph = 1 - heroMorph;

        const isPortrait = vw / vh < 0.9 || vw <= 768;
        const targetW = isPortrait ? Math.min(vw * 0.84, 380) : Math.min(vw * 0.86, 1120);
        const targetH = isPortrait ? Math.round(targetW * 16 / 9) : Math.round(targetW * 9 / 16);

        const curW = targetW + (vw - targetW) * invMorph;
        const curH = targetH + (vh - targetH) * invMorph;
        const curRadius = heroMorph * 8;
        const curVeil = (invMorph * 0.76).toFixed(3);

        st.setProperty("--hero-w", `${curW.toFixed(1)}px`);
        st.setProperty("--hero-h", `${curH.toFixed(1)}px`);
        st.setProperty("--hero-radius", `${curRadius.toFixed(1)}px`);
        st.setProperty("--hero-veil", curVeil);
        st.setProperty("--hero-glow", (heroMorph * 0.6).toFixed(3));
        st.setProperty("--hero-shadow", heroMorph > 0.05 ? "0 24px 80px -18px rgba(0, 0, 0, 0.98), 0 0 0 1px rgba(245, 242, 235, 0.08)" : "none");

        // Desvanecimiento del texto hero
        if (this.hero) {
          const heroFade = range(p, 0.0, 0.10);
          this.hero.style.opacity = (1 - smooth(heroFade)).toFixed(3);
          this.hero.style.transform = `translate3d(0, ${(-heroFade * 8).toFixed(1)}vh, 0)`;
          this.hero.style.visibility = heroFade >= 1 ? "hidden" : "visible";
        }

        // Chrome de Film 01 (aparece con el marco)
        const chromeProg = range(p, 0.06, 0.16);
        const outroProg = range(p, 0.90, 0.98);
        const outroEffect = smooth(outroProg);
        const chromeOpacity = Math.max(0, smooth(chromeProg) * (1 - outroEffect));
        st.setProperty("--chrome-opacity", chromeOpacity.toFixed(3));

        // Salida suave y rápida sin vacíos en negro
        st.setProperty("--cover-opacity", (outroEffect * 0.9).toFixed(3));
        st.setProperty("--fx-blur", `${(outroEffect * 14).toFixed(1)}px`);

      } else {
        // =======================================================
        // FILMS 02, 03, 04 (COMPACT CINEMA VIEWPORTS)
        // Despertar ágil y sin esperas (en solo un 9% de scroll):
        // la oscuridad y el desenfoque se disuelven de inmediato,
        // mientras el marco y el título aparecen de sorpresa.
        // Salida limpia al 90-98% sin quedarse en negro.
        // =======================================================
        const introProg = range(p, 0.0, 0.09);
        const introSmooth = smooth(introProg);

        const outroProg = range(p, 0.91, 0.98);
        const outroSmooth = smooth(outroProg);

        const portalVisibility = Math.max(0, introSmooth * (1 - outroSmooth));
        const portalScale = 0.97 + 0.03 * introSmooth - 0.02 * outroSmooth;

        const darkCover = Math.max(1 - introSmooth, outroSmooth);
        const blurAmount = darkCover * 14;

        st.setProperty("--portal-opacity", portalVisibility.toFixed(3));
        st.setProperty("--portal-scale", portalScale.toFixed(4));
        st.setProperty("--chrome-opacity", portalVisibility.toFixed(3));
        st.setProperty("--cover-opacity", (darkCover * 0.92).toFixed(3));
        st.setProperty("--fx-blur", `${blurAmount.toFixed(1)}px`);
      }

      // Capítulos poéticos
      this.chapters.forEach(({ n: el, r: [a, b] }) => {
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (el.style.opacity !== "0") {
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
          }
          return;
        }
        const o = smooth(Math.min(range(t, 0, 0.22), 1 - range(t, 0.78, 1)));
        const dir = t < 0.5 ? 1 : -1;
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((1 - o) * 14 * dir).toFixed(1)}px, 0)`;
      });
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));

  /* ---------------------------------------------------------
     PRELOADER
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  let ready = false;

  function setReady() {
    if (ready) return;
    ready = true;
    if (loaderCount) loaderCount.textContent = "100";
    if (loaderBar) loaderBar.style.transform = "scaleX(1)";
    setTimeout(() => {
      body.classList.add("is-ready");
      body.classList.remove("is-loading");
      if (lenis) lenis.start();
      measureAll();
    }, 350);
  }

  if (sequences.length) {
    sequences[0].load(undefined, () => {});
    sequences.slice(1).forEach((s) => s.load());
  }
  setTimeout(setReady, 1800);

  /* ---------------------------------------------------------
     REVELADOS EN SCROLL (IntersectionObserver)
     --------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      revealIO.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });

  $$("[data-reveal], [data-split]").forEach((el) => {
    const sib = el.parentElement ? $$(":scope > [data-reveal]", el.parentElement) : [];
    const idx = sib.indexOf(el);
    if (idx > 0) el.style.setProperty("--d", `${Math.min(idx, 5) * 0.08}s`);
    revealIO.observe(el);
  });

  /* ---------------------------------------------------------
     LÍNEA DE MÉTODO Y SERVICIOS HOVER PREVIEW
     --------------------------------------------------------- */
  const stepsSection = $(".method");
  const stepsLine = $("[data-steps-line]");
  const stepItems = $$(".step");

  function updateSteps() {
    if (!stepsSection || !stepsLine) return;
    const rect = stepsSection.getBoundingClientRect();
    const p = clamp((vh * 0.7 - rect.top) / rect.height);
    stepsLine.style.setProperty("--sl", smooth(p).toFixed(3));
    stepItems.forEach((st, i) => {
      const stepProg = clamp((p - i * 0.22) / 0.25);
      st.style.setProperty("--on", smooth(stepProg).toFixed(3));
      st.classList.toggle("is-on", stepProg > 0.5);
    });
  }

  // Previsualización flotante en servicios
  const svcPreview = $(".svc__preview");
  const svcRows = $$(".svc__row");
  let svcX = 0, svcY = 0, curSvcX = 0, curSvcY = 0;

  if (svcPreview && finePointer) {
    svcRows.forEach((row) => {
      row.addEventListener("mouseenter", () => {
        const img = $("img", svcPreview);
        const src = row.dataset.img;
        if (img && src) img.src = src;
        svcPreview.classList.add("is-on");
      });
      row.addEventListener("mouseleave", () => {
        svcPreview.classList.remove("is-on");
      });
    });

    window.addEventListener("mousemove", (e) => {
      svcX = e.clientX + 25;
      svcY = e.clientY - 120;
    });

    const updateSvc = () => {
      curSvcX += (svcX - curSvcX) * 0.14;
      curSvcY += (svcY - curSvcY) * 0.14;
      svcPreview.style.setProperty("--mx", `${curSvcX.toFixed(1)}px`);
      svcPreview.style.setProperty("--my", `${curSvcY.toFixed(1)}px`);
      requestAnimationFrame(updateSvc);
    };
    requestAnimationFrame(updateSvc);
  }

  /* ---------------------------------------------------------
     ATMÓSFERA SONORA CINEMATOGRÁFICA (Web Audio API)
     --------------------------------------------------------- */
  const soundBtn = $("#soundToggle");
  let audioCtx = null, droneMaster = null, filterNode = null, isAudioOn = false;

  function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioCtx = new AudioContext();

    droneMaster = audioCtx.createGain();
    droneMaster.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    droneMaster.connect(audioCtx.destination);

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.frequency.setValueAtTime(150, audioCtx.currentTime);
    filterNode.Q.setValueAtTime(1.1, audioCtx.currentTime);
    filterNode.connect(droneMaster);

    const osc1 = audioCtx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(55, audioCtx.currentTime);
    const g1 = audioCtx.createGain(); g1.gain.value = 0.35;
    osc1.connect(g1); g1.connect(filterNode);
    osc1.start();

    const osc2 = audioCtx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(82.4, audioCtx.currentTime);
    osc2.detune.setValueAtTime(2.0, audioCtx.currentTime);
    const g2 = audioCtx.createGain(); g2.gain.value = 0.16;
    osc2.connect(g2); g2.connect(filterNode);
    osc2.start();
  }

  function toggleAudio() {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();

    isAudioOn = !isAudioOn;
    if (soundBtn) {
      soundBtn.classList.toggle("is-active", isAudioOn);
      const label = $(".sound-label", soundBtn);
      if (label) label.textContent = isAudioOn ? "Sonido On" : "Sonido";
    }

    const now = audioCtx.currentTime;
    if (isAudioOn) {
      droneMaster.gain.cancelScheduledValues(now);
      droneMaster.gain.setValueAtTime(droneMaster.gain.value, now);
      droneMaster.gain.exponentialRampToValueAtTime(0.24, now + 1.2);
    } else {
      droneMaster.gain.cancelScheduledValues(now);
      droneMaster.gain.setValueAtTime(droneMaster.gain.value, now);
      droneMaster.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    }
  }

  if (soundBtn) soundBtn.addEventListener("click", toggleAudio);

  /* ---------------------------------------------------------
     RELOJ EN VIVO BUENOS AIRES
     --------------------------------------------------------- */
  const clockEl = $("[data-clock]");
  function updateClock() {
    if (!clockEl) return;
    try {
      const now = new Date();
      const str = now.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      clockEl.textContent = `${str} ART`;
    } catch (_) {}
  }
  updateClock();
  setInterval(updateClock, 10000);

  /* ---------------------------------------------------------
     GESTIÓN DE TAMAÑO Y REDIMENSIÓN
     --------------------------------------------------------- */
  function measureAll() {
    vw = innerWidth; vh = innerHeight;
    sequences.forEach((s) => s.measure());
    sequences.forEach((s) => { s.p = -1; s.dirty = true; });
  }

  let rT;
  addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(measureAll, 120);
  });
  addEventListener("load", measureAll);
  if (document.fonts) document.fonts.ready.then(measureAll);

  // Menú móvil
  const navToggle = $(".nav__toggle");
  if (navToggle) {
    navToggle.addEventListener("click", () => {
      const open = body.classList.toggle("menu-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
  }
  $$(".menu__links a").forEach((a) => {
    a.addEventListener("click", () => {
      body.classList.remove("menu-open");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    });
  });

  // Scroll suave en anclas
  $$("a[href^='#']").forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;
      const target = href === "#top" ? 0 : $(href);
      if (target !== null) {
        e.preventDefault();
        scrollToTarget(target);
      }
    });
  });

  /* ---------------------------------------------------------
     BUCLE PRINCIPAL (RAF)
     --------------------------------------------------------- */
  let last = performance.now();
  let lastY = -1;

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (lenis) lenis.raf(now);

    const y = scrollY();

    body.classList.toggle("is-scrolled", y > 50);

    // Palabras del manifiesto
    wordBlocks.forEach((block) => {
      const rect = block.el.getBoundingClientRect();
      const inView = rect.top < vh && rect.bottom > 0;
      if (!inView) return;
      const p = clamp((vh * 0.85 - rect.top) / (rect.height + vh * 0.4));
      const activeIdx = Math.floor(p * block.words.length);
      if (activeIdx !== block.last) {
        block.last = activeIdx;
        block.words.forEach((w, i) => {
          w.style.setProperty("--o", i <= activeIdx ? "1" : "0.14");
        });
      }
    });

    // Parallax suave en fotogramas de obra
    $$("[data-parallax]").forEach((img) => {
      const factor = +img.dataset.parallax || 0.08;
      const rect = img.getBoundingClientRect();
      if (rect.top < vh && rect.bottom > 0) {
        const offset = (rect.top - vh * 0.5) * factor;
        img.style.setProperty("--py", `${offset.toFixed(1)}px`);
      }
    });

    // Tira horizontal en scroll
    const stripTrack = $("[data-strip]");
    if (stripTrack) {
      const sRect = stripTrack.parentElement.getBoundingClientRect();
      if (sRect.top < vh && sRect.bottom > 0) {
        const sp = clamp((vh - sRect.top) / (vh + sRect.height));
        const maxScroll = stripTrack.scrollWidth - stripTrack.clientWidth;
        stripTrack.style.setProperty("--sx", `${(-sp * maxScroll * 0.7).toFixed(1)}px`);
      }
    }

    // Actualizar secuencias
    sequences.forEach((s) => s.update(y, dt));

    // Actualizar pasos del método
    updateSteps();

    // Modulación de audio
    if (isAudioOn && filterNode && audioCtx) {
      const dy = Math.abs(y - (lastY >= 0 ? lastY : y));
      const targetFreq = Math.min(380, 150 + dy * 1.5);
      filterNode.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.2);
    }
    lastY = y;

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
