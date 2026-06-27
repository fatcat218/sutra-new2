(function () {
  const client = window.sutraSupabase;
  const actions = document.querySelectorAll("[data-auth-action]");
  const userLabels = document.querySelectorAll("[data-auth-user]");
  if (!client || !actions.length) return;

  function render(session) {
    const signedIn = Boolean(session);
    const user = session?.user;
    const name =
      user?.user_metadata?.full_name ||
      user?.email ||
      "";

    actions.forEach((action) => {
      action.textContent = signedIn ? "Log out" : "Sign up / Log in";
      action.dataset.signedIn = signedIn ? "true" : "false";
      if (signedIn) {
        action.removeAttribute("href");
        action.setAttribute("role", "button");
      } else {
        action.href =
          action.dataset.authHref || "chatbot.html";
        action.removeAttribute("role");
      }
    });

    userLabels.forEach((label) => {
      label.textContent = signedIn ? name : "";
      label.hidden = !signedIn;
    });
  }

  actions.forEach((action) => {
    action.addEventListener("click", async (event) => {
      const session = await window.sutraGetSession();
      if (!session) return;

      event.preventDefault();
      action.setAttribute("aria-busy", "true");
      action.textContent = "Logging out...";
      const { error } = await client.auth.signOut({ scope: "local" });
      action.removeAttribute("aria-busy");
      if (error) {
        action.textContent = "Try logout again";
        return;
      }
      localStorage.removeItem("sutra_active_session_id");
      render(null);
    });
  });

  window.sutraGetSession().then(render);
  client.auth.onAuthStateChange((_event, session) => render(session));
})();
