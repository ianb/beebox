// Which quality levels and languages report on-device availability.
import { launch } from "./cdp.ts";
const page = await launch({ profile: process.argv[2]!, url: "http://localhost:8931/blank.html", port: 9342 });
console.log(JSON.stringify(await page.eval(`(async () => {
  const SR = window.SpeechRecognition; const out = {};
  for (const quality of ["command", "dictation", "conversation"]) out[quality] = await SR.available({ langs: ["en-US"], processLocally: true, quality }).catch((e) => String(e));
  for (const lang of ["en-GB", "de-DE", "fr-FR", "ja-JP", "pt-BR", "ru-RU", "zh-CN", "xx-XX"]) out[lang] = await SR.available({ langs: [lang], processLocally: true }).catch((e) => String(e));
  return out;
})()`)));
await page.close();
