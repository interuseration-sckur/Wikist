const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PageStore } = require("../src/core/page-store");
const { PassportStore } = require("../src/core/passport-store");

const tempRoot = path.join(process.cwd(), "data", "wikist-v10-community-test");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "server", "app.js"), "utf8");

function removeTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

function request() {
  return { headers: { cookie: "", "user-agent": "wikist-v10-community-test" }, socket: { remoteAddress: "127.0.0.1" } };
}

function captcha(store) {
  const item = store.createCaptcha();
  const row = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(item.id);
  const match = row.question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = match[2] === "+" ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
  return { captchaId: item.id, captchaAnswer: String(answer) };
}

function register(store, username) {
  return store.register({
    username,
    displayName: username.replace(/_/g, " "),
    email: `${username}@example.com`,
    password: "Passw0rd!",
    ...captcha(store),
  }, request()).user;
}

removeTempRoot();
fs.mkdirSync(tempRoot, { recursive: true });

let passport = null;
try {
  const pages = new PageStore(tempRoot, {});
  passport = new PassportStore(tempRoot, { database: "data/v10-community.sqlite" });
  const owner = register(passport, "v10_owner");
  const reviewer = register(passport, "v10_reviewer");
  const translator = register(passport, "v10_translator");
  const reader = register(passport, "v10_reader");
  const ownerSession = { user: passport.getUserProfile(owner.id) };
  const reviewerSession = { user: passport.getUserProfile(reviewer.id) };
  const translatorSession = { user: passport.getUserProfile(translator.id) };
  const readerSession = { user: passport.getUserProfile(reader.id) };
  const source = pages.savePage("community-algebra", {
    title: "社区代数",
    summary: "用于验证组织写作与社区审阅。",
    body: "群论研究满足结合律的代数结构。\n\n社区审阅应当形成可追溯的稳定结论。",
  });
  const organization = passport.createOrganization(ownerSession, {
    slug: "algebra-commons",
    name: "代数协作社",
    description: "共同维护代数词条、译文和审阅任务。",
    focus: "抽象代数，群论，英文翻译",
    reviewThreshold: 2,
  });
  const joinedReviewer = passport.joinOrganization(reviewerSession, organization.slug, { intro: "愿意参与来源核验和版本审阅。" });
  passport.joinOrganization(translatorSession, organization.slug, {});
  passport.updateOrganizationMember(ownerSession, organization.slug, reviewer.id, { role: "reviewer", status: "active" });
  passport.updateOrganizationMember(ownerSession, organization.slug, translator.id, { role: "translator", status: "active" });
  const writeTask = passport.createOrganizationTask(ownerSession, organization.slug, { taskType: "write", pageSlug: source.slug, title: "补充基础定义", summary: "补全代数定义与来源。" });
  const claimedTask = passport.claimOrganizationTask(translatorSession, writeTask.id);
  const pageReviewTask = passport.createOrganizationTask(ownerSession, organization.slug, { taskType: "review", pageSlug: source.slug, title: "社区审阅当前版本", summary: "两位审阅者完成可核验检查。" });
  const translationReviewTask = passport.createOrganizationTask(ownerSession, organization.slug, { taskType: "review", pageSlug: source.slug, language: "en", title: "英文译文社区审阅", summary: "核对术语与段落对应。" });
  const post = passport.createOrganizationPost(ownerSession, organization.slug, { postType: "discussion", title: "群论术语的英文表达", bodyMd: "请核对 **group** 与相关记法。", pageSlug: source.slug, language: "en" });
  const reply = passport.replyToOrganizationPost(reviewerSession, post.id, { contentMd: "建议同时检查同态与子群术语。" });
  const pageVoteOne = passport.submitCommunityReview(ownerSession, "page", source.slug, { organizationId: organization.id, revisionId: source.revisionId, decision: "approve", comment: "结构和来源范围已核对。" });
  const pageVoteTwo = passport.submitCommunityReview(reviewerSession, "page", source.slug, { organizationId: organization.id, revisionId: source.revisionId, decision: "approve", comment: "同意建立稳定版本。" });
  pages.snapshotCurrentForReview(source.slug, source.revisionId);
  const pageFinal = passport.finalizeCommunityPageReview(reviewerSession, source, { organizationId: organization.id, decision: pageVoteTwo.reachedDecision, comment: "两位组织审阅者通过。" });
  passport.joinTranslatorCommunity(translatorSession, { languages: ["en"] });
  const translation = passport.saveTranslation(translatorSession, source.slug, source, {
    language: "en",
    title: "Community algebra",
    summary: "A translation prepared by the algebra commons.",
    translatedMd: "Group theory studies algebraic structures with associative composition.\n\nCommunity review should create a traceable stable conclusion.",
  });
  const reviewerDraft = passport.getReadableTranslation(source.slug, "en", reviewerSession, { workspace: true });
  const translationVoteOne = passport.submitCommunityReview(ownerSession, "translation", source.slug, { organizationId: organization.id, language: "en", revisionId: translation.updatedAt, decision: "approve", comment: "术语通过。" });
  const translationVoteTwo = passport.submitCommunityReview(reviewerSession, "translation", source.slug, { organizationId: organization.id, language: "en", revisionId: translation.updatedAt, decision: "approve", comment: "段落对应通过。" });
  const translationFinal = passport.finalizeCommunityTranslationReview(reviewerSession, source.slug, "en", { organizationId: organization.id, decision: translationVoteTwo.reachedDecision, revisionId: translation.updatedAt, comment: "两位组织审阅者通过。" });
  const pageSnapshot = passport.communityReviewSnapshot(reviewerSession, "page", source.slug, "", source.revisionId);
  const translationSnapshot = passport.communityReviewSnapshot(reviewerSession, "translation", source.slug, "en", translation.updatedAt);
  const tasks = passport.listOrganizationTasks(reviewerSession, organization.slug, { limit: 20, offset: 0 });
  const posts = passport.listOrganizationPosts(reviewerSession, organization.slug, { limit: 20, offset: 0 });
  const replies = passport.listOrganizationPostReplies(reviewerSession, post.id, { limit: 20, offset: 0 });
  let readerDenied = false;
  try {
    passport.submitCommunityReview(readerSession, "page", source.slug, { organizationId: organization.id, revisionId: source.revisionId, decision: "approve" });
  } catch (error) {
    readerDenied = error.statusCode === 403;
  }

  const checks = {
    ownerAndRolesPersist: passport.organizationMembership(organization.id, owner.id)?.role === "owner"
      && joinedReviewer.membership.status === "active"
      && passport.organizationMembership(organization.id, reviewer.id)?.role === "reviewer",
    tasksCanBeCreatedAndClaimed: claimedTask.assigneeUserId === translator.id && tasks.total === 3 && tasks.items.some((task) => task.id === pageReviewTask.id && task.canReview),
    threadedDiscussionPersists: posts.total === 1 && replies.total === 1 && reply.authorUserId === reviewer.id,
    pageConsensusCreatesStableRevision: !pageVoteOne.reachedDecision && pageVoteTwo.reachedDecision === "approve" && pageFinal.finalized && pageFinal.review.isCurrentStable,
    translationConsensusPublishes: !translationVoteOne.reachedDecision && translationVoteTwo.reachedDecision === "approve" && translationFinal.finalized && translationFinal.translation.status === "published",
    communityReviewerCanInspectDraft: reviewerDraft?.id === translation.id,
    snapshotsExposeVotes: pageSnapshot.organizations[0].approve === 2 && pageSnapshot.organizations[0].finalized?.decision === "approve"
      && translationSnapshot.organizations[0].approve === 2 && translationSnapshot.organizations[0].finalized?.decision === "approve",
    ordinaryReaderCannotReview: readerDenied,
    serverRoutesPresent: appSource.includes("/api/community/organizations") && appSource.includes("community-review") && appSource.includes("organizationPostPayload"),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepStrictEqual(failed, [], `v0.10 community checks failed: ${failed.join(", ")}`);
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, organization: organization.slug, tasks: tasks.total }, null, 2));
} finally {
  try { passport?.db.close(); } catch (_error) {}
  removeTempRoot();
}
