# Site presentation assets

`materials.css`, `card-themes.css`, and `chrome.css` are a deliberate snapshot
of the same-named files in `beebox/src/frontend/src/themes/`, taken for the
public-site integration on 2026-09-10. Preserve the app's surfaces, fonts,
stock colors and system controls. Update these together when reconciling the
site with app design changes; do not import app frontend code at build time.

`site.css` supplies static-site layout, navigation and responsive behavior.
These local assets are included in the source manifest and copied to dist.
