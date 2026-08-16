const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");
const { seedTestAccount } = require("./legacy-test-fixtures");

const dbPath = path.join(process.cwd(), "data", "wikist-favorite-test.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(`${dbPath}${suffix}`); } catch (_error) {}
}

const store = new PassportStore(process.cwd(), { enabled: true, database: dbPath });
const account = seedTestAccount(store, {
  username: "favorite_user",
  displayName: "Favorite User",
  email: "favorite@example.com",
});
const session = { user: account.user };

const first = store.setPageFavorite(session, { slug: "abstract-algebra", title: "Abstract Algebra" }, true);
const duplicate = store.setPageFavorite(session, { slug: "abstract-algebra", title: "Abstract Algebra Updated" }, true);
const updatedTitle = store.listUserFavorites(account.user.id, { limit: 10 })[0]?.pageTitle;
const removed = store.setPageFavorite(session, { slug: "abstract-algebra", title: "Abstract Algebra" }, false);
for (let index = 0; index < 12; index += 1) {
  store.setPageFavorite(session, { slug: `page-${index}`, title: `Page ${index}` }, true);
}
const profile = store.getUserProfile(account.user.id);
const publicState = store.pageFavoriteState(null, "page-11");
const checks = {
  firstFavorite: first.favorited && first.count === 1,
  duplicateIsIdempotent: duplicate.count === 1 && updatedTitle === "Abstract Algebra Updated",
  removeFavorite: !removed.favorited && removed.count === 0,
  profileIsLimited: profile.favorites.length === 10 && profile.stats.favorites === 12,
  newestFirst: profile.favorites[0]?.pageSlug === "page-11",
  publicCountIsAvailable: !publicState.favorited && publicState.count === 1,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
store.db.close();
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(`${dbPath}${suffix}`); } catch (_error) {}
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks, profile, publicState }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, favorites: profile.stats.favorites }, null, 2));
