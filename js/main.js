/**
 * main.js — Dark mode toggle logic with localStorage persistence
 * 
 * Responsibilities:
 * 1. Initialize theme on page load (localStorage > prefers-color-scheme > default light)
 * 2. Toggle theme on button click
 * 3. Persist preference to localStorage
 * 4. Update toggle button aria-pressed state
 */

(function () {
  'use strict';

  // Constants
  const STORAGE_KEY = 'landing-page-theme';
  const THEME_ATTR = 'data-theme';
  const TOGGLE_BTN = document.getElementById('theme-toggle');
  const MOBILE_MENU_BTN = document.getElementById('mobile-menu-btn');
  const NAV_LIST = document.querySelector('.nav-list');

  /**
   * Initialize theme on page load.
   * Priority: localStorage > system preference > default (light)
   */
  function initTheme() {
    let theme = localStorage.getItem(STORAGE_KEY);

    if (!theme) {
      // Fall back to system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : 'light';
    }

    applyTheme(theme);
  }

  /**
   * Apply a theme to the document.
   * @param {string} theme - 'light' or 'dark'
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute(THEME_ATTR, theme);

    // Update toggle button aria-pressed
    if (TOGGLE_BTN) {
      TOGGLE_BTN.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  /**
   * Toggle between light and dark themes.
   */
  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute(THEME_ATTR);
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    applyTheme(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }

  /**
   * Toggle mobile navigation menu open/closed.
   */
  function toggleMobileMenu() {
    const isOpen = NAV_LIST.classList.toggle('is-open');
    MOBILE_MENU_BTN.setAttribute('aria-expanded', String(isOpen));
  }

  /**
   * Close mobile menu when a nav link is clicked.
   * @param {Event} e - Click event
   */
  function closeMobileMenu(e) {
    if (NAV_LIST.classList.contains('is-open') && NAV_LIST.contains(e.target)) {
      // Only close if the clicked target is a nav link (not the toggle button itself)
      if (e.target.classList.contains('nav-link')) {
        NAV_LIST.classList.remove('is-open');
        MOBILE_MENU_BTN.setAttribute('aria-expanded', 'false');
      }
    }
  }

  // Event listeners
  if (TOGGLE_BTN) {
    TOGGLE_BTN.addEventListener('click', toggleTheme);
  }

  if (MOBILE_MENU_BTN) {
    MOBILE_MENU_BTN.addEventListener('click', toggleMobileMenu);
  }

  // Close mobile menu when clicking a nav link
  if (NAV_LIST) {
    NAV_LIST.addEventListener('click', closeMobileMenu);
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    // Only auto-switch if user hasn't set a manual preference
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
  });

})();
