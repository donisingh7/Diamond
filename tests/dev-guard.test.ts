import { describe, expect, it, vi } from "vitest";

/** The `/dev/*` design studio and shell previews must 404 outside development, in every environment (including production). */
describe("development-only route guards", () => {
  it("blocks the /dev layout and returns children only in development", async () => {
    const { default: DevelopmentLayout } = await import("@/app/dev/layout");
    for (const env of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      try {
        expect(() => DevelopmentLayout({ children: "child" })).toThrow(/404/);
      } finally { vi.unstubAllEnvs(); }
    }
    vi.stubEnv("NODE_ENV", "development");
    try {
      expect(DevelopmentLayout({ children: "child" })).toBe("child");
    } finally { vi.unstubAllEnvs(); }
  });

  it("blocks the design showcase page outside development and renders it only in development", async () => {
    const { default: DesignSystemPage } = await import("@/app/dev/design-system/page");
    for (const env of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      try {
        await expect(DesignSystemPage()).rejects.toThrow(/404/);
      } finally { vi.unstubAllEnvs(); }
    }
    vi.stubEnv("NODE_ENV", "development");
    try {
      const element = await DesignSystemPage();
      expect(element.type.name).toBe("DesignShowcase");
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([
    ["@/app/dev/admin/[[...section]]/page", "AdminPreviewPage"],
    ["@/app/dev/player/[[...section]]/page", "PlayerPreviewPage"],
  ])("blocks %s outside development and renders it only in development", async (modulePath, exportedName) => {
    const pageModule = await import(/* @vite-ignore */ modulePath);
    const Page = pageModule.default as (props: { params: Promise<{ section?: string[] }> }) => Promise<unknown>;
    expect(Page.name).toBe(exportedName);
    const params = Promise.resolve({});
    for (const env of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      try {
        await expect(Page({ params })).rejects.toThrow(/404/);
      } finally { vi.unstubAllEnvs(); }
    }
    vi.stubEnv("NODE_ENV", "development");
    try {
      const element = (await Page({ params })) as { type: { name: string } };
      expect(element.type.name).toBe("ShellPreview");
    } finally { vi.unstubAllEnvs(); }
  });
});
