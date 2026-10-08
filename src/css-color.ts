// Parses the CSS colors the agent reports (a computed `color` or `caret-color`)
// into sRGB and an alpha, for three.js.
//
// A computed color keeps the syntax the page wrote it in: rgb() for sRGB
// colors (hex, names, hsl() and hwb() included), but color(), lab(), lch(),
// oklab() and oklch() for the others, and color-mix() resolved to one of those.
// THREE.Color only reads sRGB syntaxes, and none of them with an alpha. This
// is done in code rather than by drawing into a canvas: it gives the same
// result in every browser (and in tests), and canvas readback can be noised
// by anti-fingerprinting.
//
// The conversions follow CSS Color 4 (https://www.w3.org/TR/css-color-4/#color-conversion-code).
// Colors outside sRGB are clipped to it, not gamut mapped.

import { Color } from "three";

/** An sRGB color (gamma encoded, each channel 0–1) and an alpha (0–1). */
export interface SrgbColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const multiply = (m: Mat3, [x, y, z]: Vec3): Vec3 =>
  m.map((row) => row[0] * x + row[1] * y + row[2] * z) as Vec3;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** sRGB's transfer function (display-p3 uses it too), applied to each channel of linear light. */
const encodeSrgb = (rgb: Vec3): Vec3 =>
  rgb.map((c) => {
    const abs = Math.abs(c);
    return abs > 0.0031308 ? Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055) : 12.92 * c;
  }) as Vec3;

const decodeSrgb = (rgb: Vec3): Vec3 =>
  rgb.map((c) => {
    const abs = Math.abs(c);
    return abs <= 0.04045 ? c / 12.92 : Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
  }) as Vec3;

const decodeGamma = (rgb: Vec3, gamma: number): Vec3 =>
  rgb.map((c) => Math.sign(c) * Math.abs(c) ** gamma) as Vec3;

const decodeProPhoto = (rgb: Vec3): Vec3 =>
  rgb.map((c) => (Math.abs(c) <= 16 / 512 ? c / 16 : Math.sign(c) * Math.abs(c) ** 1.8)) as Vec3;

const decodeRec2020 = (rgb: Vec3): Vec3 => {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  return rgb.map((c) => {
    const abs = Math.abs(c);
    return abs < beta * 4.5 ? c / 4.5 : Math.sign(c) * ((abs + alpha - 1) / alpha) ** (1 / 0.45);
  }) as Vec3;
};

const XYZ_D65_TO_LINEAR_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
/** Bradford chromatic adaptation. */
const XYZ_D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LINEAR_P3_TO_XYZ_D65: Mat3 = [
  [0.48657094864821615, 0.26566769316909306, 0.19821728523436247],
  [0.22897456406974878, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LINEAR_A98_TO_XYZ_D65: Mat3 = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];
const LINEAR_PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977666449006423, 0.1351812974005331, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LINEAR_REC2020_TO_XYZ_D65: Mat3 = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const xyzD65ToSrgb = (xyz: Vec3): Vec3 => encodeSrgb(multiply(XYZ_D65_TO_LINEAR_SRGB, xyz));
const xyzD50ToSrgb = (xyz: Vec3): Vec3 => xyzD65ToSrgb(multiply(XYZ_D50_TO_D65, xyz));

/** The rgb spaces of color(), each to sRGB. */
const COLOR_SPACES: Record<string, (rgb: Vec3) => Vec3> = {
  srgb: (rgb) => rgb,
  "srgb-linear": encodeSrgb,
  "display-p3": (rgb) => xyzD65ToSrgb(multiply(LINEAR_P3_TO_XYZ_D65, decodeSrgb(rgb))),
  "a98-rgb": (rgb) => xyzD65ToSrgb(multiply(LINEAR_A98_TO_XYZ_D65, decodeGamma(rgb, 563 / 256))),
  "prophoto-rgb": (rgb) => xyzD50ToSrgb(multiply(LINEAR_PROPHOTO_TO_XYZ_D50, decodeProPhoto(rgb))),
  rec2020: (rgb) => xyzD65ToSrgb(multiply(LINEAR_REC2020_TO_XYZ_D65, decodeRec2020(rgb))),
  xyz: xyzD65ToSrgb,
  "xyz-d65": xyzD65ToSrgb,
  "xyz-d50": xyzD50ToSrgb,
};

function labToSrgb([l, a, b]: Vec3): Vec3 {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const y = l > kappa * epsilon ? fy ** 3 : l / kappa;
  const z = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  return xyzD50ToSrgb([x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]);
}

function oklabToSrgb([l, a, b]: Vec3): Vec3 {
  const lms: Vec3 = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  return encodeSrgb(
    multiply(
      [
        [4.0767416621, -3.3077115913, 0.2309699292],
        [-1.2684380046, 2.6097574011, -0.3413193965],
        [-0.0041960863, -0.7034186147, 1.707614701],
      ],
      lms,
    ),
  );
}

/** Polar (lightness, chroma, hue in degrees) to rectangular (lightness, a, b). */
const fromPolar = ([l, c, h]: Vec3): Vec3 => {
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
};

function hslToSrgb([h, s, l]: Vec3): Vec3 {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToSrgb([h, w, b]: Vec3): Vec3 {
  w /= 100;
  b /= 100;
  if (w + b >= 1) return [w / (w + b), w / (w + b), w / (w + b)];
  return hslToSrgb([h, 100, 50]).map((c) => c * (1 - w - b) + w) as Vec3;
}

const ANGLE_UNITS: Record<string, number> = {
  "": 1,
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};
const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/;

/** A component: a number, a percentage of `percent`, an angle in degrees for a hue, or `none` (0). */
function component(token: string, percent: number | undefined): number | null {
  if (token === "none") return 0;
  const match = NUMBER.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? "";
  if (percent === undefined) {
    const degrees = unit === "%" ? Number.NaN : value * ANGLE_UNITS[unit]!;
    return Number.isNaN(degrees) ? null : ((degrees % 360) + 360) % 360;
  }
  if (unit === "%") return (value / 100) * percent;
  return unit === "" ? value : null;
}

/**
 * The percentage reference of each component (undefined: a hue) and the
 * conversion to sRGB, by function. hsl() and hwb() take plain numbers too
 * (`hsl(120 50 50)`), so their percentages are of 100.
 */
const FUNCTIONS: Record<string, { percent: (number | undefined)[]; toSrgb: (v: Vec3) => Vec3 }> = {
  rgb: { percent: [255, 255, 255], toSrgb: (v) => v.map((c) => c / 255) as Vec3 },
  hsl: { percent: [undefined, 100, 100], toSrgb: hslToSrgb },
  hwb: { percent: [undefined, 100, 100], toSrgb: hwbToSrgb },
  lab: { percent: [100, 125, 125], toSrgb: labToSrgb },
  lch: { percent: [100, 150, undefined], toSrgb: (v) => labToSrgb(fromPolar(v)) },
  oklab: { percent: [1, 0.4, 0.4], toSrgb: oklabToSrgb },
  oklch: { percent: [1, 0.4, undefined], toSrgb: (v) => oklabToSrgb(fromPolar(v)) },
};
FUNCTIONS.rgba = FUNCTIONS.rgb!;
FUNCTIONS.hsla = FUNCTIONS.hsl!;

/** A table's own entry: the string comes from the page, and could be `constructor`. */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const FUNCTION = /^([a-z-]+)\((.*)\)$/;
const HEX = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/;

/** Parses a CSS color into sRGB (clipped to its gamut) and an alpha, or null if it cannot. */
export function parseCssColor(css: string): SrgbColor | null {
  const text = css.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
  const hex = HEX.exec(text)?.[1];
  if (hex) {
    const digits = (hex.length <= 4 ? hex.replace(/./g, "$&$&") : hex).match(/../g)!;
    const [r, g, b, a = 1] = digits.map((d) => parseInt(d, 16) / 255);
    return { r: r!, g: g!, b: b!, alpha: a };
  }
  const named = own(Color.NAMES as Record<string, number>, text);
  if (named !== undefined)
    return {
      r: (named >> 16) / 255,
      g: ((named >> 8) & 255) / 255,
      b: (named & 255) / 255,
      alpha: 1,
    };

  const call = FUNCTION.exec(text);
  if (!call) return null;
  const [, name, body] = call as unknown as [string, string, string];
  let tokens: string[];
  let alphaToken: string | undefined;
  if (body.includes(",")) {
    // The legacy syntax: rgba(1, 2, 3, 0.5).
    if (name === "color") return null;
    tokens = body.split(",").map((t) => t.trim());
    if (tokens.length === 4) alphaToken = tokens.pop();
  } else {
    const [main, alpha, extra] = body.split("/");
    if (extra !== undefined) return null;
    tokens = main!.trim().split(/\s+/);
    alphaToken = alpha?.trim();
  }

  let toSrgb: (v: Vec3) => Vec3;
  let percent: (number | undefined)[];
  if (name === "color") {
    const space = own(COLOR_SPACES, tokens.shift() ?? "");
    if (!space) return null;
    [toSrgb, percent] = [space, [1, 1, 1]];
  } else {
    const fn = own(FUNCTIONS, name);
    if (!fn) return null;
    ({ toSrgb, percent } = fn);
  }
  if (tokens.length !== 3) return null;
  const values = tokens.map((t, i) => component(t, percent[i]));
  const alpha = alphaToken === undefined ? 1 : component(alphaToken, 1);
  if (values.includes(null) || alpha === null) return null;
  const [r, g, b] = toSrgb(values as Vec3).map(clamp01) as Vec3;
  if (![r, g, b, alpha].every(Number.isFinite)) return null;
  return { r, g, b, alpha: clamp01(alpha) };
}
