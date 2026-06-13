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

## 배포 (GitHub Pages)

- `.github/workflows/deploy.yml`: main 푸시 시 emsdk 설치 → `build:wasm` → `vite build` → Pages 배포.
- `vite.config.ts`의 `base`는 `GITHUB_REPOSITORY`에서 repo명 자동 도출(`/<repo>/`), 로컬은 `/`. 런타임 절대경로(wasm/worklet/res)는 `import.meta.env.BASE_URL` 접두(`main.ts`), favicon/커서는 상대경로.
- `build.sh`는 emcc가 PATH에 있으면(CI) 로컬 emsdk source를 건너뜀.
- **최초 1회 수동 설정**: GitHub repo 생성·push 후 Settings → Pages → Source를 "GitHub Actions"로 지정.

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

**전 마일스톤(1–4) + 잔여 채널 기능 완료·브라우저 검증됨.** 원본 기능 패리티 달성.

## 완료된 마일스톤

### 1b. 12채널 잔여 기능 — ✅ 완료
- 엔진: `CP_GLIDE`/`CP_WIDTH`/`CP_VOICE_MODE`(1/4/8) + `GP_MASTER_PAN`. Voice에 `pitchTarget/glissRatio/slideUp/fineTune`; `glissPitch`(원본 gliss2pitch). 모노 레가토(보이스0 재사용·피치슬라이드), 폴리 할당은 `voiceCount` 내. Paula 스테레오는 폴리(>1보이스)에서만, width 믹스(`handleChannelPanning` stereo 분기). 마스터팬은 필터 뒤.
- UI: Mono/PT Poly/Octa Poly 라디오(→VOICE_MODE 1/4/8), Glide 슬라이더, Master Panning 활성화. Chan 패닝 슬라이더는 Paula on 시 width로 전환("Chan Pan/Wid").
- 검증: 마스터팬(0→L/255→R), 글리산도 자기상관 궤적(200→441 점진 슬라이드, glide=1 즉시), 보이스수(모노=1교체/폴리=2), Paula width(255 하드팬교대/128 센터블렌드) 확인.

### 2. IFF / BRR / µ-law 파서 — ✅ 완료
- `web/src/audio/sample-formats/{iff-8svx,brr,mulaw}.ts`, `wav-loader.ts`가 디스패치(8SVX는 매직넘버, BRR/µ-law는 확장자/크기). 원본 `astro_formats/` 1:1 포팅.
- 8SVX: big-endian FORM/VHDR/BODY, raw signed 8-bit(피보나치 압축은 원본에도 미디코드). BRR: 9바이트 블록·4필터·16.16 고정소수점·루프 플래그(16744Hz). µ-law: 지수 확장 공식(비표준 G.711, 22050Hz). 루프 메타데이터는 `SampleData.loopStart/End`로 전달.
- 브라우저 검증: caxioohh.iff(5922@16726), amen short.brr(29024@16744, 루프 16–29023), 합성 µ-law(4000@22050) 전부 정상 디코드·재생.

### 3. Web MIDI — ✅ 완료
- `web/src/audio/midi-input.ts`: 순수 파서 `parseMidiMessage` + `MidiInput`(requestMIDIAccess, statechange). main.ts에서 noteOn/off(채널 보존)·pitchbend·CC#1 배선, MIDI 상태 텍스트.
- 엔진: 채널별 `bend[17]`(`ami_pitch_bend`), 전역 비브라토 LFO(`incVibratoTable`, vibratoTable 32값), `GP_VIBE_SPEED`/`GP_MOD_INTENSITY`. `step = pitchRatio*bend*vibe`로 피치 전진(원본 `totalPitchRatio`).
- 검증: 파서 단위검증(채널/vel0/14비트/CC#1) 통과. FFT로 피치벤드 비율(up 1.122/down 0.890 — `2^((v-8192)/49152)` 일치), 비브라토 intensity 게이팅(0=안정, 127=흔들림) 확인. **헤드리스 Chrome은 실제 MIDI 권한 미부여라 기기 입력은 실기 필요.**

### 4. 픽셀아트 UI — ✅ 완료
- `web/src/ui/ami/`: `palette.ts`(ami_palette 색상), `draw.ts`(베벨/체커슬라이더/버튼 프리미티브), `assets.ts`(amidos.ttf @font-face + PNG), `widgets.ts`(Slider/Button/Checkbox/Stepper), `waveform-canvas.ts`(파란 배경/흰 파형/주황 센터라인/F·E/루프드래그), `sample-list.ts`(01–12 채널 셀렉터), `piano-canvas.ts`(흰건반+pixelkey_black 스프라이트+16진 라벨+범위 오버레이), `ami-ui.ts`(1080×640 단일 캔버스 즉시모드 컨트롤러·포인터 라우팅·채널 미러·AmiNode 배선).
- 에셋은 `Res/`→`web/public/res/` 복사. `index.html`은 캔버스 마운트 + 정수 스케일(`image-rendering:pixelated`).
- **충실한 재현**: 원본 레이아웃·팔레트·위젯 시각적 동일. 검증: 스크린샷 대조, 채널전환·슬라이더·LOOP토글·피아노클릭·루프드래그 동작, 파형 렌더(무음구간 정확). (Glide/Mono-Poly/Master-Pan은 1b에서 엔진 배선 완료.)
- **주의**: `ami-node.setSample`는 transfer 미사용(구조화복제) — transfer 시 메인스레드 버퍼 detach로 파형이 빈 데이터를 읽음.

## TODO (남은 작업)

### 기능 마감
- [x] **SAVE 버튼** — `wav-encoder.ts`(16-bit PCM) + `ami-ui.saveActive`로 활성 채널 WAV 다운로드. (루프/트림 반영 익스포트는 추후.)
- [x] **MORE SETTINGS** — 모달 오버레이로 8-bit·ping-pong loop 토글 노출(`ami-ui.ts` overlayWidgets/moreOpen).
- [x] **컴퓨터 키보드 옥타브** — `−`/`=`(및 numpad)로 base octave 시프트, 상태줄 표시(`main.ts`).
- [x] **파형 줌/스크롤** — `waveform-canvas.ts`에 viewStart/viewLen 윈도우. 휠 줌(커서 중심), 스크롤바 썸 드래그/트랙 페이징, 줌인 시 라인모드/줌아웃 시 min·max 엔벨로프. 루프포인트 드래그는 뷰 기준 매핑. Widget에 `onWheel` 추가.
- [x] **샘플 트림** — MORE 패널의 "TRIM TO LOOP" 버튼이 활성 채널 샘플을 루프영역으로 크롭(엔진 재주입·루프 0~len 리셋·파형 갱신). 이후 SAVE로 트림본 익스포트.

### 마감/폴리시
- [x] favicon — `public/favicon.svg`(Amiga 풍 픽셀 아이콘) + `<link rel="icon">`로 404 제거.
- [x] 트래시 — `ImageButton`(amiTrashOff/On, press 피드백)으로 활성 채널 클리어. 중복 텍스트 버튼 제거.
- [x] 커스텀 커서 — 캔버스에 `amiMouseCursor.png` CSS 커서 적용.
- [ ] 미사용 에셋: `amiwin*.png`(창 스케일 가젯 — 웹 고정 레이아웃엔 불필요), `AmiLogo.png`(타이틀은 텍스트로 대체) — 의도적 미사용.

### 검증/이식 잔여
- [ ] **실제 MIDI 하드웨어 검증** — 헤드리스 Chrome은 권한 미부여라 noteOn/pitchbend/CC 실기 테스트 필요.
- [ ] DSP 정밀 회귀: 원본 VST와 동일 샘플·파라미터로 출력 파형 대조(현재는 합성 톤·RMS/FFT 위주 검증).
- [ ] `reference/` 패리티 도달 시 폴더 정리(원본 repo가 source of truth).

## 라이선스
GPL v3. `LICENSE` + `CREDITS.md`(원작자 astriiddev, 필터 출처 8bitbubsy pt2-clone) 유지.
