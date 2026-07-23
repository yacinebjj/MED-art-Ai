import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Connexion — Med Art AI",
};

export default function LoginPage() {
  return (
    <AuthLayout
      title="Bon retour parmi nous"
      subtitle="Connecte-toi pour retrouver tes cours et continuer tes révisions."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
