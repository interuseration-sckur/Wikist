"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [
  ["public/assets/app.js", "const USER_CONTENT_SELECTORS", "main UI protects user-authored content"],
  ["public/assets/app.js", "data-i18n-skip", "main UI supports explicit protected regions"],
  ["public/assets/app.js", "EN_UI_ATTRIBUTE_NAMES", "main UI translates accessible attributes"],
  ["public/assets/app.js", "const exact = EN_UI_TEXT.get(text)", "main UI uses complete strings rather than word-by-word replacement"],
  ["public/assets/app.js", "Search mathematics concepts", "English home search copy"],
  ["public/assets/app.js", "Organization quota reached", "organization hub labels"],
  ["public/assets/app.js", "Approve as stable", "version review controls"],
  ["public/assets/app.js", "Persistent full-text index", "admin search-index labels"],
  ["public/assets/app.js", "Request protection", "admin runtime labels"],
  ["public/assets/app.js", "Create the first administrator", "legacy account setup labels"],
  ["public/assets/app.js", "Follow translation language", "account watch labels"],
  ["public/assets/app.js", "globalThis.WikistI18n", "shared module localization gateway"],
  ["public/assets/app.js", "fixedUiText(item.label)", "navigation renders localized labels immediately"],
  ["public/assets/community-qa.js", "qa-question-copy\" data-i18n-skip", "question titles and summaries are protected"],
  ["public/assets/community-qa.js", "this.t =", "community module shares reviewed UI copy"],
  ["public/assets/community-qa.js", "data-i18n-skip><span>", "community item titles remain protected"],
  ["public/assets/community-qa.js", "this.state.uiLanguage === \"en\" ? \"en-US\"", "community dates follow the selected UI language"],
  ["public/assets/community-qa.js", "<h1 data-i18n-skip>", "question detail title is protected"],
  ["public/assets/selection-toolbar.js", "const EN_LABELS", "selection toolbar has local English labels"],
  ["public/passport/passport.js", "const PASSPORT_EN_MAP", "Passport uses exact reviewed translations"],
  ["public/passport/passport.js", "Identity verified. Opening Account Center", "Passport status labels"],
  ["public/assets/install.js", "const INSTALL_EN_MAP", "installer uses exact reviewed translations"],
  ["public/assets/install.js", "Public address:", "installer dynamic deployment status"],
];

for (const [file, needle, description] of checks) {
  if (!read(file).includes(needle)) throw new Error(`Missing ${description}: ${file}`);
}

console.log(`English UI localization checks passed (${checks.length}).`);
