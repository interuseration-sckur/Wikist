<?php

namespace app\service;

use app\domain\passport\UserIdentity;

/**
 * Stable API facade for Wikist Native Community.
 *
 * This facade is the only Community entry point. All Q&A behavior and data
 * are owned by Wikist and executed inside Webman.
 */
final class CommunityQaService
{
    public function __construct(private readonly NativeCommunityService $native = new NativeCommunityService())
    {
    }

    public function bootstrap(?UserIdentity $identity): array
    {
        return $this->native->bootstrap($identity);
    }

    public function questions(array $filters = [], ?UserIdentity $identity = null): array
    {
        return $this->native->questions($filters, $identity);
    }

    public function question(string $questionId, ?UserIdentity $identity = null, int $answerPage = 1, string $viewerKey = ''): array
    {
        return $this->native->question($questionId, $identity, $answerPage, $viewerKey);
    }

    public function comments(string $objectType, string $objectId, int $page, int $limit, ?UserIdentity $identity): array
    {
        return $this->native->comments($objectType, $objectId, $page, $limit, $identity);
    }

    public function related(string $type, string $id, int $page = 1, int $limit = 8, ?UserIdentity $identity = null): array
    {
        return $this->native->related($type, $id, $page, $limit, $identity);
    }

    public function objectPreview(string $type, string $id, ?UserIdentity $identity = null): array
    {
        return $this->native->objectPreview($type, $id, $identity);
    }

    public function search(array $filters = [], ?UserIdentity $identity = null): array
    {
        return $this->native->search($filters, $identity);
    }

    public function tags(string $query, int $page, int $limit, ?UserIdentity $identity): array
    {
        return $this->native->tags($query, $page, $limit, $identity);
    }

    public function activity(array $filters, ?UserIdentity $identity): array
    {
        return $this->native->activity($filters, $identity);
    }

    public function createQuestion(UserIdentity $identity, array $input): array
    {
        return $this->native->createQuestion($identity, $input);
    }

    public function updateQuestion(UserIdentity $identity, string $questionId, array $input): array
    {
        return $this->native->updateQuestion($identity, $questionId, $input);
    }

    public function proposeQuestionRevision(UserIdentity $identity, string $questionId, array $input): array
    {
        return $this->native->proposeQuestionRevision($identity, $questionId, $input);
    }

    public function deleteQuestion(UserIdentity $identity, string $questionId): array
    {
        return $this->native->deleteQuestion($identity, $questionId);
    }

    public function setQuestionOpen(UserIdentity $identity, string $questionId, bool $open, string $reason = ''): array
    {
        return $this->native->setQuestionOpen($identity, $questionId, $open, $reason);
    }

    public function inviteAnswer(UserIdentity $identity, string $questionId, array $input): array
    {
        return $this->native->inviteAnswer($identity, $questionId, $input);
    }

    public function respondAnswerInvite(UserIdentity $identity, string $inviteId, array $input): array
    {
        return $this->native->respondAnswerInvite($identity, $inviteId, $input);
    }

    public function createAnswer(UserIdentity $identity, string $questionId, array $input): array
    {
        return $this->native->createAnswer($identity, $questionId, $input);
    }

    public function updateAnswer(UserIdentity $identity, string $answerId, array $input): array
    {
        return $this->native->updateAnswer($identity, $answerId, $input);
    }

    public function deleteAnswer(UserIdentity $identity, string $answerId): array
    {
        return $this->native->deleteAnswer($identity, $answerId);
    }

    public function acceptAnswer(UserIdentity $identity, string $questionId, string $answerId): array
    {
        return $this->native->acceptAnswer($identity, $questionId, $answerId);
    }

    public function unacceptAnswer(UserIdentity $identity, string $questionId, string $answerId): array
    {
        return $this->native->unacceptAnswer($identity, $questionId, $answerId);
    }

    public function createComment(UserIdentity $identity, string $objectId, array $input): array
    {
        return $this->native->createComment($identity, $objectId, $input);
    }

    public function updateComment(UserIdentity $identity, string $commentId, array $input): array
    {
        return $this->native->updateComment($identity, $commentId, $input);
    }

    public function deleteComment(UserIdentity $identity, string $commentId): array
    {
        return $this->native->deleteComment($identity, $commentId);
    }

    public function vote(UserIdentity $identity, string $objectType, string $objectId, int $value): array
    {
        return $this->native->vote($identity, $objectType, $objectId, $value);
    }

    public function reaction(UserIdentity $identity, string $objectType, string $objectId, string $reaction): array
    {
        return $this->native->reaction($identity, $objectType, $objectId, $reaction);
    }

    public function collection(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        return $this->native->collection($identity, $objectType, $objectId, $input);
    }

    public function follow(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        return $this->native->follow($identity, $objectType, $objectId, $input);
    }

    public function collections(UserIdentity $identity, int $page, int $limit): array
    {
        return $this->native->collections($identity, $page, $limit);
    }

    public function follows(UserIdentity $identity, int $page, int $limit): array
    {
        return $this->native->follows($identity, $page, $limit);
    }

    public function revisions(string $objectType, string $objectId, int $page, int $limit, ?UserIdentity $identity): array
    {
        return $this->native->revisions($objectType, $objectId, $page, $limit, $identity);
    }

    public function revisionDiff(string $objectType, string $objectId, string $from, string $to, ?UserIdentity $identity): array
    {
        return $this->native->revisionDiff($objectType, $objectId, $from, $to, $identity);
    }

    public function report(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        return $this->native->report($identity, $objectType, $objectId, $input);
    }

    public function reports(UserIdentity $identity, string $status, int $page, int $limit, ?int $organizationId): array
    {
        return $this->native->reports($identity, $status, $page, $limit, $organizationId);
    }

    public function moderationOverview(UserIdentity $identity): array
    {
        return $this->native->moderationOverview($identity);
    }

    public function resolveReport(UserIdentity $identity, string $reportId, array $input): array
    {
        return $this->native->resolveReport($identity, $reportId, $input);
    }

    public function reviews(UserIdentity $identity, string $status, int $page, int $limit, ?int $organizationId): array
    {
        return $this->native->reviews($identity, $status, $page, $limit, $organizationId);
    }

    public function decideReview(UserIdentity $identity, string $reviewId, array $input): array
    {
        return $this->native->decideReview($identity, $reviewId, $input);
    }

    public function reputation(int $userId, int $page, int $limit, ?UserIdentity $identity): array
    {
        return $this->native->reputation($userId, $page, $limit, $identity);
    }

    public function badges(int $userId): array
    {
        return $this->native->badges($userId);
    }

    public function wikiDraft(UserIdentity $identity, string $questionId, string $answerId, array $input): array
    {
        return $this->native->wikiDraft($identity, $questionId, $answerId, $input);
    }
}
