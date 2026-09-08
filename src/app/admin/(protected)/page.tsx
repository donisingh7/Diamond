import { redirect } from "next/navigation";

export const metadata = { title: "Admin · Diamond" };

/** Keep the existing admin entry URL pointed at the operational dashboard. */
export default async function AdminDashboardPage() {
  redirect("/admin/dashboard");
}
