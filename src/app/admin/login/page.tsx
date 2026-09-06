import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginPresentation } from "@/components/shared/login-presentation";

export const metadata = { title: "Admin access · Diamond" };

export default async function AdminLoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "PLAYER" ? "/" : "/admin");
  return <LoginPresentation admin />;
}
