/*
 * research.js — Sutra conversational research flow.
 *
 *   1. User chooses guided template or open chat, optionally adds a website,
 *      then clicks "Try researching".
 *   2. A mock registration overlay appears.
 *   3. Supabase Auth signs the user in, then we open an owned chat session.
 *   4. If they filled the setup template, we send that as the first message.
 *      The chatbot then stays as a clean standalone conversation window.
 *
 * Supabase manages passwords and browser sessions. FastAPI verifies the access
 * token and stores research data in PostgreSQL.
 */
(function () {
  const API_BASE = window.SUTRA_API_URL || "http://127.0.0.1:8000";
  const supabaseClient =
    window.supabase &&
    window.SUTRA_SUPABASE_URL &&
    window.SUTRA_SUPABASE_PUBLISHABLE_KEY
      ? window.supabase.createClient(
          window.SUTRA_SUPABASE_URL,
          window.SUTRA_SUPABASE_PUBLISHABLE_KEY,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          }
        )
      : null;

  // --- element handles ----------------------------------------------------
  const websiteGate = document.getElementById("website-gate");
  const websiteInput = document.getElementById("website_url");
  const setupModeButtons = document.querySelectorAll(".setup-mode-card");
  const setupTemplatePanel = document.getElementById("setup-template-panel");
  const setupFreePanel = document.getElementById("setup-free-panel");
  const setupTemplateFieldsEl = document.getElementById("setup-template-fields");
  const setupError = document.getElementById("setup-error");

  const authOverlay = document.getElementById("auth-overlay");
  const authForm = document.getElementById("auth-form");
  const authClose = document.getElementById("auth-close");
  const authError = document.getElementById("auth-error");
  const navUserTag = document.getElementById("nav-user-tag");
  const navLogout = document.getElementById("nav-logout");

  const chatSection = document.getElementById("chat-section");
  const chatUserTag = document.getElementById("chat-user-tag");
  const messagesEl = document.getElementById("chat-messages");
  const composer = document.getElementById("chat-composer");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const errorEl = document.getElementById("chat-error");
  const dashboardAction = document.getElementById("dashboard-action");
  const generateDashboardBtn = document.getElementById("generate-dashboard");
  const dashboardSection = document.getElementById("business-dashboard");
  const dashboardHeadline = document.getElementById("dashboard-headline");
  const targetingSummary = document.getElementById("targeting-summary");
  const targetingScore = document.getElementById("targeting-score");
  const audienceSegments = document.getElementById("audience-segments");
  const marketSummary = document.getElementById("market-summary");
  const recommendations = document.getElementById("recommendations");
  const engagementPatterns = document.getElementById("engagement-patterns");
  const behavioralTrends = document.getElementById("behavioral-trends");
  const marketOpportunities = document.getElementById("market-opportunities");
  const completeReport = document.getElementById("complete-report");

  if (!websiteGate) return;

  const fallbackTemplateFields = [
    { key: "product_name", label: "Product / business name", placeholder: "e.g. Surat Threads", required: true },
    { key: "what_you_sell", label: "What do you sell?", placeholder: "e.g. Affordable ethnic wear for women", required: true },
    { key: "industry", label: "Industry", placeholder: "e.g. Fashion & Apparel", required: false },
    { key: "location", label: "Location / target market", placeholder: "e.g. Surat, selling across India", required: false },
    { key: "price_range", label: "Price range", placeholder: "e.g. Rs. 800-2500", required: false },
    { key: "current_customers", label: "Who buys from you today?", placeholder: "e.g. College students, young professionals", required: false },
    { key: "channels", label: "Where do customers find you?", placeholder: "e.g. Instagram, WhatsApp, referrals", required: false },
    { key: "customer_signals", label: "Any customer signals?", placeholder: "e.g. Repeat purchases, common questions", required: false },
    { key: "competitors", label: "Competitors", placeholder: "Names or URLs, comma separated", required: false },
    { key: "goal", label: "Research goal", placeholder: "e.g. Find my core audience and ad angles", required: false },
  ];

  // --- state --------------------------------------------------------------
  const state = {
    user: null, // { name, email }
    authSession: null,
    website: "",
    sessionId: null,
    stage: "intake",
    templateFields: [],
    setupMode: "template",
    pendingInitialMessage: "",
    busy: false,
    generatingDashboard: false,
  };

  // =======================================================================
  // STEP 1 + 2 — website gate -> open register overlay
  // =======================================================================
  loadSetupTemplate();

  setupModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSetupMode(button.dataset.mode === "free" ? "free" : "template");
    });
  });

  websiteGate.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideSetupError();
    state.website = (websiteInput.value || "").trim();
    state.pendingInitialMessage =
      state.setupMode === "template" ? composeTemplateMessage() : "";

    if (state.setupMode === "template" && !state.pendingInitialMessage) {
      showSetupError("Add at least one template detail, or choose Open chat to start blank.");
      return;
    }

    const existingSession = await getActiveSession();
    if (existingSession) {
      setAuthenticatedSession(existingSession);
      await startChat();
      return;
    }
    openAuth();
  });

  async function loadSetupTemplate() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/template`);
      const data = await res.json().catch(() => []);
      state.templateFields = Array.isArray(data) && data.length ? data : fallbackTemplateFields;
    } catch (_) {
      state.templateFields = fallbackTemplateFields;
    }
    buildSetupTemplate(state.templateFields);
  }

  function setSetupMode(mode) {
    state.setupMode = mode;
    const free = mode === "free";
    setupModeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });
    setupTemplatePanel.hidden = free;
    setupFreePanel.hidden = !free;
    hideSetupError();
  }

  function buildSetupTemplate(fields) {
    setupTemplateFieldsEl.replaceChildren();
    fields.forEach((field) => {
      if (field.key === "website") return;
      const label = document.createElement("label");
      label.className = "field";
      const span = document.createElement("span");
      span.textContent = field.required ? `${field.label} *` : field.label;
      const inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.dataset.key = field.key;
      inputEl.placeholder = field.placeholder || "";
      label.append(span, inputEl);
      setupTemplateFieldsEl.append(label);
    });
  }

  function composeTemplateMessage() {
    const inputs = setupTemplateFieldsEl.querySelectorAll("input");
    const lines = [];
    const labelFor = {};
    state.templateFields.forEach((field) => {
      labelFor[field.key] = field.label;
    });

    if (state.website) {
      lines.push(`Website: ${state.website}`);
    }
    inputs.forEach((el) => {
      const val = el.value.trim();
      if (val) lines.push(`${labelFor[el.dataset.key] || el.dataset.key}: ${val}`);
    });

    if (!lines.length) return "";
    return (
      "Here are my business details. Please use this as intake context for my " +
      "personalised business dashboard. If something important is missing, ask " +
      "me the most useful follow-up question.\n\n" +
      lines.join("\n")
    );
  }

  function showSetupError(message) {
    setupError.textContent = message;
    setupError.hidden = false;
  }

  function hideSetupError() {
    setupError.hidden = true;
  }

  function openAuth() {
    authOverlay.hidden = false;
    document.body.classList.add("no-scroll");
    setTimeout(() => document.getElementById("reg_name").focus(), 50);
  }

  function closeAuth() {
    authOverlay.hidden = true;
    document.body.classList.remove("no-scroll");
  }

  authClose.addEventListener("click", closeAuth);
  authOverlay.addEventListener("click", (event) => {
    if (event.target === authOverlay) closeAuth();
  });

  // =======================================================================
  // STEP 3 — real Supabase sign-up/sign-in -> start owned chat session
  // =======================================================================
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("reg_name").value.trim();
    const email = document.getElementById("reg_email").value.trim();
    const password = document.getElementById("reg_password").value;
    const submitButton = authForm.querySelector('button[type="submit"]');

    hideAuthError();
    if (!supabaseClient) {
      showAuthError("Authentication could not load. Refresh the page and try again.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";

    try {
      // Existing users sign in. If the account does not exist yet, create it.
      let result = await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) {
        result = await supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
      }
      if (result.error) throw result.error;
      if (!result.data.session) {
        showAuthError(
          "Check your email to confirm the account, then return here and continue."
        );
        return;
      }

      setAuthenticatedSession(result.data.session, name);
      closeAuth();
      await startChat();
    } catch (error) {
      showAuthError(error.message || "Could not sign in. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML =
        'Continue to research';
    }
  });

  function showAuthError(message) {
    authError.textContent = message;
    authError.hidden = false;
  }

  function hideAuthError() {
    authError.hidden = true;
  }

  async function getActiveSession() {
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    return error ? null : data.session;
  }

  function setAuthenticatedSession(session, fallbackName = "") {
    state.authSession = session;
    const authUser = session.user;
    state.user = {
      name: authUser.user_metadata?.full_name || fallbackName,
      email: authUser.email || "",
    };
    navUserTag.textContent = state.user.name || state.user.email;
    navUserTag.hidden = false;
    navLogout.hidden = false;
  }

  function clearAuthenticatedSession() {
    state.authSession = null;
    state.user = null;
    state.sessionId = null;
    state.stage = "intake";
    state.pendingInitialMessage = "";
    state.busy = false;
    state.generatingDashboard = false;
    chatSection.hidden = true;
    dashboardSection.hidden = true;
    dashboardAction.hidden = true;
    messagesEl.replaceChildren();
    input.disabled = false;
    sendBtn.disabled = false;
    generateDashboardBtn.disabled = false;
    generateDashboardBtn.innerHTML =
      'Generate dashboard';
    navUserTag.textContent = "";
    navUserTag.hidden = true;
    navLogout.hidden = true;
  }

  navLogout.addEventListener("click", async () => {
    if (!supabaseClient) return;
    navLogout.disabled = true;
    navLogout.textContent = "Logging out...";
    try {
      const { error } = await supabaseClient.auth.signOut({ scope: "local" });
      if (error) throw error;
      clearAuthenticatedSession();
      document.getElementById("start").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      showSetupError(error.message || "Could not log out. Please try again.");
    } finally {
      navLogout.disabled = false;
      navLogout.textContent = "Log out";
    }
  });

  async function apiFetch(path, options = {}) {
    const session = await getActiveSession();
    if (!session) {
      throw new Error("Your session expired. Sign in again to continue.");
    }
    setAuthenticatedSession(session);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.access_token}`);
    return fetch(`${API_BASE}${path}`, { ...options, headers });
  }

  // =======================================================================
  // STEP 4 — open the chat session and reveal the UI
  // =======================================================================
  async function startChat() {
    chatSection.hidden = false;
    chatUserTag.textContent = state.user.name
      ? `Signed in as ${state.user.name}`
      : "Signed in";
    chatSection.scrollIntoView({ behavior: "smooth", block: "start" });

    messagesEl.replaceChildren();
    addTypingBubble();

    try {
      const res = await apiFetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: state.user.email,
          user_name: state.user.name,
          website_url: state.website || null,
          mode: state.setupMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      removeTypingBubble();
      if (!res.ok) throw new Error(data.detail || `Backend returned ${res.status}.`);

      state.sessionId = data.session_id;
      updateStage(data.stage || "intake");
      addMessage("assistant", data.greeting);
      if (state.pendingInitialMessage) {
        await sendMessage(state.pendingInitialMessage);
        state.pendingInitialMessage = "";
      }
    } catch (error) {
      removeTypingBubble();
      showError(friendlyError(error));
    }
  }

  // =======================================================================
  // Conversation — send messages + follow-ups on the same session
  // =======================================================================
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendMessage(text);
  });

  // Enter to send, Shift+Enter for newline; auto-grow the textarea.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });

  async function sendMessage(text) {
    if (state.busy || !state.sessionId) return;
    hideError();
    addMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    setBusy(true);
    addTypingBubble();

    try {
      const res = await apiFetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      removeTypingBubble();
      if (!res.ok) throw new Error(data.detail || `Backend returned ${res.status}.`);
      updateStage(data.stage || state.stage);
      addMessage("assistant", data.reply);
    } catch (error) {
      removeTypingBubble();
      showError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  generateDashboardBtn.addEventListener("click", generateDashboard);

  async function generateDashboard() {
    if (state.busy || state.generatingDashboard || !state.sessionId) return;
    hideError();
    state.generatingDashboard = true;
    generateDashboardBtn.disabled = true;
    generateDashboardBtn.textContent = "Generating...";

    try {
      const res = await apiFetch(`/api/chat/${state.sessionId}/generate-report`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Backend returned ${res.status}.`);

      updateStage(data.stage || "report_generated");
      renderDashboard(data.report_json || {});
      addMessage("assistant", "Your dashboard is ready below. Treat it as an estimated strategy snapshot, then validate the important parts with real customer data.");
    } catch (error) {
      showError(friendlyError(error));
      generateDashboardBtn.disabled = false;
      generateDashboardBtn.innerHTML = 'Generate dashboard';
    } finally {
      state.generatingDashboard = false;
    }
  }

  // =======================================================================
  // UI helpers
  // =======================================================================
  function updateStage(stage) {
    state.stage = stage || state.stage;
    const canGenerate = ["ready_for_report", "report_generated"].includes(state.stage);
    dashboardAction.hidden = !canGenerate;
    if (state.stage === "report_generated") {
      generateDashboardBtn.disabled = true;
      generateDashboardBtn.textContent = "Dashboard generated";
    }
  }

  function renderDashboard(report) {
    dashboardSection.hidden = false;
    dashboardHeadline.textContent =
      report.dashboard_headline || "Your audience and market intelligence dashboard";
    targetingSummary.textContent =
      report.targeting_effectiveness_summary ||
      report.target_audience_overview ||
      "Sutra generated an estimated view of how your business can target its likely customers.";

    const score = Number(report.targeting_score);
    targetingScore.textContent = Number.isFinite(score) ? `${Math.round(score)}/100` : "--";

    renderList(audienceSegments, report.key_audience_segments, [
      report.primary_segment,
      report.secondary_segment,
    ]);
    marketSummary.textContent =
      report.market_opportunity_summary ||
      report.target_audience_overview ||
      "More market context is needed to summarise the strongest opportunity.";
    renderList(recommendations, report.actionable_recommendations, report.campaign_angles);
    renderList(engagementPatterns, report.engagement_patterns, report.best_marketing_channels);
    renderList(behavioralTrends, report.behavioral_trends, [report.behavioral_analysis]);
    renderList(marketOpportunities, report.market_opportunities, report.buying_motivations);
    renderCompleteReport(report);

    dashboardSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderList(container, primaryItems, fallbackItems) {
    const items = normaliseItems(primaryItems).length
      ? normaliseItems(primaryItems)
      : normaliseItems(fallbackItems);
    container.replaceChildren();
    const list = document.createElement("ul");
    list.className = "dashboard-list";
    (items.length ? items : ["Not enough information yet. Add more business context in chat."]).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    });
    container.append(list);
  }

  function renderCompleteReport(report) {
    const sections = [
      ["Business summary", report.business_summary],
      ["Audience overview", report.target_audience_overview],
      ["Demographic analysis", report.demographic_analysis],
      ["Socioeconomic analysis", report.socioeconomic_analysis],
      ["Behavioural analysis", report.behavioral_analysis],
      ["Buying motivations", normaliseItems(report.buying_motivations).join(", ")],
      ["Pain points", normaliseItems(report.pain_points).join(", ")],
      ["Best marketing channels", normaliseItems(report.best_marketing_channels).join(", ")],
      ["Campaign angles", normaliseItems(report.campaign_angles).join(", ")],
      ["Confidence", report.confidence_score],
      ["Missing information", normaliseItems(report.missing_information).join(", ")],
      ["Recommended follow-ups", normaliseItems(report.recommended_follow_up_questions).join(", ")],
    ].filter(([, value]) => value);

    completeReport.replaceChildren();
    sections.forEach(([label, value]) => {
      const block = document.createElement("div");
      block.className = "report-block";
      const h3 = document.createElement("h3");
      h3.textContent = label;
      const p = document.createElement("p");
      p.textContent = value;
      block.append(h3, p);
      completeReport.append(block);
    });
  }

  function normaliseItems(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (value) return [String(value)];
    return [];
  }

  function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = `chat-msg chat-msg-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    // Preserve line breaks without injecting HTML.
    String(text || "").split("\n").forEach((line, i) => {
      if (i) bubble.append(document.createElement("br"));
      bubble.append(document.createTextNode(line));
    });
    row.append(bubble);
    messagesEl.append(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addTypingBubble() {
    const row = document.createElement("div");
    row.className = "chat-msg chat-msg-assistant chat-typing";
    row.id = "chat-typing";
    row.innerHTML =
      '<div class="chat-bubble"><span class="dot-typing"></span>' +
      '<span class="dot-typing"></span><span class="dot-typing"></span></div>';
    messagesEl.append(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTypingBubble() {
    const el = document.getElementById("chat-typing");
    if (el) el.remove();
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    sendBtn.disabled = isBusy;
    input.disabled = isBusy;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function hideError() {
    errorEl.hidden = true;
  }

  function friendlyError(error) {
    if (error instanceof TypeError) {
      return "Couldn't reach the backend. Keep Uvicorn running on port 8000 and try again.";
    }
    return error.message || "Something went wrong. Check the backend terminal.";
  }

  // Supabase persists the browser session and refreshes its access token.
  if (supabaseClient) {
    supabaseClient.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      setAuthenticatedSession(data.session);
    });
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        clearAuthenticatedSession();
      } else if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        setAuthenticatedSession(session);
      }
    });
  }
})();
