<?php

namespace app\service;

use app\domain\passport\RolePolicy;
use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\CommunityRepository;
use app\repository\KnowledgeGraphRepository;

final class NativeCommunityService
{
    private const OBJECT_TYPES = ['question', 'answer', 'comment'];
    private const REACTIONS = ['like', 'insightful', 'clear', 'helpful', 'curious'];

    public function __construct(
        private readonly CommunityRepository $community = new CommunityRepository(),
        private readonly CommunityPermissionService $permissions = new CommunityPermissionService(),
        private readonly CommunityEventService $events = new CommunityEventService(),
        private readonly KnowledgeGraphRepository $graph = new KnowledgeGraphRepository(),
        private readonly CommunityAttachmentService $attachments = new CommunityAttachmentService(),
        private readonly CommunityMarkdownService $markdown = new CommunityMarkdownService(),
    ) {
    }

    public function bootstrap(?UserIdentity $identity): array
    {
        return [
            'enabled' => true,
            'connected' => $identity?->isActive() ?? false,
            'native' => true,
            'sourceOfTruth' => 'wikist',
            'identity' => $identity ? $identity->toArray(true) : null,
            'connectUrl' => '/passport?mode=login&return=' . rawurlencode('#/questions'),
            'capabilities' => [
                'questions' => true, 'answers' => true, 'comments' => true,
                'qualityVotes' => true, 'reactions' => true, 'collections' => true, 'follows' => true,
                'tags' => true, 'revisions' => true, 'moderation' => true,
                'reputation' => true, 'badges' => true, 'organizations' => true,
                'knowledgeReferences' => true, 'selectionSources' => true, 'wikiDrafts' => true,
                'answerInvitations' => true,
            ],
            'permissions' => $this->permissions->capabilities($identity),
        ];
    }

    public function questions(array $filters = [], ?UserIdentity $identity = null): array
    {
        return $this->community->questionPage($filters, $identity) + [
            'source' => 'wikist-native', 'degraded' => false, 'cache' => 'database',
        ];
    }

    public function question(string $questionId, ?UserIdentity $identity = null, int $answerPage = 1, string $viewerKey = ''): array
    {
        $raw = $this->requireQuestion($questionId, $identity);
        if ($viewerKey !== '') {
            $this->community->recordView((int) $raw->id, $viewerKey, $identity?->id);
        }
        $question = $this->community->question((string) $raw->public_id, $identity);
        if (!$question) {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
        $question = $this->renderBody($question);
        $questionComments = $this->community->commentPage('question', (int) $raw->id, 1, 8);
        foreach ($questionComments['items'] as &$comment) {
            $comment = $this->renderBody($comment);
            $comment['permissions'] = $this->objectPermissions($identity, 'comment', (int) $comment['numericId']);
        }
        $question['comments'] = $questionComments['items'];
        $question['commentsPagination'] = $this->pagination($questionComments);
        $question['permissions'] = $this->permissions->capabilities($identity, $raw);
        $question['invitations'] = $identity
            ? $this->community->answerInvitePage((int) $raw->id, 1, 8, $question['permissions']['invite'] ? null : $identity->id)
            : ['items' => [], 'page' => 1, 'limit' => 8, 'total' => 0, 'pages' => 1];
        $questionObject = $this->graph->findBySource('wikist', 'question', (string) $raw->public_id)
            ?? $this->events->syncQuestion($raw, []);
        $answers = $this->community->answerPage((int) $raw->id, $answerPage, 20, $identity);
        foreach ($answers['items'] as &$answer) {
            $answerRaw = $this->community->answer((int) $answer['numericId']);
            if ($answerRaw) {
                $answerObject = $this->graph->findBySource('wikist', 'answer', (string) $answerRaw->public_id);
                if (!$answerObject || !$this->graph->relationExists($answerObject['globalId'], 'answers', $questionObject['globalId'])) {
                    $this->events->syncAnswerKnowledge($answerRaw, $raw, (int) $answerRaw->author_user_id);
                }
            }
            $answer = $this->renderBody($answer);
            $answer['comments'] = [];
            $answer['commentsPagination'] = [
                'page' => 1, 'limit' => 8, 'total' => (int) ($answer['commentCount'] ?? 0),
                'pages' => max(1, (int) ceil(((int) ($answer['commentCount'] ?? 0)) / 8)),
            ];
            $answer['permissions'] = $this->objectPermissions($identity, 'answer', (int) $answer['numericId']);
        }
        unset($answer);
        $visibleOrganizationIds = $this->community->visibleOrganizationIds($identity);
        $directRelations = $this->graph->related(
            $questionObject['globalId'],
            ['references', 'discusses', 'derived_from'],
            1,
            50,
            $visibleOrganizationIds,
        );
        $answerReferences = $this->graph->referencesFromIncomingSubjects(
            $questionObject['globalId'],
            'answers',
            ['answer'],
            ['references'],
            50,
            $visibleOrganizationIds,
        );
        $relations = $this->questionKnowledgeRelations($directRelations['items'], $answerReferences, 24);
        return [
            'question' => $question,
            'answers' => $answers,
            'relations' => $relations,
            'source' => 'wikist-native',
            'degraded' => false,
            'cache' => 'database',
        ];
    }

    public function comments(string $objectType, string $objectId, int $page, int $limit, ?UserIdentity $identity): array
    {
        [$object, $question] = $this->objectAndQuestion($objectType, $objectId, $identity);
        $comments = $this->community->commentPage($objectType, (int) $object->id, $page, $limit);
        foreach ($comments['items'] as &$comment) {
            $comment = $this->renderBody($comment);
            $comment['permissions'] = $this->objectPermissions($identity, 'comment', (int) $comment['numericId']);
        }
        return $comments + [
            'objectType' => $objectType,
            'objectId' => (string) $object->public_id,
            'questionId' => (string) $question->public_id,
        ];
    }

    public function search(array $filters = [], ?UserIdentity $identity = null): array
    {
        $query = trim((string) ($filters['query'] ?? ''));
        $page = max(1, (int) ($filters['page'] ?? 1));
        $limit = max(1, min(50, (int) ($filters['limit'] ?? 12)));
        if ($query === '') {
            return ['items' => [], 'page' => $page, 'limit' => $limit, 'total' => 0, 'pages' => 1, 'source' => 'wikist-native'];
        }
        return $this->graph->search(
            $query,
            ['question', 'answer', 'comment', 'wiki_entry', 'user', 'organization'],
            $page,
            $limit,
            $this->community->visibleOrganizationIds($identity),
        ) + ['source' => 'wikist-native'];
    }

    public function tags(string $query, int $page, int $limit, ?UserIdentity $identity): array
    {
        return $this->community->tagPage($query, $page, $limit, $identity?->id);
    }

    public function activity(array $filters, ?UserIdentity $identity): array
    {
        return $this->community->activityPage($identity, $filters);
    }

    public function createQuestion(UserIdentity $identity, array $input): array
    {
        $this->permissions->assertActive($identity);
        $title = trim((string) ($input['title'] ?? ''));
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        if (mb_strlen($title) < 6 || mb_strlen($title) > 150) {
            throw new ApiException('问题标题需为 6 至 150 个字符。', 422, 'community_question_title_invalid');
        }
        if (mb_strlen($body) < 10 || mb_strlen($body) > 65535) {
            throw new ApiException('请补充问题背景、已知条件或尝试过程。', 422, 'community_question_content_invalid');
        }
        $tags = $this->normalizeTags((array) ($input['tags'] ?? []));
        if ($tags === []) {
            throw new ApiException('请至少选择一个问题标签。', 422, 'community_question_tag_required');
        }
        $space = $this->permissions->spaceForCreate($identity, (string) ($input['organization'] ?? ''));
        $visibility = (string) $space->visibility;
        $source = is_array($input['source'] ?? null) ? $input['source'] : null;
        $question = $this->community->transaction(function () use ($identity, $input, $title, $body, $tags, $space, $visibility, $source): object {
            $question = $this->community->insertQuestion([
                'spaceId' => (int) $space->id,
                'organizationId' => $space->organization_id ? (int) $space->organization_id : null,
                'authorUserId' => $identity->id,
                'title' => $title,
                'bodyMd' => $body,
                'bodyPlain' => $this->plain($body),
                'language' => $this->language((string) ($input['language'] ?? 'zh-CN')),
                'visibility' => $visibility,
            ]);
            $this->community->syncTags((int) $question->id, $tags, $identity->id);
            $this->community->setQuestionSource((int) $question->id, $source);
            $this->community->insertRevision([
                'objectType' => 'question', 'objectId' => (int) $question->id, 'editorUserId' => $identity->id,
                'title' => $title, 'bodyMd' => $body, 'tags' => $tags, 'summary' => '创建问题', 'status' => 'approved',
            ]);
            $this->community->toggleFollow($identity->id, 'question', (int) $question->id, 'all');
            $this->attachments->bind($identity, (array) ($input['attachments'] ?? []), 'question', (int) $question->id);
            return $question;
        });
        $object = $this->events->questionCreated($identity, $question, $tags, $source);
        return [
            'question' => $this->questionData($question, $identity),
            'object' => $object,
            'url' => '#/questions/' . rawurlencode((string) $question->public_id),
        ];
    }

    public function updateQuestion(UserIdentity $identity, string $questionId, array $input): array
    {
        $question = $this->requireQuestion($questionId, $identity, true);
        $this->permissions->assertCanEdit($identity, 'question', $question);
        $title = trim((string) ($input['title'] ?? $question->title));
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? $question->body_md));
        if (mb_strlen($title) < 6 || mb_strlen($title) > 150 || mb_strlen($body) < 10 || mb_strlen($body) > 65535) {
            throw new ApiException('问题标题或正文长度不符合要求。', 422, 'community_question_invalid');
        }
        $tags = array_key_exists('tags', $input)
            ? $this->normalizeTags((array) $input['tags'])
            : array_map('strval', $this->community->connection()->table('community_question_tags as qt')
                ->join('community_tags as t', 't.id', '=', 'qt.tag_id')->where('qt.question_id', $question->id)->pluck('t.name')->all());
        if ($tags === []) {
            throw new ApiException('请至少保留一个问题标签。', 422, 'community_question_tag_required');
        }
        $this->community->transaction(function () use ($identity, $question, $title, $body, $tags, $input): void {
            $this->community->updateQuestion((int) $question->id, [
                'title' => $title, 'body_md' => $body, 'body_plain' => $this->plain($body),
                'language' => $this->language((string) ($input['language'] ?? $question->language)),
                'last_activity_at' => gmdate('c'),
            ]);
            $this->community->syncTags((int) $question->id, $tags, $identity->id);
            $this->community->insertRevision([
                'objectType' => 'question', 'objectId' => (int) $question->id, 'editorUserId' => $identity->id,
                'title' => $title, 'bodyMd' => $body, 'tags' => $tags,
                'summary' => (string) ($input['summary'] ?? '编辑问题'), 'status' => 'approved',
            ]);
            $this->attachments->bind($identity, (array) ($input['attachments'] ?? []), 'question', (int) $question->id);
        });
        $updated = $this->community->questionRaw((int) $question->id);
        $object = $this->events->questionUpdated($identity, $updated, $tags);
        return ['question' => $this->questionData($updated, $identity), 'object' => $object];
    }

    public function proposeQuestionRevision(UserIdentity $identity, string $questionId, array $input): array
    {
        $question = $this->requireQuestion($questionId, $identity);
        $this->permissions->assertActive($identity);
        $title = trim((string) ($input['title'] ?? $question->title));
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        $tags = $this->normalizeTags((array) ($input['tags'] ?? []));
        if (mb_strlen($title) < 6 || mb_strlen($body) < 10 || $tags === []) {
            throw new ApiException('请填写完整的修订标题、正文和标签。', 422, 'community_revision_invalid');
        }
        $revision = $this->community->transaction(function () use ($identity, $question, $title, $body, $tags, $input): object {
            $revision = $this->community->insertRevision([
                'objectType' => 'question', 'objectId' => (int) $question->id, 'editorUserId' => $identity->id,
                'title' => $title, 'bodyMd' => $body, 'tags' => $tags,
                'summary' => (string) ($input['summary'] ?? '社区修订建议'), 'status' => 'pending',
            ]);
            $this->community->insertReview('question_revision', (int) $revision->id, 'revision', $identity->id,
                (string) ($input['summary'] ?? '社区修订建议'), ['questionId' => (int) $question->id],
                $question->organization_id ? (int) $question->organization_id : null);
            return $revision;
        });
        return ['revision' => $this->revisionData($revision), 'queued' => true];
    }

    public function deleteQuestion(UserIdentity $identity, string $questionId): array
    {
        $question = $this->requireQuestion($questionId, $identity, true);
        $this->permissions->assertCanDelete($identity, 'question', $question);
        $this->community->transaction(function () use ($question, $identity): void {
            $this->community->setQuestionStatus((int) $question->id, 'deleted', $identity->id);
            $this->community->purgeQuestionEcosystem((int) $question->id);
        });
        $deleted = $this->community->questionRaw((int) $question->id);
        $this->events->questionUpdated($identity, $deleted, [], 'question.deleted');
        return ['ok' => true, 'id' => (string) $question->public_id, 'status' => 'deleted'];
    }

    public function setQuestionOpen(UserIdentity $identity, string $questionId, bool $open, string $reason = ''): array
    {
        $question = $this->requireQuestion($questionId, $identity, true);
        $this->permissions->assertCanClose($identity, $question);
        $status = $open ? 'published' : 'closed';
        if ((string) $question->status === $status) {
            return ['question' => $this->questionData($question, $identity)];
        }
        $this->community->setQuestionStatus((int) $question->id, $status, $identity->id, $reason);
        $updated = $this->community->questionRaw((int) $question->id);
        $this->events->questionUpdated($identity, $updated, [], $open ? 'question.reopened' : 'question.closed');
        return ['question' => $this->questionData($updated, $identity)];
    }

    public function inviteAnswer(UserIdentity $identity, string $questionId, array $input): array
    {
        $question = $this->requireQuestion($questionId, $identity);
        $this->permissions->assertCanInvite($identity, $question);
        $identifier = trim((string) ($input['userId'] ?? $input['username'] ?? ''));
        $invitee = $this->community->userByIdentifier($identifier);
        if (!$invitee || !in_array((string) $invitee->status, ['active', 'ok'], true)) {
            throw new ApiException('受邀用户不存在或当前不可用。', 404, 'community_invitee_not_found');
        }
        if ((int) $invitee->id === $identity->id) {
            throw new ApiException('不能邀请自己回答。', 409, 'community_invite_self');
        }
        $inviteeIdentity = new UserIdentity(
            (int) $invitee->id,
            (string) $invitee->username,
            (string) $invitee->email,
            (string) $invitee->display_name,
            (string) $invitee->role,
            (string) $invitee->status,
        );
        $this->permissions->assertQuestionReadable($question, $inviteeIdentity);
        if ($this->community->connection()->table('community_answers')->where('question_id', $question->id)
            ->where('author_user_id', $invitee->id)->where('status', 'published')->exists()) {
            throw new ApiException('该用户已经回答过这个问题。', 409, 'community_invitee_already_answered');
        }
        $result = $this->community->upsertAnswerInvite(
            (int) $question->id,
            $identity->id,
            (int) $invitee->id,
            (string) ($input['message'] ?? ''),
        );
        if (!$result['changed']) {
            throw new ApiException('该用户已在邀请名单中。', 409, 'community_invite_exists');
        }
        $this->events->answerInvited($identity, $question, $result['record'], $invitee);
        return [
            'invitation' => $this->community->answerInvitePage((int) $question->id, 1, 50, (int) $invitee->id)['items'][0] ?? null,
            'source' => 'wikist-native',
        ];
    }

    public function respondAnswerInvite(UserIdentity $identity, string $inviteId, array $input): array
    {
        $this->permissions->assertActive($identity);
        $invite = $this->community->answerInvite($inviteId);
        if (!$invite || (int) $invite->invitee_user_id !== $identity->id || (string) $invite->status !== 'pending') {
            throw new ApiException('待处理邀请不存在。', 404, 'community_invite_not_found');
        }
        $status = strtolower(trim((string) ($input['status'] ?? 'dismissed')));
        if (!in_array($status, ['accepted', 'dismissed'], true)) {
            throw new ApiException('邀请处理状态无效。', 422, 'community_invite_status_invalid');
        }
        $updated = $this->community->decideAnswerInvite($inviteId, $identity->id, $status);
        return ['ok' => true, 'id' => $inviteId, 'status' => (string) $updated->status];
    }

    public function createAnswer(UserIdentity $identity, string $questionId, array $input): array
    {
        $question = $this->requireQuestion($questionId, $identity);
        $this->permissions->assertCanWriteQuestion($identity, $question);
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        if (mb_strlen($body) < 6 || mb_strlen($body) > 65535) {
            throw new ApiException('回答需为 6 至 65535 个字符。', 422, 'community_answer_content_invalid');
        }
        if ((bool) config('wikist.community.restrict_duplicate_answers', true)
            && $this->community->connection()->table('community_answers')->where('question_id', $question->id)
                ->where('author_user_id', $identity->id)->where('status', 'published')->exists()) {
            throw new ApiException('你已经回答过该问题，可以继续编辑原回答。', 409, 'community_answer_already_exists');
        }
        $answer = $this->community->transaction(function () use ($identity, $question, $body, $input): object {
            $answer = $this->community->insertAnswer([
                'questionId' => (int) $question->id,
                'authorUserId' => $identity->id,
                'bodyMd' => $body,
                'bodyPlain' => $this->plain($body),
            ]);
            $this->community->insertRevision([
                'objectType' => 'answer', 'objectId' => (int) $answer->id, 'editorUserId' => $identity->id,
                'bodyMd' => $body, 'summary' => '创建回答', 'status' => 'approved',
            ]);
            $this->community->refreshQuestionCounts((int) $question->id);
            $this->ensureFollow($identity->id, 'question', (int) $question->id);
            $this->attachments->bind($identity, (array) ($input['attachments'] ?? []), 'answer', (int) $answer->id);
            return $answer;
        });
        $question = $this->community->questionRaw((int) $question->id);
        $this->community->completeAnswerInvite((int) $question->id, $identity->id);
        $object = $this->events->answerCreated($identity, $answer, $question);
        return ['answer' => $this->answerData($answer, $identity), 'object' => $object];
    }

    public function updateAnswer(UserIdentity $identity, string $answerId, array $input): array
    {
        $answer = $this->requireAnswer($answerId);
        $question = $this->requireQuestion((int) $answer->question_id, $identity, true);
        $this->permissions->assertCanEdit($identity, 'answer', $answer);
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        if (mb_strlen($body) < 6 || mb_strlen($body) > 65535) {
            throw new ApiException('回答需为 6 至 65535 个字符。', 422, 'community_answer_content_invalid');
        }
        $this->community->transaction(function () use ($identity, $answer, $body, $input): void {
            $this->community->updateAnswer((int) $answer->id, ['body_md' => $body, 'body_plain' => $this->plain($body)]);
            $this->community->insertRevision([
                'objectType' => 'answer', 'objectId' => (int) $answer->id, 'editorUserId' => $identity->id,
                'bodyMd' => $body, 'summary' => (string) ($input['summary'] ?? '编辑回答'), 'status' => 'approved',
            ]);
            $this->attachments->bind($identity, (array) ($input['attachments'] ?? []), 'answer', (int) $answer->id);
        });
        $updated = $this->community->answer((int) $answer->id);
        $object = $this->events->answerUpdated($identity, $updated, $question);
        return ['answer' => $this->answerData($updated, $identity), 'object' => $object];
    }

    public function deleteAnswer(UserIdentity $identity, string $answerId): array
    {
        $answer = $this->requireAnswer($answerId);
        $question = $this->requireQuestion((int) $answer->question_id, $identity, true);
        $this->permissions->assertCanDelete($identity, 'answer', $answer);
        $this->community->transaction(function () use ($answer, $question): void {
            $this->community->setAnswerStatus((int) $answer->id, 'deleted');
            $this->community->purgeObjectEngagements('answer', (int) $answer->id);
            if ((int) ($question->accepted_answer_id ?? 0) === (int) $answer->id) {
                $this->community->updateQuestion((int) $question->id, ['accepted_answer_id' => null]);
            }
            $this->community->refreshQuestionCounts((int) $question->id);
        });
        $deleted = $this->community->answer((int) $answer->id);
        $this->events->moderated($identity, 'answer.deleted', 'answer', $deleted);
        return ['ok' => true, 'id' => (string) $answer->public_id, 'status' => 'deleted'];
    }

    public function acceptAnswer(UserIdentity $identity, string $questionId, string $answerId): array
    {
        $question = $this->requireQuestion($questionId, $identity, true);
        $answer = $this->requireAnswer($answerId);
        $this->permissions->assertCanAccept($identity, $question, $answer);
        $previousId = (int) ($question->accepted_answer_id ?? 0);
        if ($previousId === (int) $answer->id) {
            return ['answer' => $this->answerData($answer, $identity), 'accepted' => true];
        }
        $previous = $previousId ? $this->community->answer($previousId) : null;
        $this->community->acceptAnswer((int) $question->id, (int) $answer->id);
        if ($previous) {
            $this->events->answerAcceptanceRevoked($identity, $previous, $question);
        }
        $accepted = $this->community->answer((int) $answer->id);
        $this->events->answerAccepted($identity, $accepted, $question);
        return ['answer' => $this->answerData($accepted, $identity), 'accepted' => true];
    }

    public function unacceptAnswer(UserIdentity $identity, string $questionId, string $answerId): array
    {
        $question = $this->requireQuestion($questionId, $identity, true);
        $answer = $this->requireAnswer($answerId);
        $this->permissions->assertCanAccept($identity, $question, $answer);
        if (!$this->community->clearAcceptedAnswer((int) $question->id, (int) $answer->id)) {
            throw new ApiException('该回答当前未被采纳。', 409, 'community_answer_not_accepted');
        }
        $updated = $this->community->answer((int) $answer->id);
        $this->events->answerAcceptanceRevoked($identity, $updated, $question);
        return ['answer' => $this->answerData($updated, $identity), 'accepted' => false];
    }

    public function createComment(UserIdentity $identity, string $objectId, array $input): array
    {
        $objectType = strtolower(trim((string) ($input['objectType'] ?? '')));
        if (!in_array($objectType, ['question', 'answer'], true)) {
            throw new ApiException('请明确评论的是问题还是回答。', 422, 'community_comment_target_invalid');
        }
        [$target, $question] = $this->objectAndQuestion($objectType, $objectId, $identity);
        $this->permissions->assertCanWriteQuestion($identity, $question);
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        if (mb_strlen($body) < 2 || mb_strlen($body) > 2000) {
            throw new ApiException('评论需为 2 至 2000 个字符。', 422, 'community_comment_invalid');
        }
        $reply = null;
        $replyId = trim((string) ($input['replyToCommentId'] ?? ''));
        if ($replyId !== '') {
            $reply = $this->requireComment($replyId);
            if ((string) $reply->target_type !== $objectType || (int) $reply->target_id !== (int) $target->id) {
                throw new ApiException('回复的评论不属于当前内容。', 422, 'community_comment_reply_target_invalid');
            }
            $replyUser = $this->community->user((int) $reply->author_user_id);
            if ($replyUser && !preg_match('/(^|\s)@' . preg_quote((string) $replyUser->username, '/') . '\b/u', $body)) {
                $body = '@' . (string) $replyUser->username . ' ' . $body;
            }
        }
        $comment = $this->community->transaction(function () use ($identity, $target, $question, $objectType, $body, $reply, $input): object {
            $comment = $this->community->insertComment([
                'questionId' => (int) $question->id, 'targetType' => $objectType, 'targetId' => (int) $target->id,
                'authorUserId' => $identity->id, 'replyToCommentId' => $reply?->id,
                'replyUserId' => $reply?->author_user_id, 'bodyMd' => $body, 'bodyPlain' => $this->plain($body),
            ]);
            $this->attachments->bind($identity, (array) ($input['attachments'] ?? []), 'comment', (int) $comment->id);
            if ($objectType === 'question') {
                $this->community->refreshQuestionCounts((int) $question->id);
            } else {
                $this->community->refreshAnswerCounts((int) $target->id);
                $this->community->refreshQuestionCounts((int) $question->id);
            }
            return $comment;
        });
        $object = $this->events->commentCreated($identity, $comment, $question, $target);
        return ['comment' => $this->commentData($comment), 'object' => $object];
    }

    public function updateComment(UserIdentity $identity, string $commentId, array $input): array
    {
        $comment = $this->requireComment($commentId);
        $question = $this->requireQuestion((int) $comment->question_id, $identity, true);
        $this->permissions->assertCanWriteQuestion($identity, $question);
        $this->permissions->assertCanEdit($identity, 'comment', $comment);
        $body = trim((string) ($input['content'] ?? $input['bodyMd'] ?? ''));
        if (mb_strlen($body) < 2 || mb_strlen($body) > 2000) {
            throw new ApiException('评论需为 2 至 2000 个字符。', 422, 'community_comment_invalid');
        }
        $this->community->updateComment((int) $comment->id, ['body_md' => $body, 'body_plain' => $this->plain($body)]);
        return ['comment' => $this->commentData($this->community->comment((int) $comment->id))];
    }

    public function deleteComment(UserIdentity $identity, string $commentId): array
    {
        $comment = $this->requireComment($commentId);
        $question = $this->requireQuestion((int) $comment->question_id, $identity, true);
        $this->permissions->assertQuestionReadable($question, $identity);
        $this->permissions->assertCanDelete($identity, 'comment', $comment);
        $this->community->transaction(function () use ($comment): void {
            $this->community->setCommentStatus((int) $comment->id, 'deleted');
            $this->community->purgeObjectEngagements('comment', (int) $comment->id);
        });
        if ((string) $comment->target_type === 'answer') {
            $this->community->refreshAnswerCounts((int) $comment->target_id);
        }
        $this->community->refreshQuestionCounts((int) $comment->question_id);
        $deleted = $this->community->comment((int) $comment->id);
        $this->events->moderated($identity, 'comment.deleted', 'comment', $deleted);
        return ['ok' => true, 'id' => (string) $comment->public_id, 'status' => 'deleted'];
    }

    public function vote(UserIdentity $identity, string $objectType, string $objectId, int $value): array
    {
        $objectType = $this->objectType($objectType, ['question', 'answer']);
        if (!in_array($value, [-1, 0, 1], true)) {
            throw new ApiException('投票值必须为赞同、反对或取消。', 422, 'community_vote_invalid');
        }
        $object = $objectType === 'question' ? $this->requireQuestion($objectId, $identity, true) : $this->requireAnswer($objectId);
        $this->permissions->assertCanVote($identity, $objectType, $object);
        $previous = (int) ($this->community->connection()->table('community_votes')->where([
            'user_id' => $identity->id, 'object_type' => $objectType, 'object_id' => (int) $object->id,
        ])->value('value') ?? 0);
        $result = $this->community->setVote($identity->id, $objectType, (int) $object->id, $value);
        $this->events->voteChanged($identity, $objectType, $object, $previous, (int) $result['viewerVote']);
        return $result;
    }

    public function reaction(UserIdentity $identity, string $objectType, string $objectId, string $reaction): array
    {
        $objectType = $this->objectType($objectType);
        $reaction = strtolower(trim($reaction));
        if (!in_array($reaction, self::REACTIONS, true)) {
            throw new ApiException('不支持该 Reaction。', 422, 'community_reaction_invalid');
        }
        [$object] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        $this->permissions->assertActive($identity);
        $result = $this->community->toggleReaction($identity->id, $objectType, (int) $object->id, $reaction);
        $this->events->reactionChanged($identity, $objectType, $object, $result);
        return $result;
    }

    public function collection(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        $objectType = $this->objectType($objectType, ['question', 'answer']);
        [$object] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        $this->permissions->assertActive($identity);
        return $this->community->toggleCollection($identity->id, $objectType, (int) $object->id,
            (string) ($input['collectionName'] ?? 'default'), (string) ($input['note'] ?? ''));
    }

    public function follow(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        if ($objectType === 'tag') {
            $tag = $this->community->connection()->table('community_tags')->where('slug', $this->tagSlug($objectId))->first();
            if (!$tag) {
                throw new ApiException('标签不存在。', 404, 'community_tag_not_found');
            }
            $object = $tag;
        } else {
            $objectType = $this->objectType($objectType, ['question']);
            [$object] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        }
        $this->permissions->assertActive($identity);
        return $this->community->toggleFollow($identity->id, $objectType, (int) $object->id,
            (string) ($input['notificationLevel'] ?? 'all'));
    }

    public function collections(UserIdentity $identity, int $page, int $limit): array
    {
        return $this->community->collectionPage($identity->id, $page, $limit);
    }

    public function follows(UserIdentity $identity, int $page, int $limit): array
    {
        return $this->community->followPage($identity->id, $page, $limit);
    }

    public function revisions(string $objectType, string $objectId, int $page, int $limit, ?UserIdentity $identity): array
    {
        $objectType = $this->objectType($objectType, ['question', 'answer']);
        [$object] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        return $this->community->revisionPage($objectType, (int) $object->id, $page, $limit);
    }

    public function revisionDiff(string $objectType, string $objectId, string $fromId, string $toId, ?UserIdentity $identity): array
    {
        $objectType = $this->objectType($objectType, ['question', 'answer']);
        [$object] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        $from = $this->community->revision($fromId);
        $to = $this->community->revision($toId);
        if (!$from || !$to || (string) $from->object_type !== $objectType || (string) $to->object_type !== $objectType
            || (int) $from->object_id !== (int) $object->id || (int) $to->object_id !== (int) $object->id) {
            throw new ApiException('修订版本不存在。', 404, 'community_revision_not_found');
        }
        return ['from' => $this->revisionData($from), 'to' => $this->revisionData($to), 'changes' => $this->lineDiff((string) $from->body_md, (string) $to->body_md)];
    }

    public function report(UserIdentity $identity, string $objectType, string $objectId, array $input): array
    {
        $objectType = $this->objectType($objectType);
        [$object, $question] = $this->objectAndQuestionAny($objectType, $objectId, $identity);
        $this->permissions->assertActive($identity);
        $reason = strtolower(trim((string) ($input['reason'] ?? '')));
        if (!in_array($reason, ['spam', 'abuse', 'duplicate', 'incorrect', 'copyright', 'privacy', 'other'], true)) {
            throw new ApiException('请选择举报原因。', 422, 'community_report_reason_invalid');
        }
        $exists = $this->community->connection()->table('community_reports')->where([
            'reporter_user_id' => $identity->id, 'object_type' => $objectType, 'object_id' => (int) $object->id, 'status' => 'pending',
        ])->exists();
        if ($exists) {
            throw new ApiException('你已举报过该内容，审核结果会通过站内信通知。', 409, 'community_report_exists');
        }
        $report = $this->community->insertReport([
            'reporterUserId' => $identity->id, 'objectType' => $objectType, 'objectId' => (int) $object->id,
            'organizationId' => $question->organization_id ? (int) $question->organization_id : null,
            'reason' => $reason, 'details' => (string) ($input['details'] ?? ''),
        ]);
        return ['id' => (string) $report->public_id, 'status' => (string) $report->status];
    }

    public function reports(UserIdentity $identity, string $status, int $page, int $limit, ?int $organizationId): array
    {
        $this->permissions->assertModerator($identity, $organizationId);
        return $this->community->reportPage($status, $page, $limit, $organizationId);
    }

    public function moderationOverview(UserIdentity $identity): array
    {
        $this->permissions->assertModerator($identity, null);
        $db = $this->community->connection();
        return [
            'sourceOfTruth' => 'wikist',
            'spaces' => [
                'total' => $db->table('community_spaces')->where('status', 'active')->count(),
                'public' => $db->table('community_spaces')->where(['scope' => 'public', 'status' => 'active'])->count(),
                'organization' => $db->table('community_spaces')->where(['scope' => 'organization', 'status' => 'active'])->count(),
            ],
            'content' => [
                'questions' => $db->table('community_questions')->whereIn('status', ['published', 'closed'])->count(),
                'answers' => $db->table('community_answers')->where('status', 'published')->count(),
                'comments' => $db->table('community_comments')->where('status', 'published')->count(),
                'tags' => $db->table('community_tags')->where('status', 'active')->count(),
            ],
            'queues' => [
                'reports' => $db->table('community_reports')->where('status', 'pending')->count(),
                'reviews' => $db->table('community_reviews')->where('status', 'pending')->count(),
            ],
            'engagement' => [
                'votes' => $db->table('community_votes')->count(),
                'reactions' => $db->table('community_reactions')->count(),
                'collections' => $db->table('community_collections')->count(),
                'follows' => $db->table('community_follows')->count(),
            ],
        ];
    }

    public function resolveReport(UserIdentity $identity, string $reportId, array $input): array
    {
        $report = $this->community->connection()->table('community_reports')->where('public_id', $reportId)->first();
        if (!$report) {
            throw new ApiException('举报不存在。', 404, 'community_report_not_found');
        }
        $this->permissions->assertModerator($identity, $report->organization_id ? (int) $report->organization_id : null);
        $status = (string) ($input['status'] ?? 'resolved');
        if (!in_array($status, ['resolved', 'dismissed'], true)) {
            throw new ApiException('举报处理状态无效。', 422, 'community_report_status_invalid');
        }
        $resolution = (string) ($input['resolution'] ?? '');
        $this->community->resolveReport($reportId, $identity->id, $status, $resolution);
        $this->events->reportResolved($identity, $report, $status, $resolution);
        return ['ok' => true, 'id' => $reportId, 'status' => $status];
    }

    public function reviews(UserIdentity $identity, string $status, int $page, int $limit, ?int $organizationId): array
    {
        $this->permissions->assertModerator($identity, $organizationId);
        return $this->community->reviewPage($status, $page, $limit, $organizationId);
    }

    public function decideReview(UserIdentity $identity, string $reviewId, array $input): array
    {
        $review = $this->community->connection()->table('community_reviews')->where('public_id', $reviewId)->first();
        if (!$review || (string) $review->status !== 'pending') {
            throw new ApiException('待审记录不存在。', 404, 'community_review_not_found');
        }
        $this->permissions->assertModerator($identity, $review->organization_id ? (int) $review->organization_id : null);
        $status = (string) ($input['status'] ?? 'approved');
        if (!in_array($status, ['approved', 'rejected'], true)) {
            throw new ApiException('审核决定无效。', 422, 'community_review_status_invalid');
        }
        if ((string) $review->object_type === 'question_revision') {
            $revision = $this->community->revision((int) $review->object_id);
            if (!$revision) {
                throw new ApiException('修订版本不存在。', 404, 'community_revision_not_found');
            }
            $this->community->transaction(function () use ($identity, $reviewId, $status, $input, $revision): void {
                $this->community->reviewRevision((int) $revision->id, $identity->id, $status, (string) ($input['opinion'] ?? ''));
                if ($status === 'approved') {
                    $this->community->updateQuestion((int) $revision->object_id, [
                        'title' => (string) $revision->title,
                        'body_md' => (string) $revision->body_md,
                        'body_plain' => $this->plain((string) $revision->body_md),
                        'current_revision_id' => (int) $revision->id,
                        'last_activity_at' => gmdate('c'),
                    ]);
                    $this->community->syncTags((int) $revision->object_id, $this->decode((string) $revision->tags_json), $identity->id);
                }
                $this->community->decideReview($reviewId, $identity->id, $status, (string) ($input['opinion'] ?? ''));
            });
            if ($status === 'approved') {
                $question = $this->community->questionRaw((int) $revision->object_id);
                $this->events->questionUpdated($identity, $question, [], 'question.revision.approved');
            }
        } else {
            $this->community->decideReview($reviewId, $identity->id, $status, (string) ($input['opinion'] ?? ''));
        }
        $this->events->reviewDecided($identity, $review, $status, (string) ($input['opinion'] ?? ''));
        return ['ok' => true, 'id' => $reviewId, 'status' => $status];
    }

    public function reputation(int $userId, int $page, int $limit, ?UserIdentity $viewer): array
    {
        if (!$this->community->user($userId)) {
            throw new ApiException('用户不存在。', 404, 'community_user_not_found');
        }
        return $this->community->reputation($userId, $page, $limit);
    }

    public function badges(int $userId): array
    {
        if (!$this->community->user($userId)) {
            throw new ApiException('用户不存在。', 404, 'community_user_not_found');
        }
        return ['items' => $this->community->badges($userId)];
    }

    public function related(string $type, string $id, int $page, int $limit, ?UserIdentity $identity): array
    {
        $type = KnowledgeObjectId::normalizeType($type);
        $source = in_array($type, ['question', 'answer', 'comment'], true) ? 'wikist' : 'wikist';
        $object = $this->graph->findBySource($source, $type, $id);
        if (!$object && in_array($type, ['question', 'answer', 'comment'], true)) {
            $object = $this->graph->findBySource('answer', $type, $id);
        }
        if (!$object) {
            throw new ApiException('知识对象不存在。', 404, 'knowledge_object_not_found');
        }
        return $this->graph->incoming($object['globalId'], ['discusses', 'references', 'derived_from'], ['question'],
            $page, $limit, $this->community->visibleOrganizationIds($identity));
    }

    public function objectPreview(string $type, string $id, ?UserIdentity $identity): array
    {
        $type = KnowledgeObjectId::normalizeType($type);
        $object = $this->graph->findBySource('wikist', $type, $id)
            ?? $this->graph->findBySource('answer', $type, $id);
        if (!$object) {
            throw new ApiException('知识对象不存在或不可预览。', 404, 'knowledge_object_not_found');
        }
        $relations = $this->graph->related($object['globalId'], [], 1, 5, $this->community->visibleOrganizationIds($identity));
        return ['object' => $object, 'relations' => $relations['items'], 'relationCount' => $relations['total']];
    }

    public function wikiDraft(UserIdentity $identity, string $questionId, string $answerId, array $input): array
    {
        $question = $this->requireQuestion($questionId, $identity);
        $answer = $this->requireAnswer($answerId);
        if ((int) $answer->question_id !== (int) $question->id || (string) $answer->status !== 'published') {
            throw new ApiException('回答不存在。', 404, 'community_answer_not_found');
        }
        $targetSlug = trim((string) ($input['targetSlug'] ?? ''));
        $markdown = trim((string) $answer->body_md) . "\n\n::: note\n"
            . '本节整理自 Wikist Community 问题《' . (string) $question->title . '》中的回答。'
            . "\n来源：{{ref:question|" . (string) $question->public_id . '|查看原问题}}'
            . "\n回答：{{ref:answer|" . (string) $answer->public_id . "|查看原回答}}\n:::";
        $answerObject = $this->graph->findBySource('wikist', 'answer', (string) $answer->public_id);
        if ($answerObject && $targetSlug !== '') {
            try {
                $target = (new KnowledgeObjectResolver())->resolve(['type' => 'wiki_entry', 'id' => $targetSlug]);
                $targetObject = $this->graph->findBySource('wikist', 'wiki_entry', $targetSlug)
                    ?? $this->graph->upsertObject(['type' => 'wiki_entry', 'key' => $targetSlug, 'source' => 'wikist',
                        'title' => (string) $target['label'], 'summary' => (string) ($target['metadata']['summary'] ?? ''),
                        'url' => (string) $target['url'], 'status' => 'active']);
                $this->graph->relate($answerObject['globalId'], 'contributes_to', $targetObject['globalId'], ['actorUserId' => $identity->id, 'source' => 'wikist']);
            } catch (\Throwable) {
                // A missing target remains a valid new-page draft.
            }
        }
        return [
            'title' => (string) $question->title,
            'markdown' => $markdown,
            'sourceUrl' => '#/questions/' . rawurlencode((string) $question->public_id),
            'targetSlug' => $targetSlug,
            'editUrl' => $targetSlug !== '' ? '#/edit/' . rawurlencode($targetSlug) : '#/new',
        ];
    }

    private function questionKnowledgeRelations(array $directRelations, array $answerReferences, int $limit): array
    {
        $priority = [
            'wiki_entry' => 0,
            'revision' => 1,
            'selection' => 2,
            'organization' => 3,
            'user' => 4,
            'question' => 5,
        ];
        $items = array_values(array_filter(
            array_merge($directRelations, $answerReferences),
            static fn (array $relation): bool => !in_array(
                (string) ($relation['object']['type'] ?? ''),
                ['answer', 'comment'],
                true,
            ),
        ));
        usort($items, static function (array $left, array $right) use ($priority): int {
            $leftPriority = $priority[(string) ($left['object']['type'] ?? '')] ?? 9;
            $rightPriority = $priority[(string) ($right['object']['type'] ?? '')] ?? 9;
            if ($leftPriority !== $rightPriority) {
                return $leftPriority <=> $rightPriority;
            }
            return strcmp((string) ($right['updatedAt'] ?? ''), (string) ($left['updatedAt'] ?? ''));
        });
        $unique = [];
        $seen = [];
        foreach ($items as $relation) {
            $object = $relation['object'] ?? [];
            $key = (string) ($object['globalId'] ?? (($object['type'] ?? '') . ':' . ($object['key'] ?? '')));
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = $relation;
        }
        $limit = max(1, min(50, $limit));
        return array_slice($unique, 0, $limit);
    }

    private function requireQuestion(string|int $identifier, ?UserIdentity $identity, bool $includeUnpublished = false): object
    {
        $question = $this->community->questionRaw($identifier);
        if (!$question) {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
        $this->permissions->assertQuestionReadable($question, $identity);
        if (!$includeUnpublished && !in_array((string) $question->status, ['published', 'closed'], true)) {
            throw new ApiException('问题不存在。', 404, 'community_question_not_found');
        }
        return $question;
    }

    private function requireAnswer(string|int $identifier): object
    {
        $answer = $this->community->answer($identifier);
        if (!$answer || (string) $answer->status === 'deleted') {
            throw new ApiException('回答不存在。', 404, 'community_answer_not_found');
        }
        return $answer;
    }

    private function requireComment(string|int $identifier): object
    {
        $comment = $this->community->comment($identifier);
        if (!$comment || (string) $comment->status === 'deleted') {
            throw new ApiException('评论不存在。', 404, 'community_comment_not_found');
        }
        return $comment;
    }

    private function objectAndQuestion(string $objectType, string $objectId, ?UserIdentity $identity): array
    {
        if ($objectType === 'question') {
            $question = $this->requireQuestion($objectId, $identity);
            return [$question, $question];
        }
        $answer = $this->requireAnswer($objectId);
        $question = $this->requireQuestion((int) $answer->question_id, $identity);
        return [$answer, $question];
    }

    private function objectAndQuestionAny(string $objectType, string $objectId, ?UserIdentity $identity): array
    {
        if ($objectType !== 'comment') {
            return $this->objectAndQuestion($objectType, $objectId, $identity);
        }
        $comment = $this->requireComment($objectId);
        $question = $this->requireQuestion((int) $comment->question_id, $identity);
        return [$comment, $question];
    }

    private function objectPermissions(?UserIdentity $identity, string $objectType, int $objectId): array
    {
        if (!$identity) {
            return ['edit' => false, 'delete' => false, 'vote' => false, 'accept' => false];
        }
        $object = $objectType === 'answer' ? $this->community->answer($objectId) : $this->community->comment($objectId);
        if (!$object) {
            return ['edit' => false, 'delete' => false, 'vote' => false, 'accept' => false];
        }
        $owner = (int) $object->author_user_id === $identity->id;
        $question = $this->community->questionRaw((int) $object->question_id);
        $moderator = RolePolicy::allows($identity->role, 'senior_editor');
        if (!$moderator && $question?->organization_id) {
            $membership = $this->community->organizationMembership((int) $question->organization_id, $identity->id);
            $moderator = $membership && $this->permissions->isOrganizationModeratorRole((string) $membership->role);
        }
        return [
            'edit' => $owner || $moderator,
            'delete' => $owner || $moderator,
            'vote' => !$owner && $identity->isActive(),
            'accept' => $objectType === 'answer' && ($moderator || (int) $question?->author_user_id === $identity->id),
        ];
    }

    private function answerData(object $answer, ?UserIdentity $viewer): array
    {
        $item = $this->community->answerView((int) $answer->id, $viewer)
            ?? ['id' => (string) $answer->public_id, 'numericId' => (int) $answer->id, 'bodyMd' => (string) $answer->body_md];
        return $this->renderBody($item);
    }

    private function commentData(object $comment): array
    {
        $item = $this->community->commentView((int) $comment->id)
            ?? ['id' => (string) $comment->public_id, 'numericId' => (int) $comment->id, 'bodyMd' => (string) $comment->body_md];
        return $this->renderBody($item);
    }

    private function questionData(object $question, ?UserIdentity $viewer): array
    {
        $item = $this->community->question((string) $question->public_id, $viewer);
        return $item ? $this->renderBody($item) : [];
    }

    private function renderBody(array $item): array
    {
        $item['bodyHtml'] = $this->markdown->render((string) ($item['bodyMd'] ?? ''));
        return $item;
    }

    private function ensureFollow(int $userId, string $type, int $id): void
    {
        if (!$this->community->connection()->table('community_follows')->where(['user_id' => $userId, 'object_type' => $type, 'object_id' => $id])->exists()) {
            $this->community->toggleFollow($userId, $type, $id, 'all');
        }
    }

    private function normalizeTags(array $tags): array
    {
        $result = [];
        foreach ($tags as $tag) {
            $tag = mb_substr(trim((string) $tag), 0, 35);
            if ($tag !== '' && !in_array($tag, $result, true)) {
                $result[] = $tag;
            }
        }
        if (count($result) > 8) {
            throw new ApiException('一个问题最多使用 8 个标签。', 422, 'community_question_tags_too_many');
        }
        return $result;
    }

    private function objectType(string $type, array $allowed = self::OBJECT_TYPES): string
    {
        $type = strtolower(trim($type));
        if (!in_array($type, $allowed, true)) {
            throw new ApiException('社区对象类型无效。', 422, 'community_object_type_invalid');
        }
        return $type;
    }

    private function language(string $language): string
    {
        $language = str_replace('_', '-', trim($language));
        return preg_match('/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/', $language) ? mb_substr($language, 0, 32) : 'zh-CN';
    }

    private function plain(string $markdown): string
    {
        $text = preg_replace('/```[\s\S]*?```/u', ' ', $markdown) ?? $markdown;
        $text = preg_replace('/!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)|[*_#>`~{}\[\]]/u', '$1', $text) ?? $text;
        return trim(preg_replace('/\s+/u', ' ', strip_tags($text)) ?? $text);
    }

    private function tagSlug(string $value): string
    {
        $value = mb_strtolower(trim($value));
        return trim(preg_replace('/[^\p{L}\p{N}._-]+/u', '-', $value) ?: '', '-');
    }

    private function pagination(array $page): array
    {
        return array_intersect_key($page, array_flip(['page', 'limit', 'total', 'pages']));
    }

    private function revisionData(object $revision): array
    {
        return [
            'id' => (string) $revision->public_id, 'number' => (int) $revision->revision_no,
            'objectType' => (string) $revision->object_type, 'objectId' => (int) $revision->object_id,
            'title' => (string) $revision->title, 'bodyMd' => (string) $revision->body_md,
            'tags' => $this->decode((string) $revision->tags_json), 'summary' => (string) $revision->summary,
            'status' => (string) $revision->status, 'createdAt' => (string) $revision->created_at,
        ];
    }

    private function lineDiff(string $before, string $after): array
    {
        $left = preg_split('/\R/u', $before) ?: [];
        $right = preg_split('/\R/u', $after) ?: [];
        $max = max(count($left), count($right));
        $changes = [];
        for ($index = 0; $index < $max; $index++) {
            $old = $left[$index] ?? null;
            $new = $right[$index] ?? null;
            if ($old === $new) {
                $changes[] = ['type' => 'context', 'line' => $index + 1, 'text' => $old ?? ''];
            } else {
                if ($old !== null) {
                    $changes[] = ['type' => 'remove', 'line' => $index + 1, 'text' => $old];
                }
                if ($new !== null) {
                    $changes[] = ['type' => 'add', 'line' => $index + 1, 'text' => $new];
                }
            }
        }
        return $changes;
    }

    private function decode(string $value): array
    {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

}
