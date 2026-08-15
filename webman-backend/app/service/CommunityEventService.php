<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\repository\CommunityRepository;
use app\repository\KnowledgeGraphRepository;
use app\repository\UserRepository;

final class CommunityEventService
{
    public function __construct(
        private readonly CommunityRepository $community = new CommunityRepository(),
        private readonly KnowledgeGraphRepository $graph = new KnowledgeGraphRepository(),
        private readonly UserRepository $users = new UserRepository(),
        private readonly MessagingService $messaging = new MessagingService(),
        private readonly AchievementService $achievements = new AchievementService(),
    ) {
    }

    public function questionCreated(UserIdentity $actor, object $question, array $tags, ?array $source = null): array
    {
        $object = $this->syncQuestion($question, $tags);
        $activityId = $this->community->recordActivity([
            'actorUserId' => $actor->id,
            'eventType' => 'question.created',
            'objectType' => 'question',
            'objectId' => (int) $question->id,
            'spaceId' => (int) $question->space_id,
            'organizationId' => $question->organization_id ? (int) $question->organization_id : null,
            'metadata' => ['publicId' => (string) $question->public_id, 'title' => (string) $question->title, 'tags' => $tags],
        ]);
        $this->community->addReputation($actor->id, $actor->id, $activityId, 'question.created', 2, 'question', (int) $question->id);
        if ($source && trim((string) ($source['id'] ?? '')) !== '') {
            $sourceObject = $this->contextObject($source);
            if ($sourceObject) {
                $this->graph->relate($object['globalId'], 'discusses', $sourceObject['globalId'], [
                    'actorUserId' => $actor->id,
                    'source' => 'wikist',
                    'metadata' => ['selectionText' => mb_substr((string) ($source['selectedText'] ?? ''), 0, 2000)],
                ]);
            }
        }
        $this->linkContentReferences($object, (string) $question->body_md, $actor->id);
        $tagFollowers = $this->community->readableRecipientIds($question, $this->community->tagFollowerIds($tags));
        $this->notifyMany($tagFollowers, $actor->id, [
            'title' => '关注的标签有新问题',
            'bodyMd' => '@' . $actor->username . ' 发布了《' . (string) $question->title . '》。',
            'eventType' => 'community.tag.question.created',
            'references' => [$this->reference('question', (string) $question->public_id, (string) $question->title)],
            'metadata' => ['tags' => $tags],
        ]);
        $this->notifyBadgeAwards($actor);
        return $object;
    }

    public function questionUpdated(UserIdentity $actor, object $question, array $tags, string $eventType = 'question.updated'): array
    {
        $object = $this->syncQuestion($question, $tags);
        $this->community->recordActivity([
            'actorUserId' => $actor->id,
            'eventType' => $eventType,
            'objectType' => 'question',
            'objectId' => (int) $question->id,
            'spaceId' => (int) $question->space_id,
            'organizationId' => $question->organization_id ? (int) $question->organization_id : null,
            'metadata' => ['publicId' => (string) $question->public_id, 'title' => (string) $question->title],
        ]);
        $this->linkContentReferences($object, (string) $question->body_md, $actor->id);
        $recipients = $this->community->readableRecipientIds($question, $this->community->followerIds('question', (int) $question->id));
        $this->notifyMany($recipients, $actor->id, [
            'title' => '关注的问题已更新',
            'bodyMd' => '《' . (string) $question->title . '》有新的编辑。',
            'eventType' => 'community.question.updated',
            'references' => [$this->reference('question', (string) $question->public_id, (string) $question->title)],
        ]);
        return $object;
    }

    public function answerCreated(UserIdentity $actor, object $answer, object $question): array
    {
        $object = $this->syncAnswerKnowledge($answer, $question, $actor->id);
        $activityId = $this->community->recordActivity([
            'actorUserId' => $actor->id,
            'eventType' => 'answer.created',
            'objectType' => 'answer',
            'objectId' => (int) $answer->id,
            'parentType' => 'question',
            'parentId' => (int) $question->id,
            'spaceId' => (int) $question->space_id,
            'organizationId' => $question->organization_id ? (int) $question->organization_id : null,
            'metadata' => ['publicId' => (string) $answer->public_id, 'questionId' => (string) $question->public_id, 'title' => (string) $question->title],
        ]);
        $this->community->addReputation($actor->id, $actor->id, $activityId, 'answer.created', 2, 'answer', (int) $answer->id);
        $recipients = $this->community->readableRecipientIds($question,
            array_unique(array_merge([(int) $question->author_user_id], $this->community->followerIds('question', (int) $question->id))));
        $this->notifyMany($recipients, $actor->id, [
            'title' => '问题有了新回答',
            'bodyMd' => '@' . $actor->username . ' 回答了《' . (string) $question->title . '》。',
            'eventType' => 'community.answer.created',
            'references' => [
                $this->reference('question', (string) $question->public_id, (string) $question->title),
                $this->reference('answer', (string) $answer->public_id, '查看回答'),
            ],
        ]);
        $this->notifyMentions($actor, (string) $answer->body_md, $this->reference('answer', (string) $answer->public_id, '社区回答'));
        $this->notifyBadgeAwards($actor);
        return $object;
    }

    public function answerInvited(UserIdentity $actor, object $question, object $invite, object $invitee): void
    {
        $this->notifyMany([(int) $invite->invitee_user_id], $actor->id, [
            'title' => '邀请你回答社区问题',
            'bodyMd' => '@' . $actor->username . ' 邀请你回答《' . (string) $question->title . '》。'
                . (trim((string) $invite->message) !== '' ? "\n\n" . (string) $invite->message : ''),
            'eventType' => 'community.answer.invited',
            'references' => [$this->reference('question', (string) $question->public_id, (string) $question->title)],
            'metadata' => [
                'invitationId' => (string) $invite->public_id,
                'inviteeUsername' => (string) $invitee->username,
                'organizationId' => $question->organization_id ? (int) $question->organization_id : null,
            ],
        ]);
    }

    public function answerUpdated(UserIdentity $actor, object $answer, object $question): array
    {
        $object = $this->syncAnswerKnowledge($answer, $question, $actor->id);
        $this->community->recordActivity([
            'actorUserId' => $actor->id, 'eventType' => 'answer.updated', 'objectType' => 'answer',
            'objectId' => (int) $answer->id, 'parentType' => 'question', 'parentId' => (int) $question->id,
            'spaceId' => (int) $question->space_id, 'organizationId' => $question->organization_id ?: null,
            'metadata' => ['publicId' => (string) $answer->public_id, 'questionId' => (string) $question->public_id],
        ]);
        return $object;
    }

    public function commentCreated(UserIdentity $actor, object $comment, object $question, object $target): array
    {
        $parent = (string) $comment->target_type === 'question'
            ? $this->syncQuestion($question, [])
            : $this->syncAnswer($target, $question);
        $object = $this->syncComment($comment, $question);
        $this->graph->relate($object['globalId'], 'comments_on', $parent['globalId'], [
            'actorUserId' => $actor->id, 'source' => 'wikist',
        ]);
        $this->community->recordActivity([
            'actorUserId' => $actor->id, 'eventType' => 'comment.created', 'objectType' => 'comment',
            'objectId' => (int) $comment->id, 'parentType' => (string) $comment->target_type, 'parentId' => (int) $comment->target_id,
            'spaceId' => (int) $question->space_id, 'organizationId' => $question->organization_id ?: null,
            'metadata' => ['publicId' => (string) $comment->public_id, 'questionId' => (string) $question->public_id],
        ]);
        $recipients = $this->community->readableRecipientIds($question, array_filter(array_unique([
            (int) $target->author_user_id,
            $comment->reply_user_id ? (int) $comment->reply_user_id : 0,
            ...$this->community->followerIds('question', (int) $question->id),
        ])));
        $this->notifyMany($recipients, $actor->id, [
            'title' => '社区有新评论',
            'bodyMd' => '@' . $actor->username . ' 在《' . (string) $question->title . '》中补充了评论。',
            'eventType' => 'community.comment.created',
            'references' => [
                $this->reference('question', (string) $question->public_id, (string) $question->title),
                $this->reference('comment', (string) $comment->public_id, '查看评论'),
            ],
        ]);
        $this->notifyMentions($actor, (string) $comment->body_md, $this->reference('comment', (string) $comment->public_id, '社区评论'));
        $this->linkContentReferences($object, (string) $comment->body_md, $actor->id);
        return $object;
    }

    public function voteChanged(UserIdentity $actor, string $objectType, object $object, int $previous, int $current): void
    {
        if ($previous === $current) {
            return;
        }
        $authorId = (int) $object->author_user_id;
        $delta = $this->voteReputationDelta($objectType, $previous, $current);
        $event = $this->community->recordActivity([
            'actorUserId' => $actor->id,
            'eventType' => $current === 0 ? $objectType . '.vote.canceled' : $objectType . ($current > 0 ? '.upvoted' : '.downvoted'),
            'objectType' => $objectType,
            'objectId' => (int) $object->id,
            'reputationDelta' => $delta,
            'metadata' => ['from' => $previous, 'to' => $current, 'publicId' => (string) $object->public_id],
        ]);
        if ($delta !== 0) {
            $this->community->addReputation($authorId, $actor->id, $event, $objectType . '.vote', $delta, $objectType, (int) $object->id);
            $identity = $this->users->findById($authorId);
            if ($identity && $authorId !== $actor->id && $current > 0) {
                $this->messaging->notifyUser($identity, [
                    'title' => '你的内容获得赞同',
                    'bodyMd' => '@' . $actor->username . ' 赞同了你的' . ($objectType === 'question' ? '问题' : '回答') . '。',
                    'source' => 'community',
                    'eventType' => 'community.vote.received',
                    'references' => [$this->reference($objectType, (string) $object->public_id, '查看内容')],
                ]);
            }
            if ($identity) {
                $this->notifyBadgeAwards($identity);
            }
        }
    }

    public function answerAccepted(UserIdentity $actor, object $answer, object $question): void
    {
        $activity = $this->community->recordActivity([
            'actorUserId' => $actor->id, 'eventType' => 'answer.accepted', 'objectType' => 'answer',
            'objectId' => (int) $answer->id, 'parentType' => 'question', 'parentId' => (int) $question->id,
            'spaceId' => (int) $question->space_id, 'organizationId' => $question->organization_id ?: null,
            'reputationDelta' => 15,
            'metadata' => ['publicId' => (string) $answer->public_id, 'questionId' => (string) $question->public_id],
        ]);
        $this->community->addReputation((int) $answer->author_user_id, $actor->id, $activity, 'answer.accepted', 15, 'answer', (int) $answer->id);
        $recipient = $this->users->findById((int) $answer->author_user_id);
        if ($recipient && $recipient->id !== $actor->id) {
            $this->messaging->notifyUser($recipient, [
                'title' => '回答已被采纳',
                'bodyMd' => '你在《' . (string) $question->title . '》中的回答已被采纳。',
                'source' => 'community', 'eventType' => 'community.answer.accepted',
                'references' => [$this->reference('answer', (string) $answer->public_id, '查看回答')],
            ]);
        }
        if ($recipient) {
            $this->notifyBadgeAwards($recipient);
        }
    }

    public function answerAcceptanceRevoked(UserIdentity $actor, object $answer, object $question): void
    {
        $activity = $this->community->recordActivity([
            'actorUserId' => $actor->id, 'eventType' => 'answer.acceptance_revoked', 'objectType' => 'answer',
            'objectId' => (int) $answer->id, 'parentType' => 'question', 'parentId' => (int) $question->id,
            'spaceId' => (int) $question->space_id, 'organizationId' => $question->organization_id ?: null,
            'reputationDelta' => -15,
            'metadata' => ['publicId' => (string) $answer->public_id, 'questionId' => (string) $question->public_id],
        ]);
        $this->community->addReputation((int) $answer->author_user_id, $actor->id, $activity, 'answer.acceptance_revoked', -15, 'answer', (int) $answer->id);
        $recipient = $this->users->findById((int) $answer->author_user_id);
        if ($recipient && $recipient->id !== $actor->id && $recipient->isActive()) {
            $this->messaging->notifyUser($recipient, [
                'title' => '回答采纳状态已更新',
                'bodyMd' => '你在《' . (string) $question->title . '》中的回答不再是采纳答案。',
                'source' => 'community', 'eventType' => 'community.answer.acceptance_revoked',
                'references' => [$this->reference('answer', (string) $answer->public_id, '查看回答')],
            ]);
        }
    }

    public function reactionChanged(UserIdentity $actor, string $objectType, object $object, array $result): void
    {
        $active = (bool) ($result['active'] ?? false);
        $reaction = (string) ($result['reaction'] ?? 'like');
        // Reactions remain an engagement and notification signal, but are too
        // frequent and reversible to be useful in the public activity stream.
        if (!$active || (int) $object->author_user_id === $actor->id) {
            return;
        }
        $recipient = $this->users->findById((int) $object->author_user_id);
        if ($recipient && $recipient->isActive()) {
            $this->messaging->notifyUser($recipient, [
                'title' => '你的社区内容收到互动',
                'bodyMd' => '@' . $actor->username . ' 对你的' . $this->typeLabel($objectType) . '添加了“' . $reaction . '”。',
                'source' => 'community',
                'eventType' => 'community.reaction.received',
                'references' => [$this->reference($objectType, (string) $object->public_id, '查看内容')],
                'metadata' => ['reaction' => $reaction],
            ]);
        }
    }

    public function reportResolved(UserIdentity $actor, object $report, string $status, string $resolution): void
    {
        $recipient = $this->users->findById((int) $report->reporter_user_id);
        if (!$recipient || !$recipient->isActive() || $recipient->id === $actor->id) {
            return;
        }
        $this->messaging->notifyUser($recipient, [
            'title' => '社区举报已处理',
            'bodyMd' => $status === 'resolved' ? '你提交的举报已处理。' : '你提交的举报经审核后未予处理。',
            'source' => 'community',
            'eventType' => 'community.report.decided',
            'metadata' => ['reportId' => (string) $report->public_id, 'status' => $status, 'resolution' => mb_substr($resolution, 0, 500)],
        ]);
    }

    public function reviewDecided(UserIdentity $actor, object $review, string $status, string $opinion): void
    {
        $recipient = $this->users->findById((int) $review->requested_by);
        if (!$recipient || !$recipient->isActive() || $recipient->id === $actor->id) {
            return;
        }
        $this->messaging->notifyUser($recipient, [
            'title' => '社区修订审核完成',
            'bodyMd' => $status === 'approved' ? '你提交的社区修订已通过审核。' : '你提交的社区修订需要调整。',
            'source' => 'community',
            'eventType' => 'community.review.decided',
            'metadata' => ['reviewId' => (string) $review->public_id, 'status' => $status, 'opinion' => mb_substr($opinion, 0, 1000)],
        ]);
    }

    public function moderated(UserIdentity $actor, string $eventType, string $objectType, object $object, array $metadata = []): void
    {
        $this->community->recordActivity([
            'actorUserId' => $actor->id, 'eventType' => $eventType, 'objectType' => $objectType,
            'objectId' => (int) $object->id, 'metadata' => $metadata + ['publicId' => (string) $object->public_id],
        ]);
        $recipient = $this->users->findById((int) $object->author_user_id);
        if ($recipient && $recipient->id !== $actor->id) {
            $this->messaging->notifyUser($recipient, [
                'title' => '社区内容状态已更新',
                'bodyMd' => '你的' . $this->typeLabel($objectType) . '状态已变更。',
                'source' => 'community', 'eventType' => 'community.content.moderated',
                'references' => [$this->reference($objectType, (string) $object->public_id, '查看内容')],
                'metadata' => ['action' => $eventType] + $metadata,
            ]);
        }
    }

    public function syncQuestion(object $question, array $tags): array
    {
        if ($tags === []) {
            $rows = $this->community->connection()->table('community_question_tags as qt')
                ->join('community_tags as t', 't.id', '=', 'qt.tag_id')->where('qt.question_id', $question->id)
                ->orderBy('t.name')->pluck('t.name')->all();
            $tags = array_map('strval', $rows);
        }
        return $this->graph->upsertObject([
            'type' => 'question', 'key' => (string) $question->public_id, 'source' => 'wikist',
            'externalId' => (string) $question->public_id, 'title' => (string) $question->title,
            'summary' => mb_substr((string) $question->body_plain, 0, 600),
            'url' => '#/questions/' . rawurlencode((string) $question->public_id),
            'language' => (string) $question->language, 'organizationId' => $question->organization_id ?: null,
            'authorUserId' => (int) $question->author_user_id,
            'status' => in_array((string) $question->status, ['published', 'closed'], true) ? 'active' : (string) $question->status,
            'searchText' => implode(' ', [(string) $question->title, (string) $question->body_plain, implode(' ', $tags)]),
            'metadata' => ['numericId' => (int) $question->id, 'tags' => $tags, 'status' => (string) $question->status,
                'visibility' => (string) $question->visibility, 'private' => (string) $question->visibility !== 'public'],
        ]);
    }

    public function syncAnswer(object $answer, object $question): array
    {
        return $this->graph->upsertObject([
            'type' => 'answer', 'key' => (string) $answer->public_id, 'source' => 'wikist',
            'externalId' => (string) $answer->public_id, 'title' => '回答：' . (string) $question->title,
            'summary' => mb_substr((string) $answer->body_plain, 0, 600),
            'url' => '#/questions/' . rawurlencode((string) $question->public_id) . '?answer=' . rawurlencode((string) $answer->public_id),
            'language' => (string) $question->language, 'organizationId' => $question->organization_id ?: null,
            'authorUserId' => (int) $answer->author_user_id,
            'status' => (string) $answer->status === 'published' ? 'active' : (string) $answer->status,
            'searchText' => (string) $answer->body_plain,
            'metadata' => ['numericId' => (int) $answer->id, 'questionId' => (string) $question->public_id,
                'accepted' => (bool) $answer->is_accepted, 'private' => (string) $question->visibility !== 'public'],
        ]);
    }

    public function syncAnswerKnowledge(object $answer, object $question, ?int $actorId = null): array
    {
        $questionObject = $this->syncQuestion($question, []);
        $object = $this->syncAnswer($answer, $question);
        $resolvedActorId = $actorId && $actorId > 0 ? $actorId : (int) $answer->author_user_id;
        $this->graph->relate($object['globalId'], 'answers', $questionObject['globalId'], [
            'actorUserId' => $resolvedActorId,
            'source' => 'wikist',
        ]);
        $this->linkContentReferences($object, (string) $answer->body_md, $resolvedActorId);
        return $object;
    }

    public function syncComment(object $comment, object $question): array
    {
        return $this->graph->upsertObject([
            'type' => 'comment', 'key' => (string) $comment->public_id, 'source' => 'wikist',
            'externalId' => (string) $comment->public_id, 'title' => '评论：' . (string) $question->title,
            'summary' => mb_substr((string) $comment->body_plain, 0, 600),
            'url' => '#/questions/' . rawurlencode((string) $question->public_id) . '?comment=' . rawurlencode((string) $comment->public_id),
            'language' => (string) $question->language, 'organizationId' => $question->organization_id ?: null,
            'authorUserId' => (int) $comment->author_user_id,
            'status' => (string) $comment->status === 'published' ? 'active' : (string) $comment->status,
            'searchText' => (string) $comment->body_plain,
            'metadata' => ['numericId' => (int) $comment->id, 'questionId' => (string) $question->public_id,
                'targetType' => (string) $comment->target_type, 'targetId' => (int) $comment->target_id,
                'private' => (string) $question->visibility !== 'public'],
        ]);
    }

    private function notifyMany(array $userIds, int $actorId, array $notification): void
    {
        foreach (array_unique(array_map('intval', $userIds)) as $userId) {
            if ($userId <= 0 || $userId === $actorId) {
                continue;
            }
            $recipient = $this->users->findById($userId);
            if ($recipient && $recipient->isActive()) {
                $this->messaging->notifyUser($recipient, $notification + ['source' => 'community']);
            }
        }
    }

    private function notifyMentions(UserIdentity $actor, string $body, array $reference): void
    {
        preg_match_all('/(?<![\p{L}\p{N}_.-])@([\p{L}\p{N}_.-]{2,40})/u', $body, $matches);
        foreach (array_unique($matches[1] ?? []) as $username) {
            $row = $this->community->connection()->table('users')->where('username', $username)->first();
            if (!$row || (int) $row->id === $actor->id) {
                continue;
            }
            $recipient = $this->users->findById((int) $row->id);
            if ($recipient && $recipient->isActive()) {
                $this->messaging->notifyUser($recipient, [
                    'title' => '你在社区中被提及',
                    'bodyMd' => '@' . $actor->username . ' 在社区内容中提到了你。',
                    'source' => 'community', 'eventType' => 'community.mention.created',
                    'references' => [$reference],
                ]);
            }
        }
    }

    private function notifyBadgeAwards(UserIdentity $identity): void
    {
        foreach ($this->achievements->sync($identity->id, true) as $badge) {
            $this->messaging->notifyUser($identity, [
                'title' => '获得新成就',
                'bodyMd' => '你解锁了“' . $badge['name'] . '”成就。',
                'source' => 'achievement', 'eventType' => 'achievement.awarded',
                'metadata' => ['badge' => $badge],
            ]);
        }
    }

    private function linkContentReferences(array $subject, string $content, int $actorId): void
    {
        preg_match_all('/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/u', $content, $wikiMatches, PREG_SET_ORDER);
        foreach ($wikiMatches as $match) {
            $target = $this->contextObject(['type' => 'wiki_entry', 'id' => trim((string) $match[1]), 'label' => trim((string) ($match[2] ?? $match[1]))]);
            if ($target) {
                $this->graph->relate($subject['globalId'], 'references', $target['globalId'], ['actorUserId' => $actorId, 'source' => 'wikist']);
            }
        }
        preg_match_all('/\{\{ref:([a-z_]+)\|([^|{}]+)\|([^{}]+)\}\}/i', $content, $referenceMatches, PREG_SET_ORDER);
        foreach ($referenceMatches as $match) {
            $target = $this->contextObject(['type' => strtolower($match[1]), 'id' => trim($match[2]), 'label' => trim($match[3])]);
            if ($target) {
                $this->graph->relate($subject['globalId'], 'references', $target['globalId'], ['actorUserId' => $actorId, 'source' => 'wikist']);
            }
        }
    }

    private function contextObject(array $context): ?array
    {
        try {
            $resolved = (new KnowledgeObjectResolver())->resolve($context);
            $type = KnowledgeObjectId::normalizeType((string) $resolved['type']);
            $key = (string) $resolved['id'];
            $existing = $this->graph->findBySource('wikist', $type, $key);
            if ($existing) {
                return $existing;
            }
            return $this->graph->upsertObject([
                'type' => $type, 'key' => $key, 'source' => 'wikist', 'title' => (string) ($resolved['label'] ?? $key),
                'summary' => (string) ($resolved['metadata']['summary'] ?? ''), 'url' => (string) ($resolved['url'] ?? ''),
                'status' => 'active', 'metadata' => $resolved['metadata'] ?? [],
            ]);
        } catch (\Throwable) {
            return null;
        }
    }

    private function reference(string $type, string $id, string $label): array
    {
        return ['type' => $type, 'id' => $id, 'label' => $label, 'relation' => 'context'];
    }

    private function voteReputationDelta(string $objectType, int $from, int $to): int
    {
        $weight = $objectType === 'answer' ? 10 : 5;
        $score = static fn (int $vote): int => $vote > 0 ? $weight : ($vote < 0 ? -2 : 0);
        return $score($to) - $score($from);
    }

    private function typeLabel(string $type): string
    {
        return ['question' => '问题', 'answer' => '回答', 'comment' => '评论'][$type] ?? '内容';
    }
}
