/**
 * The hourly reminders' content (lib/azkar.ts): Quranic verses and adhkar,
 * one of each in turn. GENERATED — do not edit by hand, and never retype a
 * verse: a typed one differs from the mushaf in its diacritics.
 *
 * Quranic text — verbatim excerpts of the Tanzil Project's "Simple" text:
 *   Tanzil Quran Text (Simple) Copyright (C) 2007-2021 Tanzil Project
 *   License: Creative Commons Attribution 3.0
 *   This copy of the Quran text is carefully produced, highly verified and
 *   continuously monitored by a group of specialists in Tanzil Project.
 *   Permission is granted to copy and distribute verbatim copies of this text,
 *   but CHANGING IT IS NOT ALLOWED. It can be used in any website or
 *   application, provided that its source (Tanzil Project) is clearly
 *   indicated, and a link is made to tanzil.net to enable users to keep track
 *   of changes. (Credited in Paramètres › Rappels.)
 * A verse quote is split into its ayat (`segments`), shown with an ornament
 * between them. Quotes of part of an ayah stop at a word, never at a pause sign.
 *
 * Adhkar — authentic, short, each with its collection.
 */

export interface AzkarEntry {
  /** Stable label of the entry (the rotation itself follows the list order). */
  id: string;
  kind: "ayah" | "dhikr";
  /** The Arabic text: a verse quote's ayat, or the dhikr. */
  segments: readonly string[];
  /** Arabic reference: "[سورة: آية]" for a verse, the collection for a dhikr. */
  source: string;
}

export const AZKAR_ENTRIES: readonly AzkarEntry[] = [
  { id: "taha-114", kind: "ayah", segments: ["وَقُلْ رَبِّ زِدْنِي عِلْمًا"], source: "[طه: 114]" },
  { id: "subhan-allah-wa-bihamdih", kind: "dhikr", segments: ["سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ"], source: "متفق عليه" },
  { id: "sharh-5-6", kind: "ayah", segments: ["فَإِنَّ مَعَ الْعُسْرِ يُسْرًا", "إِنَّ مَعَ الْعُسْرِ يُسْرًا"], source: "[الشرح: 5-6]" },
  { id: "la-hawla", kind: "dhikr", segments: ["لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ"], source: "متفق عليه" },
  { id: "baqara-286", kind: "ayah", segments: ["لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا"], source: "[البقرة: 286]" },
  { id: "anfani-bima-allamtani", kind: "dhikr", segments: ["اللَّهُمَّ انْفَعْنِي بِمَا عَلَّمْتَنِي، وَعَلِّمْنِي مَا يَنْفَعُنِي، وَزِدْنِي عِلْمًا"], source: "رواه الترمذي وابن ماجه" },
  { id: "rad-28", kind: "ayah", segments: ["أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ"], source: "[الرعد: 28]" },
  { id: "istighfar", kind: "dhikr", segments: ["أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ"], source: "رواه البخاري" },
  { id: "maida-32", kind: "ayah", segments: ["وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا"], source: "[المائدة: 32]" },
  { id: "la-sahla", kind: "dhikr", segments: ["اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزْنَ إِذَا شِئْتَ سَهْلًا"], source: "رواه ابن حبان" },
  { id: "taha-25-26", kind: "ayah", segments: ["رَبِّ اشْرَحْ لِي صَدْرِي", "وَيَسِّرْ لِي أَمْرِي"], source: "[طه: 25-26]" },
  { id: "al-baqiyat", kind: "dhikr", segments: ["سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ"], source: "رواه مسلم" },
  { id: "talaq-3", kind: "ayah", segments: ["وَمَنْ يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ"], source: "[الطلاق: 3]" },
  { id: "salawat", kind: "dhikr", segments: ["اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ"], source: "الصلاة على النبي ﷺ" },
  { id: "shuara-80", kind: "ayah", segments: ["وَإِذَا مَرِضْتُ فَهُوَ يَشْفِينِ"], source: "[الشعراء: 80]" },
  { id: "ya-hayy-ya-qayyum", kind: "dhikr", segments: ["يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ"], source: "رواه الترمذي" },
  { id: "mujadila-11", kind: "ayah", segments: ["يَرْفَعِ اللَّهُ الَّذِينَ آمَنُوا مِنْكُمْ وَالَّذِينَ أُوتُوا الْعِلْمَ دَرَجَاتٍ"], source: "[المجادلة: 11]" },
  { id: "ilman-nafian", kind: "dhikr", segments: ["اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا، وَرِزْقًا طَيِّبًا، وَعَمَلًا مُتَقَبَّلًا"], source: "رواه ابن ماجه" },
  { id: "baqara-153", kind: "ayah", segments: ["اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ ۚ إِنَّ اللَّهَ مَعَ الصَّابِرِينَ"], source: "[البقرة: 153]" },
  { id: "tahlil", kind: "dhikr", segments: ["لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ"], source: "متفق عليه" },
  { id: "hud-88", kind: "ayah", segments: ["وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ ۚ عَلَيْهِ تَوَكَّلْتُ وَإِلَيْهِ أُنِيبُ"], source: "[هود: 88]" },
  { id: "raditu", kind: "dhikr", segments: ["رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا"], source: "رواه أبو داود والترمذي" },
  { id: "yusuf-87", kind: "ayah", segments: ["وَلَا تَيْأَسُوا مِنْ رَوْحِ اللَّهِ"], source: "[يوسف: 87]" },
  { id: "al-hamm-wal-hazan", kind: "dhikr", segments: ["اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ، وَغَلَبَةِ الرِّجَالِ"], source: "رواه البخاري" },
  { id: "alaq-1", kind: "ayah", segments: ["اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ"], source: "[العلق: 1]" },
];
