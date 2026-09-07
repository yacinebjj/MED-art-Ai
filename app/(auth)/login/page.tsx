import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Connexion — Med Art AI",
};

export default function LoginPage() {
  return (
    <AuthLayout variant="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
