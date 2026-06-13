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
//   - Paula alternating hard L/R pan (incPanCount / shouldPan)
//
// 12 independent sampler channels (NUM_CHANNELS), each with its own sample
// buffer, params and voices. Filters and master volume are GLOBAL — applied
// once on the summed master bus.

#include <cmath>
#include <cstring>
#include <cstdint>

extern "C" {

constexpr int NUM_CHANNELS       = 12;
constexpr int VOICES_PER_CHANNEL = 8;
constexpr int MAX_BLOCK          = 1024;
constexpr int MAX_SAMPLE_FRAMES  = 1024 * 1024; // per-channel, per L/R (~23.8s @ 44.1k)

// ----------------------------------------------------------------------------
// Parameter ids (kept in sync with audio/param-ids.ts + public/ami-processor.js)
// ----------------------------------------------------------------------------
enum ChanParamId {
    CP_EIGHT_BIT    = 0,   // 8-bit quantization on/off
    CP_SNH          = 1,   // sample-and-hold step (>=1)
    CP_LOOP_EN      = 2,
    CP_LOOP_START   = 3,
    CP_LOOP_END     = 4,
    CP_PINGPONG     = 5,
    CP_ATTACK       = 6,   // seconds
    CP_DECAY        = 7,
    CP_SUSTAIN      = 8,   // 0..1
    CP_RELEASE      = 9,
    CP_VOLUME       = 10,  // 0..1
    CP_PAN          = 11,  // 0..255 (Amiga style), 128 = center
    CP_ROOT_NOTE    = 12,  // MIDI note that plays at source rate
    CP_FINETUNE     = 13,  // cents
    CP_MUTE         = 14,  // bool
    CP_SOLO         = 15,  // bool
    CP_PAULA_STEREO = 16,  // bool — alternate hard L/R pan per voice
    CP_MIDI_CHAN    = 17,  // 0 = omni, 1..16
    CP_LOW_NOTE     = 18,  // 0..127
    CP_HIGH_NOTE    = 19,  // 0..127
    CP_GLIDE        = 20,  // glissando time ms (1..100); <=1 disables (mono only)
    CP_WIDTH        = 21,  // Paula stereo width (0..255), 255 = full hard pan
    CP_VOICE_MODE   = 22,  // voice count: 1 (mono), 4, or 8
    CP__COUNT
};

enum GlobalParamId {
    GP_A500          = 0,   // model: 1 = A500 (LP+HP), 0 = A1200 (HP only)
    GP_LED           = 1,   // LED filter on/off
    GP_MASTER_VOL    = 2,
    GP_VIBE_SPEED    = 3,   // vibrato LFO speed (1..10)
    GP_MOD_INTENSITY = 4,   // CC#1 mod wheel (0..127)
    GP_MASTER_PAN    = 5,   // 0..255, 128 = center
    GP__COUNT
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
    int  midiChannel = 1; // note's MIDI channel (1..16), for pitch-bend lookup
    double pos = 0.0;
    double pitchRatio = 1.0;  // current ratio (slides toward pitchTarget in mono); excludes finetune
    double pitchTarget = 1.0; // target ratio for the held note (excludes finetune)
    double glissRatio = 0.0;  // per-sample slide increment (mono glissando)
    double fineTune = 1.0;    // 1 + cents/1200
    bool slideUp = true;
    float gain = 0.f;
    bool forward = true;
    float panLGain = 1.f, panRGain = 1.f; // Paula stereo: frozen 0/1 at note-on
    ADSR adsr;

    // gliss2pitch (AmiSamplerSound.cpp:256) — mono slide toward target
    double glissPitch(bool mono) {
        double nextPitch = pitchRatio + glissRatio;
        if (!mono) return pitchTarget;
        if (pitchRatio <= 0) return pitchTarget;
        if (slideUp && nextPitch > pitchTarget) return pitchTarget;
        if (!slideUp && nextPitch < pitchTarget) return pitchTarget;
        return nextPitch;
    }
};

// ----------------------------------------------------------------------------
// Channel (one of NUM_CHANNELS independent samplers)
// ----------------------------------------------------------------------------
struct Channel {
    float params[CP__COUNT];
    Voice voices[VOICES_PER_CHANNEL];
    int    sampleFrames = 0;
    int    sampleChannels = 1;
    double sourceRate = 44100.0;
    int    panCounter = 0; // Paula stereo, cycles 0..7

    void initParams() {
        std::memset(params, 0, sizeof(params));
        params[CP_EIGHT_BIT] = 1; params[CP_SNH] = 1; params[CP_SUSTAIN] = 1;
        params[CP_VOLUME] = 1; params[CP_PAN] = 128;
        params[CP_ATTACK] = 0.001f; params[CP_DECAY] = 0.1f; params[CP_RELEASE] = 0.05f;
        params[CP_ROOT_NOTE] = 60;
        params[CP_MIDI_CHAN] = 0; params[CP_LOW_NOTE] = 0; params[CP_HIGH_NOTE] = 127;
        params[CP_GLIDE] = 1; params[CP_WIDTH] = 255; params[CP_VOICE_MODE] = 8;
        for (auto& v : voices) v = Voice();
        sampleFrames = 0; sampleChannels = 1; sourceRate = 44100.0; panCounter = 0;
    }
};

// ----------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------
// Vibrato LFO table (32-point, unsigned 8-bit) — PluginProcessor.h:277
static const uint8_t VIBRATO_TABLE[32] = {
    0xFF, 0xFD, 0xFA, 0xF4, 0xEB, 0xE0, 0xD4, 0xC5,
    0xB4, 0xA1, 0x8D, 0x78, 0x61, 0x4A, 0x31, 0x18,
    0x00, 0x18, 0x31, 0x4A, 0x61, 0x78, 0x8D, 0xA1,
    0xB4, 0xC5, 0xD4, 0xE0, 0xEB, 0xF4, 0xFA, 0xFD
};

struct Engine {
    double devRate = 44100.0;
    float  gparams[GP__COUNT];
    Channel channels[NUM_CHANNELS];

    double bend[17];           // per MIDI channel (1..16), 1.0 = no bend
    double vibeRate = 0.0;     // vibrato LFO phase (0..32)
    double vibeRatio = 1.0;    // current LFO pitch multiplier

    OnePole a500Lo, a500Hi, a1200Hi;
    TwoPole led;

    // mirrors incVibratoTable (PluginProcessor.cpp:571) — call once per output sample
    void incVibratoTable() {
        double vibeSpeed = gparams[GP_VIBE_SPEED];
        int modIntensity = (int)gparams[GP_MOD_INTENSITY];
        double vibeFreq = (vibeSpeed * 32.0) / devRate;
        int vibePos = (int)std::floor(vibeRate);
        if (vibePos < 0) vibePos = 0; else if (vibePos > 31) vibePos = 31;
        if (modIntensity == 0) { vibeRatio = 1.0; }
        else { vibeRatio = 1.0 + ((double)(128 - VIBRATO_TABLE[vibePos]) * (double)modIntensity) / 409600.0; }
        vibeRate += vibeFreq;
        if (vibeRate >= 32.0) vibeRate = 0.0;
    }

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
        std::memset(gparams, 0, sizeof(gparams));
        gparams[GP_A500] = 1; gparams[GP_MASTER_VOL] = 1;
        gparams[GP_VIBE_SPEED] = 5; gparams[GP_MOD_INTENSITY] = 0;
        gparams[GP_MASTER_PAN] = 128;
        for (int i = 0; i < 17; i++) bend[i] = 1.0;
        vibeRate = 0.0; vibeRatio = 1.0;
        for (auto& c : channels) c.initParams();
        initFilters();
    }
};

static Engine g_engine;
static float g_sampleL[NUM_CHANNELS][MAX_SAMPLE_FRAMES];
static float g_sampleR[NUM_CHANNELS][MAX_SAMPLE_FRAMES];
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

float* ami_sample_l(int ch) { if (ch < 0 || ch >= NUM_CHANNELS) ch = 0; return g_sampleL[ch]; }
float* ami_sample_r(int ch) { if (ch < 0 || ch >= NUM_CHANNELS) ch = 0; return g_sampleR[ch]; }
int    ami_sample_capacity() { return MAX_SAMPLE_FRAMES; }
float* ami_out_l() { return g_outL; }
float* ami_out_r() { return g_outR; }

// Called after JS writes interleaved-free L/R into g_sampleL[ch]/g_sampleR[ch].
void ami_set_sample(int ch, int numFrames, int channels, float sourceRate) {
    if (ch < 0 || ch >= NUM_CHANNELS) return;
    Channel& c = g_engine.channels[ch];
    c.sampleFrames = numFrames > MAX_SAMPLE_FRAMES ? MAX_SAMPLE_FRAMES : numFrames;
    c.sampleChannels = channels >= 2 ? 2 : 1;
    c.sourceRate = sourceRate;
}

void ami_set_chan_param(int channel, int id, float value) {
    if (channel < 0 || channel >= NUM_CHANNELS) return;
    if (id < 0 || id >= CP__COUNT) return;
    g_engine.channels[channel].params[id] = value;
}

void ami_set_global_param(int id, float value) {
    if (id < 0 || id >= GP__COUNT) return;
    g_engine.gparams[id] = value;
    if (id == GP_A500) g_engine.initFilters();
}

// MIDI pitch wheel (per channel) — bendRatio = 2^((value14 - 8192) / 49152)
void ami_pitch_bend(int midiChannel, int value14) {
    if (midiChannel < 1 || midiChannel > 16) return;
    g_engine.bend[midiChannel] = std::pow(2.0, ((double)value14 - 8192.0) / 49152.0);
}

void ami_note_on(int midiNote, int midiChannel, float velocity) {
    Engine& e = g_engine;

    // global solo state (computed once)
    bool anySolo = false;
    for (auto& c : e.channels) if (c.params[CP_SOLO] != 0.f) { anySolo = true; break; }

    for (auto& c : e.channels) {
        // note range
        int lo = (int)c.params[CP_LOW_NOTE];
        int hi = (int)c.params[CP_HIGH_NOTE];
        if (midiNote < lo || midiNote > hi) continue;
        // midi channel (0 = omni)
        int mc = (int)c.params[CP_MIDI_CHAN];
        if (mc != 0 && mc != midiChannel) continue;
        // mute / solo gating
        if (c.params[CP_MUTE] != 0.f) continue;
        if (anySolo && c.params[CP_SOLO] == 0.f) continue;
        // nothing loaded
        if (c.sampleFrames <= 0) continue;

        int voiceCount = (int)c.params[CP_VOICE_MODE];
        if (voiceCount < 1) voiceCount = 1;
        if (voiceCount > VOICES_PER_CHANNEL) voiceCount = VOICES_PER_CHANNEL;
        const bool mono = voiceCount <= 1;
        const double glide = c.params[CP_GLIDE];
        const int root = (int)c.params[CP_ROOT_NOTE];
        const double finetune = 1.0 + c.params[CP_FINETUNE] / 1200.0;
        const double target = std::pow(2.0, (double)(midiNote - root) / 12.0) * (c.sourceRate / e.devRate);

        // allocate a voice among the first `voiceCount`; mono always uses voice 0
        int idx = 0;
        if (!mono) {
            idx = -1;
            for (int i = 0; i < voiceCount; i++) if (!c.voices[i].active) { idx = i; break; }
            if (idx < 0) {
                float lowest = 1e9f;
                for (int i = 0; i < voiceCount; i++)
                    if (c.voices[i].adsr.level < lowest) { lowest = c.voices[i].adsr.level; idx = i; }
            }
        }
        Voice& v = c.voices[idx];

        // mono + glide>1 with a still-sounding voice: legato slide (keep pos/envelope)
        const bool legato = mono && v.active && glide > 1.0;

        v.note = midiNote;
        v.midiChannel = (midiChannel < 1 || midiChannel > 16) ? 1 : midiChannel;
        v.fineTune = finetune;
        v.pitchTarget = target;
        v.slideUp = target > v.pitchRatio;
        v.glissRatio = (mono && glide > 1.0) ? (target - v.pitchRatio) / (glide * e.devRate * 0.01) : 0.0;
        v.gain = velocity;

        if (!legato) {
            v.pos = 0.0;
            v.forward = true;
            v.pitchRatio = target;
            v.adsr.sampleRate = (float)e.devRate;
            v.adsr.attack = c.params[CP_ATTACK];
            v.adsr.decay = c.params[CP_DECAY];
            v.adsr.sustain = c.params[CP_SUSTAIN];
            v.adsr.release = c.params[CP_RELEASE];
            v.adsr.noteOn();
        }
        v.active = true;

        // Paula stereo (poly only): alternate hard L/R per voice (incPanCount / shouldPan)
        if (c.params[CP_PAULA_STEREO] != 0.f && voiceCount > 1) {
            int side = c.panCounter % 2;
            v.panLGain = side == 0 ? 1.f : 0.f;
            v.panRGain = side == 1 ? 1.f : 0.f;
            c.panCounter = c.panCounter >= 7 ? 0 : c.panCounter + 1;
        } else {
            v.panLGain = 1.f; v.panRGain = 1.f;
        }
    }
}

void ami_note_off(int midiNote, int midiChannel) {
    Engine& e = g_engine;
    for (auto& c : e.channels) {
        int mc = (int)c.params[CP_MIDI_CHAN];
        if (mc != 0 && mc != midiChannel) continue;
        for (auto& v : c.voices)
            if (v.active && v.note == midiNote) v.adsr.noteOff();
    }
}

void ami_all_notes_off() {
    for (auto& c : g_engine.channels)
        for (auto& v : c.voices) { v.adsr.reset(); v.active = false; }
}

void ami_process(int numFrames) {
    Engine& e = g_engine;
    if (numFrames > MAX_BLOCK) numFrames = MAX_BLOCK;

    std::memset(g_outL, 0, sizeof(float) * numFrames);
    std::memset(g_outR, 0, sizeof(float) * numFrames);

    // vibrato pitch multiplier captured once per block (LFO advances in the master loop)
    const double vibe = e.vibeRatio;

    for (int ch = 0; ch < NUM_CHANNELS; ch++) {
        Channel& c = e.channels[ch];
        if (c.sampleFrames <= 0) continue;

        const bool eightBit = c.params[CP_EIGHT_BIT] != 0.f;
        int snh = (int)c.params[CP_SNH]; if (snh < 1) snh = 1;
        const bool loopEn = c.params[CP_LOOP_EN] != 0.f;
        const bool pingpong = c.params[CP_PINGPONG] != 0.f && loopEn;
        const int loopStart = (int)c.params[CP_LOOP_START];
        int loopEnd = (int)c.params[CP_LOOP_END];
        if (loopEnd <= 0 || loopEnd > c.sampleFrames) loopEnd = c.sampleFrames;
        const float vol = c.params[CP_VOLUME];
        const float pan = c.params[CP_PAN];
        const bool stereoSrc = c.sampleChannels > 1;
        int voiceCount = (int)c.params[CP_VOICE_MODE];
        if (voiceCount < 1) voiceCount = 1;
        const bool mono = voiceCount <= 1;
        const bool stereoOn = c.params[CP_PAULA_STEREO] != 0.f && voiceCount > 1;
        const float width = c.params[CP_WIDTH] / 255.f;

        // channel pan (non-Paula): mirrors handleChannelPanning else-branch
        const float panL = pan <= 128 ? 1.f : std::abs(pan - 255.f) / 127.f;
        const float panR = pan >= 128 ? 1.f : pan / 127.f;

        const float* sampL = g_sampleL[ch];
        const float* sampR = g_sampleR[ch];

        for (auto& v : c.voices) {
            if (!v.active) continue;

            const double bendVibe = e.bend[v.midiChannel] * vibe * v.fineTune;

            for (int n = 0; n < numFrames; n++) {
                int pos = (int)std::floor(v.pos);
                if (pos < 0) pos = 0;
                if (pos >= c.sampleFrames) { v.adsr.reset(); v.active = false; break; }

                int sp = pos - (pos % snh);
                if (sp >= c.sampleFrames) sp = c.sampleFrames - 1;

                float sl = sampL[sp];
                float sr = stereoSrc ? sampR[sp] : sl;
                if (eightBit) { sl = ami8(sl); sr = ami8(sr); }
                // original negates; preserve phase behaviour
                sl = -sl; sr = -sr;

                float env = v.adsr.next();
                // totalPitchRatio = pitchRatio (slid) * vibrato * fineTune * bendRatio
                const double step = (v.pitchRatio = v.glissPitch(mono)) * bendVibe;

                float base = v.gain * vol * env;
                float l = sl * base;
                float r = sr * base;
                if (stereoOn) {
                    l *= v.panLGain; r *= v.panRGain;
                    const float wl = l * width + r * std::abs(1.f - width);
                    const float wr = r * width + l * std::abs(1.f - width);
                    l = wl; r = wr;
                } else {
                    l *= panL; r *= panR;
                }

                g_outL[n] += l;
                g_outR[n] += r;

                // advance (handleLoop)
                double nextPos = v.pos + step;
                if (!loopEn) {
                    v.pos = nextPos;
                } else if (!pingpong) {
                    v.pos = nextPos < loopEnd ? nextPos : (double)loopStart;
                } else {
                    if (v.forward) {
                        if (nextPos < loopEnd) v.pos = nextPos;
                        else { v.forward = false; v.pos = v.pos - step; }
                    } else {
                        double prevPos = v.pos - step;
                        if (prevPos > loopStart) v.pos = prevPos;
                        else { v.forward = true; v.pos = nextPos; }
                    }
                }

                if (!v.adsr.isActive() || v.pos > c.sampleFrames) { v.active = false; break; }
            }
        }
    }

    // master: Amiga RC/LED filter + master volume (getAmiFilter)
    const bool isA500 = e.gparams[GP_A500] != 0.f;
    const bool ledOn = e.gparams[GP_LED] != 0.f;
    const float mvol = e.gparams[GP_MASTER_VOL];
    const float mpan = e.gparams[GP_MASTER_PAN];
    const float mpanL = mpan <= 128 ? 1.f : std::abs(mpan - 255.f) / 127.f;
    const float mpanR = mpan >= 128 ? 1.f : mpan / 127.f;
    for (int n = 0; n < numFrames; n++) {
        e.incVibratoTable();
        float l = g_outL[n], r = g_outR[n];
        float fl, fr;
        if (isA500) {
            onePoleLP(&e.a500Lo, l, r, &fl, &fr);
            onePoleHP(&e.a500Hi, fl, fr, &fl, &fr);
        } else {
            onePoleHP(&e.a1200Hi, l, r, &fl, &fr);
        }
        if (ledOn) twoPoleLP(&e.led, fl, fr, &fl, &fr);
        g_outL[n] = fl * mvol * mpanL;
        g_outR[n] = fr * mvol * mpanR;
    }
}

int ami_active_voices() {
    int c = 0;
    for (auto& ch : g_engine.channels)
        for (auto& v : ch.voices) if (v.active) c++;
    return c;
}

// playhead of the first active voice in a channel (for waveform UI)
int ami_playhead(int ch) {
    if (ch < 0 || ch >= NUM_CHANNELS) return -1;
    for (auto& v : g_engine.channels[ch].voices) if (v.active) return (int)v.pos;
    return -1;
}

} // extern "C"
