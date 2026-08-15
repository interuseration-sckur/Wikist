<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\MessagingRepository;

final class MessagingPermissionService
{
    public function __construct(private readonly MessagingRepository $messages = new MessagingRepository())
    {
    }

    public function synchronize(UserIdentity $identity): void
    {
        $this->messages->transaction(function () use ($identity): void {
            $personal = $this->messages->ensureConversation([
                'kind' => 'system',
                'directKey' => 'system:user:' . $identity->id,
                'title' => '通知中心',
                'description' => '与你相关的站内通知、提及与协作动态。',
                'metadata' => ['scope' => 'personal'],
            ]);
            $this->messages->upsertMember((int) $personal->id, $identity->id, 'member');

            $site = $this->messages->ensureConversation([
                'kind' => 'system',
                'directKey' => 'system:site',
                'title' => '全站公告',
                'description' => '来自站点管理团队的公开消息。',
                'metadata' => ['scope' => 'site'],
            ]);
            $this->messages->upsertMember((int) $site->id, $identity->id, 'member');
            $this->messages->initializeSiteAnnouncementReadBaseline((int) $site->id, $identity->id, $identity->createdAt);

            $activeOrganizationIds = [];
            foreach ($this->messages->organizationMemberships($identity->id) as $membership) {
                $organizationId = (int) $membership->organization_id;
                $activeOrganizationIds[] = $organizationId;
                $conversation = $this->messages->ensureConversation([
                    'kind' => 'organization',
                    'directKey' => 'organization:' . $organizationId,
                    'title' => (string) $membership->name,
                    'description' => (string) $membership->description,
                    'avatarUrl' => (string) ($membership->avatar_image ?: ''),
                    'organizationId' => $organizationId,
                    'ownerUserId' => null,
                    'metadata' => ['organizationSlug' => (string) $membership->slug],
                ]);
                $this->messages->syncOrganizationMember((int) $conversation->id, $identity->id, (string) $membership->role);
            }
            $this->messages->markStaleOrganizationMemberships($identity->id, $activeOrganizationIds);
        });
    }

    public function conversation(UserIdentity $identity, string $publicId, bool $forSending = false): object
    {
        $conversation = $this->messages->findConversation($publicId);
        if (!$conversation || (string) $conversation->status !== 'active') {
            throw new ApiException('会话不存在或已经关闭。', 404, 'conversation_not_found');
        }
        $this->assertConversationAccess($identity, $conversation);
        if ($forSending) {
            $this->assertCanSend($identity, $conversation);
        }
        return $conversation;
    }

    public function assertConversationAccess(UserIdentity $identity, object $conversation): void
    {
        if ((string) $conversation->kind === 'organization') {
            $membership = $this->messages->activeOrganizationMember((int) $conversation->organization_id, $identity->id);
            if (!$membership && $identity->role !== 'admin') {
                throw new ApiException('你不是该组织的有效成员。', 403, 'organization_membership_required');
            }
            if ($membership) {
                $this->messages->syncOrganizationMember(
                    (int) $conversation->id,
                    $identity->id,
                    (string) $membership->role,
                );
            } else {
                $this->messages->upsertMember((int) $conversation->id, $identity->id, 'admin');
            }
            return;
        }

        $member = $this->messages->member((int) $conversation->id, $identity->id);
        if ((!$member || (string) $member->status !== 'active') && $identity->role !== 'admin') {
            throw new ApiException('你无权访问该会话。', 403, 'conversation_access_denied');
        }
        if (!$member && $identity->role === 'admin' && (string) $conversation->kind === 'system') {
            $this->messages->upsertMember((int) $conversation->id, $identity->id, 'admin');
        }
    }

    public function assertCanSend(UserIdentity $identity, object $conversation): void
    {
        if ((string) $conversation->kind === 'system') {
            throw new ApiException('通知中心和系统公告不开放回复，请通过后台发布渠道发送。', 403, 'system_conversation_read_only');
        }
        if ((string) $conversation->kind !== 'organization' || $identity->role === 'admin') {
            return;
        }
        $member = $this->messages->member((int) $conversation->id, $identity->id);
        if (!$member || (string) $member->status !== 'active') {
            throw new ApiException('你不是该群聊的有效成员。', 403, 'organization_chat_membership_required');
        }
        $role = (string) ($member->role ?? 'member');
        $metadata = json_decode((string) ($conversation->metadata_json ?? '{}'), true);
        if (!empty($metadata['allMuted']) && !in_array($role, ['owner', 'admin'], true)) {
            throw new ApiException('群聊当前已开启全体禁言。', 403, 'organization_chat_all_muted');
        }
        $mute = $this->messages->conversationMute((int) $conversation->id, $identity->id);
        if ($mute && (string) $mute->muted_until > gmdate('c')) {
            throw new ApiException('你当前处于禁言状态。', 403, 'organization_chat_member_muted', [
                'mutedUntil' => (string) $mute->muted_until,
                'reason' => (string) ($mute->reason ?? ''),
            ]);
        }
    }

    public function assertCanModerate(UserIdentity $identity, object $conversation): object
    {
        if ((string) $conversation->kind !== 'organization') {
            throw new ApiException('只有组织群聊支持成员管理。', 422, 'organization_chat_required');
        }
        $member = $this->messages->member((int) $conversation->id, $identity->id);
        if ($identity->role !== 'admin' && !in_array((string) ($member->role ?? ''), ['owner', 'admin'], true)) {
            throw new ApiException('只有群主和群管理员可以管理群聊。', 403, 'organization_chat_moderation_denied');
        }
        return $member ?? (object) ['role' => 'admin', 'user_id' => $identity->id];
    }

    public function assertCanManageRoles(UserIdentity $identity, object $conversation): object
    {
        $member = $this->assertCanModerate($identity, $conversation);
        if ($identity->role !== 'admin' && (string) ($member->role ?? '') !== 'owner') {
            throw new ApiException('只有群主可以任命或调整群管理员。', 403, 'organization_chat_role_denied');
        }
        return $member;
    }

    public function assertCanWithdraw(UserIdentity $identity, object $message): void
    {
        if ((string) $message->status === 'withdrawn') {
            throw new ApiException('消息已经撤回。', 409, 'message_already_withdrawn');
        }
        if ((int) ($message->sender_user_id ?? 0) !== $identity->id) {
            throw new ApiException('只能撤回自己发送的消息。', 403, 'message_withdraw_denied');
        }
        $window = max(60, (int) config('wikist.messaging.withdraw_window', 300));
        if (strtotime((string) $message->created_at) < time() - $window) {
            throw new ApiException('消息已超过可撤回时间。', 409, 'message_withdraw_expired', ['windowSeconds' => $window]);
        }
    }

}
