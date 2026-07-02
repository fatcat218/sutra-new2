(function () {
  const client = window.sutraSupabase;
  const main = document.getElementById("profile-page-main");
  const loading = document.getElementById("profile-loading");
  const feedback = document.getElementById("profile-feedback");
  const statusBanner = document.getElementById("profile-status-banner");
  const languageForm = document.getElementById("profile-language-form");
  const languageSelect = document.getElementById("profile-language");
  const clearHistoryButton = document.getElementById("clear-history-button");
  const deleteAccountButton = document.getElementById("delete-account-button");
  const logoutButton = document.getElementById("profile-logout-button");
  const confirmation = document.getElementById("account-confirmation");
  const confirmationTitle = document.getElementById("account-confirmation-title");
  const confirmationMessage = document.getElementById("account-confirmation-message");
  const confirmationCancel = document.getElementById("account-confirmation-cancel");
  const confirmationAccept = document.getElementById("account-confirmation-accept");

  let confirmationAction = null;

  function initials(name) {
    return String(name || "User")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "U";
  }

  function showFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
    feedback.hidden = false;
    feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function requestJson(path, options = {}) {
    const response = await window.sutraApiFetch(path, options);
    if (response.status === 401) {
      window.location.replace("chatbot.html");
      throw new Error("Your session ended.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status}).`);
    return data;
  }

  function renderProfile(profile) {
    const name = profile.full_name || "Your account";
    document.getElementById("profile-avatar").textContent = initials(name);
    document.getElementById("profile-side-name").textContent = name;
    document.getElementById("profile-side-email").textContent = profile.email;
    document.getElementById("profile-name").textContent = name;
    document.getElementById("profile-email").textContent = profile.email;
    document.getElementById("profile-created").textContent =
      new Date(profile.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    document.getElementById("profile-status").textContent =
      profile.status.replaceAll("_", " ");
    languageSelect.value = profile.language_preference || "en";

    const deletionRequested = profile.status === "deletion_requested";
    statusBanner.hidden = !deletionRequested;
    if (deletionRequested) {
      const date = profile.deletion_requested_at
        ? new Date(profile.deletion_requested_at).toLocaleDateString()
        : "recently";
      statusBanner.textContent =
        `Account deletion was requested ${date}. No additional request is needed.`;
      deleteAccountButton.disabled = true;
      deleteAccountButton.textContent = "Deletion requested";
    }
  }

  function openConfirmation(type) {
    confirmationAction = type;
    if (type === "history") {
      confirmationTitle.textContent = "Clear all research history?";
      confirmationMessage.textContent =
        "This permanently deletes conversations, messages, captured sources, and reports. It cannot be undone.";
      confirmationAccept.textContent = "Clear everything";
    } else {
      confirmationTitle.textContent = "Request account deletion?";
      confirmationMessage.textContent =
        "This records a deletion request for your account. Your data is not erased immediately.";
      confirmationAccept.textContent = "Request deletion";
    }
    confirmation.hidden = false;
    document.body.classList.add("no-scroll");
  }

  function closeConfirmation() {
    confirmation.hidden = true;
    confirmationAction = null;
    document.body.classList.remove("no-scroll");
  }

  languageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = languageForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const profile = await requestJson("/api/auth/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language_preference: languageSelect.value }),
      });
      renderProfile(profile);
      showFeedback("Language preference saved.");
    } catch (error) {
      showFeedback(error.message || "Could not save your preference.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Save preference";
    }
  });

  clearHistoryButton.addEventListener("click", () => openConfirmation("history"));
  deleteAccountButton.addEventListener("click", () => openConfirmation("deletion"));
  confirmationCancel.addEventListener("click", closeConfirmation);
  confirmation.addEventListener("click", (event) => {
    if (event.target === confirmation) closeConfirmation();
  });

  confirmationAccept.addEventListener("click", async () => {
    const action = confirmationAction;
    confirmationAccept.disabled = true;
    confirmationAccept.textContent = "Working...";
    try {
      if (action === "history") {
        const result = await requestJson("/api/auth/history", { method: "DELETE" });
        localStorage.removeItem("sutra_active_session_id");
        showFeedback(result.message);
      } else if (action === "deletion") {
        const result = await requestJson("/api/auth/deletion-request", {
          method: "POST",
        });
        showFeedback(result.message);
        const profile = await requestJson("/api/auth/me");
        renderProfile(profile);
      }
      closeConfirmation();
    } catch (error) {
      closeConfirmation();
      showFeedback(error.message || "The account action could not be completed.", true);
    } finally {
      confirmationAccept.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      logoutButton.disabled = false;
      logoutButton.textContent = "Log out";
      showFeedback(error.message || "Could not log out.", true);
      return;
    }
    localStorage.removeItem("sutra_active_session_id");
    window.location.replace("index.html");
  });

  async function initialize() {
    const session = await window.sutraGetSession?.();
    if (!session) {
      window.location.replace("chatbot.html");
      return;
    }
    loading.hidden = true;
    main.hidden = false;
    try {
      const profile = await requestJson("/api/auth/me");
      renderProfile(profile);
    } catch (error) {
      showFeedback(error.message || "Could not load your account.", true);
    }
  }

  initialize();
})();
