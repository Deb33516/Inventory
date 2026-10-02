import { describe, it, expect } from "vitest";
import {
  BRAND_ASSETS_BUCKET,
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_FILE_SIZE_BYTES,
  validateLogoFile,
  getLogoExtension,
  generateLogoStoragePath,
} from "./brandLogo";

describe("Brand Logo Configuration", () => {
  it("uses the brand-assets bucket", () => {
    expect(BRAND_ASSETS_BUCKET).toBe("brand-assets");
  });

  it("permits only PNG, JPEG, and WebP formats", () => {
    expect(ALLOWED_LOGO_MIME_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  it("sets the maximum size limit to 2 MB (2,097,152 bytes)", () => {
    expect(MAX_LOGO_FILE_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("validateLogoFile", () => {
  it("accepts valid PNG, JPEG, and WebP files within 2 MB", () => {
    expect(validateLogoFile({ type: "image/png", size: 1024 })).toEqual({ valid: true });
    expect(validateLogoFile({ type: "image/jpeg", size: 1024 * 1024 })).toEqual({ valid: true });
    expect(validateLogoFile({ type: "image/webp", size: 2 * 1024 * 1024 })).toEqual({ valid: true });
  });

  it("rejects files exceeding 2 MB", () => {
    const res = validateLogoFile({ type: "image/png", size: 2 * 1024 * 1024 + 1 });
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.error).toContain("2 MB");
    }
  });

  it("rejects unsupported MIME types", () => {
    const disallowed = ["image/gif", "image/svg+xml", "image/bmp", "application/pdf", "text/plain"];
    for (const mime of disallowed) {
      const res = validateLogoFile({ type: mime, size: 500 });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("PNG, JPEG, and WebP");
      }
    }
  });

  it("rejects missing or empty files", () => {
    expect(validateLogoFile(null).valid).toBe(false);
    expect(validateLogoFile(undefined).valid).toBe(false);
    expect(validateLogoFile({ type: "image/png", size: 0 }).valid).toBe(false);
  });
});

describe("Storage Path & Extension Utilities", () => {
  it("maps MIME types to expected extensions", () => {
    expect(getLogoExtension("image/png")).toBe("png");
    expect(getLogoExtension("image/jpeg")).toBe("jpg");
    expect(getLogoExtension("image/webp")).toBe("webp");
  });

  it("generates structured storage paths under the logo prefix", () => {
    const timestamp = 1727780000000;
    expect(generateLogoStoragePath("image/png", timestamp)).toBe("logo/company-logo-1727780000000.png");
    expect(generateLogoStoragePath("image/webp", timestamp)).toBe("logo/company-logo-1727780000000.webp");
  });
});
