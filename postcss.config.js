module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    // sRGB fallbacks for the oklch() theme and color-mix() opacity classes, for
    // browsers without them (Windows 7/8 laptops on Chrome 109, iPhones on
    // iOS 15/16, old Android browsers). Modern browsers' CSS is unchanged.
    "./scripts/postcss/color-fallbacks.cjs": {},
  },
};
