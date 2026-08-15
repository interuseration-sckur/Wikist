<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\KnowledgeGraphRepository;
use app\repository\MessagingRepository;
use support\Log;

final class MessagingService
{
    public function __construct(
        private readonly MessagingRepository $messages = new MessagingRepository(),
        private readonly MessagingPermissionService $permissions = new MessagingPermissionService(),
        private readonly KnowledgeObjectResolver $objects = new KnowledgeObjectResolver(),
        private readonly KnowledgeGraphRepository $graph = new KnowledgeGraphRepository(),
        private readonly CentrifugoPublisher $publisher = new CentrifugoPublisher(),
    ) {
    }

    public function bootstrap(UserIdentity $identity): array
    {
        $this->permissions->synchronize($identity);
        $inbox = $this->messages->listConversations($identity->id, ['page' => 1, 'limit' => 8]);
        $peerIds = array_values(array_unique(array_filter(array_map(
            static fn (array $conversation): int => (int) ($conversation['peer']['id'] ?? 0),
            $inbox['items'] ?? [],
        ))));
        return [
            'enabled' => (bool) config('wikist.messaging.enabled', true),
            'realtime' => [
                'enabled' => $this->publisher->enabled(),
                'url' => (string) config('wikist.centrifugo.public_url', 'ws://127.0.0.1:8000/connection/websocket'),
                'fallback' => 'api',
            ],
            'unreadCount' => $this->messages->unreadCount($identity->id),
            'inbox' => $inbox,
            'preferences' => $this->messages->messagingPreferences($identity->id),
            'presence' => [
                'online' => $this->messages->recentlyOnlineUsers($peerIds, (int) config('wikist.messaging.presence_ttl', 40)),
                'observed' => $peerIds,
                'ttlSeconds' => (int) config('wikist.messaging.presence_ttl', 40),
                'heartbeatSeconds' => (int) config('wikist.messaging.heartbeat_interval', 15),
                'private' => false,
            ],
            'capabilities' => [
                'direct' => true,
                'organization' => true,
                'attachments' => true,
                'knowledgeReferences' => ['wiki_entry', 'page', 'question', 'answer', 'organization', 'user', 'revision', 'selection'],
                'withdrawWindowSeconds' => (int) config('wikist.messaging.withdraw_window', 300),
                'directRequestLimit' => 1,
                'organizationModeration' => true,
            ],
        ];
    }

    public function conversations(UserIdentity $identity, array $filters): array
    {
        $this->permissions->synchronize($identity);
        return $this->messages->listConversations($identity->id, $filters);
    }

    public function startDirect(UserIdentity $identity, int $targetUserId): array
    {
        if ($targetUserId <= 0 || $targetUserId === $identity->id) {
            throw new ApiException('请选择其他用户开始私信。', 422, 'invalid_direct_recipient');
        }
        $target = $this->messages->user($targetUserId);
        if (!$target) {
            throw new ApiException('该用户已被删除，无法发起私信。', 410, 'direct_recipient_deleted');
        }
        if (!in_array((string) $target->status, ['active', 'ok'], true)) {
            throw new ApiException('该用户已被封禁，暂时无法接收私信。', 403, 'direct_recipient_banned');
        }
        $pair = [$identity->id, $targetUserId];
        sort($pair, SORT_NUMERIC);
        $key = 'direct:' . implode(':', $pair);
        $conversation = $this->messages->transaction(function () use ($identity, $targetUserId, $key): object {
            $conversation = $this->messages->findConversationByKey($key);
            if (!$conversation) {
                try {
                    $conversation = $this->messages->createConversation([
                        'kind' => 'direct',
                        'directKey' => $key,
                        'ownerUserId' => $identity->id,
                        'metadata' => ['createdFrom' => 'passport'],
                    ]);
                } catch (\Throwable $error) {
                    $conversation = $this->messages->findConversationByKey($key);
                    if (!$conversation) {
                        throw $error;
                    }
                }
            }
            $this->messages->upsertMember((int) $conversation->id, $identity->id, 'member');
            $this->messages->upsertMember((int) $conversation->id, $targetUserId, 'member');
            return $conversation;
        });
        $summary = $this->messages->conversationSummary((int) $conversation->id, $identity->id)
            ?? throw new \RuntimeException('无法读取新建会话。');
        return $this->decorateConversation($identity, $conversation, $summary);
    }

    public function organizationConversation(UserIdentity $identity, int|string $organizationId): array
    {
        $organization = $this->messages->organization($organizationId);
        if (!$organization || (string) $organization->status !== 'active') {
            throw new ApiException('协作组织不存在。', 404, 'organization_not_found');
        }
        $membership = $this->messages->activeOrganizationMember((int) $organization->id, $identity->id);
        if (!$membership && $identity->role !== 'admin') {
            throw new ApiException('只有组织成员可以进入群聊。', 403, 'organization_membership_required');
        }
        $conversation = $this->messages->transaction(function () use ($organization): object {
            $conversation = $this->messages->ensureConversation([
                'kind' => 'organization',
                'directKey' => 'organization:' . $organization->id,
                'title' => (string) $organization->name,
                'description' => (string) $organization->description,
                'avatarUrl' => (string) ($organization->avatar_image ?? ''),
                'organizationId' => (int) $organization->id,
                'metadata' => ['organizationSlug' => (string) $organization->slug],
            ]);
            foreach ($this->messages->activeOrganizationMembers((int) $organization->id) as $member) {
                $this->messages->syncOrganizationMember((int) $conversation->id, (int) $member->user_id, (string) $member->role);
            }
            return $conversation;
        });
        $summary = $this->messages->conversationSummary((int) $conversation->id, $identity->id)
            ?? throw new \RuntimeException('无法读取组织会话。');
        return $this->decorateConversation($identity, $conversation, $summary);
    }

    public function conversation(UserIdentity $identity, string $publicId): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        $summary = $this->messages->conversationSummary((int) $conversation->id, $identity->id)
            ?? throw new ApiException('会话不可用。', 404, 'conversation_not_found');
        return $this->decorateConversation($identity, $conversation, $summary);
    }

    public function messagePage(UserIdentity $identity, string $publicId, ?int $before, int $limit): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        return $this->messages->listMessages((int) $conversation->id, $identity->id, $before, $limit);
    }

    public function members(UserIdentity $identity, string $publicId, int $page, int $limit): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        $metadata = json_decode((string) ($conversation->metadata_json ?? '{}'), true);
        $scope = is_array($metadata) ? (string) ($metadata['scope'] ?? '') : '';
        $isSiteConversation = (string) ($conversation->direct_key ?? '') === 'system:site' || $scope === 'site';
        if ((string) $conversation->kind === 'system') {
            return [
                'items' => [],
                'page' => 1,
                'limit' => max(1, min(50, $limit)),
                'total' => $this->messages->conversationMemberCount((int) $conversation->id),
                'pages' => 1,
                'private' => true,
                'scope' => $isSiteConversation ? 'site' : $scope,
            ];
        }
        return $this->messages->conversationMembersPage((int) $conversation->id, $page, $limit) + [
            'private' => false,
            'scope' => $scope,
        ];
    }

    public function preferences(UserIdentity $identity): array
    {
        return $this->messages->messagingPreferences($identity->id);
    }

    public function updatePreferences(UserIdentity $identity, array $input): array
    {
        $current = $this->messages->messagingPreferences($identity->id);
        $text = trim((string) ($input['autoReplyText'] ?? $current['autoReplyText'] ?? ''));
        if (mb_strlen($text) > 500) {
            throw new ApiException('自动回复最多 500 个字符。', 422, 'auto_reply_too_long');
        }
        $enabled = array_key_exists('autoReplyEnabled', $input)
            ? (bool) $input['autoReplyEnabled']
            : (bool) ($current['autoReplyEnabled'] ?? false);
        if ($enabled && $text === '') {
            $text = '我当前不在线，稍后回复你。';
        }
        return $this->messages->updateMessagingPreferences($identity->id, [
            'openMode' => array_key_exists('openMode', $input)
                ? (bool) $input['openMode']
                : (bool) ($current['openMode'] ?? false),
            'autoReplyEnabled' => $enabled,
            'autoReplyText' => $text,
        ]);
    }

    public function notifyUser(UserIdentity $recipient, array $notification): array
    {
        $this->permissions->synchronize($recipient);
        $conversation = $this->messages->findConversationByKey('system:user:' . $recipient->id);
        if (!$conversation) {
            throw new \RuntimeException('Unable to initialize the personal notification channel.');
        }
        $title = mb_substr(trim((string) ($notification['title'] ?? '社区动态')), 0, 180);
        $body = trim((string) ($notification['bodyMd'] ?? $notification['body'] ?? ''));
        $references = $this->objects->resolveMany((array) ($notification['references'] ?? []));
        $createdAt = gmdate('c');
        $messageId = $this->messages->transaction(function () use (
            $recipient,
            $notification,
            $conversation,
            $title,
            $body,
            $references,
            $createdAt,
        ): int {
            $messageId = $this->messages->insertMessage([
                'conversationId' => (int) $conversation->id,
                'senderUserId' => null,
                'senderName' => (string) config('wikist.name', 'Wikist'),
                'senderAvatar' => '',
                'messageType' => 'system',
                'bodyMd' => $body,
                'bodyPlain' => trim(strip_tags($body)),
                'replyToMessageId' => null,
                'clientNonce' => '',
                'priority' => in_array((string) ($notification['priority'] ?? 'normal'), ['normal', 'high', 'urgent'], true)
                    ? (string) ($notification['priority'] ?? 'normal')
                    : 'normal',
                'metadata' => array_merge((array) ($notification['metadata'] ?? []), [
                    'title' => $title,
                    'source' => (string) ($notification['source'] ?? 'community'),
                ]),
                'createdAt' => $createdAt,
            ]);
            $this->messages->insertReferences($messageId, $references);
            $this->messages->updateConversationAfterMessage((int) $conversation->id, $messageId, $createdAt);
            $message = $this->messages->hydratedMessage($messageId, $recipient->id) ?? [];
            $eventType = (string) ($notification['eventType'] ?? 'notification.created');
            $data = [
                'conversationId' => (string) $conversation->public_id,
                'recipientUserId' => $recipient->id,
                'message' => $message,
                'unreadCount' => $this->messages->unreadCount($recipient->id),
            ];
            $this->enqueue($eventType, MessagingChannels::personal($recipient->id), 'message', (string) ($message['id'] ?? $messageId), $data);
            $this->enqueue($eventType, MessagingChannels::conversation((string) $conversation->public_id), 'message', (string) ($message['id'] ?? $messageId), $data);
            return $messageId;
        });
        $message = $this->messages->hydratedMessage($messageId, $recipient->id) ?? [];
        $this->syncKnowledgeMessage($message, $conversation, null, $references);
        return $message;
    }

    public function updateOrganizationModeration(UserIdentity $identity, string $publicId, array $input): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        $this->permissions->assertCanModerate($identity, $conversation);
        $metadata = json_decode((string) ($conversation->metadata_json ?? '{}'), true);
        $metadata = is_array($metadata) ? $metadata : [];
        $previousAllMuted = (bool) ($metadata['allMuted'] ?? false);
        if (array_key_exists('allMuted', $input)) {
            $metadata['allMuted'] = (bool) $input['allMuted'];
        }
        $nextAllMuted = (bool) ($metadata['allMuted'] ?? false);
        $changed = array_key_exists('allMuted', $input) && $previousAllMuted !== $nextAllMuted;
        $createdAt = gmdate('c');
        $this->messages->transaction(function () use ($identity, $conversation, $metadata, $nextAllMuted, $changed, $createdAt): void {
            $this->messages->updateConversationMetadata((int) $conversation->id, $metadata);
            $messageId = 0;
            if ($changed) {
                $body = sprintf('%s %s了全员禁言', $identity->displayName ?: $identity->username, $nextAllMuted ? '开启' : '解除');
                $messageId = $this->messages->insertMessage([
                    'conversationId' => (int) $conversation->id,
                    'senderUserId' => $identity->id,
                    'senderName' => $identity->displayName ?: $identity->username,
                    'senderAvatar' => $identity->avatarUrl,
                    'messageType' => 'system',
                    'bodyMd' => $body,
                    'bodyPlain' => $body,
                    'replyToMessageId' => null,
                    'clientNonce' => '',
                    'priority' => 'normal',
                    'metadata' => [
                        'source' => 'conversation_moderation',
                        'event' => 'all_muted',
                        'allMuted' => $nextAllMuted,
                        'actorUserId' => $identity->id,
                    ],
                    'createdAt' => $createdAt,
                ]);
                $this->messages->updateConversationAfterMessage((int) $conversation->id, $messageId, $createdAt);
                $this->messages->markRead((int) $conversation->id, $identity->id, $messageId);
                $message = $this->messages->hydratedMessage($messageId, $identity->id) ?? [];
                $this->enqueue('message.created', MessagingChannels::conversation((string) $conversation->public_id), 'message', (string) ($message['id'] ?? $messageId), [
                    'conversationId' => (string) $conversation->public_id,
                    'message' => $message,
                    'actor' => [
                        'id' => $identity->id,
                        'username' => $identity->username,
                        'displayName' => $identity->displayName,
                    ],
                ]);
            }
            $this->enqueue('conversation.moderation.updated', MessagingChannels::conversation((string) $conversation->public_id), 'conversation', (string) $conversation->public_id, [
                'conversationId' => (string) $conversation->public_id,
                'actorUserId' => $identity->id,
                'allMuted' => $nextAllMuted,
                'messageId' => $messageId,
            ]);
        });
        return $this->conversation($identity, $publicId);
    }

    public function updateOrganizationMemberRole(UserIdentity $identity, string $publicId, int $userId, array $input): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        $this->permissions->assertCanManageRoles($identity, $conversation);
        $target = $this->messages->member((int) $conversation->id, $userId);
        if (!$target || (string) $target->status !== 'active') {
            throw new ApiException('群成员不存在。', 404, 'organization_chat_member_not_found');
        }
        if ((string) $target->role === 'owner') {
            throw new ApiException('不能修改群主身份。', 409, 'organization_chat_owner_immutable');
        }
        $role = (string) ($input['role'] ?? 'member');
        if (!in_array($role, ['admin', 'member'], true)) {
            throw new ApiException('群聊身份无效。', 422, 'organization_chat_role_invalid');
        }
        $this->messages->transaction(function () use ($identity, $conversation, $userId, $role): void {
            $this->messages->updateConversationRole((int) $conversation->id, $userId, $role);
            $this->enqueue('conversation.member.role.updated', MessagingChannels::conversation((string) $conversation->public_id), 'conversation', (string) $conversation->public_id, [
                'conversationId' => (string) $conversation->public_id,
                'actorUserId' => $identity->id,
                'userId' => $userId,
                'role' => $role,
            ]);
        });
        return ['ok' => true, 'userId' => $userId, 'role' => $role];
    }

    public function updateOrganizationMemberMute(UserIdentity $identity, string $publicId, int $userId, array $input): array
    {
        $conversation = $this->permissions->conversation($identity, $publicId);
        $actor = $this->permissions->assertCanModerate($identity, $conversation);
        $target = $this->messages->member((int) $conversation->id, $userId);
        if (!$target || (string) $target->status !== 'active') {
            throw new ApiException('群成员不存在。', 404, 'organization_chat_member_not_found');
        }
        $targetRole = (string) ($target->role ?? 'member');
        if ($targetRole === 'owner' || ($targetRole === 'admin' && $identity->role !== 'admin' && (string) ($actor->role ?? '') !== 'owner')) {
            throw new ApiException('你不能禁言该成员。', 403, 'organization_chat_mute_denied');
        }
        $muted = (bool) ($input['muted'] ?? true);
        $minutes = max(1, min(43200, (int) ($input['durationMinutes'] ?? 60)));
        $until = $muted ? gmdate('c', time() + $minutes * 60) : '';
        $reason = trim((string) ($input['reason'] ?? ''));
        $this->messages->transaction(function () use ($identity, $conversation, $userId, $until, $reason): void {
            $this->messages->setConversationMute((int) $conversation->id, $userId, $identity->id, $until, $reason);
            $this->enqueue('conversation.member.mute.updated', MessagingChannels::conversation((string) $conversation->public_id), 'conversation', (string) $conversation->public_id, [
                'conversationId' => (string) $conversation->public_id,
                'actorUserId' => $identity->id,
                'userId' => $userId,
                'mutedUntil' => $until,
            ]);
        });
        return ['ok' => true, 'userId' => $userId, 'mutedUntil' => $until];
    }

    public function send(UserIdentity $identity, string $conversationPublicId, array $input): array
    {
        $conversation = $this->permissions->conversation($identity, $conversationPublicId, true);
        $recipient = $this->assertDirectRecipientAvailable($conversation, $identity->id);
        $body = trim((string) ($input['bodyMd'] ?? $input['body'] ?? ''));
        if (mb_strlen($body) > (int) config('wikist.messaging.message_max_chars', 20000)) {
            throw new ApiException('消息内容过长。', 422, 'message_too_long');
        }
        $attachmentIds = array_values(array_unique(array_filter(array_map('strval', (array) ($input['attachmentIds'] ?? [])))));
        if (count($attachmentIds) > 8) {
            throw new ApiException('一条消息最多包含 8 个附件。', 422, 'too_many_attachments');
        }
        $references = $this->objects->resolveMany($this->referenceInputs(
            $body,
            (array) ($input['references'] ?? []),
        ));
        if ($body === '' && $attachmentIds === [] && $references === []) {
            throw new ApiException('消息内容不能为空。', 422, 'message_empty');
        }
        $nonce = trim((string) ($input['clientNonce'] ?? ''));
        if ($nonce !== '' && !preg_match('/^[A-Za-z0-9._:-]{8,100}$/', $nonce)) {
            throw new ApiException('消息幂等标识无效。', 422, 'invalid_client_nonce');
        }
        $reply = null;
        $replyPublicId = trim((string) ($input['replyToId'] ?? ''));
        if ($replyPublicId !== '') {
            $reply = $this->messages->messageByPublicId($replyPublicId);
            if (!$reply || (int) $reply->conversation_id !== (int) $conversation->id) {
                throw new ApiException('引用的消息不属于当前会话。', 422, 'invalid_reply_target');
            }
        }
        $attachments = $this->messages->pendingAttachments($attachmentIds, $identity->id);
        if (count($attachments) !== count($attachmentIds)) {
            throw new ApiException('部分附件不存在、已被使用或不属于当前用户。', 422, 'invalid_message_attachments');
        }
        $mentions = $this->resolveMentions($body, (array) ($input['mentionUserIds'] ?? []));
        $requestedPriority = (string) ($input['priority'] ?? 'normal');
        $priority = in_array($requestedPriority, ['normal', 'high', 'urgent'], true)
            ? $requestedPriority : 'normal';
        if ($identity->role !== 'admin' && $priority === 'urgent') {
            $priority = 'high';
        }
        $createdAt = gmdate('c');
        $messageId = $this->messages->transaction(function () use (
            $identity,
            $conversation,
            $body,
            $nonce,
            $reply,
            $attachments,
            $references,
            $mentions,
            $priority,
            $createdAt,
            $recipient
        ): int {
            if ($nonce !== '' && ($existing = $this->messages->findByNonce((int) $conversation->id, $identity->id, $nonce))) {
                return (int) $existing->id;
            }
            $this->assertDirectMessagingPolicy($conversation, $identity->id, $recipient);
            $messageId = $this->messages->insertMessage([
                'conversationId' => (int) $conversation->id,
                'senderUserId' => $identity->id,
                'senderName' => $identity->displayName ?: $identity->username,
                'senderAvatar' => $identity->avatarUrl,
                'messageType' => (string) $conversation->kind === 'system' ? 'system' : ($attachments !== [] && $body === '' ? 'attachment' : 'text'),
                'bodyMd' => $body,
                'bodyPlain' => $this->plainText($body),
                'replyToMessageId' => $reply ? (int) $reply->id : null,
                'clientNonce' => $nonce,
                'priority' => $priority,
                'metadata' => ['source' => 'messaging_api'],
                'createdAt' => $createdAt,
            ]);
            $this->messages->insertReferences($messageId, $references);
            $this->messages->insertMentions($messageId, array_keys($mentions));
            $this->messages->bindAttachments(array_map(static fn (object $item): int => (int) $item->id, $attachments), $messageId);
            $this->messages->updateConversationAfterMessage((int) $conversation->id, $messageId, $createdAt);
            $this->messages->markRead((int) $conversation->id, $identity->id, $messageId);
            $message = $this->messages->hydratedMessage($messageId, $identity->id);
            $this->queueMessageEvents($identity, $conversation, $message ?? [], array_keys($mentions));
            $this->createAutoReplyIfNeeded($identity, $conversation, $recipient, $messageId);
            return $messageId;
        });
        $message = $this->messages->hydratedMessage($messageId, $identity->id)
            ?? throw new \RuntimeException('消息保存后无法读取。');
        $this->syncKnowledgeMessage($message, $conversation, $identity->id, $references);
        return $message;
    }

    public function markRead(UserIdentity $identity, string $conversationPublicId, ?int $cursor): array
    {
        $conversation = $this->permissions->conversation($identity, $conversationPublicId);
        $messageId = $cursor ?: $this->messages->lastMessageId((int) $conversation->id);
        if ($messageId > 0) {
            $message = $this->messages->messageById($messageId);
            if (!$message || (int) $message->conversation_id !== (int) $conversation->id) {
                throw new ApiException('已读游标不属于当前会话。', 422, 'invalid_read_cursor');
            }
            $this->messages->transaction(function () use ($identity, $conversation, $messageId): void {
                $this->messages->markRead((int) $conversation->id, $identity->id, $messageId);
                $this->enqueue(
                    'conversation.read',
                    MessagingChannels::conversation((string) $conversation->public_id),
                    'conversation',
                    (string) $conversation->public_id,
                    ['conversationId' => (string) $conversation->public_id, 'userId' => $identity->id, 'cursor' => $messageId],
                );
            });
        }
        return ['ok' => true, 'cursor' => $messageId, 'unreadCount' => $this->messages->unreadCount($identity->id)];
    }

    public function markAllRead(UserIdentity $identity): array
    {
        $this->permissions->synchronize($identity);
        $changed = $this->messages->transaction(fn (): int => $this->messages->markAllRead($identity->id));
        return ['ok' => true, 'changed' => $changed, 'unreadCount' => 0];
    }

    public function withdraw(UserIdentity $identity, string $messagePublicId): array
    {
        $message = $this->messages->messageByPublicId($messagePublicId);
        if (!$message) {
            throw new ApiException('消息不存在。', 404, 'message_not_found');
        }
        $conversation = $this->messages->connection()->table('messaging_conversations')->where('id', $message->conversation_id)->first();
        if (!$conversation) {
            throw new ApiException('会话不存在。', 404, 'conversation_not_found');
        }
        $this->permissions->assertConversationAccess($identity, $conversation);
        $this->permissions->assertCanWithdraw($identity, $message);
        $this->messages->transaction(function () use ($identity, $conversation, $message): void {
            $this->messages->withdrawMessage((int) $message->id);
            $this->enqueue(
                'message.withdrawn',
                MessagingChannels::conversation((string) $conversation->public_id),
                'message',
                (string) $message->public_id,
                ['conversationId' => (string) $conversation->public_id, 'messageId' => (string) $message->public_id, 'actorUserId' => $identity->id],
            );
            $this->queueActivityEvent($conversation, 'message.withdrawn', [
                'conversationId' => (string) $conversation->public_id,
                'messageId' => (string) $message->public_id,
                'actorUserId' => $identity->id,
            ]);
        });
        return $this->messages->hydratedMessage((int) $message->id, $identity->id) ?? ['id' => $messagePublicId, 'status' => 'withdrawn'];
    }

    public function hide(UserIdentity $identity, string $messagePublicId): array
    {
        $message = $this->messages->messageByPublicId($messagePublicId);
        if (!$message) {
            throw new ApiException('消息不存在。', 404, 'message_not_found');
        }
        $conversation = $this->messages->connection()->table('messaging_conversations')
            ->where('id', $message->conversation_id)->first();
        if (!$conversation) {
            throw new ApiException('会话不存在。', 404, 'conversation_not_found');
        }
        $this->permissions->assertConversationAccess($identity, $conversation);
        $this->messages->hideMessageForUser((int) $message->id, $identity->id);
        return [
            'ok' => true,
            'messageId' => $messagePublicId,
            'unreadCount' => $this->messages->unreadCount($identity->id),
        ];
    }

    public function updateMembership(UserIdentity $identity, string $conversationPublicId, array $input): array
    {
        $conversation = $this->permissions->conversation($identity, $conversationPublicId);
        $updates = [];
        if (array_key_exists('notificationLevel', $input)) {
            $level = (string) $input['notificationLevel'];
            if (!in_array($level, ['all', 'mentions', 'none'], true)) {
                throw new ApiException('通知级别无效。', 422, 'invalid_notification_level');
            }
            $updates['notification_level'] = $level;
        }
        if (array_key_exists('muted', $input)) {
            $updates['muted_until'] = $input['muted'] ? gmdate('c', time() + 365 * 86400) : '';
        }
        if (array_key_exists('pinned', $input)) {
            $updates['pinned_at'] = $input['pinned'] ? gmdate('c') : '';
        }
        if (array_key_exists('archived', $input)) {
            $updates['archived_at'] = $input['archived'] ? gmdate('c') : '';
        }
        $this->messages->updateMembership((int) $conversation->id, $identity->id, $updates);
        return $this->conversation($identity, $conversationPublicId);
    }

    public function typing(UserIdentity $identity, string $conversationPublicId, bool $active): array
    {
        $conversation = $this->permissions->conversation($identity, $conversationPublicId);
        if ($this->publisher->enabled()) {
            $this->publisher->publish(MessagingChannels::conversation($conversationPublicId), [
                'type' => 'presence.typing',
                'occurredAt' => gmdate('c'),
                'data' => [
                    'conversationId' => $conversationPublicId,
                    'active' => $active,
                    'user' => [
                        'id' => $identity->id,
                        'username' => $identity->username,
                        'displayName' => $identity->displayName,
                        'avatarUrl' => $identity->avatarUrl,
                    ],
                ],
            ]);
        }
        return ['ok' => true, 'realtime' => $this->publisher->enabled()];
    }

    public function presence(UserIdentity $identity, string $conversationPublicId): array
    {
        $conversation = $this->permissions->conversation($identity, $conversationPublicId);
        $metadata = json_decode((string) ($conversation->metadata_json ?? '{}'), true);
        $scope = is_array($metadata) ? (string) ($metadata['scope'] ?? '') : '';
        $isSiteConversation = (string) ($conversation->direct_key ?? '') === 'system:site' || $scope === 'site';
        if ((string) $conversation->kind === 'system' && $isSiteConversation) {
            return [
                'online' => [],
                'count' => null,
                'private' => true,
                'realtime' => $this->publisher->enabled(),
            ];
        }
        $observed = array_values(array_unique(array_map(
            static fn (object $member): int => (int) $member->id,
            $this->messages->conversationMembers((int) $conversation->id),
        )));
        $users = [];
        foreach ($this->messages->recentlyOnlineConversationUsers(
            (int) $conversation->id,
            (int) config('wikist.messaging.presence_ttl', 40),
        ) as $user) {
            $users[(int) $user['id']] = $user;
        }
        $realtime = $this->publisher->enabled();
        $transportPresence = false;
        if ($realtime) {
            try {
                $result = $this->publisher->presence(MessagingChannels::conversation($conversationPublicId));
                $transportPresence = true;
                foreach ((array) ($result['presence'] ?? []) as $client) {
                    if (!is_array($client)) {
                        continue;
                    }
                    $userId = (int) ($client['user'] ?? 0);
                    $info = is_array($client['conn_info'] ?? null) ? $client['conn_info'] : [];
                    if ($userId > 0) {
                        $users[$userId] = [
                            'id' => $userId,
                            'username' => (string) ($info['username'] ?? ''),
                            'displayName' => (string) ($info['displayName'] ?? $info['username'] ?? ''),
                            'avatarUrl' => (string) ($info['avatarUrl'] ?? ''),
                            'lastSeenAt' => gmdate('c'),
                        ];
                    }
                }
            } catch (\Throwable) {
                $transportPresence = false;
            }
        }
        return [
            'online' => array_values($users),
            'observed' => $observed,
            'count' => count($users),
            'private' => false,
            'realtime' => $realtime,
            'authoritative' => true,
            'transportPresence' => $transportPresence,
            'ttlSeconds' => (int) config('wikist.messaging.presence_ttl', 40),
        ];
    }

    public function heartbeat(UserIdentity $identity, array $watchUserIds = [], string $context = '', string $clientId = 'legacy'): array
    {
        $watchUserIds = array_values(array_unique(array_filter(
            array_map('intval', array_slice($watchUserIds, 0, 80)),
            static fn (int $id): bool => $id > 0,
        )));
        $presence = $this->recordPresence($identity, $context !== '' ? $context : 'web', $clientId);
        if (!in_array($identity->id, $watchUserIds, true)) {
            $watchUserIds[] = $identity->id;
        }
        return [
            'ok' => true,
            'online' => $this->messages->recentlyOnlineUsers(
                $watchUserIds,
                (int) config('wikist.messaging.presence_ttl', 40),
            ),
            'observed' => $watchUserIds,
            'lastSeenAt' => $presence['lastSeenAt'],
            'ttlSeconds' => (int) config('wikist.messaging.presence_ttl', 40),
            'heartbeatSeconds' => (int) config('wikist.messaging.heartbeat_interval', 15),
            'private' => false,
            'authoritative' => true,
        ];
    }

    public function offline(UserIdentity $identity, string $clientId): array
    {
        $presence = $this->messages->releasePresence($identity->id, $clientId);
        if (!$presence['becameOffline']) {
            return ['ok' => true, 'offline' => false];
        }
        $context = (string) ($presence['lastContext'] ?? '');
        $conversationId = str_starts_with($context, 'conversation:')
            ? substr($context, strlen('conversation:'))
            : '';
        if ($conversationId !== '' && $this->publisher->enabled()) {
            try {
                $this->publisher->publish(MessagingChannels::conversation($conversationId), [
                    'type' => 'presence.changed',
                    'occurredAt' => gmdate('c'),
                    'data' => [
                        'conversationId' => $conversationId,
                        'online' => false,
                        'user' => [
                            'id' => $identity->id,
                            'username' => $identity->username,
                            'displayName' => $identity->displayName,
                            'avatarUrl' => $identity->avatarUrl,
                        ],
                    ],
                ], 'presence-offline-' . $identity->id . '-' . $conversationId . '-' . time());
            } catch (\Throwable) {
                // A best-effort disconnect hint must not delay browser shutdown.
            }
        }
        return ['ok' => true, 'offline' => true];
    }

    private function recordPresence(UserIdentity $identity, string $context, string $clientId): array
    {
        $presence = $this->messages->touchPresence($identity->id, $context, $clientId);
        if (!$presence['becameOnline'] || !$this->publisher->enabled()) {
            return $presence;
        }
        $event = [
            'type' => 'presence.changed',
            'occurredAt' => gmdate('c'),
            'data' => [
                'online' => true,
                'user' => [
                    'id' => $identity->id,
                    'username' => $identity->username,
                    'displayName' => $identity->displayName,
                    'avatarUrl' => $identity->avatarUrl,
                    'lastSeenAt' => $presence['lastSeenAt'],
                ],
            ],
        ];
        $conversationId = str_starts_with($context, 'conversation:')
            ? substr($context, strlen('conversation:'))
            : '';
        if ($conversationId !== '') {
            try {
                $conversationEvent = $event;
                $conversationEvent['data']['conversationId'] = $conversationId;
                $this->publisher->publish(
                    MessagingChannels::conversation($conversationId),
                    $conversationEvent,
                    'presence-online-' . $identity->id . '-' . $conversationId . '-' . time(),
                );
            } catch (\Throwable) {
                // Presence transport failures must never block normal API traffic.
            }
        }
        return $presence;
    }

    private function assertDirectRecipientAvailable(object $conversation, int $senderUserId): array
    {
        $recipient = $this->messages->directRecipient($conversation, $senderUserId);
        if ($recipient['state'] === 'deleted') {
            throw new ApiException('该用户已被删除，消息发送失败。', 410, 'direct_recipient_deleted');
        }
        if ($recipient['state'] === 'banned') {
            throw new ApiException('该用户已被封禁，暂时无法接收私信。', 403, 'direct_recipient_banned');
        }
        return $recipient;
    }

    private function assertDirectMessagingPolicy(object $conversation, int $senderUserId, array $recipient): void
    {
        if ((string) ($conversation->kind ?? '') !== 'direct' || (int) ($recipient['userId'] ?? 0) <= 0) {
            return;
        }
        $policy = $this->directPolicy($conversation, $senderUserId, (int) $recipient['userId']);
        if (!$policy['canSend']) {
            throw new ApiException('对方尚未回复。非好友会话在收到回复前最多发送 1 条消息。', 403, 'direct_request_limit_reached', $policy);
        }
    }

    private function directPolicy(object $conversation, int $viewerId, int $peerId): array
    {
        $preferences = $this->messages->messagingPreferences($peerId);
        $mutual = $this->messages->areMutualFollowers($viewerId, $peerId);
        $peerReplied = $this->messages->hasConversationMessageFrom((int) $conversation->id, $peerId);
        $sentCount = $this->messages->conversationMessageCountFrom((int) $conversation->id, $viewerId);
        $canSend = (bool) ($preferences['openMode'] ?? false) || $mutual || $peerReplied || $sentCount < 1;
        return [
            'openMode' => (bool) ($preferences['openMode'] ?? false),
            'mutualFollow' => $mutual,
            'peerReplied' => $peerReplied,
            'sentCount' => $sentCount,
            'limit' => 1,
            'canSend' => $canSend,
            'waitingForReply' => !$canSend,
        ];
    }

    private function decorateConversation(UserIdentity $identity, object $conversation, array $summary): array
    {
        if ((string) $conversation->kind === 'direct') {
            $peerId = (int) ($summary['peer']['id'] ?? 0);
            $summary['directPolicy'] = $peerId > 0
                ? $this->directPolicy($conversation, $identity->id, $peerId)
                : ['canSend' => false, 'waitingForReply' => true, 'limit' => 1];
            $summary['canSend'] = (bool) ($summary['directPolicy']['canSend'] ?? false);
            return $summary;
        }
        if ((string) $conversation->kind === 'organization') {
            $member = $this->messages->member((int) $conversation->id, $identity->id);
            $role = $identity->role === 'admin' && !$member ? 'admin' : (string) ($member->role ?? 'member');
            $metadata = json_decode((string) ($conversation->metadata_json ?? '{}'), true);
            $metadata = is_array($metadata) ? $metadata : [];
            $mute = $this->messages->conversationMute((int) $conversation->id, $identity->id);
            $mutedUntil = (string) ($mute->muted_until ?? '');
            $canModerate = $identity->role === 'admin' || in_array($role, ['owner', 'admin'], true);
            $allMuted = (bool) ($metadata['allMuted'] ?? false);
            $summary['role'] = $role;
            $summary['moderation'] = [
                'allMuted' => $allMuted,
                'canModerate' => $canModerate,
                'canManageRoles' => $identity->role === 'admin' || $role === 'owner',
                'mutedUntil' => $mutedUntil,
            ];
            $summary['canSend'] = ($mutedUntil === '' || $mutedUntil <= gmdate('c')) && (!$allMuted || $canModerate);
            return $summary;
        }
        $summary['canSend'] = false;
        return $summary;
    }

    private function createAutoReplyIfNeeded(
        UserIdentity $sender,
        object $conversation,
        array $recipient,
        int $triggerMessageId,
    ): ?int {
        if ((string) ($conversation->kind ?? '') !== 'direct' || ($recipient['state'] ?? '') !== 'active') {
            return null;
        }
        $recipientId = (int) ($recipient['userId'] ?? 0);
        $recipientUser = $recipient['user'] ?? null;
        if ($recipientId <= 0 || !$recipientUser || $this->messages->isUserOnline($recipientId)) {
            return null;
        }
        $preferences = $this->messages->messagingPreferences($recipientId);
        $body = trim((string) ($preferences['autoReplyText'] ?? ''));
        if (empty($preferences['autoReplyEnabled']) || $body === '' || !$this->messages->autoReplyReady($recipientId, (int) $conversation->id)) {
            return null;
        }
        $createdAt = gmdate('c');
        $messageId = $this->messages->insertMessage([
            'conversationId' => (int) $conversation->id,
            'senderUserId' => $recipientId,
            'senderName' => (string) ($recipientUser->display_name ?: $recipientUser->username),
            'senderAvatar' => (string) ($recipientUser->avatar_url ?? ''),
            'messageType' => 'text',
            'bodyMd' => $body,
            'bodyPlain' => $this->plainText($body),
            'clientNonce' => 'auto-reply:' . $recipientId . ':' . $triggerMessageId,
            'priority' => 'normal',
            'metadata' => ['source' => 'auto_reply', 'autoReply' => true, 'triggerMessageId' => $triggerMessageId],
            'createdAt' => $createdAt,
        ]);
        $this->messages->updateConversationAfterMessage((int) $conversation->id, $messageId, $createdAt);
        $this->messages->markAutoReplySent($recipientId, (int) $conversation->id, $createdAt);
        $message = $this->messages->hydratedMessage($messageId, $sender->id) ?? [];
        $this->queueMessageEventsFromActor([
            'id' => $recipientId,
            'username' => (string) $recipientUser->username,
            'displayName' => (string) ($recipientUser->display_name ?: $recipientUser->username),
        ], $conversation, $message, []);
        return $messageId;
    }

    private function resolveMentions(string $body, array $explicitIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $explicitIds), static fn (int $id): bool => $id > 0)));
        $users = $this->messages->usersByIds($ids);
        $mentions = [];
        foreach ($users as $id => $user) {
            if (in_array((string) $user->status, ['active', 'ok'], true)) {
                $mentions[(int) $id] = $user;
            }
        }
        preg_match_all('/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,32})/u', $body, $matches);
        foreach ($this->messages->usersByUsernames($matches[2] ?? []) as $user) {
            $mentions[(int) $user->id] = $user;
        }
        return $mentions;
    }

    private function queueMessageEvents(UserIdentity $identity, object $conversation, array $message, array $mentionIds): void
    {
        $this->queueMessageEventsFromActor([
            'id' => $identity->id,
            'username' => $identity->username,
            'displayName' => $identity->displayName,
        ], $conversation, $message, $mentionIds);
    }

    private function queueMessageEventsFromActor(array $actor, object $conversation, array $message, array $mentionIds): void
    {
        $actorId = (int) ($actor['id'] ?? 0);
        $data = [
            'conversationId' => (string) $conversation->public_id,
            'message' => $message,
            'actor' => [
                'id' => $actorId,
                'username' => (string) ($actor['username'] ?? ''),
                'displayName' => (string) ($actor['displayName'] ?? $actor['username'] ?? ''),
            ],
        ];
        $this->enqueue(
            'message.created',
            MessagingChannels::conversation((string) $conversation->public_id),
            'message',
            (string) ($message['id'] ?? ''),
            $data,
        );
        $this->queueActivityEvent($conversation, 'message.created', $data, $actorId);
        foreach ($mentionIds as $mentionedUserId) {
            if ((int) $mentionedUserId === $actorId) {
                continue;
            }
            $this->enqueue(
                'mention.created',
                MessagingChannels::personal((int) $mentionedUserId),
                'message',
                (string) ($message['id'] ?? ''),
                $data + ['mentionedUserId' => (int) $mentionedUserId],
            );
        }
    }

    private function queueActivityEvent(object $conversation, string $type, array $data, int $actorUserId = 0): void
    {
        if ((string) $conversation->kind === 'organization') {
            $this->enqueue($type, MessagingChannels::organizationActivity((int) $conversation->organization_id), 'conversation', (string) $conversation->public_id, $data);
            return;
        }
        if ((string) $conversation->kind === 'system' && (string) $conversation->direct_key === 'system:site') {
            $this->enqueue($type, MessagingChannels::site(), 'conversation', (string) $conversation->public_id, $data);
            return;
        }
        foreach ($this->messages->conversationMembers((int) $conversation->id) as $member) {
            if ((int) $member->user_id !== $actorUserId) {
                $this->enqueue($type, MessagingChannels::personal((int) $member->user_id), 'conversation', (string) $conversation->public_id, $data);
            }
        }
    }

    private function enqueue(string $type, string $channel, string $aggregateType, string $aggregateId, array $data): void
    {
        $eventId = $this->messages->newPublicId('evt');
        $this->messages->enqueueEvent([
            'eventId' => $eventId,
            'type' => $type,
            'channel' => $channel,
            'aggregateType' => $aggregateType,
            'aggregateId' => $aggregateId,
            'payload' => [
                'id' => $eventId,
                'type' => $type,
                'occurredAt' => gmdate('c'),
                'resource' => ['type' => $aggregateType, 'id' => $aggregateId],
                'data' => $data,
            ],
        ]);
    }

    private function plainText(string $markdown): string
    {
        $text = preg_replace_callback(
            '/\{\{ref:([a-z_]+)\|([^|{}\r\n]+)(?:\|([^{}\r\n]+))?\}\}/iu',
            static fn (array $match): string => trim((string) ($match[3] ?? $match[2] ?? '')),
            $markdown,
        ) ?? $markdown;
        $text = preg_replace('/```[\s\S]*?```/u', ' [代码] ', $text) ?? $text;
        $text = preg_replace('/!\[([^\]]*)\]\([^)]*\)/u', '$1', $text) ?? $text;
        $text = preg_replace('/\[([^\]]+)\]\([^)]*\)/u', '$1', $text) ?? $text;
        $text = preg_replace('/[`*_>#~|]/u', ' ', $text) ?? $text;
        return mb_substr(trim(preg_replace('/\s+/u', ' ', strip_tags($text)) ?? ''), 0, 4000);
    }

    private function syncKnowledgeMessage(array $message, object $conversation, ?int $actorUserId, array $references): void
    {
        $publicId = trim((string) ($message['id'] ?? ''));
        if ($publicId === '') {
            return;
        }
        try {
            $messageObject = $this->graph->upsertObject([
                'type' => 'chat_message',
                'key' => $publicId,
                'source' => 'wikist',
                'title' => '消息 · ' . trim((string) ($message['sender']['displayName'] ?? config('wikist.name', 'Wikist'))),
                'summary' => mb_substr((string) ($message['bodyPlain'] ?? ''), 0, 300),
                'url' => '#/messages/' . rawurlencode((string) $conversation->public_id) . '?message=' . rawurlencode($publicId),
                'authorUserId' => $actorUserId,
                'status' => (string) ($message['status'] ?? 'active'),
                'searchText' => (string) ($message['bodyPlain'] ?? ''),
                'metadata' => [
                    'conversationId' => (string) $conversation->public_id,
                    'messageType' => (string) ($message['type'] ?? 'text'),
                    'private' => true,
                    'createdAt' => (string) ($message['createdAt'] ?? ''),
                ],
            ]);
            foreach ($references as $reference) {
                $type = KnowledgeObjectId::normalizeType((string) ($reference['type'] ?? 'wiki_entry'));
                $key = trim((string) ($reference['id'] ?? ''));
                if ($type === 'revision' && trim((string) ($reference['revision'] ?? '')) !== '') {
                    $key .= '@' . trim((string) $reference['revision']);
                }
                if ($key === '') {
                    continue;
                }
                $source = in_array($type, ['question', 'answer', 'comment'], true) ? 'answer' : 'wikist';
                $target = $this->graph->findBySource($source, $type, $key)
                    ?? $this->graph->upsertObject([
                        'type' => $type,
                        'key' => $key,
                        'source' => $source,
                        'title' => (string) ($reference['label'] ?? $key),
                        'summary' => (string) ($reference['metadata']['summary'] ?? $reference['metadata']['quote'] ?? ''),
                        'url' => (string) ($reference['url'] ?? ''),
                        'metadata' => (array) ($reference['metadata'] ?? []),
                    ]);
                $relation = match ((string) ($reference['relation'] ?? 'context')) {
                    'quote' => 'quotes',
                    'share' => 'shares',
                    'source' => 'derived_from',
                    'mention' => 'mentions',
                    default => 'references',
                };
                $this->graph->relate($messageObject['globalId'], $relation, $target['globalId'], [
                    'actorUserId' => $actorUserId,
                    'source' => 'messaging',
                ]);
            }
            $replyId = trim((string) ($message['replyTo']['id'] ?? ''));
            if ($replyId !== '') {
                $reply = $this->graph->findBySource('wikist', 'chat_message', $replyId)
                    ?? $this->graph->upsertObject([
                        'type' => 'chat_message', 'key' => $replyId, 'source' => 'wikist',
                        'title' => '被引用消息',
                        'url' => '#/messages/' . rawurlencode((string) $conversation->public_id) . '?message=' . rawurlencode($replyId),
                        'metadata' => ['private' => true],
                    ]);
                $this->graph->relate($messageObject['globalId'], 'replies_to', $reply['globalId'], [
                    'actorUserId' => $actorUserId,
                    'source' => 'messaging',
                ]);
            }
        } catch (\Throwable $error) {
            Log::warning('Knowledge relation sync for message failed', [
                'messageId' => $publicId,
                'error' => $error->getMessage(),
            ]);
        }
    }

    private function referenceInputs(string $body, array $explicit): array
    {
        $references = [];
        foreach ($explicit as $item) {
            if (is_array($item)) {
                $references[] = $item;
            }
        }
        preg_match_all(
            '/\{\{ref:([a-z_]+)\|([^|{}\r\n]+)(?:\|([^{}\r\n]+))?\}\}/iu',
            $body,
            $matches,
            PREG_SET_ORDER,
        );
        foreach ($matches as $match) {
            $type = mb_strtolower(trim((string) ($match[1] ?? '')));
            $rawId = trim((string) ($match[2] ?? ''));
            $revision = '';
            if ($type === 'revision' && str_contains($rawId, '@')) {
                [$rawId, $revision] = array_pad(explode('@', $rawId, 2), 2, '');
                $rawId = trim($rawId);
                $revision = trim($revision);
            }
            $references[] = [
                'type' => $type,
                'id' => $rawId,
                'revision' => $revision,
                'label' => trim((string) ($match[3] ?? '')),
                'relation' => 'context',
            ];
        }
        $unique = [];
        foreach ($references as $reference) {
            $type = mb_strtolower(trim((string) ($reference['type'] ?? '')));
            if ($type === 'page') {
                $type = 'wiki_entry';
            }
            $key = implode(':', [
                $type,
                trim((string) ($reference['id'] ?? '')),
                trim((string) ($reference['revision'] ?? '')),
                trim((string) ($reference['relation'] ?? 'context')),
            ]);
            $unique[$key] = $reference;
        }
        return array_values($unique);
    }
}
