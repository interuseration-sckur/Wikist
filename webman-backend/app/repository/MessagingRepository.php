<?php

namespace app\repository;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use support\Db;

final class MessagingRepository
{
    private string $connection;

    public function __construct()
    {
        $this->connection = (string) config('wikist.passport.connection', 'wikist');
    }

    public function connection(): ConnectionInterface
    {
        return Db::connection($this->connection);
    }

    public function transaction(callable $callback): mixed
    {
        return $this->connection()->transaction($callback);
    }

    public function newPublicId(string $prefix): string
    {
        return $prefix . '_' . rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
    }

    public function user(int $id): ?object
    {
        return $this->connection()->table('users')->where('id', $id)->first();
    }

    public function messagingPreferences(int $userId): array
    {
        $row = $this->connection()->table('messaging_user_preferences')->where('user_id', $userId)->first();
        return [
            'openMode' => (bool) ($row->open_mode ?? false),
            'autoReplyEnabled' => (bool) ($row->auto_reply_enabled ?? false),
            'autoReplyText' => (string) ($row->auto_reply_text ?? ''),
        ];
    }

    public function updateMessagingPreferences(int $userId, array $preferences): array
    {
        $now = gmdate('c');
        $table = $this->connection()->table('messaging_user_preferences');
        $values = [
            'open_mode' => !empty($preferences['openMode']) ? 1 : 0,
            'auto_reply_enabled' => !empty($preferences['autoReplyEnabled']) ? 1 : 0,
            'auto_reply_text' => (string) ($preferences['autoReplyText'] ?? ''),
            'updated_at' => $now,
        ];
        $table->insertOrIgnore(['user_id' => $userId, 'created_at' => $now] + $values);
        $table->where('user_id', $userId)->update($values);
        return $this->messagingPreferences($userId);
    }

    public function areMutualFollowers(int $firstUserId, int $secondUserId): bool
    {
        if ($firstUserId <= 0 || $secondUserId <= 0 || $firstUserId === $secondUserId) {
            return true;
        }
        $count = $this->connection()->table('user_follows')
            ->where(function (Builder $query) use ($firstUserId, $secondUserId): void {
                $query->where('follower_user_id', $firstUserId)->where('following_user_id', $secondUserId);
            })
            ->orWhere(function (Builder $query) use ($firstUserId, $secondUserId): void {
                $query->where('follower_user_id', $secondUserId)->where('following_user_id', $firstUserId);
            })
            ->count();
        return $count >= 2;
    }

    public function hasConversationMessageFrom(int $conversationId, int $userId): bool
    {
        return $this->connection()->table('messaging_messages')
            ->where('conversation_id', $conversationId)
            ->where('sender_user_id', $userId)
            ->where('status', 'published')
            ->where('metadata_json', 'not like', '%"autoReply":true%')
            ->exists();
    }

    public function conversationMessageCountFrom(int $conversationId, int $userId): int
    {
        return (int) $this->connection()->table('messaging_messages')
            ->where('conversation_id', $conversationId)
            ->where('sender_user_id', $userId)
            ->whereIn('status', ['published', 'withdrawn'])
            ->count();
    }

    public function isUserOnline(int $userId, ?int $seconds = null): bool
    {
        $ttl = max(20, min(300, $seconds ?? (int) config('wikist.messaging.presence_ttl', 40)));
        return $this->connection()->table('messaging_presence_leases')
            ->where('user_id', $userId)
            ->where('last_seen_at', '>=', gmdate('c', time() - $ttl))
            ->exists();
    }

    public function autoReplyReady(int $userId, int $conversationId, int $cooldownSeconds = 21600): bool
    {
        $last = (string) ($this->connection()->table('messaging_auto_reply_state')
            ->where('user_id', $userId)
            ->where('conversation_id', $conversationId)
            ->value('last_sent_at') ?? '');
        return $last === '' || $last < gmdate('c', time() - max(300, $cooldownSeconds));
    }

    public function markAutoReplySent(int $userId, int $conversationId, string $sentAt): void
    {
        $this->connection()->table('messaging_auto_reply_state')->updateOrInsert(
            ['user_id' => $userId, 'conversation_id' => $conversationId],
            ['last_sent_at' => $sentAt],
        );
    }

    public function directRecipient(object $conversation, int $senderUserId): array
    {
        if ((string) ($conversation->kind ?? '') !== 'direct') {
            return ['userId' => 0, 'user' => null, 'state' => 'not_direct'];
        }
        $recipientId = 0;
        $key = (string) ($conversation->direct_key ?? '');
        if (preg_match('/^direct:(\d+):(\d+)$/', $key, $matches)) {
            foreach ([(int) $matches[1], (int) $matches[2]] as $candidate) {
                if ($candidate > 0 && $candidate !== $senderUserId) {
                    $recipientId = $candidate;
                    break;
                }
            }
        }
        if ($recipientId <= 0) {
            $recipientId = (int) ($this->connection()->table('messaging_conversation_members')
                ->where('conversation_id', (int) $conversation->id)
                ->where('user_id', '!=', $senderUserId)
                ->value('user_id') ?? 0);
        }
        $user = $recipientId > 0 ? $this->user($recipientId) : null;
        if (!$user) {
            return ['userId' => $recipientId, 'user' => null, 'state' => 'deleted'];
        }
        return [
            'userId' => $recipientId,
            'user' => $user,
            'state' => in_array((string) $user->status, ['active', 'ok'], true) ? 'active' : 'banned',
        ];
    }

    public function usersByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }
        return $this->connection()->table('users')
            ->whereIn('id', $ids)
            ->get()
            ->keyBy('id')
            ->all();
    }

    public function findConversation(string $publicId): ?object
    {
        return $this->connection()->table('messaging_conversations')
            ->where('public_id', $publicId)
            ->first();
    }

    public function findConversationByKey(string $directKey): ?object
    {
        return $this->connection()->table('messaging_conversations')
            ->where('direct_key', $directKey)
            ->first();
    }

    public function createConversation(array $data): object
    {
        $now = gmdate('c');
        $id = $this->connection()->table('messaging_conversations')->insertGetId([
            'public_id' => $data['publicId'] ?? $this->newPublicId('conv'),
            'kind' => $data['kind'],
            'direct_key' => $data['directKey'] ?? null,
            'title' => $data['title'] ?? '',
            'description' => $data['description'] ?? '',
            'avatar_url' => $data['avatarUrl'] ?? '',
            'organization_id' => $data['organizationId'] ?? null,
            'owner_user_id' => $data['ownerUserId'] ?? null,
            'status' => $data['status'] ?? 'active',
            'last_message_id' => null,
            'message_count' => 0,
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'created_at' => $data['createdAt'] ?? $now,
            'updated_at' => $data['updatedAt'] ?? $now,
        ]);
        return $this->connection()->table('messaging_conversations')->where('id', $id)->first();
    }

    public function ensureConversation(array $data): object
    {
        $key = (string) ($data['directKey'] ?? '');
        if ($key !== '' && ($existing = $this->findConversationByKey($key))) {
            $updates = [];
            foreach (['title' => 'title', 'description' => 'description', 'avatarUrl' => 'avatar_url'] as $input => $column) {
                if (array_key_exists($input, $data) && (string) $data[$input] !== (string) ($existing->{$column} ?? '')) {
                    $updates[$column] = (string) $data[$input];
                }
            }
            if ($updates !== []) {
                $updates['updated_at'] = gmdate('c');
                $this->connection()->table('messaging_conversations')->where('id', $existing->id)->update($updates);
                $existing = $this->connection()->table('messaging_conversations')->where('id', $existing->id)->first();
            }
            return $existing;
        }
        return $this->createConversation($data);
    }

    public function upsertMember(int $conversationId, int $userId, string $role = 'member', string $status = 'active'): void
    {
        $now = gmdate('c');
        $existing = $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first();
        if ($existing) {
            $this->connection()->table('messaging_conversation_members')
                ->where('conversation_id', $conversationId)
                ->where('user_id', $userId)
                ->update(['role' => $role, 'status' => $status, 'updated_at' => $now]);
            return;
        }
        $this->connection()->table('messaging_conversation_members')->insert([
            'conversation_id' => $conversationId,
            'user_id' => $userId,
            'role' => $role,
            'status' => $status,
            'notification_level' => 'all',
            'last_read_message_id' => null,
            'last_read_at' => '',
            'muted_until' => '',
            'pinned_at' => '',
            'archived_at' => '',
            'joined_at' => $now,
            'updated_at' => $now,
            'metadata_json' => '{}',
        ]);
    }

    public function initializeSiteAnnouncementReadBaseline(int $conversationId, int $userId, string $registeredAt): void
    {
        if ($registeredAt === '') {
            return;
        }
        $messageId = (int) $this->connection()->table('messaging_messages')
            ->where('conversation_id', $conversationId)
            ->where('status', 'published')
            ->where('created_at', '<', $registeredAt)
            ->max('id');
        if ($messageId <= 0) {
            return;
        }
        $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->where(function (Builder $query) use ($messageId): void {
                $query->whereNull('last_read_message_id')->orWhere('last_read_message_id', '<', $messageId);
            })
            ->update([
                'last_read_message_id' => $messageId,
                'last_read_at' => $registeredAt,
                'updated_at' => gmdate('c'),
            ]);
    }

    public function syncOrganizationMember(int $conversationId, int $userId, string $organizationRole): void
    {
        $mappedRole = match ($organizationRole) {
            'owner' => 'owner',
            'coordinator' => 'admin',
            default => 'member',
        };
        $existing = $this->member($conversationId, $userId);
        if ($mappedRole === 'member' && in_array((string) ($existing->role ?? ''), ['owner', 'admin'], true)) {
            $mappedRole = (string) $existing->role;
        }
        $this->upsertMember($conversationId, $userId, $mappedRole);
    }

    public function member(int $conversationId, int $userId): ?object
    {
        return $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first();
    }

    public function conversationMembers(int $conversationId): array
    {
        return $this->connection()->table('messaging_conversation_members as cm')
            ->join('users as u', 'u.id', '=', 'cm.user_id')
            ->where('cm.conversation_id', $conversationId)
            ->where('cm.status', 'active')
            ->whereIn('u.status', ['active', 'ok'])
            ->select('cm.*', 'u.id', 'u.username', 'u.display_name', 'u.avatar_url', 'u.bio', 'u.social_links_json', 'u.status as user_status')
            ->get()->all();
    }

    public function conversationMemberCount(int $conversationId): int
    {
        return (int) $this->connection()->table('messaging_conversation_members as cm')
            ->join('users as u', 'u.id', '=', 'cm.user_id')
            ->where('cm.conversation_id', $conversationId)
            ->where('cm.status', 'active')
            ->whereIn('u.status', ['active', 'ok'])
            ->count('cm.user_id');
    }

    public function conversationMembersPage(int $conversationId, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('messaging_conversation_members as cm')
            ->join('users as u', 'u.id', '=', 'cm.user_id')
            ->where('cm.conversation_id', $conversationId)
            ->where('cm.status', 'active')
            ->whereIn('u.status', ['active', 'ok']);
        $total = (clone $query)->count('cm.user_id');
        $rows = $query
            ->select('cm.*', 'u.id', 'u.username', 'u.display_name', 'u.avatar_url', 'u.bio', 'u.social_links_json', 'u.status as user_status')
            ->orderByRaw("CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'coordinator' THEN 2 ELSE 3 END")
            ->orderBy('u.display_name')
            ->orderBy('u.id')
            ->limit($limit)
            ->offset(($page - 1) * $limit)
            ->get()->all();
        if ($rows !== []) {
            $mutes = $this->connection()->table('messaging_conversation_mutes')
                ->where('conversation_id', $conversationId)
                ->whereIn('user_id', array_map(static fn (object $row): int => (int) $row->id, $rows))
                ->get()->keyBy('user_id');
            foreach ($rows as $row) {
                $mute = $mutes->get((int) $row->id);
                $row->moderation_muted_until = (string) ($mute->muted_until ?? '');
                $row->moderation_mute_reason = (string) ($mute->reason ?? '');
            }
        }
        return [
            'items' => array_map(fn (object $row): array => $this->memberData($row), $rows),
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'pages' => max(1, (int) ceil($total / $limit)),
        ];
    }

    public function touchPresence(int $userId, string $context = '', string $clientId = 'legacy'): array
    {
        $now = gmdate('c');
        $previous = (string) ($this->connection()->table('messaging_user_presence')
            ->where('user_id', $userId)
            ->value('last_seen_at') ?? '');
        $ttl = (int) config('wikist.messaging.presence_ttl', 40);
        $clientId = preg_match('/^[A-Za-z0-9._:-]{8,100}$/', $clientId) ? $clientId : 'legacy';
        $this->connection()->table('messaging_presence_leases')->updateOrInsert(
            ['user_id' => $userId, 'client_id' => $clientId],
            [
                'last_seen_at' => $now,
                'last_context' => mb_substr(trim($context), 0, 100),
                'updated_at' => $now,
            ],
        );
        $this->connection()->table('messaging_presence_leases')
            ->where('last_seen_at', '<', gmdate('c', time() - max(60, $ttl * 3)))
            ->delete();
        $this->connection()->table('messaging_user_presence')->updateOrInsert(
            ['user_id' => $userId],
            [
                'last_seen_at' => $now,
                'last_context' => mb_substr(trim($context), 0, 100),
                'updated_at' => $now,
            ],
        );
        return [
            'lastSeenAt' => $now,
            'becameOnline' => $previous === '' || $previous < gmdate('c', time() - $ttl),
        ];
    }

    public function releasePresence(int $userId, string $clientId): array
    {
        $clientId = preg_match('/^[A-Za-z0-9._:-]{8,100}$/', $clientId) ? $clientId : '';
        if ($clientId === '') {
            return ['becameOffline' => false, 'lastContext' => '', 'lastSeenAt' => ''];
        }
        $lease = $this->connection()->table('messaging_presence_leases')
            ->where('user_id', $userId)
            ->where('client_id', $clientId)
            ->first();
        $this->connection()->table('messaging_presence_leases')
            ->where('user_id', $userId)
            ->where('client_id', $clientId)
            ->delete();
        $ttl = (int) config('wikist.messaging.presence_ttl', 40);
        $hasFreshLease = $this->connection()->table('messaging_presence_leases')
            ->where('user_id', $userId)
            ->where('last_seen_at', '>=', gmdate('c', time() - $ttl))
            ->exists();
        if (!$hasFreshLease) {
            $this->connection()->table('messaging_user_presence')->where('user_id', $userId)->delete();
        }
        return [
            'becameOffline' => !$hasFreshLease,
            'lastContext' => (string) ($lease->last_context ?? ''),
            'lastSeenAt' => (string) ($lease->last_seen_at ?? ''),
        ];
    }

    public function recentlyOnlineUsers(array $userIds, int $seconds = 90): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map('intval', $userIds),
            static fn (int $id): bool => $id > 0,
        )));
        if ($ids === []) {
            return [];
        }
        $rows = $this->connection()->table('messaging_user_presence as p')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->whereIn('p.user_id', $ids)
            ->where('p.last_seen_at', '>=', gmdate('c', time() - max(20, min(300, $seconds))))
            ->whereIn('u.status', ['active', 'ok'])
            ->select('u.id', 'u.username', 'u.display_name', 'u.avatar_url', 'p.last_seen_at')
            ->distinct()
            ->get()->all();
        return array_map(static fn (object $row): array => [
            'id' => (int) $row->id,
            'username' => (string) $row->username,
            'displayName' => (string) ($row->display_name ?: $row->username),
            'avatarUrl' => (string) ($row->avatar_url ?? ''),
            'lastSeenAt' => (string) ($row->last_seen_at ?? ''),
        ], $rows);
    }

    public function recentlyOnlineConversationUsers(int $conversationId, int $seconds = 90, int $limit = 200): array
    {
        $rows = $this->connection()->table('messaging_conversation_members as cm')
            ->join('messaging_user_presence as p', 'p.user_id', '=', 'cm.user_id')
            ->join('users as u', 'u.id', '=', 'cm.user_id')
            ->where('cm.conversation_id', $conversationId)
            ->where('cm.status', 'active')
            ->where('p.last_seen_at', '>=', gmdate('c', time() - max(20, min(300, $seconds))))
            ->whereIn('u.status', ['active', 'ok'])
            ->select('u.id', 'u.username', 'u.display_name', 'u.avatar_url', 'p.last_seen_at')
            ->distinct()
            ->limit(max(1, min(500, $limit)))
            ->get()->all();
        return array_map(static fn (object $row): array => [
            'id' => (int) $row->id,
            'username' => (string) $row->username,
            'displayName' => (string) ($row->display_name ?: $row->username),
            'avatarUrl' => (string) ($row->avatar_url ?? ''),
            'lastSeenAt' => (string) ($row->last_seen_at ?? ''),
        ], $rows);
    }

    public function updateMembership(int $conversationId, int $userId, array $updates): void
    {
        $allowed = array_intersect_key($updates, array_flip(['notification_level', 'muted_until', 'pinned_at', 'archived_at']));
        if ($allowed === []) {
            return;
        }
        $allowed['updated_at'] = gmdate('c');
        $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->update($allowed);
    }

    public function updateConversationMetadata(int $conversationId, array $metadata): void
    {
        $this->connection()->table('messaging_conversations')->where('id', $conversationId)->update([
            'metadata_json' => $this->json($metadata),
            'updated_at' => gmdate('c'),
        ]);
    }

    public function updateConversationRole(int $conversationId, int $userId, string $role): void
    {
        $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->update(['role' => $role, 'updated_at' => gmdate('c')]);
    }

    public function conversationMute(int $conversationId, int $userId): ?object
    {
        return $this->connection()->table('messaging_conversation_mutes')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first();
    }

    public function setConversationMute(
        int $conversationId,
        int $userId,
        int $actorUserId,
        string $mutedUntil,
        string $reason = '',
    ): void {
        if ($mutedUntil === '') {
            $this->connection()->table('messaging_conversation_mutes')
                ->where('conversation_id', $conversationId)
                ->where('user_id', $userId)
                ->delete();
            return;
        }
        $now = gmdate('c');
        $this->connection()->table('messaging_conversation_mutes')->updateOrInsert(
            ['conversation_id' => $conversationId, 'user_id' => $userId],
            [
                'muted_by' => $actorUserId,
                'muted_until' => $mutedUntil,
                'reason' => mb_substr(trim($reason), 0, 300),
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function activeOrganizationMember(int $organizationId, int $userId): ?object
    {
        return $this->connection()->table('organization_members as m')
            ->join('writing_organizations as o', 'o.id', '=', 'm.organization_id')
            ->where('m.organization_id', $organizationId)
            ->where('m.user_id', $userId)
            ->where('m.status', 'active')
            ->where('o.status', 'active')
            ->select('m.*')
            ->first();
    }

    public function activeOrganizationMembers(int $organizationId): array
    {
        return $this->connection()->table('organization_members as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('m.organization_id', $organizationId)
            ->where('m.status', 'active')
            ->whereIn('u.status', ['active', 'ok'])
            ->select('m.*', 'u.username', 'u.display_name', 'u.avatar_url')
            ->get()->all();
    }

    public function organization(int|string $idOrSlug): ?object
    {
        $query = $this->connection()->table('writing_organizations');
        return is_int($idOrSlug) || ctype_digit((string) $idOrSlug)
            ? $query->where('id', (int) $idOrSlug)->first()
            : $query->where('slug', (string) $idOrSlug)->first();
    }

    public function organizationMemberships(int $userId): array
    {
        return $this->connection()->table('organization_members as m')
            ->join('writing_organizations as o', 'o.id', '=', 'm.organization_id')
            ->where('m.user_id', $userId)
            ->where('m.status', 'active')
            ->where('o.status', 'active')
            ->select('m.*', 'o.slug', 'o.name', 'o.description', 'o.avatar_image', 'o.hero_image')
            ->get()->all();
    }

    public function markStaleOrganizationMemberships(int $userId, array $activeOrganizationIds): void
    {
        $query = $this->connection()->table('messaging_conversation_members as cm')
            ->join('messaging_conversations as c', 'c.id', '=', 'cm.conversation_id')
            ->where('cm.user_id', $userId)
            ->where('c.kind', 'organization')
            ->where('cm.status', 'active');
        if ($activeOrganizationIds !== []) {
            $query->whereNotIn('c.organization_id', $activeOrganizationIds);
        }
        $ids = $query->pluck('cm.conversation_id')->all();
        if ($ids !== []) {
            $this->connection()->table('messaging_conversation_members')
                ->where('user_id', $userId)
                ->whereIn('conversation_id', $ids)
                ->update(['status' => 'removed', 'updated_at' => gmdate('c')]);
        }
    }

    public function listConversations(int $userId, array $filters): array
    {
        $limit = max(1, min(50, (int) ($filters['limit'] ?? 24)));
        $page = max(1, (int) ($filters['page'] ?? 1));
        $search = mb_strtolower(trim((string) ($filters['search'] ?? '')));
        $kind = trim((string) ($filters['kind'] ?? ''));

        $query = $this->conversationListQuery($userId);
        if ($kind !== '') {
            $query->where('c.kind', $kind);
        }
        if ($search !== '') {
            $like = '%' . $this->escapeLike($search) . '%';
            $query->where(function (Builder $builder) use ($like): void {
                $builder->whereRaw('LOWER(c.title) LIKE ? ESCAPE \'\\\'', [$like])
                    ->orWhereExists(function (Builder $memberQuery) use ($like): void {
                        $memberQuery->selectRaw('1')
                            ->from('messaging_conversation_members as sm')
                            ->join('users as su', 'su.id', '=', 'sm.user_id')
                            ->whereColumn('sm.conversation_id', 'c.id')
                            ->where(function (Builder $userQuery) use ($like): void {
                                $userQuery->whereRaw('LOWER(su.username) LIKE ? ESCAPE \'\\\'', [$like])
                                    ->orWhereRaw('LOWER(su.display_name) LIKE ? ESCAPE \'\\\'', [$like]);
                            });
                    });
            });
        }
        $total = (clone $query)->count('c.id');
        $rows = $query
            ->orderByRaw("CASE WHEN cm.pinned_at <> '' THEN 0 ELSE 1 END")
            ->orderByDesc('c.updated_at')
            ->limit($limit)
            ->offset(($page - 1) * $limit)
            ->get()->all();

        return [
            'items' => $this->hydrateConversations($rows, $userId),
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'pages' => max(1, (int) ceil($total / $limit)),
        ];
    }

    public function conversationSummary(int $conversationId, int $userId): ?array
    {
        $row = $this->conversationListQuery($userId)->where('c.id', $conversationId)->first();
        return $row ? ($this->hydrateConversations([$row], $userId)[0] ?? null) : null;
    }

    private function conversationListQuery(int $userId): Builder
    {
        return $this->connection()->table('messaging_conversation_members as cm')
            ->join('messaging_conversations as c', 'c.id', '=', 'cm.conversation_id')
            ->where('cm.user_id', $userId)
            ->where('cm.status', 'active')
            ->where('c.status', 'active')
            ->select([
                'c.*',
                'cm.role as membership_role',
                'cm.notification_level',
                'cm.last_read_message_id',
                'cm.last_read_at',
                'cm.muted_until',
                'cm.pinned_at',
                'cm.archived_at',
            ])
            ->selectRaw("(SELECT COUNT(*) FROM messaging_conversation_members mc WHERE mc.conversation_id = c.id AND mc.status = 'active') AS member_count")
            ->selectRaw('(SELECT COUNT(*) FROM messaging_messages um WHERE um.conversation_id = c.id AND um.id > COALESCE(cm.last_read_message_id, 0) AND um.status = ? AND NOT EXISTS (SELECT 1 FROM messaging_message_hidden uh WHERE uh.message_id = um.id AND uh.user_id = ?)) AS unread_count', ['published', $userId]);
    }

    private function hydrateConversations(array $rows, int $viewerId): array
    {
        if ($rows === []) {
            return [];
        }
        $conversationIds = array_map(static fn (object $row): int => (int) $row->id, $rows);
        $directIds = array_map(
            static fn (object $row): int => (int) $row->id,
            array_filter($rows, static fn (object $row): bool => (string) $row->kind === 'direct'),
        );
        $membersByConversation = [];
        if ($directIds !== []) {
            $memberRows = $this->connection()->table('messaging_conversation_members as cm')
                ->join('users as u', 'u.id', '=', 'cm.user_id')
                ->whereIn('cm.conversation_id', $directIds)
                ->where('cm.status', 'active')
                ->select('cm.*', 'u.id', 'u.username', 'u.display_name', 'u.avatar_url', 'u.bio', 'u.social_links_json', 'u.status as user_status')
                ->get()->all();
            foreach ($memberRows as $member) {
                $membersByConversation[(int) $member->conversation_id][] = $this->memberData($member);
            }
        }
        $latestIds = [];
        $latestRows = $this->connection()->table('messaging_messages as vm')
            ->whereIn('vm.conversation_id', $conversationIds)
            ->whereNotExists(function (Builder $hidden) use ($viewerId): void {
                $hidden->selectRaw('1')->from('messaging_message_hidden as vh')
                    ->whereColumn('vh.message_id', 'vm.id')
                    ->where('vh.user_id', $viewerId);
            })
            ->select('vm.conversation_id')
            ->selectRaw('MAX(vm.id) AS visible_message_id')
            ->groupBy('vm.conversation_id')
            ->get()->all();
        foreach ($latestRows as $latest) {
            $latestIds[(int) $latest->conversation_id] = (int) $latest->visible_message_id;
        }
        $latestMessages = $latestIds === [] ? [] : $this->connection()->table('messaging_messages')
            ->whereIn('id', array_values($latestIds))->get()->keyBy('id')->all();

        return array_map(function (object $row) use ($membersByConversation, $latestIds, $latestMessages, $viewerId): array {
            $members = $membersByConversation[(int) $row->id] ?? [];
            $peer = null;
            if ((string) $row->kind === 'direct') {
                foreach ($members as $member) {
                    if ((int) $member['id'] !== $viewerId) {
                        $peer = $member;
                        break;
                    }
                }
            }
            $title = (string) $row->title;
            $avatar = (string) $row->avatar_url;
            if ($peer) {
                $title = $peer['displayName'] ?: $peer['username'];
                $avatar = $peer['avatarUrl'];
            }
            $lastMessageId = $latestIds[(int) $row->id] ?? 0;
            $lastMessage = $lastMessageId > 0 ? ($latestMessages[$lastMessageId] ?? null) : null;
            $lastBody = (string) ($lastMessage->body_plain ?? '');
            if (($lastMessage->status ?? '') === 'withdrawn') {
                $lastBody = '消息已撤回';
            }
            $metadata = $this->decode((string) ($row->metadata_json ?? '{}'));
            if ((string) ($row->direct_key ?? '') === 'system:site') {
                $metadata['scope'] = 'site';
            }
            return [
                'id' => (string) $row->public_id,
                'kind' => (string) $row->kind,
                'title' => $title,
                'description' => (string) $row->description,
                'avatarUrl' => $avatar,
                'organizationId' => $row->organization_id !== null ? (int) $row->organization_id : null,
                'role' => (string) $row->membership_role,
                'notificationLevel' => (string) $row->notification_level,
                'unreadCount' => (int) $row->unread_count,
                'mutedUntil' => (string) $row->muted_until,
                'pinned' => (string) $row->pinned_at !== '',
                'archived' => (string) $row->archived_at !== '',
                'messageCount' => (int) $row->message_count,
                'members' => $members,
                'memberCount' => (int) ($row->member_count ?? count($members)),
                'peer' => $peer,
                'metadata' => $metadata,
                'lastMessage' => $lastMessage ? [
                    'id' => (string) $lastMessage->public_id,
                    'senderUserId' => $lastMessage->sender_user_id !== null ? (int) $lastMessage->sender_user_id : null,
                    'senderName' => (string) $lastMessage->sender_name,
                    'type' => (string) $lastMessage->message_type,
                    'priority' => (string) ($lastMessage->priority ?: 'normal'),
                    'mine' => (int) ($lastMessage->sender_user_id ?? 0) === $viewerId,
                    'preview' => mb_substr($lastBody, 0, 160),
                    'metadata' => $this->decode((string) ($lastMessage->metadata_json ?? '{}')),
                    'createdAt' => (string) $lastMessage->created_at,
                ] : null,
                'createdAt' => (string) $row->created_at,
                'updatedAt' => (string) $row->updated_at,
            ];
        }, $rows);
    }

    public function unreadCount(int $userId): int
    {
        return (int) $this->connection()->table('messaging_conversation_members as cm')
            ->join('messaging_conversations as c', 'c.id', '=', 'cm.conversation_id')
            ->join('messaging_messages as m', 'm.conversation_id', '=', 'c.id')
            ->where('cm.user_id', $userId)
            ->where('cm.status', 'active')
            ->where('c.status', 'active')
            ->where('m.status', 'published')
            ->whereRaw('m.id > COALESCE(cm.last_read_message_id, 0)')
            ->whereNotExists(function (Builder $hidden) use ($userId): void {
                $hidden->selectRaw('1')->from('messaging_message_hidden as mh')
                    ->whereColumn('mh.message_id', 'm.id')
                    ->where('mh.user_id', $userId);
            })
            ->count('m.id');
    }

    public function listMessages(int $conversationId, int $viewerId, ?int $beforeId, int $limit): array
    {
        $limit = max(1, min(100, $limit));
        $query = $this->connection()->table('messaging_messages')
            ->where('conversation_id', $conversationId)
            ->whereNotExists(function (Builder $hidden) use ($viewerId): void {
                $hidden->selectRaw('1')->from('messaging_message_hidden as mh')
                    ->whereColumn('mh.message_id', 'messaging_messages.id')
                    ->where('mh.user_id', $viewerId);
            });
        if ($beforeId !== null && $beforeId > 0) {
            $query->where('id', '<', $beforeId);
        }
        $rows = $query->orderByDesc('id')->limit($limit + 1)->get()->all();
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }
        $rows = array_reverse($rows);
        $items = $this->hydrateMessages($rows, $viewerId);
        return [
            'items' => $items,
            'hasMore' => $hasMore,
            'nextCursor' => $hasMore && $rows !== [] ? (int) $rows[0]->id : null,
        ];
    }

    public function messageByPublicId(string $publicId): ?object
    {
        return $this->connection()->table('messaging_messages')->where('public_id', $publicId)->first();
    }

    public function messageById(int $id): ?object
    {
        return $this->connection()->table('messaging_messages')->where('id', $id)->first();
    }

    public function hydratedMessage(int $id, int $viewerId): ?array
    {
        $row = $this->messageById($id);
        return $row ? ($this->hydrateMessages([$row], $viewerId)[0] ?? null) : null;
    }

    private function hydrateMessages(array $rows, int $viewerId): array
    {
        if ($rows === []) {
            return [];
        }
        $ids = array_map(static fn (object $row): int => (int) $row->id, $rows);
        $replyIds = array_values(array_unique(array_filter(array_map(static fn (object $row): int => (int) ($row->reply_to_message_id ?? 0), $rows))));
        $attachments = $this->connection()->table('messaging_attachments')
            ->whereIn('message_id', $ids)->where('status', 'ready')->orderBy('id')->get()->groupBy('message_id');
        $references = $this->connection()->table('messaging_object_references')
            ->whereIn('message_id', $ids)->orderBy('id')->get()->groupBy('message_id');
        $mentions = $this->connection()->table('messaging_mentions as mm')
            ->join('users as u', 'u.id', '=', 'mm.user_id')
            ->whereIn('mm.message_id', $ids)
            ->select('mm.message_id', 'u.id', 'u.username', 'u.display_name', 'u.avatar_url')
            ->get()->groupBy('message_id');
        $replies = $replyIds === [] ? null : $this->connection()->table('messaging_messages')
            ->whereIn('id', $replyIds)->get()->keyBy('id');
        $senderUsers = $this->usersByIds(array_map(static fn (object $row): int => (int) ($row->sender_user_id ?? 0), $rows));
        $conversationId = (int) $rows[0]->conversation_id;
        $readers = $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('status', 'active')
            ->where('user_id', '!=', $viewerId)
            ->get()->all();

        return array_map(function (object $row) use ($attachments, $references, $mentions, $replies, $senderUsers, $readers, $viewerId): array {
            $status = (string) $row->status;
            $body = $status === 'withdrawn' ? '' : (string) $row->body_md;
            $plain = $status === 'withdrawn' ? '消息已撤回' : (string) $row->body_plain;
            $reply = $row->reply_to_message_id && $replies ? $replies->get((int) $row->reply_to_message_id) : null;
            $messageAttachments = $attachments->get((int) $row->id);
            $messageReferences = $references->get((int) $row->id);
            $messageMentions = $mentions->get((int) $row->id);
            $senderUser = $row->sender_user_id !== null ? ($senderUsers[(int) $row->sender_user_id] ?? null) : null;
            $readBy = 0;
            foreach ($readers as $reader) {
                if ((int) ($reader->last_read_message_id ?? 0) >= (int) $row->id) {
                    $readBy++;
                }
            }
            return [
                'id' => (string) $row->public_id,
                'cursor' => (int) $row->id,
                'conversationId' => (int) $row->conversation_id,
                'sender' => [
                    'id' => $row->sender_user_id !== null ? (int) $row->sender_user_id : null,
                    'username' => (string) ($senderUser->username ?? ''),
                    'displayName' => (string) $row->sender_name,
                    'avatarUrl' => (string) $row->sender_avatar,
                ],
                'mine' => (int) ($row->sender_user_id ?? 0) === $viewerId,
                'type' => (string) $row->message_type,
                'bodyMd' => $body,
                'bodyPlain' => $plain,
                'status' => $status,
                'priority' => (string) $row->priority,
                'replyTo' => $reply ? [
                    'id' => (string) $reply->public_id,
                    'senderName' => (string) $reply->sender_name,
                    'preview' => (string) ($reply->status === 'withdrawn' ? '消息已撤回' : mb_substr((string) $reply->body_plain, 0, 180)),
                ] : null,
                'attachments' => $status === 'withdrawn' ? [] : array_map(fn (object $item): array => $this->attachmentData($item),
                    $messageAttachments ? $messageAttachments->all() : []),
                'references' => $status === 'withdrawn' ? [] : array_map(fn (object $item): array => $this->referenceData($item),
                    $messageReferences ? $messageReferences->all() : []),
                'mentions' => array_map(fn (object $item): array => $this->memberData($item),
                    $messageMentions ? $messageMentions->all() : []),
                'readByCount' => $readBy,
                'metadata' => $this->decode((string) $row->metadata_json),
                'createdAt' => (string) $row->created_at,
                'editedAt' => (string) $row->edited_at,
                'withdrawnAt' => (string) $row->withdrawn_at,
            ];
        }, $rows);
    }

    public function insertMessage(array $data): int
    {
        return (int) $this->connection()->table('messaging_messages')->insertGetId([
            'public_id' => $data['publicId'] ?? $this->newPublicId('msg'),
            'conversation_id' => $data['conversationId'],
            'sender_user_id' => $data['senderUserId'] ?? null,
            'sender_name' => $data['senderName'] ?? '',
            'sender_avatar' => $data['senderAvatar'] ?? '',
            'message_type' => $data['messageType'] ?? 'text',
            'body_md' => $data['bodyMd'] ?? '',
            'body_plain' => $data['bodyPlain'] ?? '',
            'reply_to_message_id' => $data['replyToMessageId'] ?? null,
            'status' => $data['status'] ?? 'published',
            'client_nonce' => $data['clientNonce'] ?: null,
            'priority' => $data['priority'] ?? 'normal',
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'created_at' => $data['createdAt'] ?? gmdate('c'),
            'edited_at' => '',
            'withdrawn_at' => '',
        ]);
    }

    public function findByNonce(int $conversationId, int $senderUserId, string $nonce): ?object
    {
        if ($nonce === '') {
            return null;
        }
        return $this->connection()->table('messaging_messages')
            ->where('conversation_id', $conversationId)
            ->where('sender_user_id', $senderUserId)
            ->where('client_nonce', $nonce)
            ->first();
    }

    public function updateConversationAfterMessage(int $conversationId, int $messageId, string $createdAt): void
    {
        $this->connection()->table('messaging_conversations')->where('id', $conversationId)->update([
            'last_message_id' => $messageId,
            'message_count' => $this->connection()->raw('message_count + 1'),
            'updated_at' => $createdAt,
        ]);
    }

    public function insertReferences(int $messageId, array $references): void
    {
        if ($references === []) {
            return;
        }
        $now = gmdate('c');
        $rows = array_map(fn (array $reference): array => [
            'message_id' => $messageId,
            'object_type' => $reference['type'],
            'object_id' => $reference['id'],
            'object_revision' => $reference['revision'] ?? '',
            'relation_type' => $reference['relation'] ?? 'context',
            'label' => $reference['label'] ?? '',
            'url' => $reference['url'] ?? '',
            'metadata_json' => $this->json($reference['metadata'] ?? []),
            'created_at' => $now,
        ], $references);
        $this->connection()->table('messaging_object_references')->insert($rows);
    }

    public function insertMentions(int $messageId, array $userIds): void
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $userIds), static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return;
        }
        $now = gmdate('c');
        $this->connection()->table('messaging_mentions')->insert(array_map(static fn (int $id): array => [
            'message_id' => $messageId,
            'user_id' => $id,
            'created_at' => $now,
        ], $ids));
    }

    public function markRead(int $conversationId, int $userId, int $messageId): void
    {
        $member = $this->member($conversationId, $userId);
        if (!$member || (int) ($member->last_read_message_id ?? 0) >= $messageId) {
            return;
        }
        $now = gmdate('c');
        $this->connection()->table('messaging_conversation_members')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->update(['last_read_message_id' => $messageId, 'last_read_at' => $now, 'updated_at' => $now]);
    }

    public function markAllRead(int $userId): int
    {
        $rows = $this->connection()->table('messaging_conversation_members as cm')
            ->join('messaging_conversations as c', 'c.id', '=', 'cm.conversation_id')
            ->where('cm.user_id', $userId)
            ->where('cm.status', 'active')
            ->whereNotNull('c.last_message_id')
            ->select('cm.conversation_id', 'cm.last_read_message_id', 'c.last_message_id')
            ->get()->all();
        $changed = 0;
        foreach ($rows as $row) {
            if ((int) ($row->last_read_message_id ?? 0) < (int) $row->last_message_id) {
                $this->markRead((int) $row->conversation_id, $userId, (int) $row->last_message_id);
                $changed++;
            }
        }
        return $changed;
    }

    public function lastMessageId(int $conversationId): int
    {
        return (int) ($this->connection()->table('messaging_conversations')->where('id', $conversationId)->value('last_message_id') ?? 0);
    }

    public function withdrawMessage(int $messageId): void
    {
        $this->connection()->table('messaging_messages')->where('id', $messageId)->update([
            'body_md' => '',
            'body_plain' => '',
            'status' => 'withdrawn',
            'withdrawn_at' => gmdate('c'),
        ]);
    }

    public function hideMessageForUser(int $messageId, int $userId): void
    {
        $this->connection()->table('messaging_message_hidden')->updateOrInsert(
            ['message_id' => $messageId, 'user_id' => $userId],
            ['hidden_at' => gmdate('c')],
        );
    }

    public function createAttachment(array $data): object
    {
        $now = gmdate('c');
        $id = $this->connection()->table('messaging_attachments')->insertGetId([
            'public_id' => $data['publicId'] ?? $this->newPublicId('att'),
            'message_id' => null,
            'owner_user_id' => $data['ownerUserId'],
            'storage_disk' => 'local',
            'storage_path' => $data['storagePath'],
            'original_name' => $data['originalName'],
            'mime_type' => $data['mimeType'],
            'size_bytes' => $data['sizeBytes'],
            'sha256' => $data['sha256'],
            'width' => $data['width'] ?? null,
            'height' => $data['height'] ?? null,
            'duration_ms' => $data['durationMs'] ?? null,
            'status' => 'pending',
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return $this->connection()->table('messaging_attachments')->where('id', $id)->first();
    }

    public function attachment(string $publicId): ?object
    {
        return $this->connection()->table('messaging_attachments')->where('public_id', $publicId)->first();
    }

    public function pendingAttachments(array $publicIds, int $ownerUserId): array
    {
        $ids = array_values(array_unique(array_filter(array_map('strval', $publicIds))));
        if ($ids === []) {
            return [];
        }
        return $this->connection()->table('messaging_attachments')
            ->whereIn('public_id', $ids)
            ->where('owner_user_id', $ownerUserId)
            ->whereNull('message_id')
            ->where('status', 'pending')
            ->get()->all();
    }

    public function bindAttachments(array $ids, int $messageId): void
    {
        if ($ids === []) {
            return;
        }
        $this->connection()->table('messaging_attachments')->whereIn('id', $ids)->update([
            'message_id' => $messageId,
            'status' => 'ready',
            'updated_at' => gmdate('c'),
        ]);
    }

    public function enqueueEvent(array $event): void
    {
        $now = gmdate('c');
        $this->connection()->table('messaging_outbox_events')->insert([
            'event_id' => $event['eventId'] ?? $this->newPublicId('evt'),
            'event_type' => $event['type'],
            'aggregate_type' => $event['aggregateType'],
            'aggregate_id' => (string) $event['aggregateId'],
            'channel' => $event['channel'],
            'payload_json' => $this->json($event['payload'] ?? []),
            'status' => 'pending',
            'attempts' => 0,
            'available_at' => $now,
            'published_at' => '',
            'last_error' => '',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function claimOutbox(int $limit = 50): array
    {
        return $this->transaction(function () use ($limit): array {
            $now = gmdate('c');
            $rows = $this->connection()->table('messaging_outbox_events')
                ->where('status', 'pending')
                ->where('available_at', '<=', $now)
                ->orderBy('id')
                ->limit(max(1, min(100, $limit)))
                ->get()->all();
            if ($rows === []) {
                return [];
            }
            $ids = array_map(static fn (object $row): int => (int) $row->id, $rows);
            $this->connection()->table('messaging_outbox_events')->whereIn('id', $ids)->update([
                'status' => 'processing',
                'attempts' => $this->connection()->raw('attempts + 1'),
                'updated_at' => $now,
            ]);
            return $this->connection()->table('messaging_outbox_events')->whereIn('id', $ids)->orderBy('id')->get()->all();
        });
    }

    public function completeOutbox(int $id): void
    {
        $now = gmdate('c');
        $this->connection()->table('messaging_outbox_events')->where('id', $id)->update([
            'status' => 'published', 'published_at' => $now, 'last_error' => '', 'updated_at' => $now,
        ]);
    }

    public function retryOutbox(int $id, int $attempts, string $error): void
    {
        $dead = $attempts >= 10;
        $delay = min(300, 2 ** min(8, max(1, $attempts)));
        $this->connection()->table('messaging_outbox_events')->where('id', $id)->update([
            'status' => $dead ? 'failed' : 'pending',
            'available_at' => gmdate('c', time() + $delay),
            'last_error' => mb_substr($error, 0, 1000),
            'updated_at' => gmdate('c'),
        ]);
    }

    public function resetStaleOutbox(): int
    {
        return $this->connection()->table('messaging_outbox_events')
            ->where('status', 'processing')
            ->where('updated_at', '<', gmdate('c', time() - 120))
            ->update(['status' => 'pending', 'available_at' => gmdate('c'), 'updated_at' => gmdate('c')]);
    }

    public function searchUsers(string $query, int $viewerId, int $limit = 12): array
    {
        $query = mb_strtolower(trim($query));
        if ($query === '') {
            return [];
        }
        $like = '%' . $this->escapeLike($query) . '%';
        return array_map(fn (object $row): array => $this->memberData($row), $this->connection()->table('users')
            ->where('id', '!=', $viewerId)
            ->whereIn('status', ['active', 'ok'])
            ->where(function (Builder $builder) use ($like): void {
                $builder->whereRaw('LOWER(username) LIKE ? ESCAPE \'\\\'', [$like])
                    ->orWhereRaw('LOWER(display_name) LIKE ? ESCAPE \'\\\'', [$like]);
            })
            ->orderBy('username')->limit(max(1, min(30, $limit)))->get()->all());
    }

    public function usersByUsernames(array $usernames): array
    {
        $usernames = array_values(array_unique(array_filter(array_map(
            static fn (mixed $value): string => mb_strtolower(trim((string) $value)),
            $usernames,
        ))));
        if ($usernames === []) {
            return [];
        }
        return $this->connection()->table('users')
            ->whereIn($this->connection()->raw('LOWER(username)'), $usernames)
            ->whereIn('status', ['active', 'ok'])
            ->get()->all();
    }

    private function attachmentData(object $row): array
    {
        return [
            'id' => (string) $row->public_id,
            'name' => (string) $row->original_name,
            'mimeType' => (string) $row->mime_type,
            'size' => (int) $row->size_bytes,
            'width' => $row->width !== null ? (int) $row->width : null,
            'height' => $row->height !== null ? (int) $row->height : null,
            'url' => '/api/messaging/attachments/' . rawurlencode((string) $row->public_id),
        ];
    }

    private function referenceData(object $row): array
    {
        return [
            'type' => (string) $row->object_type,
            'id' => (string) $row->object_id,
            'revision' => (string) $row->object_revision,
            'relation' => (string) $row->relation_type,
            'label' => (string) $row->label,
            'url' => (string) $row->url,
            'metadata' => $this->decode((string) $row->metadata_json),
        ];
    }

    private function memberData(object $row): array
    {
        return [
            'id' => (int) ($row->id ?? $row->user_id ?? 0),
            'username' => (string) ($row->username ?? ''),
            'displayName' => (string) ($row->display_name ?? $row->username ?? ''),
            'avatarUrl' => (string) ($row->avatar_url ?? ''),
            'bio' => (string) ($row->bio ?? ''),
            'socialLinks' => $this->decode((string) ($row->social_links_json ?? '{}')),
            'role' => (string) ($row->role ?? 'member'),
            'status' => (string) ($row->user_status ?? $row->status ?? 'active'),
            'mutedUntil' => (string) ($row->moderation_muted_until ?? ''),
            'muteReason' => (string) ($row->moderation_mute_reason ?? ''),
        ];
    }

    private function json(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function decode(string $json): array
    {
        $data = json_decode($json, true);
        return is_array($data) ? $data : [];
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
