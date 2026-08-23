import { useReducedMotion } from 'framer-motion';

const secondarySignal = 'M0 68 C114 68 143 69 205 68 C250 67 266 77 304 77 C341 77 360 58 391 58 C424 58 438 72 465 72 C501 72 516 46 548 46 C585 46 603 73 639 73 C684 73 714 67 759 67 C817 67 850 68 900 68';
const resonanceFieldBootTime = performance.now();
const resonanceFieldStartupBuffer = 1200;
type WaveMode = {
  spatialFrequency: number;
  temporalFrequency: number;
  amplitude: number;
  phase: number;
};

type StringDynamics = {
  baseline: number;
  direction: 1 | -1;
  modes: WaveMode[];
};

const buildDynamicStringPath = (config: StringDynamics, cycleProgress: number) => {
  const time = cycleProgress * Math.PI * 2;

  return Array.from({ length: WAVE_SEGMENTS + 1 }, (_, index) => {
    const progress = index / WAVE_SEGMENTS;
    const x = progress * 900;
    const anchoredEnvelope = Math.sin(progress * Math.PI) ** 1.45;
    const displacement = config.modes.reduce((sum, mode) => (
      sum + Math.sin(
        progress * Math.PI * 2 * mode.spatialFrequency
        + time * mode.temporalFrequency * config.direction
        + mode.phase,
      ) * mode.amplitude
    ), 0);
    const y = config.baseline + anchoredEnvelope * displacement;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
};

const primaryDynamics: StringDynamics = {
  baseline: 64,
  direction: 1,
  modes: [
    { spatialFrequency: 1, temporalFrequency: 1, amplitude: 9, phase: 0.25 },
    { spatialFrequency: 2, temporalFrequency: 2, amplitude: 3.2, phase: 1.2 },
    { spatialFrequency: 3, temporalFrequency: 1, amplitude: 1.2, phase: -0.6 },
  ],
};
const goldDynamics: StringDynamics = {
  baseline: 73,
  direction: -1,
  modes: [
    { spatialFrequency: 1.5, temporalFrequency: 1, amplitude: 4.6, phase: 1.1 },
    { spatialFrequency: 2.5, temporalFrequency: 2, amplitude: 1.6, phase: -0.45 },
  ],
};
const softGoldDynamics: StringDynamics = {
  baseline: 78,
  direction: 1,
  modes: [
    { spatialFrequency: 2, temporalFrequency: 1, amplitude: 3.2, phase: 2.05 },
    { spatialFrequency: 3.5, temporalFrequency: 2, amplitude: 1.1, phase: 0.4 },
  ],
};
const silverDynamics: StringDynamics = {
  baseline: 83,
  direction: -1,
  modes: [
    { spatialFrequency: 2.5, temporalFrequency: 1, amplitude: 2, phase: 2.8 },
    { spatialFrequency: 4, temporalFrequency: 2, amplitude: 0.7, phase: -0.8 },
  ],
};

const WAVE_SEGMENTS = 48;
const WAVE_FRAMES = 16;

const primarySignal = buildDynamicStringPath(primaryDynamics, 0);
const goldHarmonic = buildDynamicStringPath(goldDynamics, 0);
const softGoldHarmonic = buildDynamicStringPath(softGoldDynamics, 0);
const silverHarmonic = buildDynamicStringPath(silverDynamics, 0);
const waveValues = (dynamics: StringDynamics) => Array.from(
  { length: WAVE_FRAMES + 1 },
  (_, index) => buildDynamicStringPath(dynamics, index / WAVE_FRAMES),
).join(';');
const primaryWaveValues = waveValues(primaryDynamics);
const goldWaveValues = waveValues(goldDynamics);
const softGoldWaveValues = waveValues(softGoldDynamics);
const silverWaveValues = waveValues(silverDynamics);

export default function ResonanceField() {
  const reduceMotion = useReducedMotion();
  const waveDelay = Math.max(0, resonanceFieldStartupBuffer - (performance.now() - resonanceFieldBootTime));
  const waveBegin = `${waveDelay}ms`;
  const waveBeginGold = `${waveDelay + 180}ms`;
  const waveBeginSoftGold = `${waveDelay + 320}ms`;
  const waveBeginSilver = `${waveDelay + 450}ms`;
  const waveBeginOverlay = `${waveDelay}ms`;

  return (
    <div className="pointer-events-none absolute inset-y-[-22px] left-[176px] right-[138px] overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 900 128" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="resonance-signal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b8b8b8" stopOpacity="0" />
            <stop offset="0.18" stopColor="#b8b8b8" stopOpacity="0.18" />
            <stop offset="0.47" stopColor="#e0e0e0" stopOpacity="0.7" />
            <stop offset="0.72" stopColor="#a8a8a8" stopOpacity="0.34" />
            <stop offset="1" stopColor="#a8a8a8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="resonance-phase" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8a8a8a" stopOpacity="0" />
            <stop offset="0.34" stopColor="#9d9d9d" stopOpacity="0.14" />
            <stop offset="0.62" stopColor="#b8b8b8" stopOpacity="0.22" />
            <stop offset="1" stopColor="#8a8a8a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="resonance-gold-string" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#c8ad78" stopOpacity="0" />
            <stop offset="0.18" stopColor="#c8ad78" stopOpacity="0.18" />
            <stop offset="0.46" stopColor="#e1c98f" stopOpacity="0.72" />
            <stop offset="0.68" stopColor="#c8ad78" stopOpacity="0.38" />
            <stop offset="1" stopColor="#c8ad78" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="resonance-gold-string-soft" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a58f65" stopOpacity="0" />
            <stop offset="0.34" stopColor="#c8ad78" stopOpacity="0.16" />
            <stop offset="0.58" stopColor="#d8bd84" stopOpacity="0.42" />
            <stop offset="1" stopColor="#a58f65" stopOpacity="0" />
          </linearGradient>
          <pattern id="resonance-calibration" width="45" height="16" patternUnits="userSpaceOnUse">
            <path d="M0 12V16M22.5 14V16M45 10V16" stroke="#d4d4d4" strokeOpacity="0.09" strokeWidth="0.7" />
          </pattern>
          <filter id="resonance-glow" x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="resonance-gold-glow" x="-20%" y="-120%" width="140%" height="340%">
            <feGaussianBlur stdDeviation="1.15" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <mask id="resonance-fade">
            <linearGradient id="resonance-mask-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="black" />
              <stop offset="0.1" stopColor="white" />
              <stop offset="0.9" stopColor="white" />
              <stop offset="1" stopColor="black" />
            </linearGradient>
            <rect width="900" height="128" fill="url(#resonance-mask-gradient)" />
          </mask>
        </defs>

        <g mask="url(#resonance-fade)">
          <rect x="0" y="100" width="900" height="18" fill="url(#resonance-calibration)" />
          <path d="M0 64H900" stroke="#d4d4d4" strokeOpacity="0.07" strokeWidth="0.7" />
          <path d="M0 104H900" stroke="#d4d4d4" strokeOpacity="0.05" strokeWidth="0.7" />

          <path
            className="resonance-field-secondary"
            d={secondarySignal}
            fill="none"
            stroke="url(#resonance-phase)"
            strokeWidth="0.85"
            strokeDasharray="2 7"
          />
          <path
            className="resonance-field-string resonance-field-string-silver"
            d={silverHarmonic}
            fill="none"
            stroke="url(#resonance-phase)"
            strokeWidth="0.72"
          >{!reduceMotion && <animate attributeName="d" values={silverWaveValues} dur="24s" begin={waveBeginSilver} repeatCount="indefinite" />}</path>
          <path
            className="resonance-field-string resonance-field-string-soft-gold"
            d={softGoldHarmonic}
            fill="none"
            stroke="url(#resonance-gold-string-soft)"
            strokeWidth="0.85"
          >{!reduceMotion && <animate attributeName="d" values={softGoldWaveValues} dur="19.5s" begin={waveBeginSoftGold} repeatCount="indefinite" />}</path>
          <path
            className="resonance-field-string resonance-field-string-gold"
            d={goldHarmonic}
            fill="none"
            stroke="url(#resonance-gold-string)"
            strokeWidth="1.05"
            filter="url(#resonance-gold-glow)"
          >{!reduceMotion && <animate attributeName="d" values={goldWaveValues} dur="22s" begin={waveBeginGold} repeatCount="indefinite" />}</path>
          <path
            className="resonance-field-primary resonance-field-string resonance-field-string-primary"
            d={primarySignal}
            fill="none"
            stroke="url(#resonance-signal)"
            strokeWidth="1.2"
            filter="url(#resonance-glow)"
          >{!reduceMotion && <animate attributeName="d" values={primaryWaveValues} dur="18s" begin={waveBegin} repeatCount="indefinite" />}</path>
          <path
            className="resonance-field-primary-gold resonance-field-string resonance-field-string-gold-overlay"
            d={primarySignal}
            fill="none"
            stroke="url(#resonance-gold-string-soft)"
            strokeWidth="1"
            strokeDasharray="18 72"
          >{!reduceMotion && <animate attributeName="d" values={primaryWaveValues} dur="18s" begin={waveBeginOverlay} repeatCount="indefinite" />}</path>

          <g transform="translate(480 64)">
            <path d="M-68 0H-45M45 0H68" stroke="#d4d4d4" strokeOpacity="0.13" strokeWidth="0.7" />
            <path d="M-46 -10A47 47 0 0 1-15-44M15-44A47 47 0 0 1 46-10" fill="none" stroke="#d4d4d4" strokeOpacity="0.13" strokeWidth="0.75" />
            <path d="M46 10A47 47 0 0 1 15 44M-15 44A47 47 0 0 1-46 10" fill="none" stroke="#d8bd84" strokeOpacity="0.34" strokeWidth="0.85" />
            <path d="M-33-9A34 34 0 0 1-10-32M10-32A34 34 0 0 1 33-9M33 9A34 34 0 0 1 10 32M-10 32A34 34 0 0 1-33 9" fill="none" stroke="#d8bd84" strokeOpacity="0.18" strokeWidth="0.7" strokeDasharray="3 5" />
            <path d="M-19-4L-9-14M19 4L9 14M-4 19L-14 9M4-19L14-9" stroke="#d4d4d4" strokeOpacity="0.11" strokeWidth="0.7" />
            <g className="resonance-field-orbit">
              <path d="M0-38A38 38 0 0 1 21-31" fill="none" stroke="#e1c98f" strokeOpacity="0.72" strokeWidth="1.15" />
              <rect x="-2" y="-40" width="4" height="4" transform="rotate(45 0 -38)" fill="#d8bd84" fillOpacity="0.82" />
            </g>
            <path d="M-8 0H8M0-8V8" stroke="#d4d4d4" strokeOpacity="0.28" strokeWidth="0.7" />
            <rect x="-3" y="-3" width="6" height="6" transform="rotate(45)" fill="#d8bd84" fillOpacity="0.2" stroke="#e1c98f" strokeOpacity="0.86" strokeWidth="0.8" />
            <circle cx="-46" cy="0" r="1.7" fill="#d8bd84" fillOpacity="0.54" />
            <circle cx="46" cy="0" r="1.7" fill="#d4d4d4" fillOpacity="0.24" />
          </g>

        </g>
      </svg>
    </div>
  );
}
