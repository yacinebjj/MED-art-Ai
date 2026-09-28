import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Mot de passe oublié — Med Art AI",
};

export default function ForgotPasswordPage() {
  return (
    <AuthLayout variant="forgot-password">
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
