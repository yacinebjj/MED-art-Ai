import type { Language } from "@/providers/LanguageProvider";

/**
 * « Installer l'application » — the install guide and its entry points
 * (components/pwa/InstallAppModal.tsx, InstallAppEntry.tsx,
 * InstallGuideMockups.tsx). The browsers' own labels are quoted as each
 * browser shows them in that language (iOS « Sur l'écran d'accueil », Chrome
 * « Installer l'application »…), so the student finds the same words on screen.
 */
export const INSTALL_TRANSLATIONS = {
  entry: { fr: "Installer l'application", en: "Install the app" },
  title: { fr: "Installer MedArt AI", en: "Install MedArt AI" },
  subtitle: { fr: "Une vraie app sur ton écran d'accueil : plein écran, ouverte en un geste.", en: "A real app on your home screen: full screen, one tap away." },
  platforms: { fr: "Ton appareil", en: "Your device" },
  platformIos: { fr: "iPhone / iPad", en: "iPhone / iPad" },
  platformAndroid: { fr: "Android", en: "Android" },
  platformDesktop: { fr: "PC / Mac", en: "PC / Mac" },
  thisDevice: { fr: "cet appareil", en: "this device" },
  oneClick: { fr: "Installer en 1 clic", en: "Install in 1 click" },
  oneClickPending: { fr: "Ouverture…", en: "Opening…" },
  orSteps: { fr: "ou suis les 3 étapes", en: "or follow the 3 steps" },
  dismissed: { fr: "Pas de souci : les 3 étapes ci-dessous marchent à tout moment.", en: "No problem: the 3 steps below work any time." },
  installedTitle: { fr: "MedArt AI est installée", en: "MedArt AI is installed" },
  installedText: { fr: "Retrouve-la sur ton écran d'accueil ou parmi tes applications.", en: "Find it on your home screen or among your apps." },
  done: { fr: "C'est parti !", en: "Let's go!" },
  close: { fr: "Fermer", en: "Close" },
  steps: { fr: "Étapes", en: "Steps" },

  iosStep1: { fr: "Touche le bouton Partager", en: "Tap the Share button" },
  iosStep1Safari: { fr: "En bas de Safari (en haut à droite sur iPad) : le carré avec une flèche.", en: "At the bottom of Safari (top right on iPad): the square with an arrow." },
  iosStep1Chrome: { fr: "Dans Chrome, il est dans la barre d'adresse, en haut à droite.", en: "In Chrome, it's in the address bar, top right." },
  iosStep2: { fr: "Choisis « Sur l'écran d'accueil »", en: "Choose “Add to Home Screen”" },
  iosStep2Text: { fr: "Fais défiler si besoin : c'est le carré avec un +.", en: "Scroll if needed: it's the square with a +." },
  iosStep3: { fr: "Touche « Ajouter »", en: "Tap “Add”" },
  iosStep3Text: { fr: "En haut à droite. MedArt AI est sur ton écran d'accueil !", en: "Top right. MedArt AI is on your home screen!" },
  iosHint: { fr: "Sur iOS 26, « Partager » est dans le menu ••• de Safari.", en: "On iOS 26, “Share” is in Safari's ••• menu." },
  iosInApp: { fr: "Ouvert depuis Instagram, Facebook ou une autre app ? Ouvre d'abord la page dans Safari.", en: "Opened from Instagram, Facebook or another app? Open the page in Safari first." },

  androidStep1: { fr: "Ouvre le menu ⋮", en: "Open the ⋮ menu" },
  androidStep1Text: { fr: "Les 3 points en haut à droite de Chrome.", en: "The 3 dots at the top right of Chrome." },
  androidStep2: { fr: "Choisis « Installer l'application »", en: "Choose “Install app”" },
  androidStep2Text: { fr: "Ou « Ajouter à l'écran d'accueil », selon ta version.", en: "Or “Add to Home screen”, depending on your version." },
  androidStep3: { fr: "Touche « Installer »", en: "Tap “Install”" },
  androidStep3Text: { fr: "MedArt AI rejoint tes applications.", en: "MedArt AI joins your apps." },
  androidHint: { fr: "Samsung Internet : menu ≡ → « Ajouter la page à » → « Écran d'accueil ».", en: "Samsung Internet: ≡ menu → “Add page to” → “Home screen”." },
  androidInApp: { fr: "Ouvert dans une autre app ? Ouvre d'abord la page dans Chrome.", en: "Opened inside another app? Open the page in Chrome first." },

  desktopStep1: { fr: "Regarde à droite de la barre d'adresse", en: "Look at the right of the address bar" },
  desktopStep1Text: { fr: "Dans Chrome ou Edge, une petite icône d'écran apparaît.", en: "In Chrome or Edge, a small screen icon appears." },
  desktopStep2: { fr: "Clique sur « Installer MedArt AI »", en: "Click “Install MedArt AI”" },
  desktopStep2Text: { fr: "L'icône écran avec une flèche vers le bas.", en: "The screen icon with a down arrow." },
  desktopStep3: { fr: "Clique sur « Installer »", en: "Click “Install”" },
  desktopStep3Text: { fr: "MedArt s'ouvre dans sa propre fenêtre, comme une vraie app.", en: "MedArt opens in its own window, like a real app." },
  desktopHint: {
    fr: "Pas d'icône ? Menu ⋮ → « Caster, enregistrer et partager » → « Installer la page en tant qu'application ». Safari sur Mac : Fichier → « Ajouter au Dock ».",
    en: "No icon? ⋮ menu → “Cast, save and share” → “Install page as app”. Safari on Mac: File → “Add to Dock”.",
  },

  mockShare: { fr: "Partager", en: "Share" },
  mockCopy: { fr: "Copier", en: "Copy" },
  mockFavorites: { fr: "Ajouter aux favoris", en: "Add to Favorites" },
  mockAddHome: { fr: "Sur l'écran d'accueil", en: "Add to Home Screen" },
  mockAddHomeTitle: { fr: "Ajouter à l'écran d'accueil", en: "Add to Home Screen" },
  mockCancel: { fr: "Annuler", en: "Cancel" },
  mockAdd: { fr: "Ajouter", en: "Add" },
  mockNewTab: { fr: "Nouvel onglet", en: "New tab" },
  mockHistory: { fr: "Historique", en: "History" },
  mockInstallApp: { fr: "Installer l'application", en: "Install app" },
  mockInstallQuestion: { fr: "Installer l'application ?", en: "Install app?" },
  mockInstall: { fr: "Installer", en: "Install" },
  mockInstallMedart: { fr: "Installer MedArt AI", en: "Install MedArt AI" },
  tapHere: { fr: "Touche ici", en: "Tap here" },
  clickHere: { fr: "Clique ici", en: "Click here" },
} satisfies Record<string, Record<Language, string>>;

export type InstallKey = keyof typeof INSTALL_TRANSLATIONS;

export function tInstall(key: InstallKey, language: Language): string {
  return INSTALL_TRANSLATIONS[key][language];
}
