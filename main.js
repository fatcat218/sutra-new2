
const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, {threshold:0.1});
  document.querySelectorAll('.section, .problem, .social, .experience').forEach(el=>{
    el.classList.add('reveal');
    io.observe(el);
  });

  // ── Global interactive ring grid ──
  (function() {
    const canvas = document.getElementById('ring-grid');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dpr = window.devicePixelRatio || 1;
    let vw = window.innerWidth;
    let vh = window.innerHeight;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      vw = window.innerWidth;
      vh = window.innerHeight;
      canvas.width  = vw * dpr;
      canvas.height = vh * dpr;
      canvas.style.width  = vw + 'px';
      canvas.style.height = vh + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: vw / 2, y: vh / 2, active: false, lastMove: 0 };
    let smoothX = mouse.x, smoothY = mouse.y;

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      mouse.lastMove = performance.now();
    });
    window.addEventListener('mouseleave', () => { mouse.active = false; });

    // touch
    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
        mouse.active = true;
      }
    }, { passive: true });

    const SPACING = 28;
    const RANGE = 180;

    // pre-compute jitter per dot for organic feel
    const jitter = new Map();
    function getJitter(c, r) {
      const k = c + ',' + r;
      if (!jitter.has(k)) {
        const seed = (c * 13 + r * 31) % 100;
        jitter.set(k, {
          ox: ((seed * 7) % 7) - 3,
          oy: ((seed * 11) % 7) - 3,
          phase: (seed / 100) * Math.PI * 2
        });
      }
      return jitter.get(k);
    }

    let t0 = performance.now();
    function draw(now) {
      const t = (now - t0) / 1000;

      // smoothly follow mouse
      const lerp = 0.12;
      smoothX += (mouse.x - smoothX) * lerp;
      smoothY += (mouse.y - smoothY) * lerp;

      // when no mouse, drift gently
      const effectiveX = mouse.active ? smoothX : (vw/2 + Math.sin(t * 0.25) * vw * 0.18);
      const effectiveY = mouse.active ? smoothY : (vh/2 + Math.cos(t * 0.2) * vh * 0.12);

      ctx.clearRect(0, 0, vw, vh);

      const cols = Math.ceil(vw / SPACING) + 2;
      const rows = Math.ceil(vh / SPACING) + 2;
      const offsetX = (vw - cols * SPACING) / 2;
      const offsetY = (vh - rows * SPACING) / 2;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const j = getJitter(c, r);
          const x = offsetX + c * SPACING + j.ox;
          const y = offsetY + r * SPACING + j.oy;

          const dx = x - effectiveX;
          const dy = y - effectiveY;
          const dist = Math.hypot(dx, dy);

          let influence = 0;
          if (dist < RANGE) influence = 1 - dist / RANGE;
          influence = influence * influence; // ease

          // gentle drift in idle
          const breathe = 0.5 + 0.5 * Math.sin(t * 0.5 + j.phase);

          const baseAlpha = 0.10 + breathe * 0.04;
          const alpha = baseAlpha + influence * 0.55;
          const radius = 1.1 + influence * 3.2;

          // Active dots become rings (outlined); ambient ones stay as soft dots
          if (influence > 0.15) {
            // ring
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(6,40,30,${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
            // inner brightness
            ctx.beginPath();
            ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(6,64,43,${alpha * 0.9})`;
            ctx.fill();
          } else {
            // soft dot
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(6,40,30,${alpha})`;
            ctx.fill();
          }
        }
      }

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  })();


  // ── Accordion Interaction ──
  (function() {
    const panels = document.querySelectorAll('.flow-panel');
    if (!panels.length) return;

    function activatePanel(index) {
      panels.forEach(p => p.classList.remove('active'));
      panels[index].classList.add('active');
    }

    panels.forEach((panel, i) => {
      panel.addEventListener('mouseenter', () => activatePanel(i));
      panel.addEventListener('click', () => activatePanel(i));
    });
  })();
