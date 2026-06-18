(function () {
  const API_BASE = window.SUTRA_API_URL || "http://127.0.0.1:8000";
  const form = document.getElementById("research-form");
  if (!form) return;

  const submitButton = document.getElementById("research-submit");
  const loading = document.getElementById("research-loading");
  const results = document.getElementById("research-results");
  const errorPanel = document.getElementById("research-error");
  const errorMessage = document.getElementById("error-message");
  const loadingMessage = document.getElementById("loading-message");
  const videoBranch = document.getElementById("video-branch");
  const videoIntake = document.getElementById("video-intake");
  const videoPreview = document.getElementById("video-brief-preview");
  const loadingSteps = [
    "Structuring your business context...",
    "Mapping likely audience segments...",
    "Reading motivations and buying friction...",
    "Shaping channels and campaign directions...",
    "Normalising the final research report..."
  ];
  let loadingTimer;
  let latestReportResponse = null;

  function value(id) {
    const element = document.getElementById(id);
    return element ? element.value.trim() : "";
  }

  function optionalUrl(id) {
    return value(id) || null;
  }

  function competitorUrls() {
    return value("competitor_urls")
      .split(/[\n,]+/)
      .map((url) => url.trim())
      .filter(Boolean);
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    submitButton.classList.toggle("is-loading", isLoading);
    submitButton.querySelector(".submit-label").textContent = isLoading
      ? "Analysing"
      : "Generate research";

    if (isLoading) {
      loading.hidden = false;
      results.hidden = true;
      errorPanel.hidden = true;
      let index = 0;
      loadingMessage.textContent = loadingSteps[index];
      clearInterval(loadingTimer);
      loadingTimer = setInterval(() => {
        index = (index + 1) % loadingSteps.length;
        loadingMessage.textContent = loadingSteps[index];
      }, 2800);
      loading.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      clearInterval(loadingTimer);
      loading.hidden = true;
    }
  }

  function setText(id, text, fallback) {
    const element = document.getElementById(id);
    element.textContent = text || fallback || "Not enough information yet.";
  }

  function renderList(id, values, ordered) {
    const list = document.getElementById(id);
    list.replaceChildren();
    const items = Array.isArray(values) && values.length
      ? values
      : ["Not enough information yet."];

    items.forEach((item, index) => {
      const li = document.createElement("li");
      if (ordered) {
        const number = document.createElement("span");
        number.textContent = String(index + 1).padStart(2, "0");
        li.append(number);
      }
      const text = document.createElement("p");
      text.textContent = item;
      li.append(text);
      list.append(li);
    });
  }

  function renderChips(id, values) {
    const container = document.getElementById(id);
    container.replaceChildren();
    const items = Array.isArray(values) && values.length ? values : ["Not specified"];
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.textContent = item;
      container.append(chip);
    });
  }

  function renderReport(response) {
    latestReportResponse = response;
    const report = response.report_json || {};
    setText("business-summary", report.business_summary);
    setText("target-audience-overview", report.target_audience_overview);
    setText("primary-segment", report.primary_segment);
    setText("secondary-segment", report.secondary_segment);
    setText("demographic-analysis", report.demographic_analysis);
    setText("socioeconomic-analysis", report.socioeconomic_analysis);
    setText("behavioral-analysis", report.behavioral_analysis);

    renderChips("age-groups", report.age_groups);
    renderList("buying-motivations", report.buying_motivations);
    renderList("pain-points", report.pain_points);
    renderChips("best-marketing-channels", report.best_marketing_channels);
    renderList("campaign-angles", report.campaign_angles, true);
    renderList("missing-information", report.missing_information);
    renderList("follow-up-questions", report.recommended_follow_up_questions, true);

    const confidence = (report.confidence_score || "unknown").toLowerCase();
    const badge = document.getElementById("confidence-badge");
    badge.textContent = `Confidence · ${confidence}`;
    badge.dataset.level = confidence;
    document.getElementById("report-id").textContent = `Report ${response.report_id}`;
    document.getElementById("result-title").textContent =
      `${value("business_name") || "Your business"}, brought into focus.`;

    results.hidden = false;
    results.classList.remove("is-visible");
    requestAnimationFrame(() => results.classList.add("is-visible"));
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function firstItem(values, fallback) {
    return Array.isArray(values) && values.length ? values[0] : fallback;
  }

  function selectValue(id) {
    const element = document.getElementById(id);
    return element ? element.value : "";
  }

  function showVideoBranch() {
    if (!videoBranch) return;
    videoBranch.hidden = false;
    videoBranch.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderVideoBrief(event) {
    event.preventDefault();
    if (!latestReportResponse) return;

    const report = latestReportResponse.report_json || {};
    const businessName = value("business_name") || "this business";
    const duration = selectValue("video_duration") || "15 seconds";
    const platform = selectValue("video_platform") || "Instagram Reels";
    const goal = selectValue("video_goal") || "Awareness";
    const cta = value("video_cta") || "Learn more";
    const style = value("video_style") || "Keep it sharp, credible, and rooted in the audience insight.";
    const audience = report.primary_segment || report.target_audience_overview || "The likely primary audience from the research report.";
    const hook = firstItem(
      report.campaign_angles,
      "Open with the clearest pain point or aspiration from the research report."
    );

    document.getElementById("video-brief-title").textContent =
      `${duration} ${platform} direction for ${businessName}`;
    setText("brief-audience", audience);
    setText("brief-hook", hook);
    setText("brief-cta", cta);

    const scenes = [
      {
        label: "0-3s",
        title: "Pattern-break hook",
        body: `${hook} Show the audience problem immediately, using a visual that feels native to ${platform}.`
      },
      {
        label: "3-7s",
        title: "Audience mirror",
        body: `Reflect the primary segment: ${audience}`
      },
      {
        label: "7-12s",
        title: "Product proof",
        body: `${report.business_summary || "Introduce the product clearly."} Add product shots, proof points, or founder voice.`
      },
      {
        label: "Final beat",
        title: "CTA",
        body: `${cta}. Style notes: ${style} Goal: ${goal}.`
      }
    ];

    const sceneList = document.getElementById("brief-scenes");
    sceneList.replaceChildren();
    scenes.forEach((scene) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const title = document.createElement("b");
      const body = document.createElement("p");
      label.textContent = scene.label;
      title.textContent = scene.title;
      body.textContent = scene.body;
      item.append(label, title, body);
      sceneList.append(item);
    });

    videoPreview.hidden = false;
    videoPreview.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function friendlyError(error, responseStatus) {
    if (error.name === "AbortError") {
      return "The analysis took too long. Check that the backend is still running, then try again.";
    }
    if (responseStatus === 502) {
      return `${error.message} Check the OpenRouter key, model access, and account credits.`;
    }
    if (responseStatus === 422) {
      return error.message || "Some form details were not accepted. Check the fields and try again.";
    }
    if (error instanceof TypeError) {
      return "The frontend could not reach the backend. Keep Uvicorn running on port 8000 and try again.";
    }
    return error.message || "An unexpected error occurred. Check the backend terminal for details.";
  }

  async function generateResearch(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const payload = {
      business_name: value("business_name"),
      industry: value("industry") || null,
      location: value("location") || null,
      business_description: value("business_description") || null,
      website_url: optionalUrl("website_url"),
      instagram_url: optionalUrl("instagram_url"),
      linkedin_url: optionalUrl("linkedin_url"),
      competitor_urls: competitorUrls()
    };

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75000);
    let responseStatus;

    try {
      const response = await fetch(`${API_BASE}/api/research/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      responseStatus = response.status;
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg).join(" ")
          : data.detail;
        throw new Error(detail || `The backend returned status ${response.status}.`);
      }

      setLoading(false);
      renderReport(data);
    } catch (error) {
      setLoading(false);
      errorMessage.textContent = friendlyError(error, responseStatus);
      errorPanel.hidden = false;
      errorPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      clearTimeout(timeout);
    }
  }

  form.addEventListener("submit", generateResearch);
  document.getElementById("error-retry").addEventListener("click", () => {
    errorPanel.hidden = true;
    form.requestSubmit();
  });
  document.getElementById("new-research").addEventListener("click", () => {
    results.hidden = true;
    latestReportResponse = null;
    if (videoBranch) videoBranch.hidden = true;
    if (videoPreview) videoPreview.hidden = true;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("business_name").focus({ preventScroll: true });
  });
  document.querySelectorAll(".creative-choice[data-format='video']").forEach((button) => {
    button.addEventListener("click", showVideoBranch);
  });
  if (videoIntake) {
    videoIntake.addEventListener("submit", renderVideoBrief);
  }
})();
