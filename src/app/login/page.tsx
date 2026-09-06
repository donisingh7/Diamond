import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginPresentation } from "@/components/shared/login-presentation";

export const metadata = { title: "Player access · Diamond" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/");
  return <LoginPresentation />;
}
