import { notFound } from "next/navigation";
export default async function PlayerPreviewPage({ params }: { params: Promise<{ section?: string[] }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { section } = await params;
  const { ShellPreview } = await import("@/components/dev/shell-preview");
  return <ShellPreview section={section?.join("/") ?? "home"} />;
}
