<?php

namespace app\service;

use app\domain\passport\RolePolicy;
use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\CommunityRepository;

final class CommunityPermissionService
{
    private const ORGANIZATION_MODERATOR_ROLES = ['owner', 'coordinator', 'reviewer', 'admin', 'moderator'];

    public function __construct(private readonly CommunityRepository $community = new CommunityRepository())
    {
    }

    public function assertActive(UserIdentity $identity): void
    {
        if (!$identity->isActive()) {
            throw new ApiException('该账号已被封禁，不能参与社区。', 403, 'community_account_disabled');
        }
    }

    public function spaceForCreate(UserIdentity $identity, string $organization): object
    {
        $this->assertActive($identity);
        if (trim($organization) === '') {
            return $this->community->publicSpace();
        }
        $record = $this->community->organization($organization);
        if (!$record || (string) $record->status !== 'active') {
            throw new ApiException('协作组织不存在或不可用。', 404, 'community_organization_not_found');
        }
        if (!$this->isSiteModerator($identity) && !$this->community->organizationMembership((int) $record->id, $identity->id)) {
            throw new ApiException('只有组织成员可以在该空间发布内容。', 403, 'community_organization_membership_required');
        }
        return $this->community->organizationSpace($record, $identity->id);
    }

    public function assertQuestionReadable(object $question, ?UserIdentity $identity): void
    {
        if ((string) $question->status === 'deleted') {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
        if (!$question->organization_id || (string) $question->visibility === 'public' || ($identity && $this->isSiteModerator($identity))) {
            return;
        }
        if (!$identity || !$this->community->organizationMembership((int) $question->organization_id, $identity->id)) {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
    }

    public function assertCanWriteQuestion(UserIdentity $identity, object $question): void
    {
        $this->assertActive($identity);
        $this->assertQuestionReadable($question, $identity);
        if ((string) $question->status === 'closed') {
            throw new ApiException('问题已关闭，暂时不能新增回答或评论。', 409, 'community_question_closed');
        }
        if ($question->organization_id && !$this->isSiteModerator($identity)
            && !$this->community->organizationMembership((int) $question->organization_id, $identity->id)) {
            throw new ApiException('只有组织成员可以参与该空间。', 403, 'community_organization_membership_required');
        }
    }

    public function assertCanEdit(UserIdentity $identity, string $objectType, object $object): void
    {
        $this->assertActive($identity);
        if ((int) $object->author_user_id === $identity->id || $this->canModerateObject($identity, $objectType, $object)) {
            if ($objectType === 'comment' && (int) $object->author_user_id === $identity->id && !$this->canModerateObject($identity, $objectType, $object)) {
                $deadline = max(60, (int) config('wikist.community.comment_edit_window', 300));
                if ((strtotime((string) $object->created_at) ?: 0) + $deadline < time()) {
                    throw new ApiException('评论已超过可编辑时间。', 409, 'community_comment_edit_window_expired');
                }
            }
            return;
        }
        throw new ApiException('你没有权限编辑该内容。', 403, 'community_edit_forbidden');
    }

    public function assertCanDelete(UserIdentity $identity, string $objectType, object $object): void
    {
        $this->assertActive($identity);
        if ((int) $object->author_user_id === $identity->id || $this->canModerateObject($identity, $objectType, $object)) {
            return;
        }
        throw new ApiException('你没有权限删除该内容。', 403, 'community_delete_forbidden');
    }

    public function assertCanClose(UserIdentity $identity, object $question): void
    {
        $this->assertActive($identity);
        if ((int) $question->author_user_id === $identity->id || $this->canModerateObject($identity, 'question', $question)) {
            return;
        }
        throw new ApiException('只有提问者或审核成员可以关闭和重开问题。', 403, 'community_close_forbidden');
    }

    public function assertCanAccept(UserIdentity $identity, object $question, object $answer): void
    {
        $this->assertActive($identity);
        if ((int) $answer->question_id !== (int) $question->id || (string) $answer->status !== 'published') {
            throw new ApiException('回答不存在或不可采纳。', 404, 'community_answer_not_found');
        }
        if ((int) $question->author_user_id === $identity->id || $this->canModerateObject($identity, 'question', $question)) {
            return;
        }
        throw new ApiException('只有提问者或审核成员可以采纳回答。', 403, 'community_accept_forbidden');
    }

    public function assertCanInvite(UserIdentity $identity, object $question): void
    {
        $this->assertCanWriteQuestion($identity, $question);
        if ((int) $question->author_user_id === $identity->id || $this->canModerateObject($identity, 'question', $question)) {
            return;
        }
        throw new ApiException('只有提问者或审核成员可以邀请回答。', 403, 'community_invite_forbidden');
    }

    public function assertCanVote(UserIdentity $identity, string $objectType, object $object): void
    {
        $this->assertActive($identity);
        if ((int) $object->author_user_id === $identity->id) {
            throw new ApiException('不能给自己的内容投票。', 409, 'community_self_vote_forbidden');
        }
        if ((string) ($object->status ?? 'published') !== 'published') {
            throw new ApiException('该内容当前不能投票。', 409, 'community_vote_unavailable');
        }
        if ($objectType === 'question') {
            $this->assertQuestionReadable($object, $identity);
            return;
        }
        $questionId = $objectType === 'answer' ? (int) $object->question_id : (int) $object->question_id;
        $question = $this->community->questionRaw($questionId);
        if (!$question) {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
        $this->assertQuestionReadable($question, $identity);
    }

    public function assertModerator(UserIdentity $identity, ?int $organizationId = null): void
    {
        $this->assertActive($identity);
        if ($this->isSiteModerator($identity)) {
            return;
        }
        if ($organizationId) {
            $member = $this->community->organizationMembership($organizationId, $identity->id);
            if ($member && $this->isOrganizationModeratorRole((string) $member->role)) {
                return;
            }
        }
        throw new ApiException('需要社区审核权限。', 403, 'community_moderation_required');
    }

    public function capabilities(?UserIdentity $identity, ?object $question = null): array
    {
        if (!$identity || !$identity->isActive()) {
            return [
                'createQuestion' => false, 'answer' => false, 'comment' => false, 'vote' => false,
                'moderate' => false, 'edit' => false, 'delete' => false, 'close' => false, 'accept' => false, 'invite' => false,
            ];
        }
        $moderate = $question ? $this->canModerateObject($identity, 'question', $question) : $this->isSiteModerator($identity);
        return [
            'createQuestion' => true,
            'answer' => !$question || (string) $question->status === 'published',
            'comment' => !$question || (string) $question->status === 'published',
            'vote' => true,
            'moderate' => $moderate,
            'edit' => $question ? ((int) $question->author_user_id === $identity->id || $moderate) : false,
            'delete' => $question ? ((int) $question->author_user_id === $identity->id || $moderate) : false,
            'close' => $question ? ((int) $question->author_user_id === $identity->id || $moderate) : false,
            'accept' => $question ? ((int) $question->author_user_id === $identity->id || $moderate) : false,
            'invite' => $question ? ((string) $question->status === 'published' && ((int) $question->author_user_id === $identity->id || $moderate)) : false,
        ];
    }

    public function isOrganizationModeratorRole(string $role): bool
    {
        return in_array(strtolower(trim($role)), self::ORGANIZATION_MODERATOR_ROLES, true);
    }

    private function canModerateObject(UserIdentity $identity, string $objectType, object $object): bool
    {
        if ($this->isSiteModerator($identity)) {
            return true;
        }
        $organizationId = null;
        if ($objectType === 'question') {
            $organizationId = $object->organization_id ? (int) $object->organization_id : null;
        } else {
            $question = $this->community->questionRaw((int) $object->question_id);
            $organizationId = $question?->organization_id ? (int) $question->organization_id : null;
        }
        if (!$organizationId) {
            return false;
        }
        $membership = $this->community->organizationMembership($organizationId, $identity->id);
        return $membership && $this->isOrganizationModeratorRole((string) $membership->role);
    }

    private function isSiteModerator(UserIdentity $identity): bool
    {
        return RolePolicy::allows($identity->role, 'senior_editor');
    }
}
