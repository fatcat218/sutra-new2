
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
    let activeIndex = 0;
    let autoPlay;

    function activatePanel(index) {
      panels.forEach(p => p.classList.remove('active'));
      panels[index].classList.add('active');
      activeIndex = index;
    }

    function startAutoPlay() {
      stopAutoPlay();
      autoPlay = setInterval(() => {
        activatePanel((activeIndex + 1) % panels.length);
      }, 4000);
    }

    function stopAutoPlay() {
      if (autoPlay) clearInterval(autoPlay);
    }

    panels.forEach((panel, i) => {
      panel.addEventListener('mouseenter', () => {
        stopAutoPlay();
        activatePanel(i);
      });
      panel.addEventListener('mouseleave', () => {
        startAutoPlay();
      });
      panel.addEventListener('click', () => {
        stopAutoPlay();
        activatePanel(i);
        startAutoPlay();
      });
    });

    startAutoPlay();
  })();

  // ── CIM canvas orbital animation (refined, palette-only) ──
  function initCIMCanvas() {
    const canvas = document.querySelector('.cim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Handle high-DPI
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width;
    const H = canvas.height;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.scale(dpr, dpr);
    }

    const cx = W/2, cy = H/2;

    // Site palette only — monochrome elegance
    const ACCENT      = '#06402B';
    const ACCENT_SOFT = '#0A5A3C';
    const ACCENT_DEEP = '#063D29';
    const ACCENT_3    = '#1E7A4F';
    const INK_SOFT    = '#2F6B4E';
    const PAPER_RGB   = '241,238,230';

    const layers = [
      { label:'Demographics', color:ACCENT,      r:140, speed: 0.0026, angle:0.3,  size:6,   trail:[] },
      { label:'Behavioural',  color:ACCENT_SOFT, r: 92, speed:-0.0042, angle:1.7,  size:5.5, trail:[] },
      { label:'Cultural',     color:ACCENT_3,    r:165, speed: 0.0033, angle:3.4,  size:6,   trail:[] },
      { label:'Regional',     color:INK_SOFT,    r: 65, speed:-0.0055, angle:5.0,  size:5,   trail:[] },
    ];

    let particles = [];
    let frame = 0;

    function loop() {
      ctx.clearRect(0, 0, W, H);

      // Static graphic substrate — concentric orbit rings
      layers.forEach((l, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, l.r, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(6,40,30,${0.05 + (i%2)*0.025})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([1.5, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Compute node positions and trails
      layers.forEach(l => {
        l.angle += l.speed;
        l.x = cx + Math.cos(l.angle) * l.r;
        l.y = cy + Math.sin(l.angle) * l.r;
        l.trail.push({ x: l.x, y: l.y });
        if (l.trail.length > 24) l.trail.shift();
      });

      // Fading trails for orbital motion
      layers.forEach(l => {
        if (l.trail.length < 2) return;
        for (let i = 1; i < l.trail.length; i++) {
          const op = (i / l.trail.length) * 0.45;
          ctx.beginPath();
          ctx.moveTo(l.trail[i-1].x, l.trail[i-1].y);
          ctx.lineTo(l.trail[i].x, l.trail[i].y);
          ctx.strokeStyle = l.color;
          ctx.globalAlpha = op;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });

      // Constellation lines — appear when nodes drift close
      for (let i = 0; i < layers.length; i++) {
        for (let j = i+1; j < layers.length; j++) {
          const dx = layers[i].x - layers[j].x;
          const dy = layers[i].y - layers[j].y;
          const dist = Math.hypot(dx, dy);
          const T = 130;
          if (dist < T) {
            const op = (1 - dist/T) * 0.18;
            ctx.beginPath();
            ctx.moveTo(layers[i].x, layers[i].y);
            ctx.lineTo(layers[j].x, layers[j].y);
            ctx.strokeStyle = `rgba(6,64,43,${op})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      // Spokes from each node to center, then nodes
      layers.forEach(l => {
        // Spoke
        const grad = ctx.createLinearGradient(l.x, l.y, cx, cy);
        grad.addColorStop(0, l.color + '40');
        grad.addColorStop(1, l.color + '00');
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(cx, cy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      });

      layers.forEach(l => {
        // Soft outer halo
        const haloG = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.size * 3.5);
        haloG.addColorStop(0, l.color + '38');
        haloG.addColorStop(1, l.color + '00');
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.size * 3.5, 0, Math.PI*2);
        ctx.fillStyle = haloG;
        ctx.fill();

        // Outer ring
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.size, 0, Math.PI*2);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.size * 0.4, 0, Math.PI*2);
        ctx.fillStyle = l.color;
        ctx.fill();

        // Label — refined typography, subtle paper backing for legibility
        const cosA = Math.cos(l.angle);
        const sinA = Math.sin(l.angle);
        const align = cosA > 0 ? 'left' : 'right';
        const labelX = l.x + cosA * 16;
        const labelY = l.y + sinA * 14;
        ctx.font = '500 10.5px "Geist", sans-serif';
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        const mw = ctx.measureText(l.label).width;
        // backing
        const padX = 7, padY = 4;
        const boxX = align === 'left' ? labelX - padX : labelX - mw - padX;
        ctx.fillStyle = `rgba(${PAPER_RGB},0.92)`;
        ctx.fillRect(boxX, labelY - 7 - padY/2, mw + padX*2, 14 + padY);
        // text
        ctx.fillStyle = ACCENT_DEEP;
        ctx.fillText(l.label, labelX, labelY);
      });

      // Emit a particle from a random layer periodically
      if (frame % 65 === 0) {
        const l = layers[Math.floor(Math.random() * layers.length)];
        particles.push({
          sx: l.x, sy: l.y, tx: cx, ty: cy,
          progress: 0, speed: 0.011,
          color: l.color
        });
      }

      // Particles flowing toward the center, with easing + halo
      particles = particles.filter(p => p.progress < 1);
      particles.forEach(p => {
        p.progress = Math.min(1, p.progress + p.speed);
        const t = p.progress;
        const eased = t * t * (3 - 2 * t);
        const px = p.sx + (p.tx - p.sx) * eased;
        const py = p.sy + (p.ty - p.sy) * eased;
        // halo
        ctx.save();
        ctx.globalAlpha = (1 - p.progress) * 0.35;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI*2);
        ctx.fillStyle = p.color;
        ctx.fill();
        // core
        ctx.globalAlpha = (1 - p.progress * 0.6) * 0.9;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI*2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
      });

      // CENTER — refined concentric core
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.022);
      // breathing halo
      const haloR = 26 + pulse * 5;
      const haloGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, haloR);
      haloGrad.addColorStop(0, 'rgba(6,64,43,0.35)');
      haloGrad.addColorStop(1, 'rgba(6,64,43,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI*2);
      ctx.fillStyle = haloGrad;
      ctx.fill();

      // outer thin ring
      ctx.beginPath();
      ctx.arc(cx, cy, 19, 0, Math.PI*2);
      ctx.strokeStyle = ACCENT + '60';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // mid ring
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI*2);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // core disc
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI*2);
      ctx.fillStyle = ACCENT;
      ctx.fill();

      // S monogram
      ctx.font = 'italic 600 13px "Instrument Serif", serif';
      ctx.fillStyle = `rgba(${PAPER_RGB},0.95)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', cx, cy + 0.5);

      frame++;
      requestAnimationFrame(loop);
    }
    loop();
  }

  // defer canvas until fonts/layout settled
  setTimeout(initCIMCanvas, 300);

  // ── CIM layers stagger-in ──
  // Observe the methodology section and trigger child animations
  const methodObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      // stagger cim layers
      e.target.querySelectorAll('.cim-layer').forEach((l, i) => {
        setTimeout(() => l.classList.add('visible'), 200 + i * 160);
      });
      // stagger vp steps
      e.target.querySelectorAll('.vp-step').forEach((s, i) => {
        setTimeout(() => s.classList.add('visible'), 100 + i * 130);
      });
      methodObs.unobserve(e.target);
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.methodology-section').forEach(el => methodObs.observe(el));

