import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function LoginPage() {
  // Opening the app once also applies migrations and seeds the demo data.
  await db();
  if (await currentUser()) redirect("/");

  return (
    <div className="login-wrap">
      <LoginForm />
    </div>
  );
}
