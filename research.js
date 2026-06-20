/*
 * research.js — Sutra conversational research flow.
 *
 *   1. User chooses guided template or open chat, optionally adds a website,
 *      then clicks "Try researching".
 *   2. A mock registration overlay appears.
 *   3. On register, we open a chat session on the backend.
 *   4. If they filled the setup template, we send that as the first message.
 *      The chatbot then stays as a clean standalone conversation window.
 *
 * Auth is mock/prototype: the account lives only in the browser (localStorage),
 * there is no real server-side user. The chat session, however, is real and
 * persisted in the backend SQLite DB.
 */
(function () {
  const API_BASE = window.SUTRA_API_URL || "http://127.0.0.1:8000";

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

  const chatSection = document.getElementById("chat-section");
  const chatUserTag = document.getElementById("chat-user-tag");
  const messagesEl = document.getElementById("chat-messages");
  const composer = document.getElementById("chat-composer");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const errorEl = document.getElementById("chat-error");

  if (!websiteGate) return;

  const fallbackTemplateFields = [
    { key: "product_name", label: "Product / business name", placeholder: "e.g. Surat Threads", required: true },
    { key: "what_you_sell", label: "What do you sell?", placeholder: "e.g. Affordable ethnic wear for women", required: true },
    { key: "industry", label: "Industry", placeholder: "e.g. Fashion & Apparel", required: false },
    { key: "location", label: "Location / target market", placeholder: "e.g. Surat, selling across India", required: false },
    { key: "price_range", label: "Price range", placeholder: "e.g. Rs. 800-2500", required: false },
    { key: "competitors", label: "Competitors", placeholder: "Names or URLs, comma separated", required: false },
    { key: "goal", label: "Research goal", placeholder: "e.g. Find my core audience and ad angles", required: false },
  ];

  // --- state --------------------------------------------------------------
  const state = {
    user: null, // { name, email }
    website: "",
    sessionId: null,
    templateFields: [],
    setupMode: "template",
    pendingInitialMessage: "",
    busy: false,
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

  websiteGate.addEventListener("submit", (event) => {
    event.preventDefault();
    hideSetupError();
    state.website = (websiteInput.value || "").trim();
    state.pendingInitialMessage =
      state.setupMode === "template" ? composeTemplateMessage() : "";

    if (state.setupMode === "template" && !state.pendingInitialMessage) {
      showSetupError("Add at least one template detail, or choose Open chat to start blank.");
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
      "Here are my business details. Please give me an estimated audience " +
      "research breakdown.\n\n" +
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
  // STEP 3 — mock registration -> start chat session
  // =======================================================================
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("reg_name").value.trim();
    const email = document.getElementById("reg_email").value.trim();

    state.user = { name, email };
    // Persist the mock account locally so a refresh keeps them "registered".
    try {
      localStorage.setItem("sutra_user", JSON.stringify(state.user));
    } catch (_) {
      /* localStorage may be blocked on file:// — non-fatal */
    }

    closeAuth();
    await startChat();
  });

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
      const res = await fetch(`${API_BASE}/api/chat/start`, {
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
      const res = await fetch(`${API_BASE}/api/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      removeTypingBubble();
      if (!res.ok) throw new Error(data.detail || `Backend returned ${res.status}.`);
      addMessage("assistant", data.reply);
    } catch (error) {
      removeTypingBubble();
      showError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  // =======================================================================
  // UI helpers
  // =======================================================================
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

  // If the user already "registered" earlier (this browser), remember it but
  // still require the explicit "Try researching" click to open the chat.
  try {
    const saved = localStorage.getItem("sutra_user");
    if (saved) state.user = JSON.parse(saved);
  } catch (_) {
    /* ignore */
  }
})();
