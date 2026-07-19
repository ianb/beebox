# Self-hosting via vLLM: agentic + vision reality (mid-2026)

*2026-07-18. Deep-pass per-topic note (subagent web research, Sonnet; lightly edited).
Terminology: **vLLM** is the open-source GPU inference server (the "v" is "virtual" —
memory paging, nothing to do with vision); **VLM** = vision-language model, a model that
understands images. vLLM-the-server serves VLMs. Question: is self-hosting credible for
an image-centric personal assistant handling private data?
Synthesis: [2026-07-18-synthesis.md](2026-07-18-synthesis.md).*

One angle (parallel/streaming tool-call parser reliability) came back thin; flagged.

---

## 1. Open-weight vision candidates

| Model | Vision reputation | Tool-calling | Size / vLLM status |
|---|---|---|---|
| **Qwen3-VL** (Nov 2025) | "Gets me 90% of the way there" for screenshots [report, HN Feb 2026]; good OCR, "mixes up rows" on precise tables [report] | Inherited parser problems from Qwen2.5-VL; looping-generation and fp8-truncation issues open | 2B–235B; needs vllm≥0.11; actively maintained, real bugs |
| **GLM-4.5V/4.6V** | Vendor markets native multimodal tool use | **Broken combo, confirmed**: vision needs transformers≥5.0, vLLM's `glm45` tool parser is incompatible with transformers 5.x — vision OR tools, not both (vllm#31485, GLM-V#240, unresolved) | 9B/106B; disqualified for our combo until fixed |
| **Kimi K2.5/K2.6** | Vision arrived with K2.5 (Feb 2026, MoonViT-3D); base K2 has none | Unknown on vLLM | 1T MoE; vLLM support unverified |
| **Llama 4** (Scout/Maverick) | No practitioner signal either way found | Native tool calling | Day-0 vLLM support; ~55GB at Q4 (Scout) |
| **Gemma 3 / 4** | Vendor: vision + tools | Open tool-calling issue | 1B–27B; Gemma 4 too new to assess |
| **InternVL3.5** | Strong GUI-agent benchmarks (vendor-adjacent) | Unevaluated | up to 241B MoE; vLLM recipe exists |
| **MiniCPM-V 4.6** | Best OCR in the 6GB-VRAM class per roundups | Documented parser flag | 8B class |

## 2. Tool-calling reliability through vLLM

Flag-driven per-model parsers (`--enable-auto-tool-choice` + `--tool-call-parser`).
Real infrastructure; fragility concentrates exactly here — per-model parser bugs are
common and current, and vision variants ship on different transformers/vLLM cadences
than their text siblings, so the parser you need is the least-baked one.
Parallel/streaming tool-call reliability: evidence too thin to call — treat as
unverified. Best hard cross-model number (from the quality thread): Claude Opus 4.5 95%
vs GLM-4.6 87.5% success on a Linear-API agent-task eval (HN, Dec 2025).

## 3. Anthropic-compatibility (Claude Code over vLLM)

The clear good-news item, and a real change since 2025:

- **vLLM ships a native `/v1/messages` (Anthropic Messages) endpoint** (PR #22627;
  dedicated "Claude Code" integration doc dated 2026-03-12). Double-adapter
  architecture (Anthropic → internal OpenAI shape → back to Anthropic SSE).
- Caveats: Python frontend only (Rust frontend lacks it, open RFC); model names with
  `/` break; tool calling still needs the right per-model parser.
- Claude Code and the Agent SDK officially support `ANTHROPIC_BASE_URL` redirection;
  Anthropic's stance on local models is "not planned" (claude-code#7178 closed) — the
  mechanism works, unsupported.
- Practitioner confirmations exist (dev.to via LiteLLM, roborhythms.com walkthrough);
  a direct untranslated OpenAI-compatible connection fails (system-prompt grouping,
  tool-call structure, SSE format all differ) — the adapter layer is load-bearing.
- Known bugs: images passed as None on one backend path; Claude Code's per-request
  cache hash defeats vLLM prefix caching unless >0.17.1; `cached_tokens` reporting
  differs from Anthropic's API.
- LiteLLM remains the mature independent alternative translation layer.

## 4. Multimodal serving mechanics

Base64 + URL image input via OpenAI-style parts; multiple images gated by
`--limit-mm-per-prompt`. **No native PDF path — confirmed negative** (image/video/audio
only): PDFs and photographed docs must be pre-converted to images. Image token budgets
are large (~32K tokens/image for Qwen3-VL at high res). VRAM: vision towers add
~0.5–4GB, but the real risks are a Qwen3-VL days-long VRAM-growth-to-OOM issue (open)
and CPU RAM spikes (50–60GB on 40-image requests). Telling signal:
`vllm-project/vllm-omni` was spun out because core vLLM's multimodal path is considered
insufficient for production multimodal at scale (Red Hat, Jun 2026) — multimodal is
vLLM's rough edge, not its polished core.

## 5. Hardware/cost reality

- The one measured vision-agentic data point: Qwen3-VL-30B-A3B-FP8 needed **45.2GB**
  VRAM (90 tok/s, 35 tok/s at 128K context) — does not fit a stock 24GB 4090. AWQ 4-bit
  "should fit 24GB" claims are calculator-site estimates, not measured runs. **No
  independent report found of any vision-capable model running well on a plain
  24/32GB single card via vLLM.**
- GLM-4.5V AWQ specifies tensor-parallel-4. Llama 4 Scout ~55GB at Q4.
- Quantization: standard AWQ recipes exclude the vision tower (quant-sensitive;
  llama.cpp maintainers recommend BF16 for vision projectors); the compression tooling
  itself crashes on Qwen3-VL calibration (closed-unfixed).
- Prices (soft): used A6000 48GB $2.6–3.8K; RTX 5090 ~$4–4.3K; cloud A6000
  $0.33–0.80/hr; H100 $3.29–4.29/hr.
- Mac/MLX fallback: Qwen3-VL has day-0 mlx-vlm support; M3 Ultra 256GB did ~30 tok/s on
  the 235B Q4 — but Apple discontinued the 128–512GB Mac Studio configs (Mar–May 2026),
  capping the line at 96GB and undercutting that strategy.

## 6. The honest quality gap

- Artificial Analysis Intelligence Index (live): best open model (GLM-5.2 max) 51 vs
  Claude Fable 5 at 60, GPT-5.6 at 59 — a persistent ~9-point gap.
- Tool use measured: 95% vs 87.5% (above).
- Practitioner consensus: "usably close, not equal"; common pattern is Claude for
  planning, open model for execution. Vision specifically: casual screenshot reading is
  genuinely good (90%-there); precision table/document extraction is not trusted.
- No independent 2026 agentic leaderboard compares these VLMs on multi-step non-coding
  assistant tasks — the case for or against rests on sparse data.

---

## Viable stacks + verdict

- **Stack A (cheapest credible pilot):** Qwen3-VL-30B FP8 on a 48GB card (A6000-class,
  ~$2.6–3.8K used, or ~$0.33–0.80/hr cloud), vLLM ≥0.11 native `/v1/messages`, Claude
  Code pointed at it. Expect workable casual vision, tool-calling below Claude's,
  open bugs, no PDF ingestion, OOM risk on long sessions.
- **Stack B (avoid today):** GLM-4.6V — vision-plus-tools is broken by a real open
  version conflict.
- **Stack C (dev-box fallback, not vLLM):** Qwen3-VL via mlx-vlm on a Mac for iterating
  on the plumbing without cloud GPU spend; not deployable.

**Verdict: not credible today as a primary path; a live future bet.** The plumbing
(native Anthropic endpoint under our unchanged harness) now exists and is
multiply confirmed — recheck in 6–12 months, especially the GLM parser conflict and the
single-GPU vision hardware curve. Do not architect the data-sovereignty story around it
shipping in the next cycle.
