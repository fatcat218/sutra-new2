(function () {
  const client = window.sutraSupabase;
  const form = document.getElementById("reset-password-form");
  const password = document.getElementById("reset-password-new");
  const confirmation = document.getElementById("reset-password-confirm");
  const submit = document.getElementById("reset-password-submit");
  const intro = document.getElementById("reset-password-intro");
  const loading = document.getElementById("reset-password-loading");
  const errorEl = document.getElementById("reset-password-error");
  const successEl = document.getElementById("reset-password-success");
  const actions = document.getElementById("reset-password-actions");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function setReady() {
    loading.hidden = true;
    errorEl.hidden = true;
    intro.textContent = "Enter a secure password with at least eight characters.";
    form.hidden = false;
    password.focus();
  }

  function showInvalidLink() {
    loading.hidden = true;
    form.hidden = true;
    intro.textContent = "This recovery link is invalid or has expired.";
    showError("Return to the login page and request a new password reset email.");
    actions.hidden = false;
  }

  async function initialize() {
    if (!client) {
      showInvalidLink();
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const authError =
      query.get("error_description") ||
      hash.get("error_description") ||
      query.get("error") ||
      hash.get("error");

    if (authError) {
      loading.hidden = true;
      intro.textContent = "The recovery link could not be verified.";
      showError(decodeURIComponent(authError.replace(/\+/g, " ")));
      actions.hidden = false;
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      showInvalidLink();
      return;
    }
    setReady();
  }

  client?.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) setReady();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    if (password.value !== confirmation.value) {
      showError("The passwords do not match.");
      confirmation.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "Updating password...";
    try {
      const { error } = await client.auth.updateUser({
        password: password.value,
      });
      if (error) throw error;

      form.hidden = true;
      intro.textContent = "Your account is ready.";
      successEl.textContent =
        "Password updated successfully. You can continue to your Sutra workspace.";
      successEl.hidden = false;
      actions.hidden = false;
    } catch (error) {
      showError(error.message || "Could not update your password. Please try again.");
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Update password';
    }
  });

  initialize();
})();
