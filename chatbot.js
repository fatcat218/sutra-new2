(function () {
  const client = window.sutraSupabase;
  const main = document.getElementById("chatbot-main");
  const authLoading = document.getElementById("chatbot-auth-loading");
  const authGate = document.getElementById("chatbot-auth-gate");
  const authForm = document.getElementById("chatbot-account-form");
  const authModeButtons = document.querySelectorAll("[data-chatbot-auth-mode]");
  const authNameField = document.getElementById("chatbot-account-name-field");
  const authName = document.getElementById("chatbot-account-name");
  const authEmail = document.getElementById("chatbot-account-email");
  const authPassword = document.getElementById("chatbot-account-password");
  const forgotPassword = document.getElementById("chatbot-forgot-password");
  const authSubmit = document.getElementById("chatbot-account-submit");
  const authError = document.getElementById("chatbot-account-error");
  const authSuccess = document.getElementById("chatbot-account-success");
  const profileName = document.querySelector("[data-profile-name]");
  const profileEmail = document.querySelector("[data-profile-email]");
  const profileInitials = document.querySelector("[data-profile-initials]");

  const sessionList = document.getElementById("chatbot-session-list");
  const sessionTitle = document.getElementById("chatbot-session-title");
  const messages = document.getElementById("chatbot-messages");
  const composer = document.getElementById("chatbot-composer");
  const input = document.getElementById("chatbot-input");
  const sendButton = document.getElementById("chatbot-send");
  const newChatButton = document.getElementById("new-chat-button");
  const reportButton = document.getElementById("chatbot-report-button");
  const reportStatus = document.getElementById("chatbot-dashboard-status");
  const reportSection = document.getElementById("chatbot-report");
  const reportTitle = document.getElementById("chatbot-report-title");
  const reportMeta = document.getElementById("chatbot-report-meta");
  const reportScore = document.getElementById("chatbot-score");
  const reportGrid = document.getElementById("chatbot-report-grid");
  const reportRefresh = document.getElementById("chatbot-report-refresh");
  const reportPrint = document.getElementById("chatbot-report-print");
  const errorEl = document.getElementById("chatbot-error");

  const state = {
    sessionId: null,
    stage: "intake",
    busy: false,
    authMode: "login",
    initializing: false,
    workspaceUserId: null,
    userMessageCount: 0,
    reportAvailable: false,
    reportLoaded: false,
    reportCreatedAt: null,
  };

  function resetWorkspace() {
    state.sessionId = null;
    state.stage = "intake";
    state.busy = false;
    state.workspaceUserId = null;
    state.userMessageCount = 0;
    state.reportAvailable = false;
    state.reportLoaded = false;
    state.reportCreatedAt = null;
    messages.replaceChildren();
    sessionList.replaceChildren();
    reportGrid.replaceChildren();
    reportSection.hidden = true;
    reportButton.hidden = false;
    reportButton.disabled = true;
    reportButton.textContent = "Build dashboard";
    reportStatus.textContent = "Describe your business to unlock the dashboard.";
    reportRefresh.disabled = false;
    input.value = "";
    input.disabled = false;
    sendButton.disabled = false;
    newChatButton.disabled = false;
  }

  function renderProfileEntry(user) {
    const name = user.user_metadata?.full_name || "Your account";
    const email = user.email || "";
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "U";
    profileName.textContent = name;
    profileEmail.textContent = email;
    profileInitials.textContent = initials;
  }

  function showAuthGate() {
    resetWorkspace();
    authLoading.hidden = true;
    main.hidden = true;
    authGate.hidden = false;
    setAuthMode(state.authMode);
  }

  function hideAuthMessages() {
    authError.hidden = true;
    authSuccess.hidden = true;
  }

  function setAuthMode(mode) {
    state.authMode = mode === "signup" ? "signup" : "login";
    const signingUp = state.authMode === "signup";
    authNameField.hidden = !signingUp;
    authName.required = signingUp;
    authPassword.autocomplete = signingUp ? "new-password" : "current-password";
    forgotPassword.hidden = signingUp;
    authSubmit.innerHTML = signingUp
      ? 'Create account'
      : 'Log in';
    authModeButtons.forEach((button) => {
      button.setAttribute(
        "aria-selected",
        button.dataset.chatbotAuthMode === state.authMode ? "true" : "false"
      );
    });
    hideAuthMessages();
  }

  function showAuthError(message) {
    authError.textContent = message;
    authError.hidden = false;
  }

  async function api(path, options = {}) {
    try {
      const response = await window.sutraApiFetch(path, options);
      if (response.status === 401) {
        await client.auth.signOut({ scope: "local" });
        showAuthGate();
        throw new Error("Your session ended. Log in again.");
      }
      return response;
    } catch (error) {
      if (error.message === "Sign in to continue.") showAuthGate();
      throw error;
    }
  }

  async function requestJson(path, options = {}) {
    const response = await api(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status}).`);
    return data;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
  }

  function setBusy(busy) {
    state.busy = busy;
    input.disabled = busy;
    sendButton.disabled = busy;
    newChatButton.disabled = busy;
    updateDashboardControls();
  }

  function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = `chatbot-message chatbot-message-${role}`;
    const label = document.createElement("span");
    label.className = "chatbot-message-label";
    label.textContent = role === "assistant" ? "Sutra" : "You";
    const bubble = document.createElement("div");
    bubble.className = "chatbot-message-bubble";
    bubble.textContent = String(text || "");
    row.append(label, bubble);
    messages.append(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function addTyping() {
    const row = document.createElement("div");
    row.className = "chatbot-message chatbot-message-assistant";
    row.id = "chatbot-typing";
    const label = document.createElement("span");
    label.className = "chatbot-message-label";
    label.textContent = "Sutra";
    const bubble = document.createElement("div");
    bubble.className = "chatbot-message-bubble chatbot-typing-bubble";
    bubble.innerHTML =
      '<span class="dot-typing"></span><span class="dot-typing"></span>' +
      '<span class="dot-typing"></span>';
    row.append(label, bubble);
    messages.append(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function removeTyping() {
    document.getElementById("chatbot-typing")?.remove();
  }

  function updateDashboardControls() {
    const hasSession = Boolean(state.sessionId);
    const canGenerate = hasSession && state.userMessageCount > 0;
    reportButton.hidden = !hasSession;
    reportButton.disabled =
      state.busy || (!state.reportAvailable && !canGenerate);
    reportRefresh.disabled = state.busy || !state.reportAvailable;
    const videoButton = document.getElementById("chatbot-report-video");
    if (videoButton) videoButton.disabled = state.busy || !state.reportAvailable;

    if (state.busy) {
      reportButton.textContent = state.reportAvailable
        ? "Updating dashboard..."
        : "Building dashboard...";
      reportStatus.textContent =
        "Analyzing your conversation and organizing the findings...";
      return;
    }
    if (state.reportAvailable) {
      reportButton.textContent = "View dashboard";
      reportStatus.textContent = "Dashboard saved — open it whenever you need it.";
      return;
    }

    reportButton.textContent = "Build dashboard";
    if (!canGenerate) {
      reportStatus.textContent = "Describe your business to unlock the dashboard.";
    } else if (state.stage === "ready_for_report") {
      reportStatus.textContent = "Sutra has enough context to build your dashboard.";
    } else {
      reportStatus.textContent =
        "Build now, or keep answering for a sharper dashboard.";
    }
  }

  function updateStage(stage, reportStatusValue) {
    state.stage = stage || state.stage;
    state.reportAvailable =
      reportStatusValue === "complete" ||
      state.stage === "report_generated";
    updateDashboardControls();
  }

  async function loadSessions() {
    const data = await requestJson("/api/chat/sessions");
    sessionList.replaceChildren();
    if (!data.sessions?.length) {
      const empty = document.createElement("p");
      empty.className = "chatbot-session-empty";
      empty.textContent = "Your conversations will appear here.";
      sessionList.append(empty);
      return data.sessions || [];
    }

    data.sessions.forEach((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chatbot-session-item";
      button.dataset.sessionId = String(session.session_id);
      if (session.session_id === state.sessionId) button.classList.add("is-active");
      const title = document.createElement("b");
      title.textContent = session.title || "Research chat";
      const meta = document.createElement("span");
      meta.textContent = new Date(session.updated_at).toLocaleDateString();
      button.append(title, meta);
      sessionList.append(button);
    });
    return data.sessions;
  }

  async function createSession() {
    hideError();
    reportSection.hidden = true;
    messages.replaceChildren();
    addTyping();
    try {
      const data = await requestJson("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "free", website_url: null }),
      });
      state.sessionId = data.session_id;
      state.userMessageCount = 0;
      state.reportAvailable = false;
      state.reportLoaded = false;
      state.reportCreatedAt = null;
      localStorage.setItem("sutra_active_session_id", String(state.sessionId));
      sessionTitle.textContent = "New research chat";
      updateStage(data.stage);
      addMessage("assistant", data.greeting);
      await loadSessions();
    } finally {
      removeTyping();
    }
  }

  async function openSession(session) {
    const data = await requestJson(`/api/chat/${session.session_id}/history`);
    state.sessionId = session.session_id;
    state.userMessageCount = data.messages.filter(
      (message) => message.role === "user"
    ).length;
    state.reportLoaded = false;
    state.reportCreatedAt = null;
    localStorage.setItem("sutra_active_session_id", String(state.sessionId));
    sessionTitle.textContent = session.title || "Research chat";
    messages.replaceChildren();
    data.messages.forEach((message) => addMessage(message.role, message.content));
    reportSection.hidden = true;
    updateStage(session.stage, session.report_status);
    if (state.reportAvailable) {
      await loadExistingReport({ scroll: false });
    }
    await loadSessions();
  }

  async function sendMessage(text) {
    const cleanText = String(text || "").trim();
    if (!cleanText || state.busy || !state.sessionId) return;
    hideError();
    addMessage("user", cleanText);
    input.value = "";
    input.style.height = "auto";
    setBusy(true);
    addTyping();

    try {
      const data = await requestJson("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, message: cleanText }),
      });
      removeTyping();
      addMessage("assistant", data.reply);
      state.userMessageCount += 1;
      updateStage(data.stage);
      const sessions = await loadSessions();
      const current = sessions.find((item) => item.session_id === state.sessionId);
      if (current) sessionTitle.textContent = current.title;
    } catch (error) {
      removeTyping();
      showError(error.message || "Could not send the message.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Dashboard rendering ──────────────────────────────────────────── */
  const scoreTrack = document.querySelector(".chatbot-score-track");
  const scoreBar = document.getElementById("chatbot-score-bar");
  const confidenceBadge = document.getElementById("chatbot-confidence");
  const dashLoading = document.getElementById("chatbot-dashboard-loading");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cleanList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => cleanText(String(item ?? ""))).filter(Boolean);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function animBlock(node) {
    node.classList.add("dash-anim");
    return node;
  }

  function staggerItems(nodes) {
    nodes.forEach((node, index) => node.style.setProperty("--di", index));
  }

  /* Block builders — each returns an element or null when there is no data. */
  function dashLead(text) {
    const value = cleanText(text);
    if (!value) return null;
    return animBlock(el("p", "dash-lead", value));
  }

  function dashStatement(label, text) {
    const value = cleanText(text);
    if (!value) return null;
    const block = el("div", "dash-statement");
    block.append(el("h4", "dash-label", label), el("p", null, value));
    return animBlock(block);
  }

  function dashNote(label, text) {
    const value = cleanText(text);
    if (!value) return null;
    const block = el("div", "dash-note");
    block.append(el("h4", "dash-label", label), el("p", null, value));
    return animBlock(block);
  }

  function dashSegmentPair(primary, secondary) {
    const p = cleanText(primary);
    const s = cleanText(secondary);
    if (!p && !s) return null;
    const row = el("div", "dash-segment-pair");
    [["Primary segment", p], ["Secondary segment", s]].forEach(([label, value]) => {
      if (!value) return;
      const card = el("article", "dash-segment");
      card.append(el("h4", "dash-label", label), el("p", null, value));
      row.append(card);
    });
    return animBlock(row);
  }

  function dashRanked(label, items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-ranked");
    block.append(el("h4", "dash-label", label));
    const list = el("ol", "dash-ranked-list");
    values.forEach((value, index) => {
      const item = el("li");
      item.append(
        el("span", "dash-rank-num", String(index + 1).padStart(2, "0")),
        el("span", "dash-rank-text", value)
      );
      list.append(item);
    });
    staggerItems([...list.children]);
    block.append(list);
    return animBlock(block);
  }

  function dashTags(label, items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-tags");
    block.append(el("h4", "dash-label", label));
    const row = el("ul", "dash-tag-row");
    values.forEach((value) => row.append(el("li", null, value)));
    staggerItems([...row.children]);
    block.append(row);
    return animBlock(block);
  }

  function dashColumns(label, pairs) {
    const filled = pairs
      .map(([columnLabel, text]) => [columnLabel, cleanText(text)])
      .filter(([, text]) => text);
    if (!filled.length) return null;
    const block = el("div", "dash-columns");
    if (label) block.append(el("h4", "dash-label", label));
    const row = el("div", "dash-column-row");
    filled.forEach(([columnLabel, text]) => {
      const column = el("div", "dash-column");
      column.append(el("h5", null, columnLabel), el("p", null, text));
      row.append(column);
    });
    staggerItems([...row.children]);
    block.append(row);
    return animBlock(block);
  }

  function dashCompare(leftLabel, leftItems, rightLabel, rightItems) {
    const left = cleanList(leftItems);
    const right = cleanList(rightItems);
    if (!left.length && !right.length) return null;
    const row = el("div", "dash-compare");
    [
      [leftLabel, left, "dash-compare-pos", "+"],
      [rightLabel, right, "dash-compare-neg", "−"],
    ].forEach(([label, values, klass, marker]) => {
      if (!values.length) return;
      const side = el("div", `dash-compare-side ${klass}`);
      side.append(el("h4", "dash-label", label));
      const list = el("ul");
      values.forEach((value) => {
        const item = el("li");
        item.append(el("span", "dash-marker", marker), el("span", null, value));
        list.append(item);
      });
      staggerItems([...list.children]);
      side.append(list);
      row.append(side);
    });
    return animBlock(row);
  }

  function dashMarkedList(label, items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-list");
    block.append(el("h4", "dash-label", label));
    const list = el("ul");
    values.forEach((value) => {
      const item = el("li");
      item.append(el("span", "dash-marker", "—"), el("span", null, value));
      list.append(item);
    });
    staggerItems([...list.children]);
    block.append(list);
    return animBlock(block);
  }

  function dashChannels(items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-channels");
    block.append(el("h4", "dash-label", "Recommended channels, in priority order"));
    const list = el("ol", "dash-channel-list");
    values.forEach((value, index) => {
      const item = el("li");
      item.append(
        el("span", "dash-rank-num", String(index + 1).padStart(2, "0")),
        el("span", "dash-channel-name", value),
        el("span", "dash-channel-tier", index === 0 ? "Start here" : "")
      );
      list.append(item);
    });
    staggerItems([...list.children]);
    block.append(list);
    return animBlock(block);
  }

  function dashActionPlan(items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-plan");
    block.append(el("h4", "dash-label", "Action plan"));
    const list = el("ol", "dash-plan-list");
    values.forEach((value, index) => {
      const item = el("li");
      item.append(
        el("span", "dash-plan-num", String(index + 1).padStart(2, "0")),
        el("p", null, value)
      );
      list.append(item);
    });
    staggerItems([...list.children]);
    block.append(list);
    return animBlock(block);
  }

  function dashCards(label, items) {
    const values = cleanList(items);
    if (!values.length) return null;
    const block = el("div", "dash-cards");
    block.append(el("h4", "dash-label", label));
    const row = el("ul", "dash-card-row");
    values.forEach((value) => row.append(el("li", null, value)));
    staggerItems([...row.children]);
    block.append(row);
    return animBlock(block);
  }

  function dashWarnPanel(missing, questions) {
    const gaps = cleanList(missing);
    const asks = cleanList(questions);
    if (!gaps.length && !asks.length) return null;
    const panel = el("aside", "dash-warn");
    panel.setAttribute("aria-label", "Missing information");
    panel.append(el("h4", "dash-label", "To strengthen this analysis"));
    if (gaps.length) {
      const wrap = el("div", "dash-warn-group");
      wrap.append(el("h5", null, "Missing information"));
      const list = el("ul");
      gaps.forEach((value) => list.append(el("li", null, value)));
      wrap.append(list);
      panel.append(wrap);
    }
    if (asks.length) {
      const wrap = el("div", "dash-warn-group");
      wrap.append(el("h5", null, "Worth answering next"));
      const list = el("ul");
      asks.forEach((value) => list.append(el("li", null, value)));
      wrap.append(list);
      panel.append(wrap);
    }
    return animBlock(panel);
  }

  function dashSection(number, title, blocks) {
    const content = blocks.filter(Boolean);
    if (!content.length) return null;
    const section = el("section", "dash-section");
    const head = el("header", "dash-section-head dash-anim");
    head.append(
      el("span", "dash-section-num", number),
      el("h3", null, title)
    );
    section.append(head, ...content);
    section
      .querySelectorAll(":scope > .dash-anim")
      .forEach((node, index) => node.style.setProperty("--db", index));
    return section;
  }

  /* Reveal-on-scroll (one-shot) */
  let revealObserver = null;
  function armReveals() {
    const targets = reportGrid.querySelectorAll(".dash-anim");
    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      targets.forEach((target) => target.classList.add("is-in"));
      return;
    }
    revealObserver?.disconnect();
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        });
      },
      /* Huge top margin: content scrolled past (fast scroll, End key,
         anchor jumps) still reveals instead of staying invisible. */
      { threshold: 0.12, rootMargin: "100000px 0px -4% 0px" }
    );
    targets.forEach((target) => revealObserver.observe(target));
  }

  /* Targeting score: count up + bar fill (real API value only) */
  let scoreFrame = null;
  function setScore(rawScore) {
    const score = Number(rawScore);
    const hasScore = Number.isFinite(score);
    if (scoreFrame) cancelAnimationFrame(scoreFrame);
    scoreTrack.hidden = !hasScore;
    if (!hasScore) {
      reportScore.textContent = "—";
      scoreBar.style.transform = "scaleX(0)";
      return;
    }
    const target = Math.max(0, Math.min(100, Math.round(score)));
    if (reducedMotion.matches) {
      reportScore.textContent = `${target}/100`;
      scoreBar.style.transition = "none";
      scoreBar.style.transform = `scaleX(${target / 100})`;
      return;
    }
    scoreBar.style.transition = "none";
    scoreBar.style.transform = "scaleX(0)";
    const started = performance.now();
    const duration = 700;
    requestAnimationFrame(() => {
      scoreBar.style.transition = "";
      scoreBar.style.transform = `scaleX(${target / 100})`;
    });
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      reportScore.textContent = `${Math.round(target * eased)}/100`;
      if (t < 1) scoreFrame = requestAnimationFrame(tick);
    };
    scoreFrame = requestAnimationFrame(tick);
  }

  function setConfidence(rawValue) {
    const value = cleanText(rawValue).toLowerCase();
    const known = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };
    if (!value) {
      confidenceBadge.hidden = true;
      return;
    }
    confidenceBadge.hidden = false;
    confidenceBadge.textContent = known[value] || `Confidence: ${cleanText(rawValue)}`;
    confidenceBadge.dataset.level = known[value] ? value : "other";
  }

  /* Honest loading phases — no fake percentages */
  let loadingTimer = null;
  function showDashboardLoading() {
    const phases = [...dashLoading.querySelectorAll("li")];
    phases.forEach((phase) => phase.classList.remove("is-active", "is-done"));
    phases[0]?.classList.add("is-active");
    let current = 0;
    clearInterval(loadingTimer);
    loadingTimer = setInterval(() => {
      if (current >= phases.length - 1) return;
      phases[current].classList.remove("is-active");
      phases[current].classList.add("is-done");
      current += 1;
      phases[current].classList.add("is-active");
    }, 1700);
    reportSection.hidden = false;
    dashLoading.hidden = false;
    reportGrid.classList.add("is-updating");
  }

  function hideDashboardLoading() {
    clearInterval(loadingTimer);
    loadingTimer = null;
    dashLoading.hidden = true;
    reportGrid.classList.remove("is-updating");
  }

  function formatReportDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "Saved to your Research Library";
    }
    return `Generated ${date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    })} · Saved to your Research Library`;
  }

  function renderReport(report, { createdAt = null, scroll = true } = {}) {
    reportTitle.textContent =
      cleanText(report.dashboard_headline) || "Your market intelligence";
    setScore(report.targeting_score);
    setConfidence(report.confidence_score);
    state.reportCreatedAt = createdAt;
    state.reportAvailable = true;
    state.reportLoaded = true;
    reportMeta.textContent = formatReportDate(createdAt);

    const sections = [
      dashSection("01", "Executive summary", [
        dashLead(report.business_summary),
        dashStatement("Primary audience", report.target_audience_overview),
        dashNote("Targeting summary", report.targeting_effectiveness_summary),
      ]),
      dashSection("02", "Audience analysis", [
        dashSegmentPair(report.primary_segment, report.secondary_segment),
        dashRanked("Key segments, ranked", report.key_audience_segments),
        dashTags("Age groups", report.age_groups),
        dashColumns("Audience insights", [
          ["Demographics", report.demographic_analysis],
          ["Socioeconomic", report.socioeconomic_analysis],
          ["Behaviour", report.behavioral_analysis],
        ]),
        dashCompare(
          "Buying motivations", report.buying_motivations,
          "Pain points", report.pain_points
        ),
      ]),
      dashSection("03", "Market analysis", [
        dashStatement("Market opportunity", report.market_opportunity_summary),
        dashColumnsPair(
          dashMarkedList("Engagement patterns", report.engagement_patterns),
          dashMarkedList("Behavioural trends", report.behavioral_trends)
        ),
        dashRanked("Opportunities", report.market_opportunities),
      ]),
      dashSection("04", "Marketing strategy", [
        dashChannels(report.best_marketing_channels),
        dashCards("Campaign angles", report.campaign_angles),
        dashActionPlan(report.actionable_recommendations),
        dashWarnPanel(
          report.missing_information,
          report.recommended_follow_up_questions
        ),
      ]),
    ].filter(Boolean);

    reportGrid.replaceChildren(...sections);
    reportGrid.classList.remove("is-updating");
    armReveals();

    reportSection.hidden = false;
    updateDashboardControls();
    if (scroll) {
      reportSection.scrollIntoView({
        behavior: reducedMotion.matches ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  /* Two blocks side by side (used for patterns + trends) */
  function dashColumnsPair(leftBlock, rightBlock) {
    const blocks = [leftBlock, rightBlock].filter(Boolean);
    if (!blocks.length) return null;
    if (blocks.length === 1) return blocks[0];
    const row = el("div", "dash-split");
    blocks.forEach((block) => {
      block.classList.remove("dash-anim");
      row.append(block);
    });
    return animBlock(row);
  }

  async function loadExistingReport({ scroll = true } = {}) {
    if (!state.sessionId) return;
    try {
      const data = await requestJson(`/api/chat/${state.sessionId}/report`);
      renderReport(data.report_json || {}, {
        createdAt: data.created_at,
        scroll,
      });
    } catch (error) {
      state.reportAvailable = false;
      state.reportLoaded = false;
      updateDashboardControls();
      throw error;
    }
  }

  async function generateDashboard() {
    if (state.busy || !state.sessionId || state.userMessageCount < 1) return;
    hideError();
    setBusy(true);
    showDashboardLoading();
    reportSection.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "nearest",
    });
    try {
      const data = await requestJson(`/api/chat/${state.sessionId}/generate-report`, {
        method: "POST",
      });
      hideDashboardLoading();
      updateStage(data.stage, "complete");
      renderReport(data.report_json || {}, {
        createdAt: data.created_at,
        scroll: true,
      });
      addMessage(
        "assistant",
        "Your dashboard is ready and saved in your Research Library."
      );
      await loadSessions();
    } catch (error) {
      hideDashboardLoading();
      if (!state.reportLoaded) reportSection.hidden = true;
      showError(error.message || "Could not build the dashboard.");
    } finally {
      setBusy(false);
    }
  }

  async function activateWorkspace(session) {
    if (
      state.initializing ||
      (state.workspaceUserId === session.user.id && !main.hidden)
    ) return;

    state.initializing = true;
    state.workspaceUserId = session.user.id;
    renderProfileEntry(session.user);
    authLoading.hidden = true;
    authGate.hidden = true;
    main.hidden = false;
    hideError();

    try {
      const pendingMessage =
        localStorage.getItem("sutra_pending_message") ||
        sessionStorage.getItem("sutra_pending_message");
      if (pendingMessage) {
        localStorage.removeItem("sutra_pending_message");
        sessionStorage.removeItem("sutra_pending_message");
        await createSession();
        await sendMessage(pendingMessage);
        return;
      }

      const sessions = await loadSessions();
      const savedId = Number(localStorage.getItem("sutra_active_session_id"));
      const saved = sessions.find((item) => item.session_id === savedId);
      if (saved) {
        await openSession(saved);
      } else if (sessions.length) {
        await openSession(sessions[0]);
      } else {
        await createSession();
      }
    } catch (error) {
      showError(error.message || "Could not load your research workspace.");
    } finally {
      state.initializing = false;
    }
  }

  authModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.chatbotAuthMode);
    });
  });

  forgotPassword.addEventListener("click", async () => {
    hideAuthMessages();
    const email = authEmail.value.trim();
    if (!email) {
      showAuthError("Enter your email address first, then choose Forgot password.");
      authEmail.focus();
      return;
    }
    if (!authEmail.checkValidity()) {
      authEmail.reportValidity();
      return;
    }

    forgotPassword.disabled = true;
    forgotPassword.textContent = "Sending reset link...";
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: new URL("reset-password.html", window.location.href).href,
      });
      if (error) throw error;
      authSuccess.textContent =
        "Password reset email sent. Open the link in that email to choose a new password.";
      authSuccess.hidden = false;
    } catch (error) {
      showAuthError(
        error.message || "Could not send the password reset email. Please try again."
      );
    } finally {
      forgotPassword.disabled = false;
      forgotPassword.textContent = "Forgot password?";
    }
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideAuthMessages();
    authSubmit.disabled = true;
    authSubmit.textContent =
      state.authMode === "signup" ? "Creating account..." : "Logging in...";

    try {
      let result;
      if (state.authMode === "signup") {
        result = await client.auth.signUp({
          email: authEmail.value.trim(),
          password: authPassword.value,
          options: {
            data: { full_name: authName.value.trim() },
            emailRedirectTo: new URL(
              "authentication-complete.html",
              window.location.href
            ).href,
          },
        });
      } else {
        result = await client.auth.signInWithPassword({
          email: authEmail.value.trim(),
          password: authPassword.value,
        });
      }

      if (result.error) throw result.error;
      if (!result.data.session) {
        authSuccess.textContent =
          "Check your email to confirm the account. The confirmation link opens a completion page; then return to this tab.";
        authSuccess.hidden = false;
        return;
      }
      await activateWorkspace(result.data.session);
    } catch (error) {
      showAuthError(error.message || "Authentication failed. Please try again.");
    } finally {
      authSubmit.disabled = false;
      authSubmit.innerHTML = state.authMode === "signup"
        ? 'Create account'
        : 'Log in';
    }
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });

  newChatButton.addEventListener("click", async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      await createSession();
    } catch (error) {
      showError(error.message || "Could not start a new chat.");
    } finally {
      setBusy(false);
    }
  });

  sessionList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-session-id]");
    if (!button || state.busy) return;
    const sessions = await requestJson("/api/chat/sessions");
    const selected = sessions.sessions.find(
      (item) => item.session_id === Number(button.dataset.sessionId)
    );
    if (selected) await openSession(selected);
  });

  reportButton.addEventListener("click", async () => {
    if (state.busy || !state.sessionId) return;
    if (state.reportAvailable) {
      if (state.reportLoaded) {
        reportSection.hidden = false;
        reportSection.scrollIntoView({
          behavior: reducedMotion.matches ? "auto" : "smooth",
          block: "start",
        });
      } else {
        try {
          await loadExistingReport();
        } catch (error) {
          showError(error.message || "Could not load the saved dashboard.");
        }
      }
      return;
    }
    await generateDashboard();
  });

  reportRefresh.addEventListener("click", generateDashboard);
  reportPrint.addEventListener("click", () => window.print());

  /* Campaign Video Studio entry point — hands the session context over. */
  const reportVideo = document.getElementById("chatbot-report-video");
  reportVideo?.addEventListener("click", () => {
    if (!state.sessionId || !state.reportAvailable) return;
    try {
      localStorage.setItem(
        "sutra_video_source",
        JSON.stringify({
          sessionId: state.sessionId,
          title: sessionTitle.textContent || "",
        })
      );
    } catch {
      /* stash is best-effort; the studio re-fetches the report itself */
    }
    window.location.href = `video-studio.html?session=${state.sessionId}`;
  });

  client?.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      showAuthGate();
    } else if (event === "SIGNED_IN" && main.hidden) {
      activateWorkspace(session);
    }
  });

  setAuthMode("login");
  window.sutraGetSession?.().then((session) => {
    if (session) activateWorkspace(session);
    else showAuthGate();
  });
})();
