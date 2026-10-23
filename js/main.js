/* =========================================================
   FURLAN — interacción y movimiento
   Sin dependencias obligatorias. Lenis (scroll suave) es opcional:
   si no carga, todo funciona con el scroll nativo.
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
     Scroll suave (solo escritorio)
     --------------------------------------------------------- */
  let lenis = null;
  if (window.Lenis && !reduce && finePointer) {
    lenis = new window.Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 1.3,
      touchMultiplier: 1.5,
      smoothWheel: true,
    });
    lenis.stop();
  }
  const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

  function scrollToTarget(target) {
    const y = target === 0 ? 0 : target.getBoundingClientRect().top + scrollY();
    if (lenis) lenis.scrollTo(y, { duration: 1.8 });
    else window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  }

  /* ---------------------------------------------------------
     Partición de textos
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
     Secuencia de frames ligada al scroll
     --------------------------------------------------------- */
  class Sequence {
    constructor(el) {
      this.el = el;
      this.src = el.dataset.src;
      this.count = +el.dataset.count;
      this.fps = +el.dataset.fps || 25;
      this.stage = $(".seq__stage", el);
      this.media = $(".seq__media", el);
      this.canvas = $(".seq__canvas", el);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.hero = $("[data-seq-hero]", el);
      this.layers = $$(".chapter, .seq__end", el).map((n) => ({ n, r: n.dataset.range.split(",").map(Number) }));
      this.tc = $("[data-hud-tc]", el);
      this.fr = $("[data-hud-fr]", el);
      this.rail = $("[data-hud-rail]", el);
      this.frames = [];
      this.cur = 0;
      this.lastCur = -1;
      this.lastFrame = -1;
      this.token = 0;
      this.p = -1;
      this.measure();
    }

    pickSet() {
      if (vw / vh < 0.9) return "pt";
      return vw * Math.min(devicePixelRatio || 1, 2) <= 1500 ? "md" : "lg";
    }

    measure() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = this.stage.clientWidth, h = this.stage.clientHeight;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.dirty = true;
      }
      this.top = this.el.offsetTop;
      this.padPx = Math.min(48, Math.max(20, vw * 0.032)); // igual que --pad en CSS
      this.len = Math.max(1, this.el.offsetHeight - h);
      const set = this.pickSet();
      if (this.set && (set === "pt") !== (this.set === "pt")) this.load(set);
    }

    order() {
      const n = this.count, seen = new Uint8Array(n), out = [];
      [16, 8, 4, 2, 1].forEach((step) => {
        for (let i = 0; i < n; i += step) if (!seen[i]) { seen[i] = 1; out.push(i); }
      });
      if (!seen[n - 1]) out.push(n - 1);
      return out;
    }

    load(set = this.pickSet(), onProgress) {
      this.set = set;
      const token = ++this.token;
      this.frames = new Array(this.count);
      this.drawnImg = null;
      const queue = this.order();
      const first = Math.ceil(this.count / 8);
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
      const f0 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
      const f1 = Math.min(n - 1, f0 + 1);
      const blend = pos - f0;

      const img0 = this.nearest(f0);
      if (!img0) return;

      const c = this.canvas, cw = c.width, ch = c.height;

      // Frame base (f0)
      const iw0 = img0.naturalWidth, ih0 = img0.naturalHeight;
      const s0 = Math.max(cw / iw0, ch / ih0);
      const dw0 = iw0 * s0, dh0 = ih0 * s0;
      const x0 = (cw - dw0) / 2, y0 = (ch - dh0) / 2;

      this.ctx.globalAlpha = 1.0;
      this.ctx.drawImage(img0, x0, y0, dw0, dh0);

      // Disolución sub-frame (f1) para continuidad analógica hiperfluida
      if (blend > 0.005 && f1 !== f0) {
        const img1 = this.nearest(f1);
        if (img1 && img1 !== img0) {
          const iw1 = img1.naturalWidth, ih1 = img1.naturalHeight;
          const s1 = Math.max(cw / iw1, ch / ih1);
          const dw1 = iw1 * s1, dh1 = ih1 * s1;
          const x1 = (cw - dw1) / 2, y1 = (ch - dh1) / 2;
          this.ctx.globalAlpha = blend;
          this.ctx.drawImage(img1, x1, y1, dw1, dh1);
          this.ctx.globalAlpha = 1.0;
        }
      }
    }

    update(y, dt) {
      const p = clamp((y - this.top) / this.len);
      const n = this.count;

      // frame suavizado con aceleración y amortiguación reactiva
      const target = p * (n - 1);
      const k = reduce ? 1 : 1 - Math.pow(1 - 0.22, dt * 60);
      this.cur += (target - this.cur) * k;
      if (Math.abs(target - this.cur) < 0.002) this.cur = target;

      if (Math.abs(this.cur - this.lastCur) > 0.003 || this.dirty) {
        this.draw(this.cur);
        this.lastCur = this.cur;
        this.dirty = false;
        const displayFrame = Math.round(this.cur);
        if (displayFrame !== this.lastFrame) {
          this.lastFrame = displayFrame;
          const s = Math.floor(displayFrame / this.fps), ff = displayFrame % this.fps;
          if (this.tc) this.tc.textContent = `00:00:${pad(s)}:${pad(ff)}`;
          if (this.fr) this.fr.textContent = pad(displayFrame + 1, 3);
        }
      }

      if (Math.abs(p - this.p) < 0.00005) return;
      this.p = p;
      const st = this.stage.style;

      // hero (opcional: solo la primera secuencia lo tiene)
      if (this.hero) {
        const hp = range(p, 0, 0.08);
        this.hero.style.opacity = 1 - smooth(hp);
        this.hero.style.transform = `translate3d(0, ${-hp * 8}vh, 0)`;
        this.hero.style.visibility = hp >= 1 ? "hidden" : "visible";
      }

      // empuje inicial, visor y cierre
      const e = smooth(range(p, 0.88, 1));
      st.setProperty("--zoom", (1.05 - 0.05 * smooth(range(p, 0, 0.20)) + e * 0.02).toFixed(4));
      st.setProperty("--hud", (range(p, 0.04, 0.10) * (1 - range(p, 0.86, 0.92))).toFixed(3));
      st.setProperty("--rail", p.toFixed(4));
      st.setProperty("--dim", (e * 0.45).toFixed(3));
      const padPx = this.padPx || 24;
      st.setProperty("--inset-x", `${(e * Math.max(padPx, vw * 0.03)).toFixed(1)}px`);
      st.setProperty("--inset-y", `${(e * Math.max(56, vh * 0.1)).toFixed(1)}px`);
      st.setProperty("--radius", `${(e * 4).toFixed(2)}px`);

      // capítulos
      this.layers.forEach(({ n: el, r: [a, b] }) => {
        const t = (p - a) / (b - a);
        if (t <= 0 || t >= 1) {
          if (el.style.opacity !== "0") el.style.opacity = "0";
          return;
        }
        const o = smooth(Math.min(range(t, 0, 0.22), 1 - range(t, 0.78, 1)));
        const dir = t < 0.5 ? 1 : -1;
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((1 - o) * 26 * dir).toFixed(1)}px, 0)`;
        el.style.filter = o > 0.98 ? "none" : `blur(${((1 - o) * 8).toFixed(1)}px)`;
      });
    }
  }

  const sequences = $$(".seq").map((el) => new Sequence(el));

  /* ---------------------------------------------------------
     Loader
     --------------------------------------------------------- */
  const loaderCount = $("[data-loader-count]");
  const loaderBar = $("[data-loader-bar]");
  let loadTarget = 0, loadShown = 0, ready = false;
  const t0 = performance.now();

  function setReady() {
    if (ready) return;
    ready = true;
    loaderCount.textContent = "100";
    loaderBar.style.transform = "scaleX(1)";
    setTimeout(() => {
      body.classList.add("is-ready");
      body.classList.remove("is-loading");
      if (lenis) lenis.start();
      measureAll();
    }, 350);
  }

  if (sequences.length) {
    sequences[0].load(undefined, (v) => { loadTarget = v; });
    sequences.slice(1).forEach((s) => s.load());
  } else loadTarget = 1;
  setTimeout(setReady, 7000); // red lenta: no retener al visitante

  /* ---------------------------------------------------------
     Revelados al entrar en pantalla
     --------------------------------------------------------- */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      revealIO.unobserve(en.target);
      if (en.target.matches(".stat")) countUp(en.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

  $$("[data-reveal], [data-split], [data-sheen]").forEach((el) => {
    // pequeño escalonado entre hermanos
    const sib = el.parentElement ? $$(":scope > [data-reveal]", el.parentElement) : [];
    const idx = sib.indexOf(el);
    if (idx > 0) el.style.setProperty("--d", `${Math.min(idx, 5) * 0.08}s`);
    revealIO.observe(el);
  });

  function countUp(stat) {
    const el = $("[data-count]", stat);
    if (!el) return;
    const to = +el.dataset.count, start = performance.now(), dur = 1800;
    const tick = (now) => {
      const t = clamp((now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 4)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
     Tema claro / oscuro según la sección
     --------------------------------------------------------- */
  const themeIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) body.dataset.theme = en.target.dataset.themeSection;
    });
  }, { rootMargin: "-50% 0px -50% 0px" });
  $$("[data-theme-section]").forEach((s) => themeIO.observe(s));

  /* ---------------------------------------------------------
     Elementos ligados al scroll (solo si están visibles)
     --------------------------------------------------------- */
  const visible = new WeakMap();
  const visIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => visible.set(en.target, en.isIntersecting));
  }, { rootMargin: "20% 0px 20% 0px" });

  wordBlocks.forEach((b) => visIO.observe(b.el));
  const parallax = $$("[data-parallax]");
  parallax.forEach((el) => visIO.observe(el));
  const strip = $("[data-strip]");
  const stripSec = strip && strip.closest("section");
  if (stripSec) visIO.observe(stripSec);
  const steps = $("[data-steps]");
  const stepItems = steps ? $$(".step", steps) : [];
  if (steps) visIO.observe(steps);
  const nextFrame = $(".next__frame");
  const nextTc = $("[data-next-tc]");
  if (nextFrame) visIO.observe(nextFrame);
  const sheen = $("[data-sheen]");
  if (sheen) visIO.observe(sheen);

  function scrollLinked() {
    // palabras que se encienden
    wordBlocks.forEach((b) => {
      if (!visible.get(b.el)) return;
      const r = b.el.getBoundingClientRect();
      const p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.3));
      const lit = p * (b.words.length + 4) - 2;
      if (Math.abs(lit - b.last) < 0.02) return;
      b.last = lit;
      b.words.forEach((w, i) => {
        w.style.setProperty("--o", (0.14 + 0.86 * clamp(lit - i)).toFixed(3));
      });
    });

    // parallax de imágenes
    parallax.forEach((el) => {
      if (!visible.get(el)) return;
      const r = el.getBoundingClientRect();
      const c = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.setProperty("--py", `${(-c * (+el.dataset.parallax) * 100).toFixed(2)}%`);
    });

    // tira horizontal
    if (stripSec && visible.get(stripSec)) {
      const r = stripSec.getBoundingClientRect();
      const t = clamp((vh - r.top) / (vh + r.height));
      const max = strip.scrollWidth - vw + 40;
      strip.style.setProperty("--sx", `${(-t * max).toFixed(1)}px`);
    }

    // método: línea que se dibuja
    if (steps && visible.get(steps)) {
      const r = steps.getBoundingClientRect();
      const vertical = vw <= 760;
      const p = vertical
        ? clamp((vh * 0.72 - r.top) / r.height)
        : clamp((vh * 0.85 - r.top) / (vh * 0.5));
      steps.style.setProperty("--sl", p.toFixed(4));
      stepItems.forEach((s) => {
        const at = vertical ? s.offsetTop / r.height : s.offsetLeft / r.width;
        const on = p >= at + 0.01 || p >= 0.999;
        s.classList.toggle("is-on", on);
        s.style.setProperty("--on", on ? 1 : 0);
      });
    }

    // próxima producción: reflejo que cruza
    if (nextFrame && visible.get(nextFrame)) {
      const r = nextFrame.getBoundingClientRect();
      const t = clamp((vh - r.top) / (vh + r.height));
      nextFrame.style.setProperty("--nx", `${(-80 + t * 160).toFixed(1)}%`);
    }

    // reflejo sobre el título de contacto
    if (sheen && visible.get(sheen)) {
      const r = sheen.getBoundingClientRect();
      const t = clamp((vh - r.top) / (vh + r.height * 0.4));
      sheen.style.setProperty("--sh", `${(-20 + t * 140).toFixed(1)}%`);
    }
  }

  /* ---------------------------------------------------------
     Servicios: vista previa que sigue al cursor
     --------------------------------------------------------- */
  const svc = $("[data-svc]");
  const preview = $(".svc__preview");
  const pv = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  if (svc && preview && finePointer) {
    const pimg = $("img", preview);
    $$(".svc__row", svc).forEach((row) => {
      const pre = new Image(); pre.src = row.dataset.img;
      row.addEventListener("mouseenter", () => {
        if (pimg.getAttribute("src") !== row.dataset.img) pimg.src = row.dataset.img;
        preview.classList.add("is-on"); pv.on = true;
      });
    });
    svc.addEventListener("mouseleave", () => { preview.classList.remove("is-on"); pv.on = false; });
    svc.addEventListener("mousemove", (e) => {
      pv.tx = e.clientX; pv.ty = e.clientY;
      if (!pv.init) { pv.x = pv.tx; pv.y = pv.ty; pv.init = true; }
    });
  }
  function updatePreview(dt) {
    if (!preview || !pv.init) return;
    const k = 1 - Math.pow(1 - 0.12, dt * 60);
    const dx = (pv.tx - pv.x) * k;
    pv.x += dx; pv.y += (pv.ty - pv.y) * k;
    const w = preview.offsetWidth, h = preview.offsetHeight;
    preview.style.setProperty("--mx", `${(pv.x - w / 2).toFixed(1)}px`);
    preview.style.setProperty("--my", `${(pv.y - h / 2).toFixed(1)}px`);
    preview.style.setProperty("--rot", `${clamp(dx * 0.35, -5, 5).toFixed(2)}deg`);
  }

  /* ---------------------------------------------------------
     Menú móvil y anclas
     --------------------------------------------------------- */
  const toggle = $(".nav__toggle");
  const menu = $("#menu");
  function setMenu(open) {
    body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", open);
    menu.setAttribute("aria-hidden", !open);
    if (lenis) open ? lenis.stop() : lenis.start();
    body.style.overflow = open ? "hidden" : "";
  }
  toggle.addEventListener("click", () => setMenu(!body.classList.contains("menu-open")));

  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      const target = id === "#top" || id === "#film-01" ? 0 : $(id);
      if (target === null) return;
      e.preventDefault();
      const wasOpen = body.classList.contains("menu-open");
      if (wasOpen) setMenu(false);
      setTimeout(() => scrollToTarget(target), wasOpen ? 450 : 0);
    });
  });

  /* ---------------------------------------------------------
     Nav: transparente sobre el film, sólida y discreta después
     --------------------------------------------------------- */
  const nav = $(".nav");
  let navAcc = 0;
  function updateNav(y, dy) {
    const firstSeq = sequences[0];
    const inFilm = firstSeq ? y < firstSeq.top + firstSeq.len + vh * 0.5 : y < 40;
    nav.classList.toggle("is-solid", !inFilm);
    if (inFilm || body.classList.contains("menu-open")) { nav.classList.remove("is-hidden"); navAcc = 0; return; }
    navAcc = Math.sign(dy) === Math.sign(navAcc) ? navAcc + dy : dy;
    if (navAcc > 60) nav.classList.add("is-hidden");
    else if (navAcc < -30) nav.classList.remove("is-hidden");
  }

  /* ---------------------------------------------------------
     Reloj de Buenos Aires
     --------------------------------------------------------- */
  const clock = $("[data-clock]");
  const fmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
  const tickClock = () => { if (clock) clock.textContent = fmt.format(new Date()); };
  tickClock(); setInterval(tickClock, 15000);

  /* ---------------------------------------------------------
     Medidas y bucle principal
     --------------------------------------------------------- */
  function measureAll() {
    vw = innerWidth; vh = innerHeight;
    sequences.forEach((s) => s.measure());
    sequences.forEach((s) => { s.p = -1; s.dirty = true; });
  }
  let rT;
  addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(measureAll, 120); });
  addEventListener("load", measureAll);
  if (document.fonts) document.fonts.ready.then(measureAll);

  let last = performance.now();
  let lastY = -1;
  let tcStart = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (lenis) lenis.raf(now);

    // loader
    if (!ready) {
      loadShown += (loadTarget - loadShown) * 0.08;
      const v = Math.round(loadShown * 100);
      loaderCount.textContent = pad(Math.min(99, v));
      loaderBar.style.transform = `scaleX(${loadShown.toFixed(3)})`;
      if (loadTarget >= 1 && loadShown > 0.985 && now - t0 > 1200) setReady();
    }

    const y = scrollY();
    sequences.forEach((s) => s.update(y, dt));
    if (y !== lastY) { scrollLinked(); updateNav(y, y - lastY); lastY = y; }
    updatePreview(dt);

    // timecode "en postproducción"
    if (nextTc && visible.get(nextFrame)) {
      if (!tcStart) tcStart = now;
      const f = Math.floor(((now - tcStart) / 1000) * 25);
      const s = Math.floor(f / 25);
      nextTc.textContent = `00:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % 25)}`;
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
