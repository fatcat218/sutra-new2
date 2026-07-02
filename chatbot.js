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
  const reportSection = document.getElementById("chatbot-report");
  const reportTitle = document.getElementById("chatbot-report-title");
  const reportScore = document.getElementById("chatbot-score");
  const reportGrid = document.getElementById("chatbot-report-grid");
  const errorEl = document.getElementById("chatbot-error");

  const state = {
    sessionId: null,
    stage: "intake",
    busy: false,
    authMode: "login",
    initializing: false,
    workspaceUserId: null,
  };

  function resetWorkspace() {
    state.sessionId = null;
    state.stage = "intake";
    state.busy = false;
    state.workspaceUserId = null;
    messages.replaceChildren();
    sessionList.replaceChildren();
    reportGrid.replaceChildren();
    reportSection.hidden = true;
    reportButton.hidden = true;
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

  function updateStage(stage) {
    state.stage = stage || state.stage;
    reportButton.hidden = !["ready_for_report", "report_generated"].includes(state.stage);
    reportButton.disabled = state.stage === "report_generated";
    reportButton.textContent =
      state.stage === "report_generated" ? "Dashboard generated" : "Generate dashboard";
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
    localStorage.setItem("sutra_active_session_id", String(state.sessionId));
    sessionTitle.textContent = session.title || "Research chat";
    messages.replaceChildren();
    data.messages.forEach((message) => addMessage(message.role, message.content));
    reportSection.hidden = true;
    updateStage(session.stage);
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

  function appendReportCard(label, value) {
    const values = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
    if (!values.length) return;
    const card = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = label;
    card.append(heading);
    if (values.length === 1 && !Array.isArray(value)) {
      const paragraph = document.createElement("p");
      paragraph.textContent = String(values[0]);
      card.append(paragraph);
    } else {
      const list = document.createElement("ul");
      values.forEach((item) => {
        const listItem = document.createElement("li");
        listItem.textContent = String(item);
        list.append(listItem);
      });
      card.append(list);
    }
    reportGrid.append(card);
  }

  function renderReport(report) {
    reportTitle.textContent = report.dashboard_headline || "Your market intelligence";
    const score = Number(report.targeting_score);
    reportScore.textContent = Number.isFinite(score) ? `${Math.round(score)}/100` : "—";
    reportGrid.replaceChildren();
    [
      ["Targeting summary", report.targeting_effectiveness_summary],
      ["Audience segments", report.key_audience_segments],
      ["Market opportunity", report.market_opportunity_summary],
      ["Recommendations", report.actionable_recommendations],
      ["Engagement patterns", report.engagement_patterns],
      ["Behavioural trends", report.behavioral_trends],
      ["Pain points", report.pain_points],
      ["Best channels", report.best_marketing_channels],
      ["Campaign angles", report.campaign_angles],
      ["Missing information", report.missing_information],
    ].forEach(([label, value]) => appendReportCard(label, value));
    reportSection.hidden = false;
    reportSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
    setBusy(true);
    reportButton.disabled = true;
    reportButton.textContent = "Generating...";
    try {
      const data = await requestJson(`/api/chat/${state.sessionId}/generate-report`, {
        method: "POST",
      });
      updateStage(data.stage);
      renderReport(data.report_json || {});
      addMessage("assistant", "Your research dashboard is ready below.");
    } catch (error) {
      reportButton.disabled = false;
      reportButton.textContent = "Generate dashboard";
      showError(error.message || "Could not generate the dashboard.");
    } finally {
      setBusy(false);
    }
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
