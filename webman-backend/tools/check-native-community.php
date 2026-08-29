<?php

$root = dirname(__DIR__, 2);
$testRoot = $root . '/data/.tmp-native-community-' . getmypid() . '-' . bin2hex(random_bytes(4));
$database = $testRoot . '/wikist.sqlite';
@mkdir($testRoot, 0770, true);
putenv('WIKIST_DB_DRIVER=sqlite');
putenv('WIKIST_DB_DATABASE=' . $database);
putenv('WIKIST_CONTENT_ROOT=' . $root);
putenv('CENTRIFUGO_ENABLED=false');

chdir(dirname(__DIR__));
require 'vendor/autoload.php';
require 'support/bootstrap.php';

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\service\CommunityMarkdownService;
use app\service\CommunityQaService;
use app\service\AchievementService;

$removeTree = static function (string $path) use (&$removeTree): void {
    if (!is_dir($path)) {
        @unlink($path);
        return;
    }
    foreach (scandir($path) ?: [] as $name) {
        if ($name !== '.' && $name !== '..') {
            $removeTree($path . DIRECTORY_SEPARATOR . $name);
        }
    }
    @rmdir($path);
};

$assert = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};

try {
    $pdo = new PDO('sqlite:' . $database);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec((string) file_get_contents(dirname(__DIR__) . '/database/schema/wikist.sqlite.sql'));
    $nativeMigration = require dirname(__DIR__) . '/database/migrations/0010_native_community.php';
    $nativeMigration($pdo, 'sqlite');
    $invitationMigration = require dirname(__DIR__) . '/database/migrations/0011_community_answer_invites.php';
    $invitationMigration($pdo, 'sqlite');
    $quietReactionMigration = require dirname(__DIR__) . '/database/migrations/0012_quiet_reaction_activity.php';
    $quietReactionMigration($pdo, 'sqlite');
    $achievementMigration = require dirname(__DIR__) . '/database/migrations/0014_site_achievements.php';
    $achievementMigration($pdo, 'sqlite');
    $sourceMigration = require dirname(__DIR__) . '/database/migrations/0015_community_question_sources.php';
    $sourceMigration($pdo, 'sqlite');

    $now = gmdate('c');
    $insertUser = $pdo->prepare(
        'INSERT INTO users (username,email,display_name,password_hash,password_salt,role,status,bio,avatar_url,social_links_json,page_md,email_verified_at,two_factor_secret,two_factor_enabled,two_factor_confirmed_at,two_factor_recovery_json,last_security_at,created_at,updated_at,password_updated_at,last_sync_at) '
        . 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    foreach ([
        ['admin', 'admin@example.test', 'Admin', 'admin'],
        ['alice', 'alice@example.test', 'Alice', 'member'],
        ['bob', 'bob@example.test', 'Bob', 'member'],
        ['outsider', 'out@example.test', 'Outsider', 'member'],
    ] as $user) {
        $insertUser->execute([$user[0], $user[1], $user[2], 'test', '', $user[3], 'active', '', '', '{}', '', $now, '', 0, '', '[]', $now, $now, $now, $now, $now]);
    }
    $pdo->exec("INSERT INTO writing_organizations (slug,name,description,description_md,hero_image,avatar_image,focus_json,visibility,review_threshold,status,created_by,created_at,updated_at) VALUES ('open-lab','Open Lab','','','','','[]','public',2,'active',1,'{$now}','{$now}')");
    $pdo->exec("INSERT INTO organization_members (organization_id,user_id,role,status,intro,joined_at,updated_at) VALUES (1,1,'owner','active','','{$now}','{$now}'),(1,2,'member','active','','{$now}','{$now}'),(1,3,'reviewer','active','','{$now}','{$now}')");

    $admin = new UserIdentity(1, 'admin', 'admin@example.test', 'Admin', 'admin', 'active');
    $alice = new UserIdentity(2, 'alice', 'alice@example.test', 'Alice', 'member', 'active');
    $bob = new UserIdentity(3, 'bob', 'bob@example.test', 'Bob', 'member', 'active');
    $outsider = new UserIdentity(4, 'outsider', 'out@example.test', 'Outsider', 'member', 'active');
    $service = new CommunityQaService();

    $rendered = (new CommunityMarkdownService())->render(<<<'MD'
行内公式 $x^2+y^2=1$。

$$
\sum_{k=1}^{n} k
$$

::: warning 核验来源
请补充 DOI，并参考 [[group-theory|群论]]。
:::

| 对象 | 状态 |
| --- | --- |
| 定理 | 已证明 |

`$code-is-not-math$`

<script>alert(1)</script>
MD);
    $assert(str_contains($rendered, 'class="math-inline"') && str_contains($rendered, 'class="math-block"'), 'Community math was not preserved for MathJax.');
    $assert(str_contains($rendered, 'math-note-warning') && str_contains($rendered, '<table>'), 'Community extensions or GFM table rendering failed.');
    $assert(str_contains($rendered, '<code>$code-is-not-math$</code>'), 'Inline code was incorrectly treated as math.');
    $assert(!str_contains($rendered, '<script'), 'Unsafe Community HTML was not stripped.');

    $bootstrap = $service->bootstrap($alice);
    $assert($bootstrap['native'] === true && $bootstrap['sourceOfTruth'] === 'wikist' && $bootstrap['connected'] === true, 'Native Community did not become the primary path.');

    $public = $service->createQuestion($alice, [
        'title' => '有限群的拉格朗日定理如何证明？',
        'content' => '设 G 是有限群，H 是子群。如何从陪集分解严格推出 $|H|\mid|G|$？' . "\n\n" . '参考 [[group-theory|群论]]。',
        'tags' => ['群论', '拉格朗日定理'],
        'source' => [
            'type' => 'selection',
            'id' => 'selection-regression-1',
            'label' => '群论词条中的拉格朗日定理',
            'url' => '#/page/group-theory?selection=selection-regression-1',
            'selectedText' => '有限群子群的阶整除群的阶。',
            'pageSlug' => 'group-theory',
        ],
    ]);
    $questionId = (string) $public['question']['id'];
    $assert(str_starts_with($questionId, 'q-') && $public['object']['source'] === 'wikist', 'Question was not persisted as a Wikist-native object.');
    $assert(str_contains((string) $public['question']['bodyHtml'], 'class="math-inline"'), 'Question response did not include rendered Community HTML.');
    $assert((int) $pdo->query('SELECT count(*) FROM community_revisions')->fetchColumn() === 1, 'Initial question revision was not recorded.');
    $assert((int) $pdo->query("SELECT count(*) FROM community_follows WHERE user_id=2 AND object_type='question'")->fetchColumn() === 1, 'Question author was not subscribed.');
    $followPage = $service->follows($alice, 1, 20);
    $assert($followPage['total'] === 1 && $followPage['items'][0]['id'] === $questionId, 'Community follows were not exposed through the native paginated list.');
    $assert(($public['question']['origins'][0]['type'] ?? '') === 'selection', 'Question source snapshot was not persisted.');
    $sourceFiltered = $service->questions(['origin' => 'selection', 'page' => 1, 'limit' => 20], $outsider);
    $assert($sourceFiltered['total'] === 1 && $sourceFiltered['items'][0]['id'] === $questionId, 'Question source filtering did not return the selection-backed question.');

    $organizationQuestion = $service->createQuestion($alice, [
        'title' => '协作组织的有限群分类讨论',
        'content' => '这是一条公开展示、由组织成员共同维护的问题。',
        'tags' => ['群论'],
        'organization' => 'open-lab',
    ]);
    $organizationQuestionId = (string) $organizationQuestion['question']['id'];
    $assert($service->question($organizationQuestionId, $outsider)['question']['organization']['slug'] === 'open-lab', 'Organization question was not publicly readable.');
    $organizationReport = $service->report($alice, 'question', $organizationQuestionId, ['reason' => 'incorrect', 'details' => '组织审核测试。']);
    $assert($service->reports($bob, 'pending', 1, 20, 1)['items'][0]['id'] === $organizationReport['id'], 'Wikist reviewer role was not mapped to organization moderation.');
    $service->resolveReport($bob, $organizationReport['id'], ['status' => 'resolved', 'resolution' => '组织审阅者已处理。']);
    $assert($service->questions(['query' => '分类讨论'], $outsider)['total'] === 1, 'Organization question was missing from the public feed search.');

    $invitation = $service->inviteAnswer($alice, $questionId, ['username' => 'bob', 'message' => '请补充陪集证明。']);
    $assert($invitation['invitation']['status'] === 'pending', 'Answer invitation was not persisted.');
    $answer = $service->createAnswer($bob, $questionId, [
        'content' => '左陪集两两不交且每个陪集都与 H 等势，因此 G 被分成若干个大小为 |H| 的子集。',
    ]);
    $answerId = (string) $answer['answer']['id'];
    $assert(str_starts_with($answerId, 'a-'), 'Answer was not created with a native ID.');
    $service->updateAnswer($bob, $answerId, [
        'content' => 'A coset argument. {{ref:wiki_entry|abstract-algebra|Abstract Algebra}}',
        'summary' => 'Add a cited wiki entry.',
    ]);
    $knowledgeDetail = $service->question($questionId, $alice);
    $knowledgeObjects = array_column(array_column($knowledgeDetail['relations'], 'object'), 'key');
    $knowledgeTypes = array_column(array_column($knowledgeDetail['relations'], 'object'), 'type');
    $assert(in_array('abstract-algebra', $knowledgeObjects, true), 'References cited by answers were not surfaced on the question.');
    $assert(!in_array('answer', $knowledgeTypes, true), 'Answers leaked into the question knowledge-relation cards.');
    $assert($service->question($questionId, $alice)['question']['invitations']['items'][0]['status'] === 'accepted', 'Answering did not complete the invitation.');
    $duplicateDenied = false;
    try {
        $service->createAnswer($bob, $questionId, ['content' => '这是同一用户的第二个回答，应改为编辑原回答。']);
    } catch (ApiException $error) {
        $duplicateDenied = $error->errorCode() === 'community_answer_already_exists';
    }
    $assert($duplicateDenied, 'Duplicate-answer restriction did not run.');

    $vote = $service->vote($alice, 'answer', $answerId, 1);
    $assert($vote['voteCount'] === 1 && $vote['viewerVote'] === 1, 'Quality upvote was not persisted.');
    $voteCanceled = $service->vote($alice, 'answer', $answerId, 1);
    $assert($voteCanceled['voteCount'] === 0 && $voteCanceled['viewerVote'] === 0, 'Repeated quality vote did not toggle off.');
    $selfVoteDenied = false;
    try {
        $service->vote($bob, 'answer', $answerId, 1);
    } catch (ApiException $error) {
        $selfVoteDenied = $error->errorCode() === 'community_self_vote_forbidden';
    }
    $assert($selfVoteDenied, 'Self-vote protection did not run.');

    $reaction = $service->reaction($alice, 'answer', $answerId, 'insightful');
    $assert($reaction['active'] === true && $reaction['total'] === 1, 'Reaction was not stored independently from voting.');
    $helpful = $service->reaction($alice, 'answer', $answerId, 'helpful');
    $helpfulItem = array_values(array_filter($helpful['items'], static fn (array $item): bool => $item['reaction'] === 'helpful'))[0] ?? null;
    $assert($helpful['active'] === true && ($helpfulItem['count'] ?? 0) === 1, 'Helpful reaction count did not update immediately.');
    $helpfulCanceled = $service->reaction($alice, 'answer', $answerId, 'helpful');
    $assert($helpfulCanceled['active'] === false, 'Helpful reaction could not be toggled off.');
    $reactionActivityCount = (int) $pdo->query("SELECT count(*) FROM community_activity WHERE event_type LIKE '%.reaction.%'")->fetchColumn();
    $assert($reactionActivityCount === 0, 'Low-value reaction toggles leaked into the community activity stream.');
    $collection = $service->collection($alice, 'answer', $answerId, ['note' => '用于整理证明']);
    $assert($collection['active'] === true && $service->collections($alice, 1, 20)['total'] === 1, 'Community collection did not use the native store.');

    $comment = $service->createComment($alice, $answerId, ['objectType' => 'answer', 'content' => '请补充陪集映射为何是双射。']);
    $reply = $service->createComment($bob, $answerId, [
        'objectType' => 'answer',
        'content' => '可以使用左乘映射说明。',
        'replyToCommentId' => $comment['comment']['id'],
    ]);
    $assert(str_contains((string) $reply['comment']['bodyMd'], '@alice'), 'Flat comment reply did not add the target mention.');
    $commentPage = $service->comments('answer', $answerId, 1, 1, $alice);
    $assert($commentPage['total'] === 2 && count($commentPage['items']) === 1 && $commentPage['pages'] === 2, 'Comment pagination is invalid.');

    $accepted = $service->acceptAnswer($alice, $questionId, $answerId);
    $assert($accepted['accepted'] === true && $accepted['answer']['accepted'] === true, 'Answer acceptance was not persisted.');
    $detail = $service->question($questionId, $alice, 1, 'user:2');
    $assert($detail['question']['acceptedAnswerId'] === $answerId && $detail['answers']['total'] === 1, 'Question detail did not expose the accepted answer.');
    $unaccepted = $service->unacceptAnswer($alice, $questionId, $answerId);
    $assert($unaccepted['accepted'] === false && $service->question($questionId, $alice)['question']['acceptedAnswerId'] === '', 'Answer acceptance could not be revoked.');
    $service->acceptAnswer($alice, $questionId, $answerId);

    $beforeRevision = $service->revisions('question', $questionId, 1, 20, $alice)['items'][0]['id'];
    $service->updateQuestion($alice, $questionId, [
        'title' => '有限群的拉格朗日定理如何严格证明？',
        'content' => '通过左陪集划分与每个陪集到 H 的双射，可以得到群阶整除关系。',
        'tags' => ['群论', '拉格朗日定理'],
        'summary' => '补充双射步骤',
    ]);
    $revisions = $service->revisions('question', $questionId, 1, 20, $alice);
    $assert($revisions['total'] === 2, 'Question edit history was not recorded.');
    $diff = $service->revisionDiff('question', $questionId, $beforeRevision, $revisions['items'][0]['id'], $alice);
    $assert(count($diff['changes']) > 0, 'Revision diff returned no changes.');

    $proposal = $service->proposeQuestionRevision($outsider, $questionId, [
        'title' => '有限群拉格朗日定理的严格证明',
        'content' => '建议正文：先证明陪集等价关系，再证明左乘映射给出等势。',
        'tags' => ['群论', '拉格朗日定理'],
        'summary' => '社区补充建议',
    ]);
    $assert($proposal['queued'] === true && $proposal['revision']['status'] === 'pending', 'Community edit proposal did not enter review.');
    $review = $service->reviews($admin, 'pending', 1, 20, null);
    $assert($review['total'] === 1, 'Revision review queue is missing the proposal.');
    $service->decideReview($admin, $review['items'][0]['id'], ['status' => 'approved', 'opinion' => '结构更清晰。']);
    $assert(str_contains($service->question($questionId, $alice)['question']['bodyMd'], '等价关系'), 'Approved revision was not applied.');

    $report = $service->report($outsider, 'question', $questionId, ['reason' => 'incorrect', 'details' => '需要检查证明措辞。']);
    $reports = $service->reports($admin, 'pending', 1, 20, null);
    $assert($reports['total'] === 1 && $reports['items'][0]['id'] === $report['id'], 'Moderation report queue is incomplete.');
    $service->resolveReport($admin, $report['id'], ['status' => 'dismissed', 'resolution' => '属于可通过编辑解决的问题。']);
    $assert($service->reports($admin, 'pending', 1, 20, null)['total'] === 0, 'Resolved report remained in the pending queue.');

    $search = $service->search(['query' => '拉格朗日', 'page' => 1, 'limit' => 20], $outsider);
    $assert($search['total'] >= 1, 'Unified search missed public Community content.');
    $assert(count(array_filter($search['items'], static fn (array $item): bool => ($item['type'] ?? '') !== 'question')) === 0, 'Community search leaked answers, comments or auxiliary objects.');
    $service->setQuestionOpen($alice, $questionId, false, '回归测试关闭状态');
    $closedItems = $service->questions(['query' => '拉格朗日', 'page' => 1, 'limit' => 20], $outsider)['items'];
    $closedQuestion = array_values(array_filter($closedItems, static fn (array $item): bool => $item['id'] === $questionId))[0] ?? null;
    $assert(($closedQuestion['closed'] ?? false) === true, 'Closed questions disappeared from the public feed.');
    $service->setQuestionOpen($alice, $questionId, true, '回归测试恢复状态');
    $assert((int) $pdo->query("SELECT count(*) FROM knowledge_objects WHERE source_system='wikist' AND object_type IN ('question','answer','comment')")->fetchColumn() >= 4, 'Community objects were not synchronized into the knowledge graph.');
    $assert((int) $pdo->query("SELECT count(*) FROM messaging_messages WHERE message_type='system'")->fetchColumn() >= 1, 'Community events did not enter the unified notification service.');
    $achievementOverview = (new AchievementService())->overview($bob->id, 1, 12);
    $earnedAchievementSlugs = array_column(array_filter($achievementOverview['items'], static fn (array $item): bool => $item['earned']), 'slug');
    $assert(in_array('first-answer', $earnedAchievementSlugs, true), 'Community contribution did not enter the site-wide achievement domain.');
    $assert(in_array('organization-collaborator', $earnedAchievementSlugs, true), 'Organization membership did not enter the site-wide achievement domain.');
    $assert(($achievementOverview['summary']['earned'] ?? 0) >= 2, 'Achievement summary did not include earned milestones.');

    $cleanup = $service->createQuestion($alice, [
        'title' => '用于验证删除生态清理的问题',
        'content' => '这个问题只用于确认关注、收藏、投票和反应不会在软删除后残留。',
        'tags' => ['回归测试'],
    ]);
    $cleanupId = (string) $cleanup['question']['id'];
    $cleanupNumericId = (int) $cleanup['question']['numericId'];
    $service->collection($alice, 'question', $cleanupId, []);
    $service->follow($bob, 'question', $cleanupId, []);
    $service->reaction($bob, 'question', $cleanupId, 'helpful');
    $service->deleteQuestion($alice, $cleanupId);
    foreach (['community_votes', 'community_reactions', 'community_collections', 'community_follows'] as $engagementTable) {
        $count = (int) $pdo->query("SELECT count(*) FROM {$engagementTable} WHERE object_type='question' AND object_id={$cleanupNumericId}")->fetchColumn();
        $assert($count === 0, "Deleted question left rows in {$engagementTable}.");
    }
    $assert(!in_array($cleanupId, array_column($service->follows($bob, 1, 20)['items'], 'id'), true), 'Deleted question remained in the self-healing follow list.');

    echo "Native Community checks passed.\n";
} finally {
    $removeTree($testRoot);
}
