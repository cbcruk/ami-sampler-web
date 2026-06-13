# CLAUDE.md — Ami Sampler Web

브라우저로 포팅 중인 Ami Sampler. 원본은 [astriiddev/Ami-Sampler-VST](https://github.com/astriiddev/Ami-Sampler-VST)
(JUCE/C++ VST·AU 플러그인, **GPL v3**). 이 repo는 그 **웹 포트**(파생물, GPL v3 유지).

## 핵심 방향 (WAM 방식)

**DSP만 C++ → standalone WASM, UI는 순수 TS+Canvas로 재작성.** 프레임워크 없음.
- DSP는 원본과 가깝게 유지(1:1 대조 가능). `reference/`의 원본 소스와 항상 대조하며 이식.
- UI/MIDI/파일로딩 등 나머지는 전부 새 웹 코드.

## 구조

```
engine/ami-engine.cpp   JUCE-free DSP. extern "C" C ABI. import 0개 ~20KB wasm.
engine/build.sh         emcc 빌드 (../web-build/emsdk 자동 source)
web/                    Vite + TS 앱
  public/ami-processor.js   AudioWorkletProcessor (import 없는 plain JS)
  public/wasm/ami-engine.wasm  (gitignored 빌드산출물)
  src/audio/ami-node.ts      메인스레드 컨트롤러 (AudioWorkletNode 래퍼)
  src/audio/param-ids.ts     파라미터 id (TS측)
  src/audio/wav-loader.ts    decodeAudioData
  src/ui/keyboard.ts, waveform.ts
  src/main.ts
reference/Source/       원본 JUCE 소스 (읽기전용 포팅 레퍼런스, reference/README.md에 매핑표)
Res/                    원본 픽셀아트 에셋 (UI용)
Samples/                원본 Amiga 샘플셋 (테스트용)
web-build/emsdk/        Emscripten SDK (gitignored 로컬 툴, 1.6G)
```

## 빌드 & 실행

```bash
cd web && pnpm install
pnpm build:wasm     # engine/build.sh → public/wasm/ami-engine.wasm
pnpm dev            # http://localhost:5173
pnpm build          # tsc && vite build (커밋 전 타입체크 겸용)
```
emcc가 없으면 README의 emsdk 설치 절차 참고.

## 반드시 지킬 규약

- **파라미터 id 3곳 동기화**: `engine/ami-engine.cpp`의 `enum ParamId` ↔ `web/src/audio/param-ids.ts` ↔ `web/public/ami-processor.js`. 하나 추가하면 셋 다 고칠 것.
- **DSP 충실성**: 새 DSP를 쓸 때 `reference/Source/`의 원본과 수식·상수까지 대조. 임의로 "개선"하지 말 것 (예: `getAmi8Bit`의 음수/양수 비대칭 양자화, 출력 부호 반전, RC 필터 계수는 원본 그대로).
- **AudioWorklet 제약**: 워크렛은 `fetch`/`import` 불가. wasm 바이트는 메인스레드에서 fetch해 `processorOptions`로 넘기고 워크렛에서 `WebAssembly.instantiate(bytes, {})`. wasm은 import 0개라 빈 importObject로 동작. 메모리는 `ALLOW_MEMORY_GROWTH=0`이라 Float32Array 뷰가 안정적 — growth 켜면 뷰 재생성 필요.
- 전역 규칙(kebab-case 파일명, 코드 문자열 영어, pnpm, strict TS, 명시적 반환타입, 타입/유틸 분리)은 `~/.claude/CLAUDE.md` 적용.

## 검증 방법 (chrome-devtools MCP)

- dev 서버 띄우고 `navigate_page` → `take_snapshot` → 파일 `upload_file`로 샘플 주입 → `evaluate_script`로 noteOn 후 AnalyserNode RMS/peak 측정.
- **함정**: 짧은 샘플(<0.5s)은 noteOff 없이도 끝까지 재생되고 멈춤. 출력 측정 시 **루프를 켜서 음을 지속**시킨 뒤 측정할 것 (안 그러면 측정 시점에 이미 끝나 peak=0으로 오판). 메인스레드엔 `window.__ami`(node/ctx/voices) 디버그 훅 노출됨.

## 현재 상태

**마일스톤 1(12 샘플러 채널) 코어 완료·브라우저 검증됨.** 12채널 독립 샘플/파라미터/보이스, MIDI 채널·노트범위 라우팅, mute/solo 게이팅, Paula 스테레오 교대 하드팬(첫 노트 L, 원본 `shouldPan`과 일치), per-channel vol/pan/ADSR/loop/8bit/S&H/finetune/root. UI는 1–12 채널 셀렉터로 단일 패널 재타게팅 + 전역 패널(A500/LED/Master). 엔진은 `(channel,id)` 페어 메시지 스킴(`ami_set_chan_param`/`ami_set_global_param`), per-channel 고정 샘플버퍼(1M frames), `INITIAL_MEMORY=128MB`.

**남은 채널 기능(M3 Web MIDI와 함께):** 글리산도, mono/poly 보이스 수(1/4/8), Paula width, 비브라토 LFO(CC#1).

## 다음 마일스톤

### 1b. 12채널 잔여 기능 (M3과 함께)
- 글리산도(mono 모드 피치 슬라이드), mono/poly voice-count 셀렉터, Paula width, 비브라토 LFO.
- 원본 `AmiSamplerVoice.cpp` gliss2pitch / `PluginProcessor.cpp` incVibratoTable 참고.

### 2. IFF / BRR / µ-law 파서
- `reference/Source/astro_formats/` — JUCE AudioFormat 서브클래스지만 파싱 자체는 plain 바이트 처리. WAV/AIFF는 이미 `decodeAudioData`로 처리됨.
- 추가 대상: IFF(8SVX, Amiga), BRR(SNES), µ-law. **파싱은 1회성이라 wasm보다 TS 포팅이 단순** — `wav-loader.ts` 옆에 포맷별 파서 추가하고 매직넘버로 디스패치 권장.

### 3. Web MIDI
- `navigator.requestMIDIAccess()` → noteOn/noteOff/pitchbend/CC.
- 원본 processBlock은 **CC#1(mod wheel) → vibrato intensity** 매핑. pitchwheel은 보이스 `bendRatio`(`pow(2,(v-8192)/49152)`). 이식 시 동일하게.

### 4. 픽셀아트 UI
- `Res/`: `amiwin*.png`(창 배경), `amidos.ttf`/`ami_font`(픽셀 폰트), `pixelkey_black.png`(키보드), 마우스커서/트래시.
- 레퍼런스: `reference/Source/PixelBuffer.cpp`, `GuiComponent.cpp`, `AmiWindowEditor.cpp`, `AmiLookAndFeel.cpp`.
- Canvas에 `image-rendering: pixelated`, 정수 스케일. 노브·가상 키보드·파형 에디터(루프 포인트 드래그) 재현.

## 라이선스
GPL v3. `LICENSE` + `CREDITS.md`(원작자 astriiddev, 필터 출처 8bitbubsy pt2-clone) 유지.
