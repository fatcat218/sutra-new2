/*
 * video-store.js — data-service abstraction for Campaign Video Studio projects.
 *
 * The UI only talks to sutraVideoStore. There is currently no backend endpoint
 * for video projects, so this implementation falls back to localStorage,
 * namespaced per authenticated user. A future backend implementation should
 * keep the same async signatures:
 *
 *   sutraVideoStore.listProjects()          -> Promise<Project[]>
 *   sutraVideoStore.getProject(id)          -> Promise<Project|null>
 *   sutraVideoStore.saveProject(project)    -> Promise<Project>
 *   sutraVideoStore.deleteProject(id)       -> Promise<void>
 */
(function () {
  "use strict";

  const KEY_PREFIX = "sutra_video_projects_v1";
  /* Keep persisted uploads small; larger images stay preview-only in-session. */
  const MAX_IMAGE_CHARS = 900000; /* ~660KB binary as dataURL */

  async function userKey() {
    let userId = "anonymous";
    try {
      const session = await window.sutraGetSession?.();
      if (session?.user?.id) userId = session.user.id;
    } catch {
      /* fall through to anonymous namespace */
    }
    return `${KEY_PREFIX}:${userId}`;
  }

  function readAll(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeAll(key, projects) {
    try {
      localStorage.setItem(key, JSON.stringify(projects));
      return true;
    } catch {
      return false;
    }
  }

  function stripHeavyImage(project) {
    const copy = { ...project };
    if (
      typeof copy.brandImage === "string" &&
      copy.brandImage.length > MAX_IMAGE_CHARS
    ) {
      copy.brandImage = null;
      copy.brandImageDropped = true;
    }
    return copy;
  }

  async function listProjects() {
    const key = await userKey();
    return readAll(key).sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    );
  }

  async function getProject(id) {
    const key = await userKey();
    return readAll(key).find((project) => project.id === id) || null;
  }

  async function saveProject(project) {
    const key = await userKey();
    const projects = readAll(key);
    const now = new Date().toISOString();
    const record = stripHeavyImage({
      ...project,
      id: project.id || `vid-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
      createdAt: project.createdAt || now,
      updatedAt: now,
      storage: "local-temporary",
    });
    const index = projects.findIndex((item) => item.id === record.id);
    if (index >= 0) projects[index] = record;
    else projects.unshift(record);

    if (!writeAll(key, projects)) {
      /* Storage full — retry once without any images. */
      const slim = projects.map((item) => ({ ...item, brandImage: null }));
      if (!writeAll(key, slim)) {
        throw new Error(
          "Could not save the project locally (browser storage is full)."
        );
      }
      record.brandImage = null;
      record.brandImageDropped = true;
    }
    return record;
  }

  async function deleteProject(id) {
    const key = await userKey();
    const projects = readAll(key).filter((project) => project.id !== id);
    writeAll(key, projects);
  }

  window.sutraVideoStore = {
    backend: "localStorage (temporary fallback — no video endpoint exists yet)",
    listProjects,
    getProject,
    saveProject,
    deleteProject,
  };
})();
