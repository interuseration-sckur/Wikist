<?php

$root = dirname(__DIR__, 2);
$testRoot = $root . '/data/.tmp-selection-check-' . getmypid() . '-' . bin2hex(random_bytes(4));
$database = $testRoot . '/wikist.sqlite';
@mkdir($testRoot, 0770, true);
putenv('WIKIST_DB_DRIVER=sqlite');
putenv('WIKIST_DB_DATABASE=' . $database);
putenv('WIKIST_CONTENT_ROOT=' . $root);

chdir(dirname(__DIR__));
require 'vendor/autoload.php';
require 'support/bootstrap.php';

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\service\KnowledgeObjectResolver;
use app\service\SelectionService;

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
    $now = gmdate('c');
    $insertUser = $pdo->prepare(
        'INSERT INTO users (username,email,display_name,password_hash,password_salt,role,status,bio,avatar_url,social_links_json,page_md,email_verified_at,two_factor_secret,two_factor_enabled,two_factor_confirmed_at,two_factor_recovery_json,last_security_at,created_at,updated_at,password_updated_at,last_sync_at) '
        . 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    foreach ([
        ['alice', 'alice@example.test', 'Alice', 'admin'],
        ['bob', 'bob@example.test', 'Bob', 'member'],
    ] as $user) {
        $insertUser->execute([
            $user[0], $user[1], $user[2], 'test', '', $user[3], 'active', '', '', '{}', '', $now,
            '', 0, '', '[]', $now, $now, $now, $now, $now,
        ]);
    }

    $alice = new UserIdentity(1, 'alice', 'alice@example.test', 'Alice', 'admin', 'active');
    $bob = new UserIdentity(2, 'bob', 'bob@example.test', 'Bob', 'member', 'active');
    $service = new SelectionService();
    $anchor = [
        'object' => ['type' => 'wiki_entry', 'id' => 'home', 'label' => '首页', 'url' => '#/page/home'],
        'selector' => ['exact' => '群是带有结合二元运算的集合。', 'prefix' => '在抽象代数中，', 'suffix' => '单位元与逆元由公理给出。', 'start' => 12, 'end' => 28],
    ];
    $created = $service->resolve($alice, $anchor + ['create' => true]);
    $selection = $created['selection'];
    $assert((int) $selection['id'] > 0, 'Selection anchor was not created.');
    $assert($selection['objectType'] === 'wiki_entry' && $selection['objectId'] === 'home', 'Selection object identity was not preserved.');
    $assert(!$selection['canDelete'], 'An unsubmitted selection exposed its delete action.');

    $duplicate = $service->resolve($bob, $anchor);
    $assert($duplicate['selection']['id'] === $selection['id'], 'Identical text anchors did not converge on one record.');
    $public = $service->resolve(null, $anchor);
    $assert($public['selection']['id'] === $selection['id'], 'Public annotation lookup could not read an existing anchor.');
    $shiftedAnchor = [
        'object' => $anchor['object'],
        'selector' => [
            'exact' => $anchor['selector']['exact'],
            'prefix' => '补充上下文后，' . $anchor['selector']['prefix'],
            'suffix' => $anchor['selector']['suffix'],
            'start' => 17,
            'end' => 33,
        ],
    ];
    $shiftedHash = hash('sha256', implode("\0", [
        'wiki_entry', 'home', $shiftedAnchor['selector']['exact'],
        $shiftedAnchor['selector']['prefix'], $shiftedAnchor['selector']['suffix'],
    ]));
    $insertShifted = $pdo->prepare(
        'INSERT INTO content_selections (object_type,object_id,object_label,object_url,selected_text,prefix_text,suffix_text,start_offset,end_offset,anchor_hash,creator_user_id,status,created_at,updated_at) '
        . 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $insertShifted->execute([
        'wiki_entry', 'home', '首页', '#/page/home', $shiftedAnchor['selector']['exact'],
        $shiftedAnchor['selector']['prefix'], $shiftedAnchor['selector']['suffix'], 17, 33,
        $shiftedHash, 2, 'active', $now, $now,
    ]);
    $shiftedId = (int) $pdo->lastInsertId();
    $pdo->prepare('INSERT INTO content_selection_likes (selection_id,user_id,created_at) VALUES (?,?,?)')
        ->execute([$shiftedId, 2, $now]);
    $converged = $service->resolve($bob, $shiftedAnchor + ['create' => true]);
    $assert($converged['selection']['id'] === $selection['id'], 'Equivalent anchors with shifted context were not consolidated.');
    $assert($service->detail($bob, $shiftedId)['selection']['id'] === $selection['id'], 'Merged selection ids did not redirect to their canonical anchor.');
    $unknown = $service->resolve(null, [
        'object' => ['type' => 'wiki_entry', 'id' => 'home', 'label' => '首页', 'url' => '#/page/home'],
        'selector' => ['exact' => '尚未被批注的正文', 'prefix' => '', 'suffix' => '', 'start' => 0, 'end' => 8],
    ]);
    $assert($unknown['selection'] === null, 'Anonymous lookup created a new selection record.');
    $unsubmittedDeleteDenied = false;
    try {
        $service->deleteSelection($alice, $selection['id']);
    } catch (ApiException $error) {
        $unsubmittedDeleteDenied = $error->status() === 403;
    }
    $assert($unsubmittedDeleteDenied, 'An unsubmitted selection was deletable by its anchor creator.');
    $unsubmitted = $service->resolve($bob, [
        'object' => ['type' => 'wiki_entry', 'id' => 'home', 'label' => '首页', 'url' => '#/page/home'],
        'selector' => ['exact' => '只打开但没有提交', 'prefix' => '', 'suffix' => '', 'start' => 60, 'end' => 68],
    ]);
    $assert($unsubmitted['selection'] === null, 'Opening the annotation dialog persisted an unsubmitted selection.');

    $comment = $service->addComment($bob, $selection['id'], ['bodyMd' => '这里应补充一个具体例子。']);
    $assert($comment['comment']['author']['username'] === 'bob', 'Selection comment author was not hydrated.');
    $secondComment = $service->addComment($bob, $selection['id'], [
        'bodyMd' => '也可以补充一个反例。',
        'replyToCommentId' => $comment['comment']['id'],
    ]);
    $assert($secondComment['comment']['replyTo']['username'] === 'bob', 'Selection comment reply target was not hydrated.');
    $likedView = $service->resolve($bob, $shiftedAnchor + ['create' => true]);
    $assert($likedView['comments']['pagination']['total'] === 2 && $likedView['selection']['liked'], 'Liked activity did not open the canonical annotations.');
    $assert($service->comments($shiftedId, 1, 20)['pagination']['total'] === 2, 'Merged selection routes did not expose canonical annotations.');
    $commentPage = $service->comments($selection['id'], 1, 1);
    $assert($commentPage['pagination']['total'] === 2 && $commentPage['pagination']['totalPages'] === 2, 'Selection comments were not paginated.');
    $liked = $service->setLike($bob, $selection['id'], ['liked' => true]);
    $assert($liked['liked'] && $liked['likeCount'] === 1, 'Selection like state was not persisted.');
    $quoted = $service->recordActivity($bob, $selection['id'], [
        'activityType' => 'quote', 'targetType' => 'comment', 'targetId' => 'home', 'targetLabel' => '首页评论',
    ]);
    $assert($quoted['activity']['targetType'] === 'comment', 'Selection quote destination was not persisted.');
    $mine = $service->mine($bob, 'liked', 1, 12);
    $assert(count($mine['items']) === 1 && $mine['items'][0]['activity']['type'] === 'like', 'Liked selection did not appear in My Selections.');
    $commentedMine = $service->mine($bob, 'commented', 1, 12);
    $assert(count($commentedMine['items']) === 2 && $commentedMine['items'][0]['activity']['type'] === 'comment', 'Published annotations did not appear in My Selections.');
    $personalPage = $service->mine($bob, 'all', 1, 2);
    $assert(count($personalPage['items']) === 2 && $personalPage['pagination']['total'] === 3 && $personalPage['pagination']['totalPages'] === 2, 'Personal selection activities were not paginated.');
    $assert(count(array_filter($personalPage['items'], static fn (array $item): bool => ($item['activity']['type'] ?? '') === 'quote')) === 0, 'Quote activity leaked into My Selections.');
    $assert(count($service->mine($alice, 'all', 1, 12)['items']) === 0, 'Creating or commenting on an anchor polluted the personal selection library.');
    $markers = $service->markers($bob, 'wiki_entry', 'home');
    $assert(count($markers['items']) === 1 && $markers['items'][0]['quoteCount'] === 1 && !$markers['items'][0]['canDelete'], 'Engaged selection marker permissions were not exposed correctly.');

    $selectionDeleteDenied = false;
    try {
        $service->deleteSelection($bob, $selection['id']);
    } catch (ApiException $error) {
        $selectionDeleteDenied = $error->status() === 403;
    }
    $assert($selectionDeleteDenied, 'A non-owner deleted another users selection anchor.');

    $denied = false;
    try {
        $service->deleteComment($alice = new UserIdentity(1, 'alice', 'alice@example.test', 'Alice', 'member', 'active'), $selection['id'], $comment['comment']['id']);
    } catch (ApiException $error) {
        $denied = $error->status() === 403;
    }
    $assert($denied, 'A non-owner member deleted another user selection comment.');
    $admin = new UserIdentity(1, 'alice', 'alice@example.test', 'Alice', 'admin', 'active');
    $service->deleteComment($admin, $selection['id'], $comment['comment']['id']);
    $assert($service->comments($selection['id'], 1, 20)['pagination']['total'] === 1, 'Deleted annotation remained visible or removed another annotation.');

    $soloAnchor = [
        'object' => ['type' => 'wiki_entry', 'id' => 'home', 'label' => '首页', 'url' => '#/page/home'],
        'selector' => ['exact' => '只属于 Bob 的划词', 'prefix' => '', 'suffix' => '', 'start' => 31, 'end' => 42],
    ];
    $solo = $service->resolve($bob, $soloAnchor + ['create' => true])['selection'];
    $service->setLike($bob, $solo['id'], ['liked' => true]);
    $assert($service->detail($bob, $solo['id'])['selection']['canDelete'], 'An engaged owned selection did not expose deletion.');
    $deletedSolo = $service->deleteSelection($bob, $solo['id']);
    $assert($deletedSolo['deleted'] && !$deletedSolo['preserved'], 'An unshared owned selection was not deleted.');
    $revivedSolo = $service->resolve($bob, $soloAnchor + ['create' => true])['selection'];
    $assert($revivedSolo['id'] === $solo['id'], 'A deleted anchor blocked the same text from being selected again.');
    $service->setLike($bob, $revivedSolo['id'], ['liked' => true]);
    $unlikedSolo = $service->setLike($bob, $revivedSolo['id'], ['liked' => false]);
    $assert($unlikedSolo['deleted'] && $unlikedSolo['likeCount'] === 0, 'The last unlike did not prune an empty selection anchor.');
    $assert($service->resolve($bob, $soloAnchor)['selection'] === null, 'A pruned empty selection remained readable.');
    $assert(count(array_filter(
        $service->markers($bob, 'wiki_entry', 'home')['items'],
        static fn (array $item): bool => (int) $item['id'] === (int) $revivedSolo['id'],
    )) === 0, 'A pruned empty selection remained visible in article markers.');

    $shared = $service->resolve($bob, [
        'object' => ['type' => 'wiki_entry', 'id' => 'home', 'label' => '首页', 'url' => '#/page/home'],
        'selector' => ['exact' => '共享划词', 'prefix' => '', 'suffix' => '', 'start' => 45, 'end' => 49],
        'create' => true,
    ])['selection'];
    $service->setLike($bob, $shared['id'], ['liked' => true]);
    $service->addComment($admin, $shared['id'], ['bodyMd' => '保留这条公共批注。']);
    $deletedShared = $service->deleteSelection($bob, $shared['id']);
    $preservedShared = $service->detail($admin, $shared['id'])['selection'];
    $assert($deletedShared['preserved'] && $preservedShared['creator']['username'] === 'alice', 'Deleting an owned shared anchor removed other users content.');
    $assert($service->comments($shared['id'], 1, 20)['pagination']['total'] === 1, 'Shared annotation was removed with the former owner.');

    $reference = (new KnowledgeObjectResolver())->resolve([
        'type' => 'selection', 'id' => (string) $selection['id'], 'relation' => 'quote',
    ]);
    $assert($reference['type'] === 'selection' && $reference['metadata']['quote'] === $selection['selectedText'], 'Selection knowledge reference was not resolved.');

    echo "OK    Selection anchors, flat replies, likes, private quote activities, deletion, pagination, markers, privacy and knowledge references passed.\n";
} finally {
    $removeTree($testRoot);
}
