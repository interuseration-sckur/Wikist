<?php

$root = dirname(__DIR__, 2);
$testRoot = $root . '/data/.tmp-messaging-check-' . getmypid() . '-' . bin2hex(random_bytes(4));
$database = $testRoot . '/wikist.sqlite';
$attachments = $testRoot . '/attachments';
@mkdir($testRoot, 0770, true);
putenv('WIKIST_DB_DRIVER=sqlite');
putenv('WIKIST_DB_DATABASE=' . $database);
putenv('WIKIST_CONTENT_ROOT=' . $root);
putenv('MESSAGING_ATTACHMENT_ROOT=' . $attachments);
putenv('CENTRIFUGO_ENABLED=false');

chdir(dirname(__DIR__));
require 'vendor/autoload.php';
require 'support/bootstrap.php';

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\MessagingRepository;
use app\service\CentrifugoTokenService;
use app\service\MessagingAttachmentService;
use app\service\MessagingPermissionService;
use app\service\MessagingService;
use Webman\Http\UploadFile;

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
        ['carol', 'carol@example.test', 'Carol', 'member'],
        ['dave', 'dave@example.test', 'Dave', 'member'],
    ] as $user) {
        $insertUser->execute([
            $user[0], $user[1], $user[2], 'test', '', $user[3], 'active', '', '', '{}', '', $now,
            '', 0, '', '[]', $now, $now, $now, $now, $now,
        ]);
    }
    $pdo->exec("UPDATE users SET bio = '研究有限群与表示论。', social_links_json = '{\"website\":\"https://example.test/bob\",\"github\":\"https://github.com/example\"}' WHERE id = 2");
    $pdo->exec("INSERT INTO writing_organizations (slug,name,description,description_md,hero_image,avatar_image,focus_json,visibility,review_threshold,status,created_by,created_at,updated_at) VALUES ('algebra-lab','代数学协作组','测试组织','','','','[]','public',2,'active',1,'{$now}','{$now}')");
    $pdo->exec("INSERT INTO organization_members (organization_id,user_id,role,status,intro,joined_at,updated_at) VALUES (1,1,'owner','active','','{$now}','{$now}'),(1,2,'member','active','','{$now}','{$now}'),(1,4,'member','active','','{$now}','{$now}')");

    $alice = new UserIdentity(1, 'alice', 'alice@example.test', 'Alice', 'admin', 'active');
    $bob = new UserIdentity(2, 'bob', 'bob@example.test', 'Bob', 'member', 'active');
    $carol = new UserIdentity(3, 'carol', 'carol@example.test', 'Carol', 'member', 'active');
    $dave = new UserIdentity(4, 'dave', 'dave@example.test', 'Dave', 'member', 'active');
    $service = new MessagingService();

    (new MessagingPermissionService())->synchronize($alice);
    (new MessagingPermissionService())->synchronize($bob);
    $direct = $service->startDirect($alice, 2);
    $assert($direct['kind'] === 'direct' && $direct['peer']['username'] === 'bob', 'Direct conversation was not created correctly.');
    $assert($direct['peer']['bio'] === '研究有限群与表示论。', 'Direct peer biography was not hydrated.');
    $assert(($direct['peer']['socialLinks']['website'] ?? '') === 'https://example.test/bob', 'Direct peer social links were not hydrated.');

    $initialPresence = $service->bootstrap($alice)['presence'];
    $assert(!in_array(2, array_column($initialPresence['online'], 'id'), true), 'A stored user session incorrectly implied realtime presence.');
    $bobPresence = $service->heartbeat($bob, [1, 2, 3], 'conversation:' . $direct['id'], 'test-bob-tab');
    $assert(in_array(2, array_column($bobPresence['online'], 'id'), true), 'Heartbeat did not mark the active user online.');
    $alicePresence = $service->heartbeat($alice, [2, 3], 'route:messages', 'test-alice-tab');
    $onlineIds = array_column($alicePresence['online'], 'id');
    $assert(in_array(2, $onlineIds, true) && !in_array(3, $onlineIds, true), 'Presence lookup did not distinguish active and inactive users.');
    $presenceRow = $pdo->query('SELECT last_context FROM messaging_user_presence WHERE user_id = 2')->fetchColumn();
    $assert($presenceRow === 'conversation:' . $direct['id'], 'Presence context was not persisted.');
    $pdo->exec("UPDATE messaging_user_presence SET last_seen_at = '2000-01-01T00:00:00+00:00' WHERE user_id = 2");
    $expiredPresence = $service->heartbeat($alice, [2], 'route:messages', 'test-alice-tab');
    $assert(!in_array(2, array_column($expiredPresence['online'], 'id'), true), 'Expired heartbeat still reported the user online.');
    $service->heartbeat($bob, [1], 'conversation:' . $direct['id'], 'test-bob-tab');
    $offline = $service->offline($bob, 'test-bob-tab');
    $assert($offline['offline'] === true, 'Closing the final browser presence lease did not mark the user offline.');
    $afterOffline = $service->heartbeat($alice, [2], 'route:messages', 'test-alice-tab');
    $assert(!in_array(2, array_column($afterOffline['online'], 'id'), true), 'Released browser presence lease still reported the user online.');
    $service->heartbeat($bob, [1], 'conversation:' . $direct['id'], 'test-bob-tab');

    $nonce = 'check-' . bin2hex(random_bytes(8));
    $message = $service->send($alice, $direct['id'], [
        'bodyMd' => '请看 {{ref:wiki_entry|home|首页}}，@bob。',
        'clientNonce' => $nonce,
    ]);
    $duplicate = $service->send($alice, $direct['id'], [
        'bodyMd' => '该内容不应重复写入。',
        'clientNonce' => $nonce,
    ]);
    $assert($message['id'] === $duplicate['id'], 'Message idempotency failed.');
    $requestLimitDenied = false;
    try {
        $service->send($alice, $direct['id'], [
            'bodyMd' => 'A second request must wait for the recipient.',
            'clientNonce' => 'direct-limit-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $requestLimitDenied = $error->errorCode() === 'direct_request_limit_reached';
    }
    $assert($requestLimitDenied, 'Closed direct messaging allowed a second message before the recipient replied.');
    $openPreferences = $service->updatePreferences($bob, ['openMode' => true]);
    $assert($openPreferences['openMode'] === true, 'Open direct messaging preference was not persisted.');
    $openMessage = $service->send($alice, $direct['id'], [
        'bodyMd' => 'Open mode permits this follow-up.',
        'clientNonce' => 'direct-open-' . bin2hex(random_bytes(8)),
    ]);
    $assert(($openMessage['status'] ?? '') === 'published', 'Open direct messaging did not permit the follow-up message.');
    $service->updatePreferences($bob, ['openMode' => false]);
    $assert(count($message['references']) === 1 && count($message['mentions']) === 1, 'References or mentions were not persisted.');
    $assert($message['references'][0]['id'] === 'home', 'Reference magic word was not resolved by the service.');
    $assert((new MessagingRepository())->unreadCount(2) >= 1, 'Recipient unread cursor was not updated.');

    $page = $service->messagePage($bob, $direct['id'], null, 20);
    $assert(count($page['items']) === 2, 'Message pagination returned an unexpected result.');
    $hidden = $service->hide($bob, $message['id']);
    $assert($hidden['ok'] === true && $hidden['unreadCount'] === 1, 'Per-user message hiding did not update the viewer unread count.');
    $assert(count($service->messagePage($bob, $direct['id'], null, 20)['items']) === 1, 'Hidden message is still visible to the viewer.');
    $assert(count($service->messagePage($alice, $direct['id'], null, 20)['items']) === 2, 'Per-user hiding leaked into the sender view.');
    $assert((int) $pdo->query("SELECT count(*) FROM messaging_messages WHERE public_id = '{$message['id']}'")->fetchColumn() === 1, 'Soft-hidden message was physically deleted.');
    $service->markRead($bob, $direct['id'], $openMessage['cursor']);
    $assert((new MessagingRepository())->unreadCount(2) === 0, 'Mark-read did not advance the recipient cursor.');
    $readMessage = $service->messagePage($alice, $direct['id'], null, 20)['items'][0] ?? [];
    $assert((int) ($readMessage['readByCount'] ?? 0) === 1, 'Realtime read-receipt count was not derived from member cursors.');

    $bobMessage = $service->send($bob, $direct['id'], [
        'bodyMd' => '管理员也不能替发送者撤回。',
        'clientNonce' => 'sender-only-' . bin2hex(random_bytes(8)),
    ]);
    $adminDenied = false;
    try {
        $service->withdraw($alice, $bobMessage['id']);
    } catch (ApiException $error) {
        $adminDenied = $error->status() === 403;
    }
    $assert($adminDenied, 'Administrator bypassed sender-only withdrawal permission.');
    $assert($service->withdraw($bob, $bobMessage['id'])['status'] === 'withdrawn', 'Sender could not withdraw within five minutes.');

    $autoReplyPreferences = $service->updatePreferences($dave, [
        'autoReplyEnabled' => true,
        'autoReplyText' => 'I am offline and will reply later.',
    ]);
    $assert($autoReplyPreferences['autoReplyEnabled'] === true, 'Auto-reply preference was not persisted.');
    $autoReplyConversation = $service->startDirect($alice, 4);
    $service->send($alice, $autoReplyConversation['id'], [
        'bodyMd' => 'Trigger the offline auto reply.',
        'clientNonce' => 'auto-reply-' . bin2hex(random_bytes(8)),
    ]);
    $autoReplyMessages = $service->messagePage($alice, $autoReplyConversation['id'], null, 20)['items'];
    $assert(count($autoReplyMessages) === 2, 'Offline auto reply was not inserted into the conversation.');
    $autoReply = $autoReplyMessages[1] ?? [];
    $assert((int) ($autoReply['sender']['id'] ?? 0) === 4 && !empty($autoReply['metadata']['autoReply']), 'Auto reply metadata or sender is invalid.');
    $autoReplyDidNotUnlock = false;
    try {
        $service->send($alice, $autoReplyConversation['id'], [
            'bodyMd' => 'An automatic response must not unlock another request.',
            'clientNonce' => 'auto-reply-limit-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $autoReplyDidNotUnlock = $error->errorCode() === 'direct_request_limit_reached';
    }
    $assert($autoReplyDidNotUnlock, 'An automatic reply incorrectly unlocked the direct-message request limit.');

    $expiredMessage = $service->send($bob, $direct['id'], [
        'bodyMd' => '这条消息用于验证五分钟窗口。',
        'clientNonce' => 'expired-' . bin2hex(random_bytes(8)),
    ]);
    $expiredAt = gmdate('c', time() - 301);
    $pdo->prepare('UPDATE messaging_messages SET created_at = ? WHERE public_id = ?')->execute([$expiredAt, $expiredMessage['id']]);
    $expiredDenied = false;
    try {
        $service->withdraw($bob, $expiredMessage['id']);
    } catch (ApiException $error) {
        $expiredDenied = $error->status() === 409;
    }
    $assert($expiredDenied, 'Message older than five minutes was still withdrawable.');

    $uploadPath = $testRoot . '/attachment.txt';
    file_put_contents($uploadPath, 'Wikist messaging attachment');
    $attachment = (new MessagingAttachmentService())->store(
        $alice,
        new UploadFile($uploadPath, 'proof-note.txt', 'text/plain', UPLOAD_ERR_OK),
    );
    $attachmentMessage = $service->send($alice, $direct['id'], [
        'bodyMd' => '附件中的证明草稿。',
        'clientNonce' => 'attach-' . bin2hex(random_bytes(8)),
        'attachmentIds' => [$attachment['id']],
    ]);
    $assert(count($attachmentMessage['attachments']) === 1, 'Attachment was not bound to the message.');
    $authorized = (new MessagingAttachmentService())->authorize($bob, $attachment['id']);
    $assert(is_file($authorized['path']), 'Conversation member could not access attachment.');

    $organization = $service->organizationConversation($bob, 1);
    $assert($organization['kind'] === 'organization', 'Organization conversation was not created.');
    $organizationConversationStatement = $pdo->prepare('SELECT id FROM messaging_conversations WHERE public_id = ? LIMIT 1');
    $organizationConversationStatement->execute([$organization['id']]);
    $organizationConversationId = (int) $organizationConversationStatement->fetchColumn();
    $organizationConversationStatement->closeCursor();
    $assert($organizationConversationId > 0, 'Organization conversation storage row was not found.');
    $latestModerationEvent = static function () use ($pdo, $organizationConversationId): array {
        $statement = $pdo->prepare("SELECT body_plain, metadata_json FROM messaging_messages WHERE conversation_id = ? AND message_type = 'system' AND metadata_json LIKE '%conversation_moderation%' ORDER BY id DESC LIMIT 1");
        $statement->execute([$organizationConversationId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : [];
    };
    $memberPage = $service->members($bob, $organization['id'], 1, 1);
    $assert($memberPage['total'] === 3 && count($memberPage['items']) === 1 && $memberPage['pages'] === 3, 'Organization members were not paginated.');
    $siteConversation = (new MessagingRepository())->findConversationByKey('system:site');
    $siteMembers = $service->members($bob, (string) $siteConversation->public_id, 1, 12);
    $assert($siteMembers['private'] === true && $siteMembers['items'] === [] && $siteMembers['total'] >= 2, 'Site-wide conversation exposed subscriber identities.');
    $repository = new MessagingRepository();
    $oldAnnouncementAt = gmdate('c', time() - 3600);
    $oldAnnouncementId = $repository->insertMessage([
        'conversationId' => (int) $siteConversation->id,
        'senderUserId' => 1,
        'senderName' => 'Alice',
        'messageType' => 'system',
        'bodyMd' => '注册前公告',
        'bodyPlain' => '注册前公告',
        'clientNonce' => '',
        'priority' => 'normal',
        'createdAt' => $oldAnnouncementAt,
    ]);
    $repository->updateConversationAfterMessage((int) $siteConversation->id, $oldAnnouncementId, $oldAnnouncementAt);
    $lateRegisteredAt = gmdate('c', time() - 60);
    $insertUser->execute([
        'erin', 'erin@example.test', 'Erin', 'test', '', 'member', 'active', '', '', '{}', '', $lateRegisteredAt,
        '', 0, '', '[]', $lateRegisteredAt, $lateRegisteredAt, $lateRegisteredAt, $lateRegisteredAt, $lateRegisteredAt,
    ]);
    $erinId = (int) $pdo->lastInsertId();
    $erin = new UserIdentity($erinId, 'erin', 'erin@example.test', 'Erin', 'member', 'active', createdAt: $lateRegisteredAt);
    (new MessagingPermissionService())->synchronize($erin);
    $assert($repository->unreadCount($erinId) === 0, 'A newly registered user received historical site announcements as unread.');
    $baselineCursor = (int) $pdo->query("SELECT last_read_message_id FROM messaging_conversation_members WHERE conversation_id = {$siteConversation->id} AND user_id = {$erinId}")->fetchColumn();
    $assert($baselineCursor === $oldAnnouncementId, 'The site-announcement registration baseline was not persisted as a cursor.');
    $newAnnouncementAt = gmdate('c', time() + 1);
    $newAnnouncementId = $repository->insertMessage([
        'conversationId' => (int) $siteConversation->id,
        'senderUserId' => 1,
        'senderName' => 'Alice',
        'messageType' => 'system',
        'bodyMd' => '注册后公告',
        'bodyPlain' => '注册后公告',
        'clientNonce' => '',
        'priority' => 'normal',
        'createdAt' => $newAnnouncementAt,
    ]);
    $repository->updateConversationAfterMessage((int) $siteConversation->id, $newAnnouncementId, $newAnnouncementAt);
    $assert($repository->unreadCount($erinId) === 1, 'A newly registered user did not receive a later site announcement as unread.');
    $systemReadOnly = false;
    try {
        $service->send($alice, (string) $siteConversation->public_id, [
            'bodyMd' => '系统通知不应从聊天输入框回复。',
            'clientNonce' => 'system-readonly-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $systemReadOnly = $error->errorCode() === 'system_conversation_read_only';
    }
    $assert($systemReadOnly, 'Administrator could reply through the system-notification conversation.');
    $service->send($bob, $organization['id'], [
        'bodyMd' => '组织群聊测试。',
        'clientNonce' => 'org-' . bin2hex(random_bytes(8)),
        'references' => [['type' => 'organization', 'id' => '1']],
    ]);
    $service->organizationConversation($dave, 1);
    $presenceLeaseBeforeModeration = (string) $pdo->query("SELECT last_seen_at FROM messaging_presence_leases WHERE user_id = 2 AND client_id = 'test-bob-tab'")->fetchColumn();
    $promoted = $service->updateOrganizationMemberRole($alice, $organization['id'], 2, ['role' => 'admin']);
    $assert($promoted['role'] === 'admin', 'Organization owner could not promote a chat administrator.');
    $service->updateOrganizationMemberMute($bob, $organization['id'], 4, [
        'muted' => true,
        'durationMinutes' => 60,
        'reason' => 'Regression check',
    ]);
    $memberMuteDenied = false;
    try {
        $service->send($dave, $organization['id'], [
            'bodyMd' => 'Muted members must not send messages.',
            'clientNonce' => 'org-muted-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $memberMuteDenied = $error->errorCode() === 'organization_chat_member_muted';
    }
    $assert($memberMuteDenied, 'A muted organization member sent a message.');
    $service->updateOrganizationMemberMute($bob, $organization['id'], 4, ['muted' => false]);
    $service->updateOrganizationModeration($bob, $organization['id'], ['allMuted' => true]);
    $muteEvent = $latestModerationEvent();
    $muteMetadata = json_decode((string) ($muteEvent['metadata_json'] ?? '{}'), true);
    $assert(str_contains((string) ($muteEvent['body_plain'] ?? ''), '开启了全员禁言'), 'All-member mute did not create a visible timeline event.');
    $assert(($muteMetadata['source'] ?? '') === 'conversation_moderation' && ($muteMetadata['allMuted'] ?? null) === true, 'All-member mute timeline metadata was not persisted.');
    $presenceLeaseAfterModeration = (string) $pdo->query("SELECT last_seen_at FROM messaging_presence_leases WHERE user_id = 2 AND client_id = 'test-bob-tab'")->fetchColumn();
    $assert($presenceLeaseAfterModeration === $presenceLeaseBeforeModeration, 'Organization moderation mutated the actor presence lease.');
    $organizationPresence = $service->presence($bob, $organization['id']);
    $assert(in_array(2, array_column($organizationPresence['online'], 'id'), true), 'All-member mute incorrectly marked the moderator offline.');
    $allMuteDenied = false;
    try {
        $service->send($dave, $organization['id'], [
            'bodyMd' => 'Members must not bypass all-member mute.',
            'clientNonce' => 'org-all-muted-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $allMuteDenied = $error->errorCode() === 'organization_chat_all_muted';
    }
    $assert($allMuteDenied, 'A member bypassed organization all-member mute.');
    $adminMessage = $service->send($bob, $organization['id'], [
        'bodyMd' => 'Organization administrators may speak during all-member mute.',
        'clientNonce' => 'org-admin-muted-' . bin2hex(random_bytes(8)),
    ]);
    $assert(($adminMessage['status'] ?? '') === 'published', 'Organization administrator was incorrectly blocked by all-member mute.');
    $service->updateOrganizationModeration($bob, $organization['id'], ['allMuted' => false]);
    $unmuteEvent = $latestModerationEvent();
    $unmuteMetadata = json_decode((string) ($unmuteEvent['metadata_json'] ?? '{}'), true);
    $assert(str_contains((string) ($unmuteEvent['body_plain'] ?? ''), '解除了全员禁言'), 'All-member unmute did not create a visible timeline event.');
    $assert(($unmuteMetadata['source'] ?? '') === 'conversation_moderation' && ($unmuteMetadata['allMuted'] ?? null) === false, 'All-member unmute timeline metadata was not persisted.');

    $denied = false;
    try {
        $service->conversation($carol, $organization['id']);
    } catch (ApiException $error) {
        $denied = $error->status() === 403;
    }
    $assert($denied, 'Organization permission was not inherited from Wikist membership.');

    $carolDirect = $service->startDirect($alice, 3);
    $pdo->exec("UPDATE users SET status = 'disabled' WHERE id = 3");
    $bannedDenied = false;
    try {
        $service->send($alice, $carolDirect['id'], [
            'bodyMd' => '这条消息不应发送给被封禁用户。',
            'clientNonce' => 'banned-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $bannedDenied = $error->errorCode() === 'direct_recipient_banned';
    }
    $assert($bannedDenied, 'A direct message was sent to a banned recipient.');
    $pdo->exec('DELETE FROM users WHERE id = 3');
    $deletedDenied = false;
    try {
        $service->send($alice, $carolDirect['id'], [
            'bodyMd' => '这条消息不应发送给已删除用户。',
            'clientNonce' => 'deleted-' . bin2hex(random_bytes(8)),
        ]);
    } catch (ApiException $error) {
        $deletedDenied = $error->errorCode() === 'direct_recipient_deleted';
    }
    $assert($deletedDenied, 'A direct message was sent to a deleted recipient.');

    $withdrawn = $service->withdraw($alice, $message['id']);
    $assert($withdrawn['status'] === 'withdrawn' && $withdrawn['bodyMd'] === '', 'Message withdrawal failed.');
    $token = (new CentrifugoTokenService())->connectionToken($bob);
    $assert($token['token'] !== '' && in_array('organization:1:activity', $token['channels'], true), 'Centrifugo connection token lacks organization channels.');
    $outboxCount = (int) $pdo->query('SELECT count(*) FROM messaging_outbox_events')->fetchColumn();
    $assert($outboxCount >= 6, 'Domain events were not written to the outbox.');

    echo "Unified messaging checks passed.\n";
} finally {
    $removeTree($testRoot);
}
