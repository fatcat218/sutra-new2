(function () {
  if (window.sutraSupabase) return;

  if (
    !window.supabase ||
    !window.SUTRA_SUPABASE_URL ||
    !window.SUTRA_SUPABASE_PUBLISHABLE_KEY
  ) {
    console.error("Sutra authentication could not be initialized.");
    return;
  }

  window.sutraSupabase = window.supabase.createClient(
    window.SUTRA_SUPABASE_URL,
    window.SUTRA_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

  window.sutraGetSession = async function () {
    const { data, error } = await window.sutraSupabase.auth.getSession();
    return error ? null : data.session;
  };

  window.sutraApiFetch = async function (path, options = {}) {
    const session = await window.sutraGetSession();
    if (!session) throw new Error("Sign in to continue.");

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.access_token}`);
    return fetch(
      `${window.SUTRA_API_URL || "http://127.0.0.1:8000"}${path}`,
      { ...options, headers }
    );
  };
})();
