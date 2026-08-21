import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bare `var(--x)`, NOT `hsl(var(--x))` — the tokens in globals.css
        // are now full oklch() color functions (a custom shadcn preset),
        // not bare HSL-triplet components. Wrapping an already-complete
        // color function in hsl() would produce invalid CSS like
        // `hsl(oklch(...))`, silently breaking every themed color in the
        // app. Tailwind's opacity-modifier syntax (`bg-primary/50` etc.,
        // used by Button/Badge/several forms) still works with this format
        // via Tailwind's color-mix() fallback for non-decomposable colors.
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        // Med Art AI "Clinical SaaS" design system — this is Tailwind's real
        // teal palette (not a custom-tuned scale) so `primary-600` is
        // exactly the spec'd #0d9488, `primary-50` #f0fdfa, etc. Deliberately
        // UNCHANGED by the shadcn preset token swap above — DEFAULT/
        // foreground follow the new neutral palette, but every numbered
        // shade (used pervasively — icon badges, hero glows, accents) stays
        // the app's real teal.
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 2px 10px -2px rgb(0 0 0 / 0.08)",
        card: "0 4px 24px -4px rgb(0 0 0 / 0.08)",
        // color-mix(), not the old `hsl(var(--primary) / 0.15)` alpha-slice
        // trick — that only works when the variable holds bare HSL
        // components, not a complete oklch() color function. color-mix()
        // is format-agnostic, so this keeps working regardless of which
        // color space --primary is defined in.
        glow: "0 0 0 1px color-mix(in oklch, var(--primary) 15%, transparent), 0 8px 30px -8px color-mix(in oklch, var(--primary) 35%, transparent)",
        // "Futuristic Medical Elegance" glass chrome — a soft ambient shadow
        // plus a hairline inset highlight (the light catching the top edge
        // of a frosted pane), on top of Tailwind's own arbitrary
        // shadow-[...] utilities already used for one-off card glows.
        glass: "0 8px 32px -8px rgb(0 0 0 / 0.12), inset 0 1px 0 0 rgb(255 255 255 / 0.4)",
        "glass-dark": "0 8px 32px -8px rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "dash-flow": {
          to: { strokeDashoffset: "-20" },
        },
        "aurora-breathe": {
          "0%, 100%": { opacity: "0.6", transform: "scale(1) translate(0, 0)" },
          "50%": { opacity: "1", transform: "scale(1.15) translate(2%, -2%)" },
        },
        "sidebar-wave": {
          "0%, 100%": { transform: "translate(0%, 0%) scale(1)" },
          "33%": { transform: "translate(4%, -6%) scale(1.08)" },
          "66%": { transform: "translate(-3%, 5%) scale(0.96)" },
        },
        "mesh-pulse": {
          "0%, 100%": { opacity: "0.06" },
          "50%": { opacity: "0.1" },
        },
        // Gentle vertical bob for the animated brand mark / empty-state
        // icons — distinct from aurora-breathe (which scales/fades a large
        // background blob), this is for a small foreground glyph.
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        // Outward-expanding ring pulse (the "neural node" halo around the
        // animated logo) — opacity fades to 0 as it scales up, looped.
        "ring-pulse": {
          "0%": { transform: "scale(0.9)", opacity: "0.6" },
          "80%, 100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "dash-flow": "dash-flow 1s linear infinite",
        "aurora-breathe": "aurora-breathe 12s ease-in-out infinite",
        "sidebar-wave": "sidebar-wave 20s ease-in-out infinite",
        "mesh-pulse": "mesh-pulse 20s ease-in-out infinite",
        float: "float 4s ease-in-out infinite",
        "ring-pulse": "ring-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("tailwindcss-animate")],
};

export default config;
