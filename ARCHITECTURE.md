# Technical Architecture

## Overview

A simple, self-contained responsive landing page built with pure HTML5, CSS3, and Vanilla JavaScript. The page includes a header with navigation, a hero section, a three-card features section, and a footer — all wrapped in a mobile-first responsive layout with a dark/light theme toggle.

The entire application lives in a single static site with no build tools, no frameworks, and no external dependencies.

## Technology Stack

| Technology | Choice | Justification |
|---|---|---|
| Markup | HTML5 (semantic elements) | Native, no build step, accessibility-first |
| Styling | CSS3 with custom properties (variables) | Enables dark mode via simple variable swaps; native `@media` queries for responsiveness |
| Scripting | Vanilla JavaScript (ES6+) | No dependency overhead; minimal DOM manipulation |
| Iconography | Inline SVGs | Zero external requests, scalable, colorable via CSS |
| Hosting | Static file serving (file:// or any HTTP server) | No backend required |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  index.html                  │
│                                              │
│  <header>                                    │
│    ┌──────────┐   <nav>                      │
│    │ Logo     │   ├── Home                   │
│    └──────────┘   ├── Features               │
│                    ├── About                  │
│                    └── Contact                │
│         ☀/🌙 Toggle Button                   │
│  </header>                                   │
│                                              │
│  <main>                                      │
│    <section class="hero">                    │
│      <h1>Headline</h1>                       │
│      <p>Subheadline</p>                      │
│      <button>Call to Action</button>         │
│    </section>                                │
│                                              │
│    <section class="features">                │
│      ┌────────┐ ┌────────┐ ┌────────┐       │
│      │ Card 1 │ │ Card 2 │ │ Card 3 │       │
│      └────────┘ └────────┘ └────────┘       │
│    </section>                                │
│  </main>                                     │
│                                              │
│  <footer>                                    │
│    Contact info, copyright                   │
│  </footer>                                   │
└─────────────────────────────────────────────┘
```

### Module Boundaries

| Module | Responsibility | Dependencies |
|---|---|---|
| `index.html` | Semantic structure, content hierarchy | None |
| `css/styles.css` | Layout, colors, typography, responsive breakpoints, dark mode visual rules | HTML classes/IDs |
| `js/main.js` | Dark mode toggle logic, localStorage persistence, theme class toggling | CSS variables |

All modules are independent. JavaScript only manipulates a single class (`dark`) on `<html>` or `<body>`. CSS variables handle all visual changes.

## Data Structures

### CSS Custom Properties (Theme Tokens)

Light theme (default):
```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #1a1a1a;
  --text-secondary: #555555;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --border-color: #e0e0e0;
  --shadow: rgba(0, 0, 0, 0.1);
  --card-bg: #ffffff;
  --header-bg: #ffffff;
  --footer-bg: #f5f5f5;
}
```

Dark theme (activated via `[data-theme="dark"]` or `.dark` class):
```css
[data-theme="dark"],
.dark {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #e0e0e0;
  --text-secondary: #b0b0b0;
  --accent: #4f8ff7;
  --accent-hover: #6ba0ff;
  --border-color: #2a2a4a;
  --shadow: rgba(0, 0, 0, 0.4);
  --card-bg: #16213e;
  --header-bg: #1a1a2e;
  --footer-bg: #16213e;
}
```

### JavaScript State

| Key | Type | Description |
|---|---|---|
| `theme` | `"light" \| "dark"` | Current active theme |
| `prefers-dark` | `boolean` | System preference from `matchMedia` |
| `storage-key` | `"landing-page-theme"` | localStorage key for persistence |

## API Design

No server-side API. Client-side interactions only.

### Dark Mode Toggle Contract

| Event / Method | Trigger | Effect |
|---|---|---|
| `toggleTheme()` | User clicks toggle button | Swaps `data-theme` attribute, updates localStorage |
| `initTheme()` | Page load | Reads localStorage → falls back to `prefers-color-scheme` → applies initial theme |
| `updateToggleIcon()` | After theme change | Switches icon between sun/moon |

### Breakpoints

| Name | Width | Usage |
|---|---|---|
| `mobile` | `< 768px` | Default (base) styles |
| `tablet` | `≥ 768px` | Feature cards become 2-column or wider |
| `desktop` | `≥ 1024px` | Full-width layout, larger typography |

```css
/* Mobile-first */
.features {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 768px) {
  .features {
    flex-direction: row;
    gap: 2rem;
  }
}
```

## File Structure

```
landing-page/
├── index.html          # Single-page HTML with embedded <style> and <script>
├── css/
│   └── styles.css      # All CSS: variables, reset, layout, responsive, dark mode
├── js/
│   └── main.js         # Theme toggle logic + initialization
└── README.md           # Project description (optional)
```

**Decision:** For maximum simplicity, all CSS and JS can be inlined within `index.html` using `<style>` and `<script>` tags. This eliminates cross-file references and makes deployment trivial (one file). However, separating them into `css/styles.css` and `js/main.js` improves readability and maintainability. **Recommended approach:** separate files for cleanliness, but a single-file variant is acceptable if deployment constraints require it.

## Implementation Notes

### 1. CSS Reset
Apply a minimal reset at the top of `styles.css`:
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; }
img { max-width: 100%; height: auto; }
a { text-decoration: none; color: inherit; }
```

### 2. Dark Mode Persistence
- On load: check `localStorage.getItem("landing-page-theme")`
- If absent: check `window.matchMedia("(prefers-color-scheme: dark)")`
- Apply `data-theme` attribute to `<html>` element
- On toggle: save to localStorage and update attribute

### 3. Performance
- No external resources (fonts, images, CDNs) — everything is inline or system-native
- CSS transitions on `background-color`, `color`, `border-color` for smooth theme switching (~200–300ms)
- JavaScript runs after DOMContentLoaded; negligible payload

### 4. Accessibility
- Semantic HTML (`<header>`, `<main>`, `<section>`, `<footer>`, `<nav>`)
- Sufficient contrast ratios in both themes (WCAG AA minimum)
- Toggle button has `aria-label` and `aria-pressed` state
- Focus visible styles for keyboard navigation
- Skip-to-content link recommended

### 5. Responsive Testing Targets
| Viewport | Width | Expected Behavior |
|---|---|---|
| Mobile | 320px | Single-column stack, hamburger or compact nav |
| Tablet | 768px | 2-column or full feature row, comfortable padding |
| Desktop | 1024px+ | Full layout, max-width container centered |

### 6. Gotchas
- CSS custom property transitions: browsers animate individual properties, not variables. Use `transition` on `color` and `background-color` directly, or transition the `--*` variables via a wrapper class.
- Dark mode flash: add `data-theme` attribute inline in `<html>` before CSS loads to prevent FOUC (flash of wrong theme).
- SVG icons: ensure `fill` and `stroke` use CSS variables, not hardcoded colors, so they adapt to theme.
