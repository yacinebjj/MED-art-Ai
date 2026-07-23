import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <Logo />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Fait pour les étudiants en Médecine, Pharmacie et Chirurgie Dentaire en Algérie.
          </p>
          <p className="text-sm text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} Med Art AI
          </p>
        </div>
      </div>
    </footer>
  );
}
