(function () {
  const title = document.getElementById("confirmation-title");
  const message = document.getElementById("confirmation-message");
  const mark = document.getElementById("confirmation-mark");

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const errorDescription =
    query.get("error_description") ||
    hash.get("error_description") ||
    query.get("error") ||
    hash.get("error");

  if (errorDescription) {
    mark.textContent = "!";
    mark.classList.add("is-error");
    title.textContent = "Authentication could not be completed.";
    message.textContent = decodeURIComponent(errorDescription.replace(/\+/g, " "));
    return;
  }

  // Initializing the shared client processes the confirmation response and
  // persists the new Supabase session. This page intentionally does not
  // navigate anywhere afterward.
  window.sutraGetSession?.();
})();
