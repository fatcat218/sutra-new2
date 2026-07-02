(function () {
  const API_BASE = window.SUTRA_API_URL || "http://127.0.0.1:8000";

  document.querySelectorAll("[data-waitlist-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const status = form.parentElement.querySelector("[data-waitlist-status]");
      const data = new FormData(form);

      button.disabled = true;
      button.textContent = "Joining...";
      if (status) status.textContent = "";

      try {
        const response = await fetch(`${API_BASE}/api/waitlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: data.get("full_name") || null,
            email: data.get("email"),
            company_website: data.get("company_website") || null,
            marketing_consent: false,
            policy_version: "privacy-v1",
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.detail || "Could not join the waitlist.");
        }
        form.reset();
        button.textContent = "You’re in ✓";
        if (status) status.textContent = result.message || "You’re on the list.";
      } catch (error) {
        button.disabled = false;
        button.innerHTML = 'Try again';
        if (status) status.textContent = error.message || "Something went wrong.";
      }
    });
  });
})();
