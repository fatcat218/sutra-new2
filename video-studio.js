/* Campaign Video Studio — UI logic. Provider/store logic lives in
 * video-provider.js and video-store.js and is intentionally not duplicated here. */
(function () {
  "use strict";

  const client = window.sutraSupabase;
  const provider = window.sutraVideoProvider;
  const store = window.sutraVideoStore;

  const main = document.getElementById("studio-main");
  const authLoading = document.getElementById("studio-auth-loading");
  const sourceNote = document.getElementById("studio-source");
  const stepsEl = document.getElementById("studio-steps");
  const errorEl = document.getElementById("studio-error");

  const panels = {
    brief: document.getElementById("studio-brief"),
    plan: document.getElementById("studio-plan"),
    generation: document.getElementById("studio-generation"),
    preview: document.getElementById("studio-preview"),
  };

  const form = document.getElementById("studio-form");
  const insightsBody = document.getElementById("studio-insights-body");
  const imageInput = document.getElementById("vs-image");
  const imageClear = document.getElementById("vs-image-clear");
  const imagePreview = document.getElementById("vs-image-preview");
  const loadDemoButton = document.getElementById("vs-load-demo");
  const briefStatus = document.getElementById("studio-brief-status");

  const storyboardEl = document.getElementById("studio-storyboard");
  const insightsUsedWrap = document.getElementById("studio-insights-used");
  const insightsUsedList = document.getElementById("studio-insights-used-list");
  const phasesEl = document.getElementById("studio-phases");

  const playerFrame = document.getElementById("studio-player-frame");
  const playerScenes = document.getElementById("studio-player-scenes");
  const playerToggle = document.getElementById("player-toggle");
  const playerDots = document.getElementById("player-dots");
  const playerSceneLabel = document.getElementById("player-scene-label");
  const previewPlanTitle = document.getElementById("preview-plan-title");
  const previewMeta = document.getElementById("studio-preview-meta");
  const saveStatus = document.getElementById("studio-save-status");
  const backDashboard = document.getElementById("preview-back-dashboard");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    sessionId: null,
    sessionTitle: "",
    report: null,
    config: null,
    plan: null,
    variant: 0,
    brandImage: null,
    projectId: null,
    player: { index: 0, timer: null, playing: false },
    pollTimer: null,
  };

  /* ---------------------------------------------------------------- utils */
  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
  }

  function hideError() {
    errorEl.hidden = true;
  }

  function redirectToLogin() {
    window.location.replace("chatbot.html");
  }

  async function apiJson(path) {
    const response = await window.sutraApiFetch(path);
    if (response.status === 401) {
      await client?.auth.signOut({ scope: "local" });
      redirectToLogin();
      throw new Error("Your session ended.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status}).`);
    return data;
  }

  function showStep(name) {
    hideError();
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = key !== name;
    });
    const stepKey = name === "generation" ? "preview" : name;
    [...stepsEl.children].forEach((item) => {
      const current = item.dataset.step === stepKey;
      item.classList.toggle("is-current", current);
      if (current) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    stopPlayer();
    if (name !== "generation") stopPolling();
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  /* ------------------------------------------------------------- source */
  function describeSource() {
    if (state.sessionTitle || state.sessionId) {
      sourceNote.hidden = false;
      sourceNote.textContent = `Source research: ${state.sessionTitle || `session #${state.sessionId}`}`;
    }
  }

  function insightRow(label, value) {
    if (!value) return null;
    const row = el("div", "studio-insight-row");
    row.append(el("b", null, label), el("span", null, value));
    return row;
  }

  function renderInsights() {
    const report = state.report || {};
    const rows = [
      insightRow("Audience", clean(report.target_audience_overview) || clean(report.primary_segment)),
      insightRow("Top channel", Array.isArray(report.best_marketing_channels) ? clean(String(report.best_marketing_channels[0] || "")) : ""),
      insightRow("Key motivation", Array.isArray(report.buying_motivations) ? clean(String(report.buying_motivations[0] || "")) : ""),
      insightRow("Main pain point", Array.isArray(report.pain_points) ? clean(String(report.pain_points[0] || "")) : ""),
    ].filter(Boolean);
    if (!rows.length) return;
    insightsBody.replaceChildren(...rows);
    const audience = clean(report.target_audience_overview) || clean(report.primary_segment);
    const audienceField = document.getElementById("vs-audience");
    if (audience && !audienceField.value) audienceField.value = audience;
  }

  async function loadSource() {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = Number(params.get("session"));
    let stash = null;
    try {
      stash = JSON.parse(localStorage.getItem("sutra_video_source") || "null");
    } catch { stash = null; }

    if (Number.isFinite(sessionParam) && sessionParam > 0) {
      state.sessionId = sessionParam;
      if (stash && Number(stash.sessionId) === sessionParam) {
        state.sessionTitle = clean(stash.title);
      }
      describeSource();
      try {
        const data = await apiJson(`/api/chat/${sessionParam}/report`);
        state.report = data.report_json || null;
        renderInsights();
      } catch {
        /* Report unavailable — the studio still works from the brief alone. */
        if (stash?.report) {
          state.report = stash.report;
          renderInsights();
        }
      }
    }
  }

  /* --------------------------------------------------------------- brief */
  function platformLabel() {
    const select = document.getElementById("vs-platform");
    return select.options[select.selectedIndex]?.textContent || "Instagram Reel";
  }

  function platformAspect() {
    const select = document.getElementById("vs-platform");
    return select.options[select.selectedIndex]?.dataset.aspect || "9:16";
  }

  function collectConfig() {
    return {
      objective: document.getElementById("vs-objective").value,
      audience: clean(document.getElementById("vs-audience").value),
      platform: document.getElementById("vs-platform").value,
      platformLabel: platformLabel().replace(/\s*\(.*\)$/, ""),
      aspect: platformAspect(),
      duration: Number(document.getElementById("vs-duration").value),
      tone: document.getElementById("vs-tone").value,
      language: document.getElementById("vs-language").value,
      cta: clean(document.getElementById("vs-cta").value),
      brand: clean(document.getElementById("vs-brand").value),
      productDescription: clean(document.getElementById("vs-description").value),
      sessionId: state.sessionId,
      sessionTitle: state.sessionTitle,
    };
  }

  function applyDemoBrief() {
    document.getElementById("vs-objective").value = "awareness";
    document.getElementById("vs-platform").value = "instagram-reel";
    document.getElementById("vs-duration").value = "15";
    document.getElementById("vs-tone").value = "Energetic";
    document.getElementById("vs-language").value = "English";
    document.getElementById("vs-cta").value = "Find your next run";
    document.getElementById("vs-audience").value = "Urban runners aged 18–30";
    document.getElementById("vs-brand").value = "Nike running shoes";
    document.getElementById("vs-description").value =
      "Lightweight running shoes for city streets — responsive cushioning, breathable fit, built for daily miles. (Concept demonstration — fictional sample content, no brand affiliation.)";
    briefStatus.textContent =
      "Sample brief loaded. This is a concept demonstration with fictional content.";
  }

  function saveStatusMessage(message) {
    saveStatus.textContent = message;
  }

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      state.brandImage = null;
      imagePreview.hidden = true;
      imageClear.hidden = true;
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      imageInput.value = "";
      state.brandImage = null;
      imagePreview.hidden = true;
      imagePreview.removeAttribute("src");
      imageClear.hidden = true;
      showError("Choose an image smaller than 5 MB.");
      return;
    }
    hideError();
    const reader = new FileReader();
    reader.onload = () => {
      state.brandImage = String(reader.result || "");
      imagePreview.src = state.brandImage;
      imagePreview.hidden = false;
      imageClear.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  imageClear.addEventListener("click", () => {
    imageInput.value = "";
    state.brandImage = null;
    imagePreview.hidden = true;
    imagePreview.removeAttribute("src");
    imageClear.hidden = true;
  });

  loadDemoButton.addEventListener("click", applyDemoBrief);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    hideError();
    state.config = collectConfig();
    state.variant = 0;
    state.plan = provider.buildConcept(state.config, state.report, state.variant);
    state.projectId = null;
    renderPlan();
    showStep("plan");
  });

  /* ---------------------------------------------------------------- plan */
  function sceneCard(scene, index) {
    const card = el("article", "studio-scene-card");
    card.dataset.sceneIndex = String(index);
    card.style.setProperty("--di", index);

    const head = el("div", "studio-scene-head");
    head.append(
      el("span", "studio-scene-num", String(index + 1).padStart(2, "0")),
      el("h4", null, scene.label),
      el("span", "studio-scene-duration", `${scene.duration}s`)
    );

    const direction = el("label", "field");
    direction.append(el("span", null, "Scene direction"));
    const directionInput = document.createElement("textarea");
    directionInput.rows = 2;
    directionInput.maxLength = 300;
    directionInput.value = scene.direction;
    directionInput.dataset.field = "direction";
    direction.append(directionInput);

    const onScreen = el("label", "field");
    onScreen.append(el("span", null, "On-screen text"));
    const onScreenInput = document.createElement("input");
    onScreenInput.type = "text";
    onScreenInput.maxLength = 120;
    onScreenInput.value = scene.onScreenText;
    onScreenInput.dataset.field = "onScreenText";
    onScreen.append(onScreenInput);

    const voice = el("label", "field");
    voice.append(el("span", null, "Voiceover"));
    const voiceInput = document.createElement("input");
    voiceInput.type = "text";
    voiceInput.maxLength = 160;
    voiceInput.value = scene.voiceover;
    voiceInput.dataset.field = "voiceover";
    voice.append(voiceInput);

    card.append(head, direction, onScreen, voice);
    return card;
  }

  function renderPlan() {
    const plan = state.plan;
    document.getElementById("plan-title").value = plan.title;
    document.getElementById("plan-angle").value = plan.angle;
    document.getElementById("plan-hook").value = plan.hook;
    document.getElementById("plan-script").value = plan.script;
    document.getElementById("plan-cta").value = plan.cta;

    storyboardEl.classList.remove("is-revealed");
    storyboardEl.replaceChildren(...plan.scenes.map(sceneCard));
    /* Two frames so the un-revealed state paints before the staggered reveal. */
    requestAnimationFrame(() =>
      requestAnimationFrame(() => storyboardEl.classList.add("is-revealed"))
    );

    if (plan.insightsUsed?.length) {
      insightsUsedWrap.hidden = false;
      insightsUsedList.replaceChildren(
        ...plan.insightsUsed.map((item) => el("li", null, item))
      );
    } else {
      insightsUsedWrap.hidden = true;
    }
  }

  function collectPlanEdits() {
    const plan = state.plan;
    plan.title = clean(document.getElementById("plan-title").value) || plan.title;
    plan.angle = clean(document.getElementById("plan-angle").value) || plan.angle;
    plan.hook = clean(document.getElementById("plan-hook").value) || plan.hook;
    plan.script = clean(document.getElementById("plan-script").value) || plan.script;
    plan.cta = clean(document.getElementById("plan-cta").value) || plan.cta;
    storyboardEl.querySelectorAll(".studio-scene-card").forEach((card) => {
      const scene = plan.scenes[Number(card.dataset.sceneIndex)];
      if (!scene) return;
      card.querySelectorAll("[data-field]").forEach((field) => {
        const value = clean(field.value);
        if (value) scene[field.dataset.field] = value;
      });
    });
    /* Keep the final scene's on-screen text in step with an edited CTA. */
    const last = plan.scenes[plan.scenes.length - 1];
    if (last && last.label === "Final CTA") {
      last.onScreenText = plan.cta;
      last.voiceover = plan.cta;
    }
  }

  document.getElementById("plan-back").addEventListener("click", () => showStep("brief"));

  document.getElementById("plan-regenerate").addEventListener("click", () => {
    state.variant += 1;
    state.plan = provider.buildConcept(state.config, state.report, state.variant);
    renderPlan();
    saveStatusMessage("");
  });

  document.getElementById("plan-approve").addEventListener("click", async () => {
    collectPlanEdits();
    await runGeneration();
  });

  /* ----------------------------------------------------------- generation */
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function setPhase(status) {
    const order = ["queued", "preparing_scenes", "rendering_preview", "completed"];
    const reached = order.indexOf(status);
    [...phasesEl.children].forEach((item, index) => {
      item.classList.toggle("is-active", index === reached);
      item.classList.toggle("is-done", index < reached);
    });
  }

  async function runGeneration() {
    hideError();
    showStep("generation");
    setPhase("queued");
    try {
      const { jobId } = await provider.createJob({
        config: state.config,
        plan: state.plan,
      });
      stopPolling();
      state.pollTimer = setInterval(async () => {
        try {
          const { status } = await provider.getJobStatus(jobId);
          setPhase(status);
          if (status === "completed") {
            stopPolling();
            await provider.getResult(jobId);
            /* Brief pause so "Completed" is readable before the switch. */
            setTimeout(() => {
              renderPreview();
              showStep("preview");
              startPlayer();
            }, reducedMotion.matches ? 0 : 550);
          }
        } catch (error) {
          stopPolling();
          showStep("plan");
          showError(error.message || "The mock generation failed.");
        }
      }, 450);
    } catch (error) {
      showStep("plan");
      showError(error.message || "Could not start the mock generation.");
    }
  }

  /* -------------------------------------------------------------- preview */
  function buildSceneSlide(scene, index, palette) {
    const slide = el("div", "studio-slide");
    slide.dataset.index = String(index);
    slide.style.background = index % 2 === 0 ? palette.bg : palette.panel;
    slide.style.color = palette.text;

    const label = el("span", "studio-slide-label", scene.label);
    label.style.color = palette.accent;
    slide.append(label);

    if (state.brandImage && (scene.label === "Product in motion" || scene.label === "Brand moment")) {
      const img = document.createElement("img");
      img.src = state.brandImage;
      img.alt = "";
      img.className = "studio-slide-image";
      slide.append(img);
    } else if (scene.label === "Product in motion" || scene.label === "Brand moment") {
      /* Neutral placeholder mark — simple shape, no fake product shots. */
      const placeholder = el("div", "studio-slide-placeholder");
      placeholder.style.borderColor = palette.accent;
      placeholder.append(el("span", null, state.config?.brand?.[0]?.toUpperCase() || "S"));
      slide.append(placeholder);
    }

    slide.append(el("p", "studio-slide-text", scene.onScreenText || ""));
    const vo = el("p", "studio-slide-vo", scene.voiceover ? `VO: ${scene.voiceover}` : "");
    vo.style.color = palette.accent;
    slide.append(vo);
    return slide;
  }

  function renderPreview() {
    const plan = state.plan;
    const palette = plan.palette;
    playerFrame.dataset.aspect = state.config.aspect || "9:16";
    playerScenes.replaceChildren(
      ...plan.scenes.map((scene, index) => buildSceneSlide(scene, index, palette))
    );

    playerDots.replaceChildren(
      ...plan.scenes.map((scene, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "studio-player-dot";
        dot.setAttribute("aria-label", `Scene ${index + 1}: ${scene.label}`);
        dot.addEventListener("click", () => {
          goToScene(index);
          pausePlayer();
        });
        return dot;
      })
    );

    previewPlanTitle.textContent = plan.title;
    previewMeta.replaceChildren();
    [
      ["Platform", `${state.config.platformLabel} · ${state.config.aspect}`],
      ["Duration", `${state.config.duration}s across ${plan.scenes.length} scenes`],
      ["Tone", state.config.tone],
      ["Language", state.config.language],
      ["Angle", plan.angle],
      ["Source", state.sessionTitle || (state.sessionId ? `Session #${state.sessionId}` : "Brief only")],
    ].forEach(([label, value]) => {
      if (!value) return;
      previewMeta.append(el("dt", null, label), el("dd", null, value));
    });

    goToScene(0);
  }

  function goToScene(index) {
    const slides = [...playerScenes.children];
    if (!slides.length) return;
    state.player.index = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === state.player.index));
    [...playerDots.children].forEach((dot, i) => {
      dot.classList.toggle("is-active", i === state.player.index);
      dot.setAttribute("aria-pressed", i === state.player.index ? "true" : "false");
    });
    const scene = state.plan.scenes[state.player.index];
    playerSceneLabel.textContent =
      `Scene ${state.player.index + 1} of ${state.plan.scenes.length} — ${scene.label} (${scene.duration}s)`;
  }

  function scheduleNext() {
    const scene = state.plan.scenes[state.player.index];
    const ms = Math.max(1200, (scene?.duration || 3) * 1000);
    state.player.timer = setTimeout(() => {
      goToScene(state.player.index + 1);
      scheduleNext();
    }, ms);
  }

  function startPlayer() {
    stopPlayer();
    if (reducedMotion.matches) {
      /* Reduced motion: no auto-advance; scenes are browsed with the dots. */
      state.player.playing = false;
      playerToggle.textContent = "Play";
      playerToggle.setAttribute("aria-pressed", "false");
      goToScene(0);
      return;
    }
    state.player.playing = true;
    playerToggle.textContent = "Pause";
    playerToggle.setAttribute("aria-pressed", "true");
    scheduleNext();
  }

  function pausePlayer() {
    if (state.player.timer) clearTimeout(state.player.timer);
    state.player.timer = null;
    state.player.playing = false;
    playerToggle.textContent = "Play";
    playerToggle.setAttribute("aria-pressed", "false");
  }

  function stopPlayer() {
    if (state.player.timer) clearTimeout(state.player.timer);
    state.player.timer = null;
    state.player.playing = false;
  }

  playerToggle.addEventListener("click", () => {
    if (state.player.playing) {
      pausePlayer();
    } else {
      state.player.playing = true;
      playerToggle.textContent = "Pause";
      playerToggle.setAttribute("aria-pressed", "true");
      scheduleNext();
    }
  });

  /* ------------------------------------------------------- preview actions */
  document.getElementById("preview-edit").addEventListener("click", () => {
    renderPlan();
    showStep("plan");
  });

  document.getElementById("preview-regenerate").addEventListener("click", () => {
    state.variant += 1;
    state.plan = provider.buildConcept(state.config, state.report, state.variant);
    renderPlan();
    showStep("plan");
    saveStatusMessage("New concept generated from the same brief — review and approve it.");
  });

  document.getElementById("preview-new-version").addEventListener("click", async () => {
    state.variant += 1;
    state.plan = provider.buildConcept(state.config, state.report, state.variant);
    state.projectId = null; /* a new version saves as a new project */
    await runGeneration();
  });

  document.getElementById("preview-save").addEventListener("click", async () => {
    const button = document.getElementById("preview-save");
    button.disabled = true;
    saveStatusMessage("Saving project…");
    try {
      const record = await store.saveProject({
        id: state.projectId || undefined,
        title: state.plan.title,
        config: state.config,
        plan: state.plan,
        report: state.report,
        brandImage: state.brandImage,
        status: "preview-ready",
        source: {
          sessionId: state.sessionId,
          sessionTitle: state.sessionTitle,
        },
      });
      state.projectId = record.id;
      saveStatusMessage(
        record.brandImageDropped
          ? "Project saved on this device (image was too large to keep)."
          : "Project saved on this device. Find it in the Creative Library."
      );
    } catch (error) {
      saveStatusMessage(error.message || "Could not save the project.");
    } finally {
      button.disabled = false;
    }
  });

  /* -------------------------------------------------------- open a project */
  async function loadProject(projectId) {
    const project = await store.getProject(projectId);
    if (!project) {
      showError("That saved project could not be found on this device.");
      return;
    }
    state.projectId = project.id;
    state.config = project.config;
    state.plan = project.plan;
    state.report = project.report || null;
    state.variant = project.plan?.variant || 0;
    state.brandImage = project.brandImage || null;
    state.sessionId = project.source?.sessionId || null;
    state.sessionTitle = project.source?.sessionTitle || "";
    describeSource();
    renderPreview();
    showStep("preview");
    startPlayer();
    saveStatusMessage("Loaded from the Creative Library.");
  }

  /* ----------------------------------------------------------------- boot */
  if (backDashboard) backDashboard.href = "chatbot.html";

  client?.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) redirectToLogin();
  });

  if (!client) {
    redirectToLogin();
  } else {
    window.sutraGetSession().then(async (session) => {
      if (!session) {
        redirectToLogin();
        return;
      }
      authLoading.hidden = true;
      main.hidden = false;
      const params = new URLSearchParams(window.location.search);
      const projectParam = params.get("project");
      try {
        if (projectParam) {
          await loadProject(projectParam);
        } else {
          await loadSource();
        }
      } catch (error) {
        showError(error.message || "Could not load the studio source.");
      }
    });
  }
})();
