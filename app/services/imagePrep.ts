/**
 * imagePrep.ts — 업로드 전 이미지 전처리 (C)
 *
 * 브라우저 전용. canvas / createImageBitmap을 쓴다.
 * 순수 파서(ocrSchema.ts)와 분리해 둔 이유: 평가 파이프라인이 Node에서 ocrSchema를 import 해야 하기 때문.
 *
 * 하는 일:
 *  1) EXIF 회전 보정 — 세로로 찍은 티켓이 눕혀진 채 들어가면 인식이 통째로 실패한다.
 *  2) 장변 1568px로 축소 — Gemini 이미지 타일 수를 줄여 토큰/지연을 크게 줄인다(정확도는 유지).
 *  3) JPEG quality 0.85로 재인코딩.
 */

/** Gemini 이미지 타일 기준 실용 균형점 */
export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.85;

export interface PreparedImage {
  /** <img src>에 바로 쓸 수 있는 data URL */
  dataUrl: string;
  /** data URL 프리픽스를 뗀 순수 base64 (API 전송용) */
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  /** 재인코딩 후 바이트 수 */
  bytes: number;
  /** 실제로 축소가 일어났는지 */
  resized: boolean;
}

function targetSize(w: number, h: number): { w: number; h: number; resized: boolean } {
  const longest = Math.max(w, h);
  if (longest <= MAX_EDGE) return { w, h, resized: false };
  const scale = MAX_EDGE / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), resized: true };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('이미지 인코딩에 실패했습니다.'))),
      mimeType,
      quality,
    );
  });
}

/**
 * EXIF 보정을 적용해 이미지 소스를 얻는다.
 * createImageBitmap(blob, { imageOrientation: 'from-image' })가 1순위.
 * 미지원 브라우저(구형 Safari 등)에서는 <img> 폴백 — 최신 브라우저의 <img>는
 * CSS image-orientation 기본값이 from-image라 EXIF가 이미 반영된 상태로 디코딩된다.
 */
async function decodeOriented(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 옵션 미지원 → 옵션 없이 재시도
      try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch {
        /* <img> 폴백으로 */
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지를 디코딩하지 못했습니다.'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * 티켓 이미지를 OCR에 보내기 좋은 형태로 만든다.
 * 실패하면 던진다 — 호출부가 사용자에게 알려야 한다(조용히 원본을 보내지 않는다).
 */
export async function prepareTicketImage(file: Blob): Promise<PreparedImage> {
  const { source, width, height, close } = await decodeOriented(file);
  try {
    if (!width || !height) throw new Error('이미지 크기를 읽지 못했습니다.');
    const { w, h, resized } = targetSize(width, height);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 컨텍스트를 사용할 수 없습니다.');

    // 축소 시 계단 현상을 줄여 작은 글씨(좌석/열/번) 판독률을 지킨다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // JPEG은 알파가 없다. 투명 PNG가 검게 깔리지 않도록 흰 배경을 먼저.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);

    const mimeType = 'image/jpeg';
    const blob = await canvasToBlob(canvas, mimeType, JPEG_QUALITY);
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    return {
      dataUrl,
      base64,
      mimeType,
      width: w,
      height: h,
      originalWidth: width,
      originalHeight: height,
      bytes: blob.size,
      resized,
    };
  } finally {
    close();
  }
}
