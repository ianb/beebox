/**
 * The theme studio's app bar: the real place pill, session chip, voice chip,
 * attention badges and profile faces in the app's `AppNavFace` row, with
 * fixed props. Their menus hold one inert row each.
 */

import { useParams } from "@tanstack/react-router";
import { PlacePillFace, type PlacePillMenu } from "../../../../components/app-bar-faces/PlacePillFace";
import { AttentionBadgesFace } from "../../../../components/app-bar-faces/AttentionBadgesFace";
import { SessionChipFace } from "../../../../components/app-bar-faces/SessionChipFace";
import { VoiceChipFace } from "../../../../components/chat/VoiceChip/view";
import { AppNavFace } from "../../../../components/app-bar-faces/AppNavFace";
import { ProfileButtonFace } from "../../../../components/app-bar-faces/ProfileButtonFace";
import { VoiceChipButtonFace } from "../../../../components/app-bar-faces/VoiceChipButtonFace";
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
  return <AppNavFace pill={<PlacePillFace boxSlug={boxSlug ?? ""} boxName="Seed exchange" place={{ dir: "garden", label: "garden" }}
    landmark={{ dir: "garden", label: "Garden", symbol: { glyph: "🌱" } }} menu={placeMenu} />}>
    <Dropdown align="right" width="w-56" trigger={({ toggle, ariaProps }) => (
      <SessionChipFace label="Saturday plan" drift="below" offEngine={false} accessibleName="Chat: Saturday plan · Sonnet — below the box default"
        onClick={toggle} ariaProps={ariaProps} />
    )}>
      <MenuItem id="bbx-studio-menu-session" onClick={noop}>New chat</MenuItem>
    </Dropdown>
    <Dropdown align="right" trigger={({ toggle, ariaProps }) => (
      <VoiceChipButtonFace label="Voice — taking turns, answers aloud, transcribing — voice notice" onClick={toggle} ariaProps={ariaProps}>
        <VoiceChipFace muted={false} narrationEnabled={false} hqInFlight alert />
      </VoiceChipButtonFace>
    )}>
      <MenuItem id="bbx-studio-menu-voice" onClick={noop}>Mute speech</MenuItem>
    </Dropdown>
    <AttentionBadgesFace base={`/${boxSlug ?? ""}`} pendingQuestions={2} onPlateTodos={3} escalatedTodos={1} errorCount={4} onOpenErrors={noop} />
    <Dropdown align="right" trigger={({ toggle, ariaProps }) => (
      <ProfileButtonFace user={{ name: "Dana", email: null }} onClick={toggle} ariaProps={ariaProps} />
    )}>
      <MenuItem id="bbx-studio-menu-profile" onClick={noop}>Settings</MenuItem>
    </Dropdown>
  </AppNavFace>;
}
