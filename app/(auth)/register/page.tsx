import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Créer un compte — Med Art AI",
};

export default function RegisterPage() {
  return (
    <AuthLayout
      title="Crée ton compte étudiant"
      subtitle="Renseigne ton profil pour recevoir un contenu adapté à ta spécialité et ton année."
    >
      <RegisterForm />
    </AuthLayout>
  );
}
