/**
 * The realtime transcription machine wired to its real actor (mic, worklet,
 * live socket, voice staging). Separate from the machine definition so a
 * doctest can drive the machine with a fake actor without loading the audio
 * worklet, which only Vite can resolve.
 */

import { realtimeTranscriptionMachine } from "./realtimeTranscriptionMachine";
import { transcriptionActor } from "./transcription-actor";

export const liveTranscriptionMachine = realtimeTranscriptionMachine.provide({
  actors: { transcriptionActor },
});
