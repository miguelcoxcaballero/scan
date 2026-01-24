(() => {
  "use strict";

  const SP = (window.ScannerPro = window.ScannerPro || {});

  // Parse values.config file
  function parseConfig(text) {
    const config = {};
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue;

      // Parse key = value
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();

      // Parse numeric value
      const num = parseFloat(value);
      if (!isNaN(num)) {
        config[key] = num;
      }
    }

    return config;
  }

  // Convert 0-100 user values to technical configuration
  function convertToTechnicalConfig(userConfig) {
    // Default values (50 = neutral for most)
    const defaults = {
      brightness: 50,
      contrast: 50,
      saturation: 50,
      hue: 50,
      red: 50,
      green: 50,
      blue: 50,
      yellow: 50,
      white: 50,
      black: 50,
      contrast_target: 50,
      exposure_target: 50,
      noise: 30,
      definition: 50,
      margin_scale: 50
    };

    // Merge user config with defaults
    const cfg = { ...defaults, ...userConfig };

    // Normalize to 0-1 range with 0.5 as neutral
    const norm = (val, min = 0, max = 100) => (val - min) / (max - min);
    const normCentered = val => (val - 50) / 50; // -1 to +1 range

    // --- BRIGHTNESS ---
    // Maps to dark processing thresholds (higher brightness = higher thresholds)
    const brightnessScale = norm(cfg.brightness);
    const brightOffset = (brightnessScale - 0.5) * 2; // -1 to +1
    const THRESHOLD_1 = 200 + (brightOffset * 80); // 120-280
    const THRESHOLD_2 = 130 + (brightOffset * 50); // 80-180
    const THRESHOLD_3 = 70 + (brightOffset * 30); // 40-100

    // --- CONTRAST ---
    // Maps to white threshold and dark processing intensity
    const contrastScale = norm(cfg.contrast);
    const contrastFactor = 0.5 + contrastScale * 1.0; // 0.5-1.5

    // --- SATURATION ---
    // Maps to desaturation strengths (inverted - high saturation = low desaturation)
    // Keep desaturation LOW to preserve colors after calibration correction
    const satScale = norm(cfg.saturation);
    const RED_STRENGTH = 0.15 - (satScale * 0.1); // 0.15 (low sat) to 0.05 (high sat)
    const BLUE_STRENGTH = 0.12 - (satScale * 0.08); // 0.12 to 0.04
    const NEUTRAL_STRENGTH = 0.1 - (satScale * 0.08); // 0.1 to 0.02

    // --- HUE ---
    // Maps to yellow target color shift
    const hueShift = normCentered(cfg.hue);
    const TARGET_YELLOW = {
      R: 240 + (hueShift * 15) | 0, // 225-255
      G: 219 + (hueShift * 20) | 0, // 199-239
      B: 76 - (hueShift * 30) | 0   // 46-106
    };

    // --- COLOR CHANNELS ---
    // These adjustments affect detection sensitivity and desaturation
    const redAdj = normCentered(cfg.red) * 0.5;
    const greenAdj = normCentered(cfg.green) * 0.5;
    const blueAdj = normCentered(cfg.blue) * 0.5;
    const yellowAdj = normCentered(cfg.yellow) * 0.5;
    const contrastTarget = norm(cfg.contrast_target);
    const exposureTarget = norm(cfg.exposure_target);

    // Red detection (affected by red channel adjustment)
    // Wider range to ensure red is caught
    const ORIGRED_MIN = 60 + (redAdj * 30) | 0; // 45-75
    const ORIGRED_TO_GREEN = 1.3 + (redAdj * 0.25); // 1.175-1.425
    const ORIGRED_TO_BLUE = 1.2 + (redAdj * 0.25); // 1.075-1.325

    // Blue detection (affected by blue channel adjustment)
    // Distinct from red with wider range
    const BLUE_MIN_DIFF = 10 + (blueAdj * 15) | 0; // 2.5-17.5
    const BLUE_MIN_BLUE = 40 + (blueAdj * 30) | 0; // 25-55
    const BLUE_RATIO = 1.25 + (blueAdj * 0.2); // 1.15-1.35

    // Yellow detection (affected by yellow channel adjustment)
    const YELLOW_MIN_RED = 100 + (yellowAdj * 40) | 0; // 80-120
    const YELLOW_MIN_GREEN = 80 + (yellowAdj * 40) | 0; // 60-100
    const YELLOW_RG_DIFF = 60 - (yellowAdj * 25) | 0; // 47.5-72.5
    const YELLOW_GREEN_TO_RED = 0.78 + (yellowAdj * 0.1); // 0.73-0.83
    const YELLOW_BLUE_RATIO = 0.7 - (yellowAdj * 0.18); // 0.61-0.79

    // --- WHITE POINT ---
    // Maps to white threshold levels
    const whiteScale = norm(cfg.white);
    const whiteOffset = (whiteScale - 0.5) * 2; // -1 to +1 centered at 50
    const whiteStrength = whiteScale * whiteScale; // Exponential for more control

    const WHITE_THRESHOLD = {
      MIN_CHANNEL: 120 + (whiteOffset * 20) | 0, // 100-140
      MAX_RANGE_START: 80 - (whiteOffset * 20) | 0, // 60-100
      LEVEL_1: {
        MIN: 120 + (whiteOffset * 20) | 0, // 100-140
        RANGE: 80 - (whiteOffset * 20) | 0, // 60-100
        STRENGTH: 0.5 + (whiteOffset * 0.3) // 0.2-0.8
      },
      LEVEL_2: {
        MIN: 150 + (whiteOffset * 20) | 0, // 130-170
        RANGE: 60 - (whiteOffset * 20) | 0, // 40-80
        STRENGTH: 0.6 + (whiteOffset * 0.3) // 0.3-0.9
      },
      LEVEL_3: {
        MIN: 170 + (whiteOffset * 20) | 0, // 150-190
        RANGE: 50 - (whiteOffset * 15) | 0, // 35-65
        STRENGTH: 0.75 + (whiteOffset * 0.2) // 0.55-0.95
      },
      LEVEL_4: {
        MIN: 190 + (whiteOffset * 20) | 0, // 170-210
        RANGE: 40 - (whiteOffset * 15) | 0, // 25-55
        STRENGTH: 0.88 + (whiteOffset * 0.12) // 0.76-1.0
      },
      LEVEL_5: {
        MIN: 210 + (whiteOffset * 20) | 0, // 190-230
        RANGE: 30 - (whiteOffset * 15) | 0, // 15-45
        STRENGTH: 0.95 + (whiteOffset * 0.05) // 0.90-1.0
      },
      LEVEL_6: {
        MIN: 225 + (whiteOffset * 20) | 0, // 205-245
        RANGE: 22 - (whiteOffset * 13) | 0, // 9-35
        STRENGTH: 1.0 // Always 1.0 at this level
      },
      FINAL_MIN: 230 + (whiteOffset * 15) | 0, // 215-245
      FINAL_RANGE: 15 - (whiteOffset * 10) | 0 // 5-25
    };

    // --- BLACK POINT ---
    // Maps to dark processing thresholds (higher black = darker shadows)
    const blackScale = norm(cfg.black);

    // --- NOISE REDUCTION ---
    // Maps to preprocessing and smoothing (not yet implemented in processing)
    const noiseScale = norm(cfg.noise);

    // --- DEFINITION ---
    // Maps to sharpening strength in restoreMargins (RENDER_SCALE)
    // At 50 (default), RENDER_SCALE = 1.005 (original value)
    const defScale = norm(cfg.definition);
    const defOffset = (defScale - 0.5) * 2; // -1 to +1, centered at 50
    const RENDER_SCALE = 1.005 + (defOffset * 0.055); // 0.95-1.06

    // --- NORMALIZATION TARGETS ---
    const CONTRAST_TARGET_RANGE = 100 + (contrastTarget * 70); // 100-170
    const CONTRAST_MIN_SCALE = 0.5 + (contrastTarget * 0.25); // 0.5-0.75
    const EXPOSURE_TARGET_MID = 160 + (exposureTarget * 50); // 160-210
    const EXPOSURE_TARGET_LOW = 20 + (exposureTarget * 20); // 20-40
    const EXPOSURE_TARGET_HIGH = 235 + (exposureTarget * 15); // 235-250
    const EXPOSURE_MAX_GAIN = 1.2 + (exposureTarget * 0.4); // 1.2-1.6

    // Build technical configuration
    return {
      RENDER_SCALE,

      A4_CM_W: 21,
      A4_CM_H: 29.7,
      BASE_A4_W: 2480,
      BASE_A4_H: 3508,
      SCALE: 1.01,

      TARGET_YELLOW,

      BLUE_DETECTION: {
        MIN_DIFF: BLUE_MIN_DIFF,
        MIN_BLUE: BLUE_MIN_BLUE,
        RATIO: BLUE_RATIO
      },

      ORIGRED_DETECTION: {
        MIN_RED: ORIGRED_MIN,
        RED_TO_GREEN: ORIGRED_TO_GREEN,
        RED_TO_BLUE: ORIGRED_TO_BLUE
      },

      YELLOW_DETECTION: {
        MIN_RED: YELLOW_MIN_RED,
        MIN_GREEN: YELLOW_MIN_GREEN,
        RG_DIFF_MAX: YELLOW_RG_DIFF,
        GREEN_TO_RED_MIN: YELLOW_GREEN_TO_RED,
        BLUE_RATIO_MAX: YELLOW_BLUE_RATIO
      },

      WHITE_THRESHOLD,

      DARK_PROCESSING: {
        THRESHOLD_1,
        THRESHOLD_2,
        THRESHOLD_3
      },

      DESATURATION: {
        RED_STRENGTH,
        BLUE_STRENGTH,
        NEUTRAL_STRENGTH
      },

      CONTRAST_TARGET_RANGE,
      CONTRAST_MIN_SCALE,
      EXPOSURE_TARGET_MID,
      EXPOSURE_TARGET_LOW,
      EXPOSURE_TARGET_HIGH,
      EXPOSURE_MAX_GAIN,

      STENCIL_COLORS: {
        red:   { r: 101, g: 51,  b: 49 },
        black: { r: 30,  g: 28,  b: 30 },
        blue:  { r: 35,  g: 41,  b: 66 },
        green: { r: 90,  g: 107, b: 55 }
      },

      CALIBRATION_TARGETS: {
        red:   [255, 0, 0],
        blue:  [0, 0, 255],
        green: [110, 255, 18],
        black: [0, 0, 0],
        white: [255, 255, 255]
      },

      // Internal metadata
      _userConfig: cfg,
      _noise: noiseScale,
      _definition: defScale,
      _brightness: brightnessScale,
      _contrast: contrastScale
    };
  }

  // Load configuration from values.config
  SP.loadConfig = async function loadConfig() {
    try {
      const response = await fetch('values.config', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Config file not found');
      }

      const text = await response.text();
      const userConfig = parseConfig(text);
      const technicalConfig = convertToTechnicalConfig(userConfig);

      return technicalConfig;
    } catch (err) {
      console.warn('Failed to load values.config, using defaults:', err);
      // Return default configuration
      return convertToTechnicalConfig({});
    }
  };

  // Export converter for testing
  SP.convertConfigToTechnical = convertToTechnicalConfig;
})();
