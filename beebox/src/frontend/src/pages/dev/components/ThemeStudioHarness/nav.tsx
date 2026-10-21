/**
 * The theme studio's app bar: the real place pill, session chip, voice chip,
 * attention badges and avatar faces in the app's `.bbx-app-nav` row, with
 * fixed props. Their menus hold one inert row each.
 */

import { useParams } from "@tanstack/react-router";
import { PlacePillFace, type PlacePillMenu } from "../../../../components/app-bar-faces/PlacePillFace";
import { AttentionBadgesFace } from "../../../../components/app-bar-faces/AttentionBadgesFace";
import { SessionChipFace } from "../../../../components/app-bar-faces/SessionChipFace";
import { VoiceChipFace } from "../../../../components/chat/VoiceChip/view";
import { Avatar } from "../../../../components/ui/Avatar";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { MenuItem } from "../../../../components/ui/dropdown-menu-item";

function noop() { /* A specimen menu row does nothing. */ }

const placeMenu: PlacePillMenu = ({ half, className, trigger }) => (
  <Dropdown align="left" width="w-[20rem]" className={className} trigger={trigger}>
    <MenuItem id={`bbx-studio-menu-${half}`} onClick={noop}>{half === "switch" ? "Garden" : "Open garden/"}</MenuItem>
  </Dropdown>
);

export function StudioNav() {
  const { boxSlug } = useParams({ strict: false });
  return <nav aria-label="Primary" className="bbx-app-nav bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden">
    {/* The row and group classes match AppNav (nav.tsx); the members are its real faces. */}
    <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 text-sm">
      <PlacePillFace boxSlug={boxSlug ?? ""} boxName="Seed exchange" place={{ dir: "garden", label: "garden" }}
        landmark={{ dir: "garden", label: "Garden", symbol: { glyph: "🌱" } }} menu={placeMenu} />
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <Dropdown align="right" width="w-56" trigger={({ toggle, ariaProps }) => (
          <SessionChipFace label="Saturday plan" drift="below" offEngine={false} accessibleName="Chat: Saturday plan · Sonnet — below the box default"
            onClick={toggle} ariaProps={ariaProps} />
        )}>
          <MenuItem id="bbx-studio-menu-session" onClick={noop}>New chat</MenuItem>
        </Dropdown>
        <Dropdown align="right" trigger={({ toggle, ariaProps }) => (
          // The trigger's classes match VoiceChip (VoiceChip/view.tsx).
          <button type="button" id="bbx-nav-voice" onClick={toggle} aria-label="Voice — taking turns, answers aloud, transcribing — voice notice" {...ariaProps}
            className="min-h-[40px] px-2 sm:px-[11px] flex items-center justify-center rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            <VoiceChipFace muted={false} narrationEnabled={false} hqInFlight alert />
          </button>
        )}>
          <MenuItem id="bbx-studio-menu-voice" onClick={noop}>Mute speech</MenuItem>
        </Dropdown>
        <AttentionBadgesFace base={`/${boxSlug ?? ""}`} pendingQuestions={2} onPlateTodos={3} escalatedTodos={1} errorCount={4} onOpenErrors={noop} />
        <Dropdown align="right" trigger={({ toggle, ariaProps }) => (
          // The trigger's classes match the profile menu (nav.tsx).
          <button type="button" id="bbx-nav-profile" onClick={toggle} title="Dana" {...ariaProps}
            className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-white/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            <Avatar name="Dana" email={null} picture={null} fallbackClassName="bg-white/20 text-white" />
          </button>
        )}>
          <MenuItem id="bbx-studio-menu-profile" onClick={noop}>Settings</MenuItem>
        </Dropdown>
      </div>
    </div>
  </nav>;
}
