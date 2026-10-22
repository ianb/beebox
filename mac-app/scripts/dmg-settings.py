# dmgbuild settings for the Bee Box Desktop DMG (scripts/make-dmg.sh passes
# app, background, and icon with -D). Positions match the arrow drawn by
# scripts/make-art.swift: the app at (170, 230), Applications at (490, 230),
# in a 660 x 420 window.
import os.path

application = defines["app"]  # noqa: F821 (dmgbuild provides `defines`)
appname = os.path.basename(application)

format = "UDZO"
# HFS+, the format dmgbuild documents for background pictures.
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]  # noqa: F821
background = defines["background"]  # noqa: F821

show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
window_rect = ((200, 120), (660, 420))
default_view = "icon-view"
show_icon_preview = False
arrange_by = None
icon_size = 112
text_size = 13
icon_locations = {appname: (170, 230), "Applications": (490, 230)}
