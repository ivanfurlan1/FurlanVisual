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
  const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

  function scrollToTarget(target, opts = {}) {
    const y = typeof target === "number" ? target : target.getBoundingClientRect().top + scrollY();
    if (lenis) lenis.scrollTo(y, { duration: opts.duration || 1.8, immediate: !!opts.immediate });
    else window.scrollTo({ top: y, behavior: reduce || opts.immediate ? "auto" : "smooth" });
  }

  /* ---------------------------------------------------------
     Cursor
     --------------------------------------------------------- */
  const cursor = $(".cursor");
  const cursorLabel = $(".cursor__label");
  let mx = -200, my = -200, cx = -200, cy = -200;

  if (finePointer && cursor) {
    body.classList.add("has-cursor");
    addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });

    const bindCursor = (el) => {
      el.addEventListener("mouseenter", () => {
        const label = el.dataset.cursor;
        if (label) {
          cursorLabel.textContent = label;
          body.classList.add("cursor-label");
        } else {
          body.classList.add("cursor-link");
        }
      });
      el.addEventListener("mouseleave", () => {
        body.classList.remove("cursor-label", "cursor-link");
      });
    };
    $$("a, button, .seq__scrub, [data-cursor]").forEach(bindCursor);
  }

  /* ---------------------------------------------------------
     Texto palabra por palabra (tinta que aparece con el scroll)
     --------------------------------------------------------- */
  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = "";
    nodes.forEach((n) => {
      const isEl = n.nodeType === 1;
      const text = n.textContent;
      text.split(/\s+/).filter(Boolean).forEach((w) => {
        const s = document.createElement("span");
        s.className = "wd";
        if (isEl) {
          const inner = document.createElement(n.tagName.toLowerCase());
          inner.textContent = w;
          s.appendChild(inner);
        } else {
          s.textContent = w;
        }
        el.appendChild(s);
        el.appendChild(document.createTextNode(" "));
      });
    });
  }

  const wordBlocks = $$("[data-words]").map((el) => {
    splitWords(el);
    return { el, words: $$(".wd", el), last: -1 };
  });

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
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.fps = +el.dataset.fps || 25;
      this.durationSec = Math.round(this.count / this.fps);

      this.stage = $(".seq__stage", el);
      this.media = $(".seq__media", el);
      this.canvas = $(".seq__canvas", el);
      this.posterImg = $(".seq__poster img", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.hero = $("[data-seq-hero]", el);
      this.lead = $("[data-seq-lead]", el);

      this.chapters = $$(".chapter", el).map((n) => ({
        n,
        r: n.dataset.range.split(",").map(Number),
      }));

      this.tcEl = $("[data-tc]", el);
      this.frEl = $("[data-hud-fr]", el);
      this.scrub = $(".seq__scrub", el);
      this.scrubFill = $("[data-scrub-fill]", el);

      this.frames = [];
      this.cur = 0;
      this.lastCur = -1;
      this.lastFrame = -1;
      this.token = 0;
      this.lastBlur = -1;
      this.lastScrollPos = undefined;

      this.bindScrub();
      this.measure();
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
        fromEvent(e);
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
      const targetP = progress * 0.9;
      const y = this.top + targetP * this.len;
      if (lenis) lenis.scrollTo(y, { immediate: true });
      else window.scrollTo(0, y);
    }

    pickSet() {
      return vw / vh < 0.9 ? "pt" : "lg";
    }

    /* Tamaño del encuadre final (16:9 horizontal / 9:16 vertical) */
    target() {
      const portrait = vw / vh < 0.9 || vw <= 640;
      let tw, th;
      if (portrait) {
        th = Math.min(vh * 0.64, 700);
        tw = th * 9 / 16;
        if (tw > vw * 0.8) { tw = vw * 0.8; th = tw * 16 / 9; }
      } else {
        tw = Math.min(vw * 0.8, 1240);
        th = tw * 9 / 16;
        const maxH = vh * 0.62;
        if (th > maxH) { th = maxH; tw = th * 16 / 9; }
      }
      return { tw: Math.round(tw), th: Math.round(th) };
    }

    measure() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
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

      const set = this.pickSet();
      if (this.set && set !== this.set) {
        this.set = null;
        this.load(set);
      }
    }

    order() {
      const n = this.count, seen = new Uint8Array(n), out = [];
      // Los primeros fotogramas, en orden estricto: arranque y reencuadre sin saltos.
      const head = Math.min(45, n);
      for (let i = 0; i < head; i++) { seen[i] = 1; out.push(i); }
      // El resto, en pasadas progresivas para cubrir todo el film cuanto antes.
      [6, 3, 1].forEach((step) => {
        for (let i = head; i < n; i += step) if (!seen[i]) { seen[i] = 1; out.push(i); }
      });
      if (!seen[n - 1]) out.push(n - 1);
      return out;
    }

    load(set = this.pickSet(), onProgress) {
      if (this.set === set && this.frames.length) return;
      this.set = set;
      const token = ++this.token;
      this.frames = new Array(this.count);
      const queue = this.order();
      const first = Math.min(30, Math.max(16, Math.ceil(this.count / 10)));
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
          if (i === 0 && ok) {
            this.el.classList.add("has-canvas");
            this.draw(0);
          }
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
      const p = clamp(pos, 0, n - 1);
      const f0 = Math.floor(p);
      const f1 = Math.min(n - 1, f0 + 1);
      const blend = p - f0;

      const img0 = this.nearest(f0);
      if (!img0) return;
      const c = this.canvas, ctx = this.ctx;
      const cw = c.width, ch = c.height;
      const iw = img0.naturalWidth, ih = img0.naturalHeight;
      if (!iw || !ih) return;

      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s, dh = ih * s;
      const x = (cw - dw) / 2, y = (ch - dh) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.drawImage(img0, x, y, dw, dh);

      // Fundido entre fotogramas contiguos: movimiento continuo, sin escalones.
      if (f1 !== f0 && blend > 0.005) {
        const img1 = this.frames[f1];
        if (img1 && img1.naturalWidth) {
          ctx.globalAlpha = smooth(blend);
          ctx.drawImage(img1, x, y, dw, dh);
          ctx.globalAlpha = 1;
        }
      }
    }

    setBlur(px) {
      const v = Math.round(px * 10) / 10;
      if (v === this.lastBlur) return;
      this.lastBlur = v;
      const f = v > 0.05 ? `blur(${v}px)` : "none";
      this.canvas.style.filter = f;
      if (this.posterImg) this.posterImg.style.filter = f;
    }

    setText(el, o, ty, blur) {
      el.style.opacity = o.toFixed(3);
      el.style.transform = ty ? `translate3d(0, ${ty.toFixed(2)}vh, 0)` : "none";
      el.style.filter = blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "none";
      el.style.visibility = o <= 0.001 ? "hidden" : "visible";
    }

    update(dt) {
      const n = this.count;
      const isHero = this.isHero;
      const y = scrollY();
      const rawP = (y - this.top) / this.len;
      const st = this.stage.style;

      // Fuera de pantalla (más de una pantalla de distancia): no trabajar.
      if (y + vh < this.top - vh || y > this.top + this.len + vh) return;

      /* ---- Antes de la secuencia: estado inicial absoluto ---- */
      if (rawP <= 0) {
        this.cur = 0;
        this.progress = 0;
        st.setProperty("--frame-w", `${vw}px`);
        st.setProperty("--frame-h", `${vh}px`);
        st.setProperty("--frame-veil", isHero ? "1" : "0");
        st.setProperty("--cover-opacity", isHero ? "0" : "1");
        st.setProperty("--frame-opacity", "1");
        st.setProperty("--img-scale", isHero ? "1.05" : "1.1");
        st.setProperty("--chrome-opacity", "0");
        st.setProperty("--chrome-vis", "hidden");
        this.setBlur(isHero ? 0 : 18);
        if (this.hero) this.setText(this.hero, 1, 0, 0);
        if (this.lead) this.setText(this.lead, 1, 0, 0);
        if (this.scrubFill) this.scrubFill.style.width = "0%";
        this.chapters.forEach(({ n: el }) => { el.style.opacity = "0"; });
        if (this.lastCur !== 0 || this.dirty) {
          this.draw(0);
          this.lastCur = 0;
          this.dirty = false;
        }
        return;
      }

      /* ---- Después de la secuencia ---- */
      if (rawP >= 1) {
        this.cur = n - 1;
        this.progress = 1;
        st.setProperty("--cover-opacity", "1");
        st.setProperty("--frame-opacity", "0");
        st.setProperty("--chrome-opacity", "0");
        st.setProperty("--chrome-vis", "hidden");
        this.setBlur(14);
        if (this.scrubFill) this.scrubFill.style.width = "100%";
        return;
      }

      /* ---- Dentro de la secuencia ---- */
      const p = rawP;
      const pEnd = 0.9;
      const prog = clamp(p / pEnd);
      this.progress = prog;

      const targetF = prog * (n - 1);
      const k = reduce ? 1 : 1 - Math.exp(-14 * dt);

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
        this.dirty = false;

        const f = Math.round(this.cur);
        if (f !== this.lastFrame) {
          this.lastFrame = f;
          const sec = Math.floor(f / this.fps);
          const fr = f % this.fps;
          if (this.tcEl) this.tcEl.textContent = `${pad(sec)}:${pad(fr)}`;
          if (this.frEl) this.frEl.textContent = pad(f + 1, 3);
        }
        if (this.scrubFill) this.scrubFill.style.width = `${(prog * 100).toFixed(2)}%`;
        if (this.scrub) this.scrub.setAttribute("aria-valuenow", String(Math.round(prog * 100)));
      }

      /* Reencuadre: pantalla completa → encuadre (0 → 0.34) */
      const morph = smooth(range(p, 0, 0.34));
      const inv = 1 - morph;
      const curW = this.tw + (vw - this.tw) * inv;
      const curH = this.th + (vh - this.th) * inv;
      st.setProperty("--frame-w", `${curW.toFixed(1)}px`);
      st.setProperty("--frame-h", `${curH.toFixed(1)}px`);
      st.setProperty("--img-scale", (1 + inv * (isHero ? 0.05 : 0.1)).toFixed(4));

      /* Salida: el film se apaga y se desenfoca (0.88 → 0.98) */
      const outro = smooth(range(p, 0.88, 0.98));

      let cover, blur;
      if (isHero) {
        st.setProperty("--frame-veil", inv.toFixed(3));
        cover = outro;
        blur = outro * 14;
      } else {
        // Nace del negro: la capa oscura se vuelve transparente y el desenfoque se disipa.
        st.setProperty("--frame-veil", "0");
        const reveal = smooth(range(p, 0.02, 0.34));
        cover = Math.max(1 - reveal, outro);
        blur = Math.max((1 - reveal) * 18, outro * 14);
      }
      st.setProperty("--cover-opacity", cover.toFixed(3));
      st.setProperty("--frame-opacity", (1 - outro).toFixed(3));
      this.setBlur(blur);

      /* Textos frontales */
      if (this.hero) {
        const t = range(p, 0.015, 0.2);
        this.setText(this.hero, 1 - smooth(t), -t * 6, t * 8);
      }
      if (this.lead) {
        const t = range(p, 0.02, 0.22);
        this.setText(this.lead, 1 - smooth(t), -t * 5, t * 8);
      }

      /* Rótulo, marcas y línea de tiempo */
      const chrome = smooth(range(p, 0.24, 0.36)) * (1 - outro);
      st.setProperty("--chrome-opacity", chrome.toFixed(3));
      st.setProperty("--chrome-vis", chrome > 0.01 ? "visible" : "hidden");

      /* Capítulos */
      let shade = 0;
      this.chapters.forEach(({ n: el, r: [a, b] }) => {
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (el.style.opacity !== "0") el.style.opacity = "0";
          return;
        }
        const o = smooth(Math.min(range(t, 0, 0.2), 1 - range(t, 0.8, 1)));
        shade = Math.max(shade, o);
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((1 - o) * (t < 0.5 ? 12 : -8)).toFixed(1)}px, 0)`;
      });
      st.setProperty("--shade", shade.toFixed(3));
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));

  /* ---------------------------------------------------------
     PRELOADER — contador suave con duración mínima
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  const tStart = performance.now();
  let loadTarget = 0, loadShown = 0, ready = false;

  function tickLoader(now) {
    if (ready) return;
    const minT = reduce ? 0 : 1700;
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
    sequences[0].load(undefined, (p) => { loadTarget = Math.max(loadTarget, p); });

    const seqLoader = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const s = sequences.find((x) => x.el === en.target);
        if (s && !s.set) s.load();
        seqLoader.unobserve(en.target);
      });
    }, { rootMargin: "1400px 0px" });
    sequences.slice(1).forEach((s) => seqLoader.observe(s.el));
  } else {
    loadTarget = 1;
  }
  setTimeout(() => { loadTarget = 1; }, 6000);

  /* ---------------------------------------------------------
     Portadas de obra: aparecen cuando el escenario se acerca
     --------------------------------------------------------- */
  const nearIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) en.target.classList.add("is-near");
      else if (en.boundingClientRect.top > 0) en.target.classList.remove("is-near");
    });
  }, { rootMargin: "0px 0px -30% 0px" });
  sequences.filter((s) => !s.isHero).forEach((s) => nearIO.observe(s.el));

  /* ---------------------------------------------------------
     Revelados
     --------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      revealIO.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });

  $$("[data-reveal], [data-lines], .rimg").forEach((el) => {
    const sib = el.parentElement ? $$(":scope > [data-reveal]", el.parentElement) : [];
    const idx = sib.indexOf(el);
    if (idx > 0) el.style.setProperty("--d", `${Math.min(idx, 6) * 0.09}s`);
    revealIO.observe(el);
  });

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

  /* ---------------------------------------------------------
     Servicios: imagen asociada a la fila activa
     --------------------------------------------------------- */
  const svcRows = $$(".svc__row");
  const svcImgs = $$(".services__fig img");
  const svcN = $("[data-svc-n]");
  let svcActive = 0, svcHover = -1;

  function setSvc(i) {
    if (i === svcActive) return;
    svcActive = i;
    svcRows.forEach((r, j) => r.classList.toggle("is-active", j === i));
    svcImgs.forEach((img, j) => img.classList.toggle("is-active", j === i));
    if (svcN) svcN.textContent = pad(i + 1);
  }
  if (finePointer) {
    svcRows.forEach((row, i) => {
      row.addEventListener("mouseenter", () => { svcHover = i; setSvc(i); });
      row.addEventListener("mouseleave", () => { svcHover = -1; });
    });
  }
  function updateSvc() {
    if (!svcRows.length || svcHover >= 0) return;
    const mid = vh * 0.5;
    let best = svcActive, bestD = Infinity;
    svcRows.forEach((r, i) => {
      const b = r.getBoundingClientRect();
      const d = Math.abs(b.top + b.height / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    setSvc(best);
  }

  /* ---------------------------------------------------------
     Archivo: galería horizontal fijada
     --------------------------------------------------------- */
  const archive = $(".archive");
  const archTrack = $("[data-archive]");
  const archBar = $("[data-archive-bar]");
  let archDist = 0;

  function measureArchive() {
    if (!archive || !archTrack) return;
    archDist = Math.max(0, archTrack.scrollWidth - vw);
    archive.style.height = `${Math.round(archDist + vh)}px`;
  }
  function updateArchive() {
    if (!archive || !archTrack) return;
    const r = archive.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return;
    const p = clamp(-r.top / Math.max(1, r.height - vh));
    archTrack.style.setProperty("--ax", `${(-p * archDist).toFixed(1)}px`);
    if (archBar) archBar.style.transform = `scaleX(${p.toFixed(4)})`;
  }
  $$(".arc img").forEach((img) => img.addEventListener("load", () => { measureArchive(); measureSeqs(); }));

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
     Medidas
     --------------------------------------------------------- */
  function measureSeqs() {
    sequences.forEach((s) => { s.measure(); s.dirty = true; });
  }
  function measureAll() {
    vw = innerWidth; vh = innerHeight;
    root.style.setProperty("--vh", `${vh}px`);
    measureArchive();
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

  /* ---------------------------------------------------------
     Bucle principal
     --------------------------------------------------------- */
  const readline = $("[data-readline]");
  const parallaxEls = $$("[data-parallax]");
  let last = performance.now();
  let lastY = 0, navAcc = 0;

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (lenis) lenis.raf(now);
    const y = scrollY();

    // Cursor con inercia
    if (finePointer && cursor) {
      cx += (mx - cx) * 0.2;
      cy += (my - cy) * 0.2;
      cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    }

    // Línea de lectura
    if (readline) {
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      readline.style.transform = `scaleX(${clamp(y / max).toFixed(4)})`;
    }

    // Navegación: se retira al bajar, vuelve al subir
    const dy = y - lastY;
    navAcc = Math.sign(dy) === Math.sign(navAcc) ? navAcc + dy : dy;
    if (y < 120) body.classList.remove("nav-hidden");
    else if (navAcc > 40) body.classList.add("nav-hidden");
    else if (navAcc < -30) body.classList.remove("nav-hidden");

    // Tinta palabra por palabra
    wordBlocks.forEach((b) => {
      const r = b.el.getBoundingClientRect();
      if (r.top > vh || r.bottom < 0) return;
      const p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.3));
      const idx = Math.floor(p * (b.words.length + 1)) - 1;
      if (idx !== b.last) {
        b.last = idx;
        b.words.forEach((w, i) => w.style.setProperty("--o", i <= idx ? "1" : "0.14"));
      }
    });

    // Parallax interno de imágenes
    parallaxEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      const f = +el.dataset.parallax || 0.06;
      const off = (r.top + r.height / 2 - vh / 2) * -f;
      const img = el.firstElementChild;
      if (img) img.style.setProperty("--py", `${off.toFixed(1)}px`);
    });

    sequences.forEach((s) => s.update(dt));
    updateSvc();
    updateArchive();

    if (audioOn && filter) {
      const target = Math.min(420, 160 + Math.abs(dy) * 1.6);
      filter.frequency.setTargetAtTime(target, audioCtx.currentTime, 0.25);
    }

    lastY = y;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
