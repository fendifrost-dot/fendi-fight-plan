/**
 * Storage upload utilities for streaming page uploads.
 * Object naming invariant: "{uid}/{jobId}/page-###.jpg"
 * No bucket prefix in object name.
 */
import { supabase } from "@/integrations/supabase/client";

const BUCKET = 'analysis-images';

/**
 * Upload a single page blob to storage.
 * Returns the object path (NOT including bucket name).
 */
export async function uploadPageBlob(
  userId: string,
  uploadId: string,
  pageIndex: number,
  blob: Blob,
): Promise<string> {
  const objectName = `${userId}/${uploadId}/page-${String(pageIndex).padStart(3, '0')}.jpg`;
  
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectName, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed for page ${pageIndex}: ${error.message}`);
  }

  return objectName;
}

/**
 * Upload a single image file (non-PDF) to storage.
 * Reads as blob, uploads with correct path.
 */
export async function uploadImageFile(
  userId: string,
  uploadId: string,
  file: File,
  pageIndex: number = 0,
): Promise<string> {
  const objectName = `${userId}/${uploadId}/page-${String(pageIndex).padStart(3, '0')}.jpg`;

  // For non-JPEG images, convert via canvas to ensure JPEG output
  let blob: Blob;
  if (file.type === 'image/jpeg') {
    blob = file;
  } else {
    blob = await convertImageToJpegBlob(file);
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectName, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed for ${file.name}: ${error.message}`);
  }

  return objectName;
}

/**
 * Convert any supported image to a JPEG blob via canvas.
 */
async function convertImageToJpegBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context creation failed'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          canvas.width = 0;
          canvas.height = 0;
          b ? resolve(b) : reject(new Error('toBlob failed'));
        },
        'image/jpeg',
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };

    img.src = url;
  });
}

/**
 * Delete all objects under a job prefix.
 * Used for cleanup on cancel/error during upload.
 */
export async function deleteJobObjects(
  userId: string,
  uploadId: string,
): Promise<void> {
  const prefix = `${userId}/${uploadId}/`;
  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list(prefix.replace(/\/$/, ''), { limit: 200 });

  if (files && files.length > 0) {
    await supabase.storage
      .from(BUCKET)
      .remove(files.map(f => `${prefix}${f.name}`));
  }
}
