/**
 * Webpack loader: removes the regex lookbehind from remark-gfm's e-mail
 * autolinks (mdast-util-gfm-autolink-literal, wired in next.config.mjs).
 *
 * Safari before 16.4 — every iPhone left on iOS 15 or 16 (iPhone 6s/7/8/X,
 * still everywhere) — cannot even PARSE a regex with `(?<=…)`: the whole
 * JavaScript file holding it is rejected with a SyntaxError. That file is a
 * shared chunk of the course module page, the workspace, the assistant, the
 * audio workspace, group chats and the demo, so on those phones those pages
 * simply never loaded.
 *
 * The lookbehind only pre-filters what `findEmail` checks anyway: the match
 * must start the text or follow whitespace/punctuation/a symbol (the
 * `previous()` test), and a refused match is retried one character further
 * (mdast-util-find-and-replace sets lastIndex = index + 1 on `false`). So
 * the plain pattern finds exactly the same e-mails — checked on 60,000
 * random markdown inputs, identical trees.
 *
 * If a future version changes the pattern, the build fails here instead of
 * silently shipping a lookbehind to those phones again.
 */
const FROM = "/(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu";
const TO = "/([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu";

module.exports = function stripRegexLookbehindLoader(source) {
  const out = source.split(FROM).join(TO);
  if (out.includes("(?<=") || out.includes("(?<!")) {
    this.emitError(
      new Error(
        `${this.resourcePath} still contains a regex lookbehind, which old iPhones (Safari < 16.4) cannot parse. ` +
          "Update scripts/webpack/strip-regex-lookbehind-loader.cjs for the new version of this package."
      )
    );
  }
  return out;
};
