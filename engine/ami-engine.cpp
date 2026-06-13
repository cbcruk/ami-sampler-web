// Ami Sampler — JUCE-free DSP engine for WebAssembly / AudioWorklet.
//
// Ports the core Amiga/Paula sampler DSP from the JUCE plugin
// (AmiSamplerSound.cpp + RCFilters.cpp + PluginProcessor processBlock)
// into a self-contained C ABI compiled to standalone WASM.
//
// Faithful to the original:
//   - 8-bit signed quantization (getAmi8Bit)
//   - sample-and-hold decimation (snh)
//   - nearest-neighbor pitch resampling
//   - forward / ping-pong looping
//   - linear ADSR
//   - Paula RC low/high-pass + 2-pole LED filter on the master bus

#include <cmath>
#include <cstring>
#include <cstdint>

extern "C" {

constexpr int MAX_VOICES = 16;
constexpr int MAX_SAMPLE_FRAMES = 4 * 1024 * 1024; // ~16M floats per channel
constexpr int MAX_BLOCK = 1024;

// ----------------------------------------------------------------------------
// Parameter ids (kept in sync with audio/param-ids.ts)
// ----------------------------------------------------------------------------
enum ParamId {
    P_EIGHT_BIT = 0,   // 8-bit quantization on/off
    P_SNH       = 1,   // sample-and-hold step (>=1)
    P_LOOP_EN   = 2,
    P_LOOP_START= 3,
    P_LOOP_END  = 4,
    P_PINGPONG  = 5,
    P_ATTACK    = 6,   // seconds
    P_DECAY     = 7,
    P_SUSTAIN   = 8,   // 0..1
    P_RELEASE   = 9,
    P_VOLUME    = 10,  // 0..1
    P_PAN       = 11,  // 0..255 (Amiga style), 128 = center
    P_A500      = 12,  // model: 1 = A500 (LP+HP), 0 = A1200 (HP only)
    P_LED       = 13,  // LED filter on/off
    P_ROOT_NOTE = 14,  // MIDI note that plays at source rate
    P_FINETUNE  = 15,  // cents
    P_MASTER_VOL= 16,
    P__COUNT
};

// ----------------------------------------------------------------------------
// Linear ADSR (mirrors juce::ADSR segment behaviour closely enough)
// ----------------------------------------------------------------------------
struct ADSR {
    enum State { Idle, Attack, Decay, Sustain, Release };
    State state = Idle;
    float level = 0.f;
    float sampleRate = 44100.f;
    float attack = 0.01f, decay = 0.1f, sustain = 1.f, release = 0.1f;
    float attackRate = 0.f, decayRate = 0.f, releaseRate = 0.f;

    void recalc() {
        attackRate  = attack  > 0.f ? 1.f / (attack  * sampleRate) : -1.f;
        decayRate   = decay   > 0.f ? (1.f - sustain) / (decay * sampleRate) : -1.f;
        releaseRate = release > 0.f ? 1.f / (release * sampleRate) : -1.f;
    }
    void noteOn() {
        recalc();
        if (attackRate > 0.f) { state = Attack; }
        else { level = 1.f; state = decayRate > 0.f ? Decay : Sustain; }
    }
    void noteOff() {
        if (state == Idle) return;
        recalc();
        if (releaseRate > 0.f) state = Release;
        else { level = 0.f; state = Idle; }
    }
    void reset() { state = Idle; level = 0.f; }
    bool isActive() const { return state != Idle; }

    float next() {
        switch (state) {
            case Idle: return 0.f;
            case Attack:
                level += attackRate;
                if (level >= 1.f) { level = 1.f; state = decayRate > 0.f ? Decay : Sustain; }
                break;
            case Decay:
                level -= decayRate;
                if (level <= sustain) { level = sustain; state = Sustain; }
                break;
            case Sustain:
                level = sustain;
                break;
            case Release:
                level -= releaseRate;
                if (level <= 0.f) { level = 0.f; state = Idle; }
                break;
        }
        return level;
    }
};

// ----------------------------------------------------------------------------
// RC filters (port of RCFilters.cpp)
// ----------------------------------------------------------------------------
static const double PI = 3.14159265358979323846;
static const double TWO_PI = 2.0 * PI;
static const double SMALL = 1e-4;

struct OnePole { double a1=0, a2=0, tmpL=0, tmpR=0; };
struct TwoPole { double a1=0,a2=0,b1=0,b2=0, tmpL[4]={0,0,0,0}, tmpR[4]={0,0,0,0}; };

static void setupOnePole(double rate, double cut, OnePole* f) {
    if (cut >= rate/2.0) cut = rate/2.0 - SMALL;
    double a = 2.0 - std::cos((TWO_PI * cut) / rate);
    double b = a - std::sqrt(a*a - 1.0);
    f->a1 = 1.0 - b; f->a2 = b;
}
static void onePoleLP(OnePole* f, float inL, float inR, float* oL, float* oR) {
    f->tmpL = inL*f->a1 + f->tmpL*f->a2; *oL = (float)f->tmpL;
    f->tmpR = inR*f->a1 + f->tmpR*f->a2; *oR = (float)f->tmpR;
}
static void onePoleHP(OnePole* f, float inL, float inR, float* oL, float* oR) {
    f->tmpL = inL*f->a1 + f->tmpL*f->a2; *oL = (float)(inL - f->tmpL);
    f->tmpR = inR*f->a1 + f->tmpR*f->a2; *oR = (float)(inR - f->tmpR);
}
static void setupTwoPole(double rate, double cut, double q, TwoPole* f) {
    if (cut >= rate/2.0) cut = rate/2.0 - SMALL;
    double a = 1.0 / std::tan((PI * cut) / rate);
    double b = 1.0 / q;
    f->a1 = 1.0 / (1.0 + b*a + a*a);
    f->a2 = 2.0 * f->a1;
    f->b1 = 2.0 * (1.0 - a*a) * f->a1;
    f->b2 = (1.0 - b*a + a*a) * f->a1;
}
static void twoPoleLP(TwoPole* f, float inL, float inR, float* oL, float* oR) {
    double L = inL*f->a1 + f->tmpL[0]*f->a2 + f->tmpL[1]*f->a1 - f->tmpL[2]*f->b1 - f->tmpL[3]*f->b2;
    double R = inR*f->a1 + f->tmpR[0]*f->a2 + f->tmpR[1]*f->a1 - f->tmpR[2]*f->b1 - f->tmpR[3]*f->b2;
    f->tmpL[1]=f->tmpL[0]; f->tmpL[0]=inL; f->tmpL[3]=f->tmpL[2]; f->tmpL[2]=L;
    f->tmpR[1]=f->tmpR[0]; f->tmpR[0]=inR; f->tmpR[3]=f->tmpR[2]; f->tmpR[2]=R;
    *oL=(float)L; *oR=(float)R;
}

// ----------------------------------------------------------------------------
// Voice (port of AmiSamplerVoice)
// ----------------------------------------------------------------------------
struct Voice {
    bool active = false;
    int  note = 0;
    double pos = 0.0;
    double pitchRatio = 1.0;
    float gain = 0.f;
    bool forward = true;
    ADSR adsr;
};

// ----------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------
struct Engine {
    double devRate = 44100.0;
    double sourceRate = 44100.0;
    int    sampleFrames = 0;
    int    sampleChannels = 1;

    float params[P__COUNT];

    Voice voices[MAX_VOICES];

    OnePole a500Lo, a500Hi, a1200Hi;
    TwoPole led;

    void initFilters() {
        double rate = devRate;
        a500Lo = OnePole(); a500Hi = OnePole(); a1200Hi = OnePole(); led = TwoPole();
        setupOnePole(rate, 1.0 / (TWO_PI * 360.0 * 1e-7),       &a500Lo);   // ~4421 Hz
        setupOnePole(rate, 1.0 / (TWO_PI * 1390.0 * 2.233e-5),  &a500Hi);   // ~5.13 Hz
        setupOnePole(rate, 1.0 / (TWO_PI * 1360.0 * 2.2e-5),    &a1200Hi);  // ~5.32 Hz
        double R1=10000,R2=10000,C1=6.8e-9,C2=3.9e-9;
        double cut = 1.0/(TWO_PI*std::sqrt(R1*R2*C1*C2));
        double q   = std::sqrt(R1*R2*C1*C2)/(C2*(R1+R2));
        setupTwoPole(rate, cut, q, &led);
    }

    void init(double sr) {
        devRate = sr;
        std::memset(params, 0, sizeof(params));
        params[P_EIGHT_BIT] = 1; params[P_SNH] = 1; params[P_SUSTAIN] = 1;
        params[P_VOLUME] = 1; params[P_PAN] = 128; params[P_A500] = 1;
        params[P_ATTACK] = 0.001f; params[P_DECAY] = 0.1f; params[P_RELEASE] = 0.05f;
        params[P_ROOT_NOTE] = 60; params[P_MASTER_VOL] = 1;
        for (auto& v : voices) { v = Voice(); }
        initFilters();
    }
};

static Engine g_engine;
static float g_sampleL[MAX_SAMPLE_FRAMES];
static float g_sampleR[MAX_SAMPLE_FRAMES];
static float g_outL[MAX_BLOCK];
static float g_outR[MAX_BLOCK];

// ---- 8-bit quantization (getAmi8Bit) ----
static inline float ami8(float s) {
    float a = s < 0 ? std::floor(s * 128.f) / 128.f : std::floor(s * 127.f) / 127.f;
    return a >= 1.f ? 1.f : a <= -1.f ? -1.f : a;
}

// ============================================================================
// Exported C ABI
// ============================================================================

void ami_init(float sampleRate) { g_engine.init(sampleRate); }

float* ami_sample_l() { return g_sampleL; }
float* ami_sample_r() { return g_sampleR; }
int    ami_sample_capacity() { return MAX_SAMPLE_FRAMES; }
float* ami_out_l() { return g_outL; }
float* ami_out_r() { return g_outR; }

// Called after JS writes interleaved-free L/R into g_sampleL/g_sampleR.
void ami_set_sample(int numFrames, int channels, float sourceRate) {
    g_engine.sampleFrames = numFrames > MAX_SAMPLE_FRAMES ? MAX_SAMPLE_FRAMES : numFrames;
    g_engine.sampleChannels = channels >= 2 ? 2 : 1;
    g_engine.sourceRate = sourceRate;
}

void ami_set_param(int id, float value) {
    if (id < 0 || id >= P__COUNT) return;
    g_engine.params[id] = value;
    if (id == P_A500) g_engine.initFilters();
}

void ami_note_on(int midiNote, float velocity) {
    Engine& e = g_engine;
    // find a free voice, else steal the oldest-quietest
    int idx = -1;
    for (int i = 0; i < MAX_VOICES; i++) if (!e.voices[i].active) { idx = i; break; }
    if (idx < 0) {
        float lowest = 1e9f;
        for (int i = 0; i < MAX_VOICES; i++)
            if (e.voices[i].adsr.level < lowest) { lowest = e.voices[i].adsr.level; idx = i; }
    }
    Voice& v = e.voices[idx];
    int root = (int)e.params[P_ROOT_NOTE];
    double finetune = 1.0 + e.params[P_FINETUNE] / 1200.0;
    v.note = midiNote;
    v.pitchRatio = std::pow(2.0, (double)(midiNote - root) / 12.0) * (e.sourceRate / e.devRate) * finetune;
    v.pos = 0.0;
    v.gain = velocity;
    v.forward = true;
    v.adsr.sampleRate = (float)e.devRate;
    v.adsr.attack = e.params[P_ATTACK];
    v.adsr.decay = e.params[P_DECAY];
    v.adsr.sustain = e.params[P_SUSTAIN];
    v.adsr.release = e.params[P_RELEASE];
    v.adsr.noteOn();
    v.active = true;
}

void ami_note_off(int midiNote) {
    for (auto& v : g_engine.voices)
        if (v.active && v.note == midiNote) v.adsr.noteOff();
}

void ami_all_notes_off() {
    for (auto& v : g_engine.voices) { v.adsr.reset(); v.active = false; }
}

void ami_process(int numFrames) {
    Engine& e = g_engine;
    if (numFrames > MAX_BLOCK) numFrames = MAX_BLOCK;

    std::memset(g_outL, 0, sizeof(float) * numFrames);
    std::memset(g_outR, 0, sizeof(float) * numFrames);

    const bool eightBit = e.params[P_EIGHT_BIT] != 0.f;
    int snh = (int)e.params[P_SNH]; if (snh < 1) snh = 1;
    const bool loopEn = e.params[P_LOOP_EN] != 0.f;
    const bool pingpong = e.params[P_PINGPONG] != 0.f && loopEn;
    const int loopStart = (int)e.params[P_LOOP_START];
    int loopEnd = (int)e.params[P_LOOP_END];
    if (loopEnd <= 0 || loopEnd > e.sampleFrames) loopEnd = e.sampleFrames;
    const float vol = e.params[P_VOLUME];
    const float pan = e.params[P_PAN];
    const bool stereoSrc = e.sampleChannels > 1;

    // channel pan (non-Paula): mirrors handleChannelPanning else-branch
    const float panL = pan <= 128 ? 1.f : std::abs(pan - 255.f) / 127.f;
    const float panR = pan >= 128 ? 1.f : pan / 127.f;

    if (e.sampleFrames <= 0) {
        // still apply master filter to silence to keep state coherent
    } else {
        for (auto& v : e.voices) {
            if (!v.active) continue;
            for (int n = 0; n < numFrames; n++) {
                int pos = (int)std::floor(v.pos);
                if (pos < 0) pos = 0;
                if (pos >= e.sampleFrames) { v.adsr.reset(); v.active = false; break; }

                int sp = pos - (pos % snh);
                if (sp >= e.sampleFrames) sp = e.sampleFrames - 1;

                float sl = g_sampleL[sp];
                float sr = stereoSrc ? g_sampleR[sp] : sl;
                if (eightBit) { sl = ami8(sl); sr = ami8(sr); }
                // original negates; preserve phase behaviour
                sl = -sl; sr = -sr;

                float env = v.adsr.next();
                float l = sl * v.gain * vol * env * panL;
                float r = sr * v.gain * vol * env * panR;

                g_outL[n] += l;
                g_outR[n] += r;

                // advance (handleLoop)
                double nextPos = v.pos + v.pitchRatio;
                if (!loopEn) {
                    v.pos = nextPos;
                } else if (!pingpong) {
                    v.pos = nextPos < loopEnd ? nextPos : (double)loopStart;
                } else {
                    if (v.forward) {
                        if (nextPos < loopEnd) v.pos = nextPos;
                        else { v.forward = false; v.pos = v.pos - v.pitchRatio; }
                    } else {
                        double prevPos = v.pos - v.pitchRatio;
                        if (prevPos > loopStart) v.pos = prevPos;
                        else { v.forward = true; v.pos = nextPos; }
                    }
                }

                if (!v.adsr.isActive() || v.pos > e.sampleFrames) { v.active = false; break; }
            }
        }
    }

    // master: Amiga RC/LED filter + master volume (getAmiFilter)
    const bool isA500 = e.params[P_A500] != 0.f;
    const bool ledOn = e.params[P_LED] != 0.f;
    const float mvol = e.params[P_MASTER_VOL];
    for (int n = 0; n < numFrames; n++) {
        float l = g_outL[n], r = g_outR[n];
        float fl, fr;
        if (isA500) {
            onePoleLP(&e.a500Lo, l, r, &fl, &fr);
            onePoleHP(&e.a500Hi, fl, fr, &fl, &fr);
        } else {
            onePoleHP(&e.a1200Hi, l, r, &fl, &fr);
        }
        if (ledOn) twoPoleLP(&e.led, fl, fr, &fl, &fr);
        g_outL[n] = fl * mvol;
        g_outR[n] = fr * mvol;
    }
}

int ami_active_voices() {
    int c = 0; for (auto& v : g_engine.voices) if (v.active) c++; return c;
}

// playhead of the most recently active voice (for waveform UI)
int ami_playhead() {
    for (auto& v : g_engine.voices) if (v.active) return (int)v.pos;
    return -1;
}

} // extern "C"
