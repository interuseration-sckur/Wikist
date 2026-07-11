const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");
const { PageStore } = require("../src/core/page-store");
const { buildLineDiff } = require("../src/core/revision-review");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "server", "app.js"), "utf8");

const tempRoot = path.join(process.cwd(), "data", "wikist-review-test");

function request() {
  return {
    headers: { cookie: "", "user-agent": "wikist-review-test" },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function captcha(store) {
  const item = store.createCaptcha();
  const row = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(item.id);
  const match = row.question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = match[2] === "+" ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
  return { captchaId: item.id, captchaAnswer: String(answer) };
}

fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
fs.mkdirSync(tempRoot, { recursive: true });

let passport = null;
try {
  const pages = new PageStore(tempRoot, {});
  passport = new PassportStore(tempRoot, { database: "data/review.sqlite" });
  const admin = passport.register({
    username: "review_admin",
    displayName: "Review Admin",
    email: "review-admin@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const member = passport.register({
    username: "review_member",
    displayName: "Review Member",
    email: "review-member@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const adminSession = { user: passport.getUserProfile(admin.id) };
  const memberSession = { user: passport.getUserProfile(member.id) };

  const first = pages.savePage("review-lab", {
    title: "Review Lab",
    body: "# Definition\n\nThe stable statement.",
  });
  const snapshot = pages.snapshotCurrentForReview(first.slug, first.revisionId);
  const approved = passport.recordPageReview(adminSession, first, { decision: "approve", comment: "Definition and source framing checked." });
  const stable = pages.getReviewedSnapshot(first.slug, approved.stableRevisionId);

  const current = pages.savePage("review-lab", {
    title: "Review Lab",
    body: "# Definition\n\nThe current statement has one extra sentence.\n\n## Example\n\nA pending example.",
  });
  const pending = passport.getPageReview(current.slug, current.revisionId);
  const states = passport.getPageReviewStates([current, { slug: "never-reviewed", revisionId: "2026-07-11T08-00-00-000Z" }]);
  const changed = passport.recordPageReview(adminSession, current, { decision: "changes_requested", comment: "Please verify the new example." });
  const notes = passport.listPageReviewNotes(current.slug, { limit: 10, offset: 0 });
  const diff = buildLineDiff(stable.body, current.body);
  let memberBlocked = false;
  try {
    passport.recordPageReview(memberSession, current, { decision: "approve" });
  } catch (_error) {
    memberBlocked = true;
  }
  let memberCannotWithdraw = false;
  try {
    passport.withdrawPageReview(memberSession, current, notes[0].id);
  } catch (_error) {
    memberCannotWithdraw = true;
  }
  const withdrawnChange = passport.withdrawPageReview(adminSession, current, notes[0].id);
  const notesAfterChangeWithdrawal = passport.listPageReviewNotes(current.slug, { limit: 10, offset: 0 });
  const withdrawnApproval = passport.withdrawPageReview(adminSession, current, notesAfterChangeWithdrawal[0].id);
  const reviewAfterApprovalWithdrawal = passport.getPageReview(current.slug, current.revisionId);

  const checks = {
    snapshotCreated: Boolean(snapshot?.revisionId) && stable?.body.includes("stable statement"),
    approvedCurrentIsStable: approved.isCurrentStable && approved.hasStable,
    postEditIsPending: pending.pending && pending.stableRevisionId === first.revisionId && current.revisionId !== first.revisionId,
    neverReviewedStateKeepsSlug: states.some((item) => item.pageSlug === "never-reviewed" && item.pending && !item.hasStable),
    changeRequestDoesNotMoveStable: changed.stableRevisionId === first.revisionId && changed.pending,
    notesRecorded: notes.length === 2 && notes[0].decision === "changes_requested" && notes[1].decision === "approve",
    diffIncludesBothSides: diff.some((item) => item.type === "remove") && diff.some((item) => item.type === "add"),
    memberCannotReview: memberBlocked,
    memberCannotWithdraw,
    withdrawnChangeKeepsStable: withdrawnChange.withdrawn.decision === "changes_requested" && !withdrawnChange.stableChanged && withdrawnChange.review.stableRevisionId === first.revisionId,
    withdrawnApprovalClearsStable: withdrawnApproval.withdrawn.decision === "approve" && withdrawnApproval.stableChanged && !reviewAfterApprovalWithdrawal.hasStable,
    withdrawalRoutePrecedesPageDelete: appSource.indexOf("const pageReviewNoteMatch") < appSource.indexOf('if (pathname.startsWith("/api/pages/") && req.method === "DELETE")'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepStrictEqual(failed, [], `Review checks failed: ${failed.join(", ")}`);
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, stableRevisionId: approved.stableRevisionId }, null, 2));
} finally {
  try { passport?.db.close(); } catch (_error) {}
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}
