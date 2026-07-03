/* Creative Library — saved Campaign Video Studio projects. */
(function () {
  "use strict";

  const client = window.sutraSupabase;
  const store = window.sutraVideoStore;

  const main = document.getElementById("creative-main");
  const authLoading = document.getElementById("creative-auth-loading");
  const grid = document.getElementById("creative-grid");
  const emptyEl = document.getElementById("creative-empty");
  const countEl = document.getElementById("creative-count");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function redirectToLogin() {
    window.location.replace("chatbot.html");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  function statusLabel(project) {
    if (project.status === "preview-ready") return "Preview ready";
    if (project.status === "approved") return "Approved";
    return "Draft";
  }

  function thumbnail(project) {
    const palette = project.plan?.palette || {};
    const frame = el("div", "creative-thumb");
    frame.dataset.aspect = project.config?.aspect || "9:16";
    frame.style.background = palette.bg || "#0B3D2A";
    frame.style.color = palette.text || "#F1EEE6";
    if (project.brandImage) {
      const img = document.createElement("img");
      img.src = project.brandImage;
      img.alt = "";
      frame.append(img);
    }
    const hook = project.plan?.hook || project.title || "Concept";
    const text = el("span", "creative-thumb-text", hook);
    frame.append(text);
    const badge = el("span", "creative-thumb-badge", "Concept preview");
    if (palette.accent) badge.style.color = palette.accent;
    frame.append(badge);
    return frame;
  }

  function projectCard(project) {
    const card = el("article", "creative-card");

    card.append(thumbnail(project));

    const body = el("div", "creative-card-body");
    body.append(el("h2", null, project.title || "Untitled concept"));

    const meta = el("p", "creative-card-meta");
    meta.textContent = [
      project.config?.platformLabel || "—",
      statusLabel(project),
      `Created ${formatDate(project.createdAt)}`,
    ].join(" · ");
    body.append(meta);

    const source = el("p", "creative-card-source");
    source.textContent = project.source?.sessionTitle
      ? `Source: ${project.source.sessionTitle}`
      : project.source?.sessionId
        ? `Source: research session #${project.source.sessionId}`
        : "Source: brief only";
    body.append(source);

    const actions = el("div", "creative-card-actions");
    const open = el("a", "btn creative-open", "Open project");
    open.href = `video-studio.html?project=${encodeURIComponent(project.id)}`;
    const remove = el("button", "studio-ghost-button creative-delete", "Delete");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete “${project.title || "this project"}”? This cannot be undone.`)) return;
      await store.deleteProject(project.id);
      await render();
    });
    actions.append(open, remove);
    body.append(actions);

    card.append(body);
    return card;
  }

  async function render() {
    const projects = await store.listProjects();
    grid.replaceChildren();
    if (!projects.length) {
      emptyEl.hidden = false;
      countEl.textContent = "";
      return;
    }
    emptyEl.hidden = true;
    countEl.textContent = `${projects.length} saved project${projects.length === 1 ? "" : "s"} · stored on this device`;
    projects.forEach((project) => grid.append(projectCard(project)));
  }

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
      await render();
    });
  }
})();
