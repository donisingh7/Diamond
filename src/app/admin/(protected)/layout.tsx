import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/admin-shell";
import { AccountMenu } from "@/components/shared/account-menu";

/** A sibling route (src/app/admin/login) sits outside this group, so it is never wrapped by this guard. */
export default async function AdminAreaLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/");

  return (
    <AdminShell title="Dashboard" breadcrumbs="Diamond / Administration" profile={<AccountMenu name={user.name} redirectTo="/admin/login" />}>
      {children}
    </AdminShell>
  );
}
