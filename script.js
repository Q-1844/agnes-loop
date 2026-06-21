/**
 * AgnesLoop — Dark Mode Toggle
 *
 * IIFE pattern to avoid global scope pollution.
 * Handles: localStorage persistence, system preference detection,
 * and toggle button interaction.
 */
(function () {
  'use strict';

  // --- Constants ---
  var STORAGE_KEY = 'theme';
  var TOGGLE_BUTTON = document.getElementById('themeToggle');
  var DARK_CLASS = 'dark';
  var SUN_ICON = '\u2600\uFE0F';   // ☀️
  var MOON_ICON = '\uD83C\uDF19';  // 🌙

  /**
   * Determine the initial theme before any user interaction.
   * Priority: localStorage > system preference > default "light"
   */
  function getInitialTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === DARK_CLASS) {
        return DARK_CLASS;
      }
      if (stored === 'light') {
        return 'light';
      }
    } catch (e) {
      // localStorage unavailable (private browsing, etc.) — fall through
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return DARK_CLASS;
    }

    return 'light';
  }

  /**
   * Apply the given theme to the document.
   * @param {string} theme — "light" or "dark"
   */
  function applyTheme(theme) {
    var html = document.documentElement;

    if (theme === DARK_CLASS) {
      html.setAttribute('data-theme', DARK_CLASS);
    } else {
      html.removeAttribute('data-theme');
    }

    // Update toggle button icon and aria-pressed
    if (TOGGLE_BUTTON) {
      var icon = TOGGLE_BUTTON.querySelector('.toggle-icon');
      if (icon) {
        icon.textContent = theme === DARK_CLASS ? SUN_ICON : MOON_ICON;
      }
      TOGGLE_BUTTON.setAttribute('aria-pressed', theme === DARK_CLASS ? 'true' : 'false');
    }
  }

  /**
   * Toggle between light and dark themes.
   */
  function toggleTheme() {
    var current = document.documentElement.hasAttribute('data-theme')
      ? DARK_CLASS
      : 'light';

    var next = current === DARK_CLASS ? 'light' : DARK_CLASS;

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      // Silently ignore storage failures
    }

    applyTheme(next);
  }

  // --- Initialization ---
  var initial = getInitialTheme();
  applyTheme(initial);

  // --- Event Listener ---
  if (TOGGLE_BUTTON) {
    TOGGLE_BUTTON.addEventListener('click', toggleTheme);
  }

  // Listen for system theme changes on first load only
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(e.matches ? DARK_CLASS : 'light');
        }
      } catch (err) {
        // ignore
      }
    });
  }
})();
