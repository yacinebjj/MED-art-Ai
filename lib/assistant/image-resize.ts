/**
 * Downsizes a picked/captured image client-side before it is sent to the
 * assistant: ~1568 px on the long edge (the sweet spot for vision models —
 * more pixels add cost, not accuracy) as a JPEG data URL. Keeps a phone
 * photo (often 4-12 MB) far under the API's request-size ceiling.
 */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export async function resizeImageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Cette image n'a pas pu être lue. Essaie une photo JPEG ou PNG.");
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Ton navigateur ne peut pas préparer cette image.");
  // White background so transparent PNGs (schemas) stay legible once in JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
