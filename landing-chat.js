(function () {
  const form = document.getElementById("landing-chat-form");
  const input = document.getElementById("landing-chat-input");
  const suggestions = document.querySelectorAll("[data-chat-suggestion]");
  if (!form || !input) return;

  function savePendingMessage(message) {
    const cleanMessage = String(message || "").trim();
    if (cleanMessage) {
      localStorage.setItem("sutra_pending_message", cleanMessage);
    }
  }

  form.addEventListener("submit", () => {
    // The form's native target="_blank" opens the chatbot in a new tab.
    // We only persist the prompt here so the new tab can pick it up.
    savePendingMessage(input.value);
  });

  suggestions.forEach((button) => {
    button.addEventListener("click", () => {
      // The anchor opens natively in a new tab; preserve its starter prompt.
      savePendingMessage(button.dataset.chatSuggestion);
    });
  });
})();
