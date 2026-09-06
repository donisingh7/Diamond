import { notFound } from "next/navigation";
export default async function DesignSystemPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { DesignShowcase } = await import("@/components/dev/design-showcase");
  return <DesignShowcase />;
}
