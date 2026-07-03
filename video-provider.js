/*
 * video-provider.js — TEMPORARY Mock Video Provider for the Campaign Video Studio.
 *
 * Interface (stable — a real provider such as Runway or HeyGen should implement
 * the same three methods and replace this file without UI changes):
 *
 *   sutraVideoProvider.buildConcept(config, report, variant) -> plan   (sync)
 *   sutraVideoProvider.createJob(config)                     -> Promise<{ jobId }>
 *   sutraVideoProvider.getJobStatus(jobId)                   -> Promise<{ status, detail }>
 *   sutraVideoProvider.getResult(jobId)                      -> Promise<{ renderSpec }>
 *
 * This mock never calls any external service. Results are deterministic
 * functions of the user's inputs, and every output is labelled a
 * "Concept preview" — it is not a real AI-generated video.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------ seeding */
  function hashString(input) {
    let hash = 5381;
    const text = String(input || "");
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  }

  function makeRng(seed) {
    let value = seed >>> 0;
    return function next() {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length) % list.length];
  }

  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cleanList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => clean(String(item ?? ""))).filter(Boolean);
  }

  /* ------------------------------------------------------- palette pool */
  /* Editorial palettes in the Sutra family — no gradients, no neon. */
  const PALETTES = [
    { name: "Forest",   bg: "#0B3D2A", panel: "#0F4A33", text: "#F1EEE6", accent: "#C9E3D4" },
    { name: "Paper",    bg: "#F1EEE6", panel: "#FFFFFF", text: "#12201A", accent: "#06402B" },
    { name: "Ink",      bg: "#12201A", panel: "#1B2B23", text: "#F1EEE6", accent: "#8FC2A5" },
    { name: "Moss",     bg: "#274A38", panel: "#2F5643", text: "#F4F1E9", accent: "#DCE8DE" },
    { name: "Sand",     bg: "#E7E0D0", panel: "#F4F0E6", text: "#1E2C24", accent: "#0A5A3C" },
  ];

  /* ------------------------------------------------------ content pools */
  const ANGLES = {
    energetic: [
      "Momentum you can feel from the first frame",
      "Fast cuts, real movement, zero filler",
      "The city is the gym — meet it head on",
    ],
    confident: [
      "Let the product do the talking",
      "One promise, proven in fifteen seconds",
      "Quiet authority over loud claims",
    ],
    warm: [
      "The everyday moment your product makes better",
      "Familiar faces, honest benefit",
      "Comfort first, performance close behind",
    ],
    minimal: [
      "One product. One benefit. One line.",
      "Strip everything that isn't the point",
      "White space sells the craft",
    ],
    playful: [
      "A wink, not a pitch",
      "Small joke, big recall",
      "Make them smile before you make the offer",
    ],
  };

  const HOOK_TEMPLATES = [
    (c) => `What if ${c.audienceShort} stopped settling?`,
    (c) => `${c.brand}: built for ${c.audienceShort}.`,
    (c) => `The first 2 seconds decide. Make them count for ${c.audienceShort}.`,
    (c) => `Made for the way ${c.audienceShort} actually live.`,
    (c) => `Stop scrolling — this is for ${c.audienceShort}.`,
  ];

  const BENEFIT_LINES = [
    "Show the benefit in use, not on a spec sheet",
    "Cut to the moment the problem disappears",
    "Let a real detail carry the claim",
    "One tight close-up that proves the promise",
  ];

  const BRAND_MOMENT_LINES = [
    "Product held to camera, logo readable, background quiet",
    "Name on screen, product centered, one beat of stillness",
    "Logo lockup over the product's best angle",
  ];

  const VO_OPENERS = [
    "This is where it starts.",
    "You know the feeling.",
    "No warm-up needed.",
    "Every day asks more of you.",
  ];

  /* --------------------------------------------------- scene templates */
  function sceneTemplates(config, rng, insights) {
    const brand = config.brand;
    const benefit =
      insights.motivation ||
      clean(config.productDescription).split(/[.;]/)[0] ||
      "the benefit your buyer cares about most";
    const pain = insights.painPoint;

    return [
      {
        label: "Opening hook",
        direction: `Cold open on movement — ${config.tone.toLowerCase()} energy, shot tight so the frame feels alive.`,
        onScreenText: config.hook,
        voiceover: pick(rng, VO_OPENERS),
      },
      {
        label: "Product in motion",
        direction: `${brand} in real use by ${config.audienceShort} — natural light, no studio gloss.`,
        onScreenText: brand,
        voiceover: `Meet ${brand}. Made for exactly this.`,
      },
      {
        label: "Benefit moment",
        direction: pick(rng, BENEFIT_LINES) + ".",
        onScreenText: benefit,
        voiceover: pain
          ? `Forget ${pain.toLowerCase().replace(/\.$/, "")}. This solves it.`
          : `Built around ${benefit.toLowerCase().replace(/\.$/, "")}.`,
      },
      {
        label: "Brand moment",
        direction: pick(rng, BRAND_MOMENT_LINES) + ".",
        onScreenText: clean(config.productDescription)
          ? clean(config.productDescription).split(/[.;]/)[0]
          : `${brand} — no compromises`,
        voiceover: `${brand}. ${config.objective === "consideration" ? "Worth a closer look." : "Remember the name."}`,
      },
      {
        label: "Final CTA",
        direction: "Hold one clean frame. CTA large, centered, high contrast. Nothing else moves.",
        onScreenText: config.cta,
        voiceover: config.cta,
      },
    ];
  }

  /* ------------------------------------------------ insights from report */
  function extractInsights(report, rng) {
    const source = report && typeof report === "object" ? report : {};
    const motivations = cleanList(source.buying_motivations);
    const painPoints = cleanList(source.pain_points);
    const channels = cleanList(source.best_marketing_channels);
    const segments = cleanList(source.key_audience_segments);
    return {
      motivation: motivations.length ? pick(rng, motivations) : "",
      painPoint: painPoints.length ? pick(rng, painPoints) : "",
      topChannel: channels[0] || "",
      primarySegment:
        clean(source.primary_segment) || segments[0] || "",
      audienceOverview: clean(source.target_audience_overview),
      headline: clean(source.dashboard_headline),
    };
  }

  /* ------------------------------------------------------- plan builder */
  function normalizeConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const audience = clean(config.audience) || "your target audience";
    return {
      objective: clean(config.objective) || "awareness",
      audience,
      audienceShort: audience.length > 48 ? audience.slice(0, 45) + "…" : audience,
      platform: clean(config.platform) || "instagram-reel",
      platformLabel: clean(config.platformLabel) || "Instagram Reel",
      aspect: clean(config.aspect) || "9:16",
      duration: Math.max(6, Math.min(120, Number(config.duration) || 15)),
      tone: clean(config.tone) || "Confident",
      language: clean(config.language) || "English",
      cta: clean(config.cta) || "Learn more",
      brand: clean(config.brand) || "Your product",
      productDescription: clean(config.productDescription),
      sessionId: config.sessionId ?? null,
      sessionTitle: clean(config.sessionTitle),
    };
  }

  function buildConcept(rawConfig, report, variant) {
    const config = normalizeConfig(rawConfig);
    const seed = hashString(
      JSON.stringify([
        config.objective, config.audience, config.platform, config.duration,
        config.tone, config.language, config.cta, config.brand,
        config.productDescription, variant || 0,
      ])
    );
    const rng = makeRng(seed);
    const insights = extractInsights(report, rng);

    const toneKey = config.tone.toLowerCase().split(/[ ,]/)[0];
    const anglePool =
      ANGLES[toneKey] ||
      ANGLES[pick(rng, Object.keys(ANGLES))];

    config.hook = pick(rng, HOOK_TEMPLATES)(config);

    const scenes = sceneTemplates(config, rng, insights);
    /* Distribute duration across scenes: hook and CTA slightly shorter. */
    const weights = [0.16, 0.24, 0.24, 0.2, 0.16];
    let allocated = 0;
    scenes.forEach((scene, index) => {
      const isLast = index === scenes.length - 1;
      const seconds = isLast
        ? Math.max(1, Math.round((config.duration - allocated) * 10) / 10)
        : Math.max(1, Math.round(config.duration * weights[index] * 10) / 10);
      allocated += seconds;
      scene.duration = seconds;
      scene.id = `scene-${index + 1}`;
    });

    const palette = PALETTES[seed % PALETTES.length];

    return {
      version: 1,
      variant: variant || 0,
      title: `${config.brand} — ${config.platformLabel} concept`,
      angle: pick(rng, anglePool),
      hook: config.hook,
      script: scenes
        .map((scene) => `${scene.label}: ${scene.voiceover}`)
        .join("\n"),
      scenes,
      cta: config.cta,
      language: config.language,
      palette,
      insightsUsed: [
        insights.motivation && `Buying motivation: ${insights.motivation}`,
        insights.painPoint && `Pain point addressed: ${insights.painPoint}`,
        insights.topChannel && `Top channel from research: ${insights.topChannel}`,
        insights.primarySegment && `Primary segment: ${insights.primarySegment}`,
      ].filter(Boolean),
      disclaimer:
        "Concept preview assembled from your plan. Not a final AI-generated video.",
    };
  }

  /* ----------------------------------------------------- mock job engine */
  const jobs = new Map();
  const PHASES = [
    { status: "queued", detail: "Waiting in the render queue", after: 0 },
    { status: "preparing_scenes", detail: "Preparing scenes from your storyboard", after: 1400 },
    { status: "rendering_preview", detail: "Rendering the concept preview", after: 3400 },
    { status: "completed", detail: "Concept preview ready", after: 5200 },
  ];

  function createJob(rawPayload) {
    const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
    const jobId = `mockjob-${Date.now().toString(36)}-${hashString(JSON.stringify(payload)) % 10000}`;
    /* Small deterministic wobble so runs feel real but repeatable. */
    const wobble = (hashString(jobId) % 900);
    jobs.set(jobId, {
      startedAt: performance.now(),
      wobble,
      payload,
    });
    return Promise.resolve({ jobId });
  }

  function phaseFor(job) {
    const elapsed = performance.now() - job.startedAt;
    let current = PHASES[0];
    for (const phase of PHASES) {
      if (elapsed >= phase.after + (phase.after ? job.wobble : 0)) current = phase;
    }
    return current;
  }

  function getJobStatus(jobId) {
    const job = jobs.get(jobId);
    if (!job) return Promise.reject(new Error("Unknown job."));
    const phase = phaseFor(job);
    return Promise.resolve({ status: phase.status, detail: phase.detail });
  }

  function getResult(jobId) {
    const job = jobs.get(jobId);
    if (!job) return Promise.reject(new Error("Unknown job."));
    const phase = phaseFor(job);
    if (phase.status !== "completed") {
      return Promise.reject(new Error("The preview is not ready yet."));
    }
    return Promise.resolve({
      renderSpec: {
        kind: "concept-preview",
        plan: job.payload.plan || null,
        config: job.payload.config || null,
        completedAt: new Date().toISOString(),
      },
    });
  }

  window.sutraVideoProvider = {
    name: "mock",
    label: "Mock Video Provider (temporary)",
    buildConcept,
    createJob,
    getJobStatus,
    getResult,
  };
})();
