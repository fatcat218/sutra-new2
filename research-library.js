(function () {
  const client = window.sutraSupabase;

  const main = document.getElementById("library-main");
  const authLoading = document.getElementById("library-auth-loading");
  const grid = document.getElementById("library-grid");
  const searchInput = document.getElementById("library-search");
  const sortSelect = document.getElementById("library-sort");
  const countEl = document.getElementById("library-count");
  const loadingEl = document.getElementById("library-loading");
  const errorEl = document.getElementById("library-error");
  const errorText = document.getElementById("library-error-text");
  const retryButton = document.getElementById("library-retry");
  const emptyEl = document.getElementById("library-empty");
  const noResultsEl = document.getElementById("library-no-results");
  const modalBackdrop = document.getElementById("library-modal");
  const modalTitle = document.getElementById("library-modal-title");
  const modalBody = document.getElementById("library-modal-body");
  const modalClose = document.getElementById("library-modal-close");

  const state = { sessions: [], query: "", sort: "newest", loading: false };
  let modalReturnFocus = null;

  function redirectToLogin() {
    window.location.replace("chatbot.html");
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await window.sutraApiFetch(path, options);
    } catch (error) {
      if (error.message === "Sign in to continue.") {
        redirectToLogin();
        throw error;
      }
      throw new Error("Could not reach the Sutra backend. Is it running?");
    }
    if (response.status === 401) {
      await client?.auth.signOut({ scope: "local" });
      redirectToLogin();
      throw new Error("Your session ended. Log in again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || `Request failed (${response.status}).`);
    }
    return data;
  }

  /* ---------------------------------------------------------- states */
  function showLoading() {
    state.loading = true;
    loadingEl.hidden = false;
    errorEl.hidden = true;
    emptyEl.hidden = true;
    noResultsEl.hidden = true;
    countEl.hidden = true;
    grid.replaceChildren();
  }

  function showError(message) {
    state.loading = false;
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorText.textContent = message || "Could not load your research.";
    emptyEl.hidden = true;
    noResultsEl.hidden = true;
    countEl.hidden = true;
    grid.replaceChildren();
  }

  /* ---------------------------------------------------------- helpers */
  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function stageLabel(session) {
    if (session.report_status === "complete") return ["Report ready", "is-ready"];
    if (session.report_status === "failed") return ["Report failed", "is-failed"];
    if (["ready_for_report", "report_generated"].includes(session.stage)) {
      return ["Ready for report", "is-progress"];
    }
    return ["In conversation", "is-progress"];
  }

  function visibleSessions() {
    const query = state.query.trim().toLowerCase();
    let list = state.sessions.slice();
    if (query) {
      list = list.filter((session) =>
        `${session.title || ""} ${session.preview || ""}`.toLowerCase().includes(query)
      );
    }
    list.sort((a, b) => {
      const diff = new Date(b.updated_at) - new Date(a.updated_at);
      return state.sort === "oldest" ? -diff : diff;
    });
    return list;
  }

  /* ---------------------------------------------------------- modal */
  function openModal(title) {
    modalReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalTitle.textContent = title;
    modalBody.replaceChildren();
    modalBackdrop.hidden = false;
    document.body.classList.add("library-modal-open");
    modalClose.focus();
    return modalBody;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    modalBody.replaceChildren();
    document.body.classList.remove("library-modal-open");
    modalReturnFocus?.focus();
    modalReturnFocus = null;
  }

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
  });

  function modalMessage(text, kind) {
    const paragraph = document.createElement("p");
    paragraph.className = `library-modal-note${kind ? ` ${kind}` : ""}`;
    paragraph.textContent = text;
    return paragraph;
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------- actions */
  function openConversation(session) {
    localStorage.setItem("sutra_active_session_id", String(session.session_id));
    window.location.href = "chatbot.html";
  }

  function openRenameModal(session) {
    const body = openModal("Rename research");
    const form = document.createElement("form");
    form.className = "library-modal-form";
    const label = document.createElement("label");
    label.className = "field";
    const caption = document.createElement("span");
    caption.textContent = "Title";
    const input = document.createElement("input");
    input.type = "text";
    input.required = true;
    input.maxLength = 255;
    input.value = session.title || "";
    label.append(caption, input);
    const submit = document.createElement("button");
    submit.className = "btn btn-block";
    submit.type = "submit";
    submit.textContent = "Save name";
    const note = modalMessage("", "is-error");
    note.hidden = true;
    form.append(label, submit, note);
    body.append(form);
    input.focus();
    input.select();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      submit.disabled = true;
      submit.textContent = "Saving…";
      try {
        await api(`/api/chat/${session.session_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        closeModal();
        await loadSessions({ quiet: true });
      } catch (error) {
        note.textContent = error.message || "Could not rename this research.";
        note.hidden = false;
        submit.disabled = false;
        submit.textContent = "Save name";
      }
    });
  }

  function openDeleteModal(session) {
    const body = openModal("Delete research?");
    body.append(
      modalMessage(
        `“${session.title || "Research chat"}” and its ${session.message_count} ` +
        "message(s), saved sources, and generated reports will be permanently deleted. " +
        "This cannot be undone."
      )
    );
    const row = document.createElement("div");
    row.className = "library-modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "library-ghost-button";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn library-danger-btn";
    confirm.textContent = "Delete permanently";
    row.append(cancel, confirm);
    const note = modalMessage("", "is-error");
    note.hidden = true;
    body.append(row, note);

    cancel.addEventListener("click", closeModal);
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      confirm.textContent = "Deleting…";
      try {
        await api(`/api/chat/${session.session_id}`, { method: "DELETE" });
        const active = localStorage.getItem("sutra_active_session_id");
        if (active === String(session.session_id)) {
          localStorage.removeItem("sutra_active_session_id");
        }
        closeModal();
        await loadSessions({ quiet: true });
      } catch (error) {
        note.textContent = error.message || "Could not delete this research.";
        note.hidden = false;
        confirm.disabled = false;
        confirm.textContent = "Delete permanently";
      }
    });
  }

  async function openSourcesModal(session) {
    const body = openModal("Saved sources");
    body.append(modalMessage("Loading sources…"));
    try {
      const data = await api(`/api/chat/${session.session_id}/sources`);
      body.replaceChildren();
      if (!data.sources.length) {
        body.append(
          modalMessage("No sources were captured for this research session.")
        );
        return;
      }
      const list = document.createElement("ul");
      list.className = "library-source-list";
      data.sources.forEach((source) => {
        const item = document.createElement("li");
        const top = document.createElement("div");
        top.className = "library-source-top";
        const type = document.createElement("span");
        type.className = "library-badge";
        type.textContent = source.source_type;
        const status = document.createElement("span");
        status.className = `library-badge ${
          source.scrape_status === "complete" ? "is-ready" : "is-progress"
        }`;
        status.textContent = source.scrape_status;
        top.append(type, status);
        const safeUrl = safeExternalUrl(source.url);
        const sourceLabel = safeUrl
          ? document.createElement("a")
          : document.createElement("span");
        sourceLabel.textContent = source.url;
        if (safeUrl) {
          sourceLabel.href = safeUrl;
          sourceLabel.target = "_blank";
          sourceLabel.rel = "noopener noreferrer";
        }
        item.append(top, sourceLabel);
        if (source.extracted_summary) {
          const summary = document.createElement("p");
          summary.textContent = source.extracted_summary;
          item.append(summary);
        }
        list.append(item);
      });
      body.append(list);
    } catch (error) {
      body.replaceChildren(
        modalMessage(error.message || "Could not load sources.", "is-error")
      );
    }
  }

  function appendReportCard(container, label, value) {
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
      values.forEach((entry) => {
        const listItem = document.createElement("li");
        listItem.textContent = String(entry);
        list.append(listItem);
      });
      card.append(list);
    }
    container.append(card);
  }

  async function openReportModal(session) {
    const body = openModal("Research dashboard");
    body.append(modalMessage("Loading the report…"));
    try {
      const data = await api(`/api/chat/${session.session_id}/report`);
      const report = data.report_json || {};
      body.replaceChildren();

      const head = document.createElement("div");
      head.className = "library-report-head";
      const title = document.createElement("h3");
      title.textContent = report.dashboard_headline || "Your market intelligence";
      const score = document.createElement("span");
      score.className = "chatbot-score";
      const scoreValue = Number(report.targeting_score);
      score.textContent = Number.isFinite(scoreValue)
        ? `${Math.round(scoreValue)}/100`
        : "—";
      head.append(title, score);
      const meta = modalMessage(`Generated on ${formatDate(data.created_at)}`);
      const gridEl = document.createElement("div");
      gridEl.className = "chatbot-report-grid library-report-grid";
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
      ].forEach(([label, value]) => appendReportCard(gridEl, label, value));
      body.append(head, meta, gridEl);
    } catch (error) {
      body.replaceChildren(
        modalMessage(error.message || "Could not load the report.", "is-error")
      );
    }
  }

  /* ---------------------------------------------------------- rendering */
  function buildCard(session) {
    const card = document.createElement("article");
    card.className = "library-card";

    const top = document.createElement("div");
    top.className = "library-card-top";
    const [statusText, statusClass] = stageLabel(session);
    const badge = document.createElement("span");
    badge.className = `library-badge ${statusClass}`;
    badge.textContent = statusText;
    const messagesBadge = document.createElement("span");
    messagesBadge.className = "library-badge";
    messagesBadge.textContent = `${session.message_count} message${
      session.message_count === 1 ? "" : "s"
    }`;
    top.append(badge, messagesBadge);

    const title = document.createElement("h2");
    title.textContent = session.title || "Research chat";

    const dates = document.createElement("p");
    dates.className = "library-card-dates";
    dates.textContent = `Created ${formatDate(session.created_at)} · Updated ${formatDate(session.updated_at)}`;

    const preview = document.createElement("p");
    preview.className = "library-card-preview";
    preview.textContent = session.preview || "No messages yet.";

    const actions = document.createElement("div");
    actions.className = "library-card-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn library-open-btn";
    openButton.innerHTML = 'Open';
    openButton.addEventListener("click", () => openConversation(session));

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "library-ghost-button";
    renameButton.textContent = "Rename";
    renameButton.addEventListener("click", () => openRenameModal(session));

    const sourcesButton = document.createElement("button");
    sourcesButton.type = "button";
    sourcesButton.className = "library-ghost-button";
    sourcesButton.textContent = `Sources (${session.source_count})`;
    sourcesButton.addEventListener("click", () => openSourcesModal(session));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "library-ghost-button library-danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => openDeleteModal(session));

    actions.append(openButton, renameButton, sourcesButton);
    if (session.report_status === "complete") {
      const reportButton = document.createElement("button");
      reportButton.type = "button";
      reportButton.className = "library-ghost-button";
      reportButton.textContent = "Report";
      reportButton.addEventListener("click", () => openReportModal(session));
      actions.append(reportButton);
    }
    actions.append(deleteButton);

    card.append(top, title, dates, preview, actions);
    return card;
  }

  function render() {
    if (state.loading) return;
    loadingEl.hidden = true;
    errorEl.hidden = true;
    grid.replaceChildren();

    if (!state.sessions.length) {
      emptyEl.hidden = false;
      noResultsEl.hidden = true;
      countEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;

    const list = visibleSessions();
    if (!list.length) {
      noResultsEl.hidden = false;
      countEl.hidden = true;
      return;
    }
    noResultsEl.hidden = true;
    countEl.hidden = false;
    countEl.textContent = `${list.length} of ${state.sessions.length} research session${
      state.sessions.length === 1 ? "" : "s"
    }`;
    list.forEach((session) => grid.append(buildCard(session)));
  }

  async function loadSessions({ quiet = false } = {}) {
    if (!quiet) showLoading();
    try {
      const data = await api("/api/chat/sessions");
      state.sessions = data.sessions || [];
      state.loading = false;
      render();
    } catch (error) {
      showError(error.message);
    }
  }

  /* ---------------------------------------------------------- events */
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    render();
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    render();
  });
  retryButton.addEventListener("click", () => loadSessions());

  client?.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) redirectToLogin();
  });

  /* ---------------------------------------------------------- boot */
  if (!client) {
    redirectToLogin();
  } else {
    window.sutraGetSession().then((session) => {
      if (!session) {
        redirectToLogin();
        return;
      }
      authLoading.hidden = true;
      main.hidden = false;
      loadSessions();
    });
  }
})();
