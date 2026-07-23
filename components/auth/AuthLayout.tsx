import Link from "next/link";
import { Stethoscope, ShieldCheck, BrainCircuit, GraduationCap } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const HIGHLIGHTS = [
  { icon: BrainCircuit, text: "Explications ultra-détaillées générées par IA" },
  { icon: ShieldCheck, text: "Pièges de QCM identifiés à l'avance" },
  { icon: GraduationCap, text: "QCMs corrigés en détail, du facile au difficile" },
];

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-secondary-900 p-10 text-white lg:flex">
        <Link href="/">
          <Logo variant="light" />
        </Link>

        <div>
          <Stethoscope className="mb-6 h-12 w-12 text-primary-200" />
          <h2 className="text-3xl font-bold leading-tight">
            L'assistant IA des étudiants en santé algériens.
          </h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-center gap-3 text-primary-100">
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="text-sm">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-200/70">
          © {new Date().getFullYear()} Med Art AI — Médecine · Pharmacie · Chirurgie Dentaire
        </p>
      </div>

      <div className="flex flex-col justify-center px-4 py-12 sm:px-6 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link href="/">
              <Logo />
            </Link>
            <ThemeToggle />
          </div>

          <div className="hidden justify-end lg:flex">
            <ThemeToggle />
          </div>

          <h1 className="mt-4 text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
