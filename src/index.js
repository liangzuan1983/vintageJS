// @flow

import nullthrows from 'nullthrows';

type UnaryFn<A, B> = (a: A) => B;
export type Pixel = [number, number, number];
export type SourceElement = HTMLImageElement | HTMLCanvasElement;
export type RGBAColor = {
  r: number,
  g: number,
  b: number,
  a: number,
};

export type Curve = {
  r: Array<number>,
  g: Array<number>,
  b: Array<number>,
};

export type Effect = {
  curves: false | Curve,
  screen: false | RGBAColor,
  saturation: number,
  vignette: number,
  lighten: number,
  viewFinder: false | string,
  sepia: boolean,
  brightness: number,
  contrast: number,
};

const defaultEffect: Effect = {
  curves: false,
  screen: false,
  saturation: 1,
  vignette: 0,
  lighten: 0,
  viewFinder: false,
  sepia: false,
  brightness: 0,
  contrast: 0,
};

const IMAGE_TYPE = 'image/jpeg';
const IMAGE_QUALITY = 1;

const createCanvasFromImage = (el: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = el.width;
  canvas.height = el.height;
  const ctx = nullthrows(
    canvas.getContext('2d'),
    'Could not get 2d context for canvas',
  );
  ctx.drawImage(el, 0, 0, el.width, el.height);

  return canvas;
};

const getCanvas = (el: SourceElement): createCanvasFromImage => {
  if (el instanceof HTMLImageElement) {
    return createCanvasFromImage(el);
  }
  if (el instanceof HTMLCanvasElement) {
    return el;
  }
  throw new Error(
    `Unsupported source element. Expected HTMLCanvasElement or HTMLImageElement, got ${typeof el}.`,
  );
};

// cool when used as contrast
// const contrastFn = _ =>
//   c => 259 * (c + 255) / (255 * (259 - c)) * (c - 128) + 128;

const compose = <T1, T2, R>(
  f: UnaryFn<T2, R>,
  g: UnaryFn<T1, T2>,
): UnaryFn<T1, R> =>
  x => f(g(x));

const idFn = (c: number): number => c;
const curvesFn = (curves: Array<number>) => (c: number): number => curves[c];
const contrastFn = (f: number) =>
  (c: number): number =>
    259 * (f * 256 + 255) / (255 * (259 - f * 256)) * (c - 128) + 128;
const brightnessFn = (f: number) => (c: number): number => c + f * 256;
const screenFn = (sa: number) =>
  (sc: number) =>
    (c: number): number => 255 - (255 - c) * (255 - sc * sa) / 255;

const getLUT = (effect: Effect): Array<Array<number>> => {
  const { curves, contrast, brightness, screen, saturation } = effect;
  let rMod = idFn;
  let gMod = idFn;
  let bMod = idFn;

  if (curves) {
    rMod = compose(curvesFn(curves.r), rMod);
    gMod = compose(curvesFn(curves.g), gMod);
    bMod = compose(curvesFn(curves.b), bMod);
  }

  if (contrast) {
    let f = contrastFn(contrast);
    rMod = compose(f, rMod);
    gMod = compose(f, gMod);
    bMod = compose(f, bMod);
  }

  if (brightness) {
    let f = brightnessFn(brightness);
    rMod = compose(f, rMod);
    gMod = compose(f, gMod);
    bMod = compose(f, bMod);
  }

  if (screen) {
    let f = screenFn(screen.a);
    rMod = compose(f(screen.r), rMod);
    gMod = compose(f(screen.g), gMod);
    bMod = compose(f(screen.b), bMod);
  }

  const id_arr = new Array(256).fill(1).map((_, idx) => idx);
  return [id_arr.map(rMod), id_arr.map(gMod), id_arr.map(bMod)];
};

// ApplyEffect :: SourceElement -> $Shape<Effect> -> Promise<string>
export default (
  srcEl: SourceElement,
  partialEffect: $Shape<Effect>,
): Promise<string> =>
  new Promise((resolve, reject) => {
    console.time('effect');
    const effect = {
      ...defaultEffect,
      ...partialEffect,
    };
    const LUT = getLUT(effect);
    const canvas = getCanvas(srcEl);
    const { width, height } = canvas;
    const ctx = nullthrows(
      canvas.getContext('2d'),
      'Could not get 2d context for canvas',
    );

    const data = ctx.getImageData(0, 0, width, height);
    const id = data.data.slice(0);
    const { sepia, saturation } = effect;

    let r, g, b, ri, gi, bi;
    for (let i = id.length / 4; i >= 0; --i) {
      ri = i << 2;
      gi = ri + 1;
      bi = ri + 2;

      r = LUT[0][id[ri]];
      g = LUT[1][id[gi]];
      b = LUT[2][id[bi]];

      if (sepia) {
        r = r * 0.393 + g * 0.769 + b * 0.189;
        g = r * 0.349 + g * 0.686 + b * 0.168;
        b = r * 0.272 + g * 0.534 + b * 0.131;
      }

      if (saturation < 1) {
        const avg = (r + g + b) / 3;
        r += (avg - r) * (1 - saturation);
        g += (avg - g) * (1 - saturation);
        b += (avg - b) * (1 - saturation);
      }

      id[ri] = r;
      id[gi] = g;
      id[bi] = b;
    }

    data.data.set(id);
    ctx.putImageData(data, 0, 0);

    if (effect.vignette) {
      ctx.globalCompositeOperation = 'multiply';
      if (ctx.globalCompositeOperation !== 'multiply') {
        console.log('globalCompositeOperation fallback');
        ctx.globalCompositeOperation = 'source-over';
      }
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)),
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.5, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${effect.vignette})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    if (effect.lighten) {
      ctx.globalCompositeOperation = 'lighter';
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2)),
      );
      gradient.addColorStop(0, `rgba(255,255,255,${effect.lighten})`);
      gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
    const res = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
    console.timeEnd('effect');
    resolve(res);
  });
