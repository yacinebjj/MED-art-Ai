/**
 * Webpack loader: rewrites class static blocks (`static { … }`) as private
 * static field initializers, for pdf.js's legacy build (wired in
 * next.config.mjs).
 *
 * Safari before 16.4 (iPhones left on iOS 15/16) and Chrome before 94 cannot
 * parse a static block: the whole PDF viewer chunk was rejected with a
 * SyntaxError and every course PDF fell back to its extracted text. pdf.js's
 * "legacy" build is otherwise made for older browsers (core-js polyfills
 * included) but still ships one static block (PDFWorker).
 *
 *   static {            →   static #medartStaticBlock1 = (() => {
 *     …                       …            (same `this`: the class)
 *   }                       })();
 *
 * Static fields and blocks run in source order at class definition, with
 * `this` bound to the class, and the arrow keeps both `this` and access to
 * the class's private names: the same code runs at the same moment. The file
 * is pretty-printed, so a block ends at the first `}` line at its own
 * indentation. If a static block is left over, the build fails here rather
 * than shipping a viewer old iPhones can't parse.
 */
module.exports = function staticBlockLoader(source) {
  let count = 0;
  const out = source.replace(/\n([ \t]*)static \{\n([\s\S]*?)\n\1\}(?=\n)/g, (_, indent, body) => {
    count += 1;
    return `\n${indent}static #medartStaticBlock${count} = (() => {\n${body}\n${indent}})();`;
  });
  if (/(^|[\s;{}])static\s*\{/.test(out)) {
    this.emitError(
      new Error(
        `${this.resourcePath} still contains a class static block, which old iPhones (Safari < 16.4) cannot parse. ` +
          "Update scripts/webpack/static-block-loader.cjs for the new version of this package."
      )
    );
  }
  return out;
};
