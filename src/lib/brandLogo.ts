export const BRAND_ASSETS_BUCKET = "brand-assets";
export const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_LOGO_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export function validateLogoFile(file: { type: string; size: number } | null | undefined): { valid: true } | { valid: false; error: string } {
  if (!file || file.size === 0) {
    return { valid: false, error: "Please select an image file to upload." };
  }

  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
    return {
      valid: false,
      error: "Invalid file format. Only PNG, JPEG, and WebP images are allowed.",
    };
  }

  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "File exceeds maximum size of 2 MB.",
    };
  }

  return { valid: true };
}

export function getLogoExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return "png";
  }
}

export function generateLogoStoragePath(mimeType: string, timestamp = Date.now()): string {
  const ext = getLogoExtension(mimeType);
  return `logo/company-logo-${timestamp}.${ext}`;
}
