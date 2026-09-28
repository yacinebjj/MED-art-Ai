import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { UpdatePasswordForm } from "@/components/auth/UpdatePasswordForm";

export const metadata: Metadata = {
  title: "Nouveau mot de passe — Med Art AI",
};

export default function UpdatePasswordPage() {
  return (
    <AuthLayout variant="update-password">
      <UpdatePasswordForm />
    </AuthLayout>
  );
}
