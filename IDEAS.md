# Value-Add Ideas


## 2026-06-21T14:15:50.955Z

- **Add mobile hamburger menu toggle** [high]: The HTML includes a mobile-menu-btn with hamburger spans, and script.js handles dark mode but there is no JavaScript to toggle the mobile navigation menu open/closed. Add click handler for #mobile-menu-btn that toggles a .nav-open class on the nav element, and corresponding CSS to show/hide the nav list on mobile.
- **Add scroll-aware sticky header shadow** [medium]: Add a subtle box-shadow to .site-header when the user scrolls past 10px. This provides visual depth feedback. Implement in script.js with a scroll event listener that toggles a .scrolled class on the header element.
- **Add meta description and SEO tags** [medium]: Include a <meta name='description'> tag and Open Graph meta tags (og:title, og:description, og:type) in the HTML head for better search engine indexing and social media sharing previews.
- **Add keyboard-accessible mobile menu (Escape to close)** [high]: When the mobile menu is open, pressing Escape should close it. Also add a keydown event listener on the body or nav to handle this. Improve overall keyboard accessibility beyond the existing focus-visible styles.
- **Add CSS prefers-reduced-motion support** [medium]: Wrap the hero fade-in transitions, card hover transforms, and smooth scroll in @media (prefers-reduced-motion: reduce) to disable animations for users who prefer reduced motion, improving accessibility compliance.
- **Add footer year dynamically via JS** [low]: Replace the hardcoded '&copy; 2025' in the footer with a dynamic year set via script.js so it always reflects the current year. This prevents stale copyright notices.
- **Add smooth scroll offset for sticky header** [medium]: Since the header is sticky with a 3.5rem height, anchor links to sections will be partially hidden behind the header. Add CSS scroll-margin-top to sections or use scroll-padding-top on html so linked sections are fully visible after navigation.
- **Add loading state prevention of FOUC** [low]: Move the theme initialization script inline in the <head> before CSS loads, or add a small inline script that reads localStorage and sets data-theme immediately to prevent flash of unstyled/wrong-theme content on page load.
