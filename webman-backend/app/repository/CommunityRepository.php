<?php

namespace app\repository;

use app\domain\passport\UserIdentity;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use support\Db;

final class CommunityRepository
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

    public function publicSpace(): object
    {
        $space = $this->connection()->table('community_spaces')->where('slug', 'public')->first();
        if ($space) {
            return $space;
        }
        $now = gmdate('c');
        $id = $this->connection()->table('community_spaces')->insertGetId([
            'public_id' => 'space-public',
            'scope' => 'public',
            'organization_id' => null,
            'slug' => 'public',
            'name' => 'Wikist Public Community',
            'visibility' => 'public',
            'status' => 'active',
            'settings_json' => '{}',
            'created_by' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return $this->connection()->table('community_spaces')->where('id', $id)->first();
    }

    public function organization(string|int $identifier): ?object
    {
        $query = $this->connection()->table('writing_organizations');
        return is_int($identifier) || ctype_digit((string) $identifier)
            ? $query->where('id', (int) $identifier)->first()
            : $query->where('slug', trim((string) $identifier))->first();
    }

    public function organizationMembership(int $organizationId, int $userId): ?object
    {
        return $this->connection()->table('organization_members')
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->first();
    }

    public function organizationSpace(object $organization, int $actorUserId): object
    {
        $space = $this->connection()->table('community_spaces')
            ->where('organization_id', (int) $organization->id)->first();
        $visibility = 'public';
        if ($space) {
            if ((string) $space->visibility !== $visibility || (string) $space->name !== (string) $organization->name) {
                $this->connection()->table('community_spaces')->where('id', $space->id)->update([
                    'name' => (string) $organization->name,
                    'visibility' => $visibility,
                    'status' => (string) $organization->status === 'active' ? 'active' : 'disabled',
                    'updated_at' => gmdate('c'),
                ]);
                $space = $this->connection()->table('community_spaces')->where('id', $space->id)->first();
            }
            return $space;
        }
        $now = gmdate('c');
        $id = $this->connection()->table('community_spaces')->insertGetId([
            'public_id' => $this->publicId('space'),
            'scope' => 'organization',
            'organization_id' => (int) $organization->id,
            'slug' => 'org-' . (string) $organization->slug,
            'name' => (string) $organization->name,
            'visibility' => $visibility,
            'status' => (string) $organization->status === 'active' ? 'active' : 'disabled',
            'settings_json' => '{}',
            'created_by' => $actorUserId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return $this->connection()->table('community_spaces')->where('id', $id)->first();
    }

    public function questionPage(array $filters, ?UserIdentity $viewer): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $limit = max(1, min(50, (int) ($filters['limit'] ?? 12)));
        $queryText = mb_strtolower(trim((string) ($filters['query'] ?? '')));
        $order = (string) ($filters['order'] ?? 'active');
        $tag = $this->tagSlug((string) ($filters['tag'] ?? ''));
        $organization = trim((string) ($filters['organization'] ?? ''));
        $origin = strtolower(trim((string) ($filters['origin'] ?? '')));
        $query = $this->questionQuery()->whereIn('q.status', ['published', 'closed'])->where('q.review_status', 'approved');
        if ($organization !== '') {
            $query->where('o.slug', $organization);
        }
        if ($queryText !== '') {
            $like = '%' . $this->escapeLike($queryText) . '%';
            $query->where(function (Builder $scope) use ($like): void {
                $scope->whereRaw("LOWER(q.title) LIKE ? ESCAPE '\\'", [$like])
                    ->orWhereRaw("LOWER(q.body_plain) LIKE ? ESCAPE '\\'", [$like])
                    ->orWhereExists(function (Builder $tags) use ($like): void {
                        $tags->selectRaw('1')->from('community_question_tags as qtx')
                            ->join('community_tags as tx', 'tx.id', '=', 'qtx.tag_id')
                            ->whereColumn('qtx.question_id', 'q.id')
                            ->whereRaw("LOWER(tx.name) LIKE ? ESCAPE '\\'", [$like]);
                    });
            });
        }
        if ($tag !== '') {
            $query->whereExists(function (Builder $tags) use ($tag): void {
                $tags->selectRaw('1')->from('community_question_tags as qt')
                    ->join('community_tags as t', 't.id', '=', 'qt.tag_id')
                    ->whereColumn('qt.question_id', 'q.id')->where('t.slug', $tag);
            });
        }
        if ($origin === 'organization') {
            $query->whereNotNull('q.organization_id');
        } elseif ($origin === 'direct') {
            $query->whereNull('q.organization_id')->whereNotExists(function (Builder $sources): void {
                $sources->selectRaw('1')->from('community_question_sources as qs')
                    ->whereColumn('qs.question_id', 'q.id');
            });
        } elseif (in_array($origin, ['selection', 'wiki_entry', 'page', 'question', 'answer'], true)) {
            $query->whereExists(function (Builder $sources) use ($origin): void {
                $sources->selectRaw('1')->from('community_question_sources as qs')
                    ->whereColumn('qs.question_id', 'q.id')->where('qs.source_type', $origin);
            });
        }
        if ($order === 'unanswered') {
            $query->where('q.answer_count', 0);
        }
        $total = (clone $query)->count('q.id');
        match ($order) {
            'newest' => $query->orderByDesc('q.created_at'),
            'hot' => $query->orderByDesc('q.hot_score')->orderByDesc('q.last_activity_at'),
            'score' => $query->orderByDesc('q.vote_score')->orderByDesc('q.last_activity_at'),
            'frequent' => $query->orderByDesc('q.unique_view_count')->orderByDesc('q.last_activity_at'),
            'recommend' => $query->orderByRaw('(CASE WHEN q.accepted_answer_id IS NULL THEN 0 ELSE 1 END) DESC')
                ->orderByDesc('q.vote_score')->orderByDesc('q.follower_count')->orderByDesc('q.last_activity_at'),
            default => $query->orderByDesc('q.last_activity_at'),
        };
        $rows = $query->orderByDesc('q.id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = array_map(fn (object $row): array => $this->questionData($row), $rows);
        $this->attachTags($items);
        $this->attachQuestionOrigins($items);
        return $this->page($items, $page, $limit, $total);
    }

    public function question(string|int $identifier, ?UserIdentity $viewer, bool $includeUnpublished = false): ?array
    {
        $query = $this->questionQuery();
        $this->whereIdentifier($query, 'q', $identifier);
        if (!$includeUnpublished) {
            $query->whereIn('q.status', ['published', 'closed'])->where('q.review_status', 'approved');
        }
        $row = $query->first();
        if (!$row) {
            return null;
        }
        $item = $this->questionData($row);
        $items = [&$item];
        $this->attachTags($items);
        $this->attachQuestionOrigins($items);
        $item['viewer'] = $this->viewerState('question', (int) $row->id, $viewer?->id);
        $item['reactions'] = $this->reactionSummary('question', (int) $row->id, $viewer?->id);
        return $item;
    }

    public function questionRaw(string|int $identifier): ?object
    {
        $query = $this->connection()->table('community_questions');
        return $this->whereIdentifier($query, 'community_questions', $identifier)->first();
    }

    public function insertQuestion(array $data): object
    {
        $now = (string) ($data['createdAt'] ?? gmdate('c'));
        $id = $this->connection()->table('community_questions')->insertGetId([
            'public_id' => (string) ($data['publicId'] ?? $this->publicId('q')),
            'space_id' => (int) $data['spaceId'],
            'organization_id' => $data['organizationId'] ?? null,
            'author_user_id' => (int) $data['authorUserId'],
            'title' => (string) $data['title'],
            'body_md' => (string) $data['bodyMd'],
            'body_plain' => (string) $data['bodyPlain'],
            'language' => (string) ($data['language'] ?? 'zh-CN'),
            'visibility' => (string) ($data['visibility'] ?? 'public'),
            'status' => (string) ($data['status'] ?? 'published'),
            'review_status' => (string) ($data['reviewStatus'] ?? 'approved'),
            'close_reason' => '',
            'closed_by' => null,
            'closed_at' => '',
            'accepted_answer_id' => null,
            'view_count' => 0,
            'unique_view_count' => 0,
            'answer_count' => 0,
            'comment_count' => 0,
            'upvote_count' => 0,
            'downvote_count' => 0,
            'vote_score' => 0,
            'reaction_count' => 0,
            'collection_count' => 0,
            'follower_count' => 0,
            'hot_score' => 0,
            'current_revision_id' => null,
            'last_activity_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
            'deleted_at' => '',
        ]);
        return $this->connection()->table('community_questions')->where('id', $id)->first();
    }

    public function setQuestionSource(int $questionId, ?array $source): void
    {
        if (!$source || trim((string) ($source['id'] ?? '')) === '') {
            return;
        }
        $sourceType = strtolower(trim((string) ($source['type'] ?? '')));
        $sourceType = preg_replace('/[^a-z0-9_\-]/', '', $sourceType) ?: 'page';
        $now = gmdate('c');
        $metadata = array_filter([
            'pageSlug' => trim((string) ($source['pageSlug'] ?? '')),
        ], static fn (string $value): bool => $value !== '');
        $this->connection()->table('community_question_sources')->updateOrInsert(
            ['question_id' => $questionId],
            [
                'source_type' => mb_substr($sourceType, 0, 40),
                'object_type' => mb_substr(strtolower(trim((string) ($source['objectType'] ?? $sourceType))), 0, 40),
                'object_key' => mb_substr(trim((string) $source['id']), 0, 255),
                'label' => mb_substr(trim((string) ($source['label'] ?? '')), 0, 255),
                'url' => mb_substr(trim((string) ($source['url'] ?? '')), 0, 1000),
                'excerpt' => mb_substr(trim((string) ($source['selectedText'] ?? '')), 0, 2000),
                'metadata_json' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function updateQuestion(int $id, array $values): void
    {
        $this->connection()->table('community_questions')->where('id', $id)->update($values + ['updated_at' => gmdate('c')]);
    }

    public function setQuestionStatus(int $id, string $status, int $actorId, string $reason = ''): void
    {
        $now = gmdate('c');
        $values = ['status' => $status, 'updated_at' => $now, 'last_activity_at' => $now];
        if ($status === 'closed') {
            $values += ['closed_by' => $actorId, 'closed_at' => $now, 'close_reason' => mb_substr($reason, 0, 500)];
        } elseif ($status === 'published') {
            $values += ['closed_by' => null, 'closed_at' => '', 'close_reason' => ''];
        } elseif ($status === 'deleted') {
            $values['deleted_at'] = $now;
        }
        $this->connection()->table('community_questions')->where('id', $id)->update($values);
    }

    public function answerPage(int $questionId, int $page, int $limit, ?UserIdentity $viewer): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_answers as a')
            ->join('users as u', 'u.id', '=', 'a.author_user_id')
            ->join('community_questions as aq', 'aq.id', '=', 'a.question_id')
            ->where('a.question_id', $questionId)->where('a.status', 'published')->where('a.review_status', 'approved')
            ->select('a.*', 'u.username as author_username', 'u.display_name as author_display_name',
                'u.avatar_url as author_avatar_url', 'u.role as author_role', 'u.status as author_status',
                'aq.public_id as question_public_id');
        $total = (clone $query)->count('a.id');
        $rows = $query->orderByDesc('a.is_accepted')->orderByDesc('a.vote_score')->orderBy('a.id')
            ->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = [];
        foreach ($rows as $row) {
            $item = $this->answerData($row);
            $item['viewer'] = $this->viewerState('answer', (int) $row->id, $viewer?->id);
            $item['reactions'] = $this->reactionSummary('answer', (int) $row->id, $viewer?->id);
            $items[] = $item;
        }
        return $this->page($items, $page, $limit, $total);
    }

    public function answer(string|int $identifier): ?object
    {
        $query = $this->connection()->table('community_answers');
        return $this->whereIdentifier($query, 'community_answers', $identifier)->first();
    }

    public function answerView(string|int $identifier, ?UserIdentity $viewer = null): ?array
    {
        $query = $this->connection()->table('community_answers as a')
            ->join('users as u', 'u.id', '=', 'a.author_user_id')
            ->join('community_questions as aq', 'aq.id', '=', 'a.question_id')
            ->select('a.*', 'u.username as author_username', 'u.display_name as author_display_name',
                'u.avatar_url as author_avatar_url', 'u.role as author_role', 'u.status as author_status',
                'aq.public_id as question_public_id');
        $row = $this->whereIdentifier($query, 'a', $identifier)->first();
        if (!$row) {
            return null;
        }
        $item = $this->answerData($row);
        $item['viewer'] = $this->viewerState('answer', (int) $row->id, $viewer?->id);
        $item['reactions'] = $this->reactionSummary('answer', (int) $row->id, $viewer?->id);
        return $item;
    }

    public function insertAnswer(array $data): object
    {
        $now = (string) ($data['createdAt'] ?? gmdate('c'));
        $id = $this->connection()->table('community_answers')->insertGetId([
            'public_id' => (string) ($data['publicId'] ?? $this->publicId('a')),
            'question_id' => (int) $data['questionId'],
            'author_user_id' => (int) $data['authorUserId'],
            'body_md' => (string) $data['bodyMd'],
            'body_plain' => (string) $data['bodyPlain'],
            'status' => (string) ($data['status'] ?? 'published'),
            'review_status' => (string) ($data['reviewStatus'] ?? 'approved'),
            'is_accepted' => 0,
            'comment_count' => 0,
            'upvote_count' => 0,
            'downvote_count' => 0,
            'vote_score' => 0,
            'reaction_count' => 0,
            'collection_count' => 0,
            'current_revision_id' => null,
            'created_at' => $now,
            'updated_at' => $now,
            'accepted_at' => '',
            'deleted_at' => '',
        ]);
        return $this->connection()->table('community_answers')->where('id', $id)->first();
    }

    public function updateAnswer(int $id, array $values): void
    {
        $this->connection()->table('community_answers')->where('id', $id)->update($values + ['updated_at' => gmdate('c')]);
    }

    public function setAnswerStatus(int $id, string $status): void
    {
        $now = gmdate('c');
        $this->connection()->table('community_answers')->where('id', $id)->update([
            'status' => $status,
            'deleted_at' => $status === 'deleted' ? $now : '',
            'updated_at' => $now,
        ]);
    }

    public function acceptAnswer(int $questionId, int $answerId): ?int
    {
        $now = gmdate('c');
        $previous = $this->connection()->table('community_questions')->where('id', $questionId)->value('accepted_answer_id');
        $this->connection()->table('community_answers')->where('question_id', $questionId)->update([
            'is_accepted' => 0, 'accepted_at' => '', 'updated_at' => $now,
        ]);
        $this->connection()->table('community_answers')->where('id', $answerId)->where('question_id', $questionId)->update([
            'is_accepted' => 1, 'accepted_at' => $now, 'updated_at' => $now,
        ]);
        $this->connection()->table('community_questions')->where('id', $questionId)->update([
            'accepted_answer_id' => $answerId, 'last_activity_at' => $now, 'updated_at' => $now,
        ]);
        return $previous ? (int) $previous : null;
    }

    public function clearAcceptedAnswer(int $questionId, int $answerId): bool
    {
        $question = $this->connection()->table('community_questions')->where('id', $questionId)->first();
        if (!$question || (int) ($question->accepted_answer_id ?? 0) !== $answerId) {
            return false;
        }
        $now = gmdate('c');
        $this->connection()->table('community_answers')->where('id', $answerId)->where('question_id', $questionId)->update([
            'is_accepted' => 0, 'accepted_at' => '', 'updated_at' => $now,
        ]);
        $this->connection()->table('community_questions')->where('id', $questionId)->update([
            'accepted_answer_id' => null, 'last_activity_at' => $now, 'updated_at' => $now,
        ]);
        return true;
    }

    public function commentPage(string $targetType, int $targetId, int $page = 1, int $limit = 12): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_comments as c')
            ->join('users as u', 'u.id', '=', 'c.author_user_id')
            ->leftJoin('users as ru', 'ru.id', '=', 'c.reply_user_id')
            ->leftJoin('community_comments as rc', 'rc.id', '=', 'c.reply_to_comment_id')
            ->where('c.target_type', $targetType)->where('c.target_id', $targetId)->where('c.status', 'published')
            ->select('c.*', 'u.username as author_username', 'u.display_name as author_display_name',
                'u.avatar_url as author_avatar_url', 'u.role as author_role', 'u.status as author_status',
                'ru.username as reply_username', 'ru.display_name as reply_display_name',
                'rc.public_id as reply_comment_public_id');
        $total = (clone $query)->count('c.id');
        $rows = $query->orderBy('c.id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        return $this->page(array_map(fn (object $row): array => $this->commentData($row), $rows), $page, $limit, $total);
    }

    public function comment(string|int $identifier): ?object
    {
        $query = $this->connection()->table('community_comments');
        return $this->whereIdentifier($query, 'community_comments', $identifier)->first();
    }

    public function commentView(string|int $identifier): ?array
    {
        $query = $this->connection()->table('community_comments as c')
            ->join('users as u', 'u.id', '=', 'c.author_user_id')
            ->leftJoin('users as ru', 'ru.id', '=', 'c.reply_user_id')
            ->leftJoin('community_comments as rc', 'rc.id', '=', 'c.reply_to_comment_id')
            ->select('c.*', 'u.username as author_username', 'u.display_name as author_display_name',
                'u.avatar_url as author_avatar_url', 'u.role as author_role', 'u.status as author_status',
                'ru.username as reply_username', 'ru.display_name as reply_display_name',
                'rc.public_id as reply_comment_public_id');
        $row = $this->whereIdentifier($query, 'c', $identifier)->first();
        return $row ? $this->commentData($row) : null;
    }

    public function insertComment(array $data): object
    {
        $now = (string) ($data['createdAt'] ?? gmdate('c'));
        $id = $this->connection()->table('community_comments')->insertGetId([
            'public_id' => (string) ($data['publicId'] ?? $this->publicId('c')),
            'question_id' => (int) $data['questionId'],
            'target_type' => (string) $data['targetType'],
            'target_id' => (int) $data['targetId'],
            'author_user_id' => (int) $data['authorUserId'],
            'reply_to_comment_id' => $data['replyToCommentId'] ?? null,
            'reply_user_id' => $data['replyUserId'] ?? null,
            'body_md' => (string) $data['bodyMd'],
            'body_plain' => (string) $data['bodyPlain'],
            'status' => 'published',
            'upvote_count' => 0,
            'reaction_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
            'deleted_at' => '',
        ]);
        return $this->connection()->table('community_comments')->where('id', $id)->first();
    }

    public function updateComment(int $id, array $values): void
    {
        $this->connection()->table('community_comments')->where('id', $id)->update($values + ['updated_at' => gmdate('c')]);
    }

    public function setCommentStatus(int $id, string $status): void
    {
        $now = gmdate('c');
        $this->connection()->table('community_comments')->where('id', $id)->update([
            'status' => $status,
            'deleted_at' => $status === 'deleted' ? $now : '',
            'updated_at' => $now,
        ]);
    }

    public function syncTags(int $questionId, array $tags, int $actorUserId): array
    {
        $now = gmdate('c');
        $ids = [];
        foreach ($tags as $name) {
            $name = mb_substr(trim((string) $name), 0, 100);
            if ($name === '') {
                continue;
            }
            $slug = $this->tagSlug($name);
            $tag = $this->connection()->table('community_tags')->where('slug', $slug)->first();
            if (!$tag) {
                $id = $this->connection()->table('community_tags')->insertGetId([
                    'slug' => $slug,
                    'name' => $name,
                    'description_md' => '',
                    'color' => '',
                    'question_count' => 0,
                    'follower_count' => 0,
                    'is_recommended' => 0,
                    'is_reserved' => 0,
                    'status' => 'active',
                    'created_by' => $actorUserId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $id = (int) $tag->id;
            }
            $ids[] = $id;
        }
        $oldIds = $this->connection()->table('community_question_tags')->where('question_id', $questionId)->pluck('tag_id')->map('intval')->all();
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $this->connection()->table('community_question_tags')->where('question_id', $questionId)->delete();
        foreach ($ids as $id) {
            $this->connection()->table('community_question_tags')->insert(['question_id' => $questionId, 'tag_id' => $id, 'created_at' => $now]);
        }
        foreach (array_unique(array_merge($oldIds, $ids)) as $id) {
            $count = $this->connection()->table('community_question_tags')->where('tag_id', $id)->count();
            $this->connection()->table('community_tags')->where('id', $id)->update(['question_count' => $count, 'updated_at' => $now]);
        }
        return $this->tagsForQuestion($questionId);
    }

    public function tagPage(string $queryText, int $page, int $limit, ?int $viewerId): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_tags')->where('status', 'active');
        if (trim($queryText) !== '') {
            $like = '%' . $this->escapeLike(mb_strtolower(trim($queryText))) . '%';
            $query->where(function (Builder $scope) use ($like): void {
                $scope->whereRaw("LOWER(name) LIKE ? ESCAPE '\\'", [$like])
                    ->orWhereRaw("LOWER(slug) LIKE ? ESCAPE '\\'", [$like]);
            });
        }
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('is_recommended')->orderByDesc('question_count')->orderBy('name')
            ->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = array_map(function (object $row) use ($viewerId): array {
            return [
                'id' => (int) $row->id,
                'slug' => (string) $row->slug,
                'name' => (string) $row->name,
                'descriptionMd' => (string) $row->description_md,
                'color' => (string) $row->color,
                'questionCount' => (int) $row->question_count,
                'followerCount' => (int) $row->follower_count,
                'recommended' => (bool) $row->is_recommended,
                'reserved' => (bool) $row->is_reserved,
                'followed' => $viewerId ? $this->connection()->table('community_follows')->where([
                    'user_id' => $viewerId, 'object_type' => 'tag', 'object_id' => (int) $row->id,
                ])->exists() : false,
            ];
        }, $rows);
        return $this->page($items, $page, $limit, $total);
    }

    public function setVote(int $userId, string $objectType, int $objectId, int $value): array
    {
        $now = gmdate('c');
        $table = $this->connection()->table('community_votes');
        $existing = $table->where(['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId])->first();
        if ($value === 0 || ($existing && (int) $existing->value === $value)) {
            $table->where(['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId])->delete();
            $value = 0;
        } elseif ($existing) {
            $table->where(['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId])->update(['value' => $value, 'updated_at' => $now]);
        } else {
            $table->insert(['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId, 'value' => $value, 'created_at' => $now, 'updated_at' => $now]);
        }
        $counts = $this->voteCounts($objectType, $objectId);
        $this->updateObjectCounts($objectType, $objectId, $counts);
        return $counts + ['viewerVote' => $value];
    }

    public function toggleReaction(int $userId, string $objectType, int $objectId, string $reaction): array
    {
        $key = ['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId, 'reaction' => $reaction];
        $table = $this->connection()->table('community_reactions');
        $active = !$table->where($key)->exists();
        if ($active) {
            $table->insert($key + ['created_at' => gmdate('c')]);
        } else {
            $table->where($key)->delete();
        }
        $count = $table->where('object_type', $objectType)->where('object_id', $objectId)->count();
        $this->updateObjectCounts($objectType, $objectId, ['reaction_count' => $count]);
        return ['active' => $active, 'reaction' => $reaction, 'total' => $count, 'items' => $this->reactionSummary($objectType, $objectId, $userId)];
    }

    public function toggleCollection(int $userId, string $objectType, int $objectId, string $name = 'default', string $note = ''): array
    {
        $key = ['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId];
        $table = $this->connection()->table('community_collections');
        $active = !$table->where($key)->exists();
        if ($active) {
            $now = gmdate('c');
            $table->insert($key + ['collection_name' => mb_substr(trim($name) ?: 'default', 0, 100), 'note' => mb_substr(trim($note), 0, 500), 'created_at' => $now, 'updated_at' => $now]);
        } else {
            $table->where($key)->delete();
        }
        $count = $table->where('object_type', $objectType)->where('object_id', $objectId)->count();
        $this->updateObjectCounts($objectType, $objectId, ['collection_count' => $count]);
        return ['active' => $active, 'count' => $count];
    }

    public function toggleFollow(int $userId, string $objectType, int $objectId, string $level = 'all'): array
    {
        $key = ['user_id' => $userId, 'object_type' => $objectType, 'object_id' => $objectId];
        $table = $this->connection()->table('community_follows');
        $active = !$table->where($key)->exists();
        if ($active) {
            $now = gmdate('c');
            $table->insert($key + ['notification_level' => in_array($level, ['all', 'important', 'none'], true) ? $level : 'all', 'created_at' => $now, 'updated_at' => $now]);
        } else {
            $table->where($key)->delete();
        }
        $count = $table->where('object_type', $objectType)->where('object_id', $objectId)->count();
        if ($objectType === 'tag') {
            $this->connection()->table('community_tags')->where('id', $objectId)->update(['follower_count' => $count, 'updated_at' => gmdate('c')]);
        } else {
            $this->updateObjectCounts($objectType, $objectId, ['follower_count' => $count]);
        }
        return ['active' => $active, 'count' => $count];
    }

    public function purgeObjectEngagements(string $objectType, int $objectId): int
    {
        $deleted = 0;
        foreach (['community_votes', 'community_reactions', 'community_collections', 'community_follows'] as $table) {
            $deleted += $this->connection()->table($table)
                ->where('object_type', $objectType)->where('object_id', $objectId)->delete();
        }
        return $deleted;
    }

    public function purgeQuestionEcosystem(int $questionId): int
    {
        $answerIds = array_map('intval', $this->connection()->table('community_answers')->where('question_id', $questionId)->pluck('id')->all());
        $commentIds = array_map('intval', $this->connection()->table('community_comments')->where('question_id', $questionId)->pluck('id')->all());
        $deleted = $this->purgeObjectEngagements('question', $questionId);
        foreach ($answerIds as $answerId) {
            $deleted += $this->purgeObjectEngagements('answer', $answerId);
        }
        foreach ($commentIds as $commentId) {
            $deleted += $this->purgeObjectEngagements('comment', $commentId);
        }
        $now = gmdate('c');
        $this->connection()->table('community_answer_invites')->where('question_id', $questionId)->where('status', 'pending')
            ->update(['status' => 'dismissed', 'responded_at' => $now, 'updated_at' => $now]);
        return $deleted;
    }

    public function pruneInvalidEngagements(?int $userId = null): int
    {
        $deleted = 0;
        $rules = [
            'question' => static function (Builder $valid, string $table): void {
                $valid->selectRaw('1')->from('community_questions as valid_q')
                    ->whereColumn('valid_q.id', $table . '.object_id')->whereIn('valid_q.status', ['published', 'closed']);
            },
            'answer' => static function (Builder $valid, string $table): void {
                $valid->selectRaw('1')->from('community_answers as valid_a')
                    ->join('community_questions as valid_q', 'valid_q.id', '=', 'valid_a.question_id')
                    ->whereColumn('valid_a.id', $table . '.object_id')->where('valid_a.status', 'published')
                    ->whereIn('valid_q.status', ['published', 'closed']);
            },
            'comment' => static function (Builder $valid, string $table): void {
                $valid->selectRaw('1')->from('community_comments as valid_c')
                    ->join('community_questions as valid_q', 'valid_q.id', '=', 'valid_c.question_id')
                    ->whereColumn('valid_c.id', $table . '.object_id')->where('valid_c.status', 'published')
                    ->whereIn('valid_q.status', ['published', 'closed']);
            },
            'tag' => static function (Builder $valid, string $table): void {
                $valid->selectRaw('1')->from('community_tags as valid_t')
                    ->whereColumn('valid_t.id', $table . '.object_id')->where('valid_t.status', 'active');
            },
        ];
        foreach (['community_votes', 'community_reactions', 'community_collections', 'community_follows'] as $table) {
            foreach ($rules as $objectType => $rule) {
                $query = $this->connection()->table($table)->where('object_type', $objectType);
                if ($userId !== null) {
                    $query->where('user_id', $userId);
                }
                $deleted += $query->whereNotExists(function (Builder $valid) use ($rule, $table): void {
                    $rule($valid, $table);
                })->delete();
            }
        }
        return $deleted;
    }

    public function userByIdentifier(string|int $identifier): ?object
    {
        $value = trim((string) $identifier);
        if ($value === '') {
            return null;
        }
        $query = $this->connection()->table('users');
        if (ctype_digit($value)) {
            return $query->where('id', (int) $value)->first();
        }
        return $query->whereRaw('LOWER(username) = ?', [mb_strtolower(ltrim($value, '@'))])->first();
    }

    public function upsertAnswerInvite(int $questionId, int $inviterUserId, int $inviteeUserId, string $message = ''): array
    {
        $table = $this->connection()->table('community_answer_invites');
        $row = $table->where(['question_id' => $questionId, 'invitee_user_id' => $inviteeUserId])->first();
        $now = gmdate('c');
        $message = mb_substr(trim($message), 0, 1000);
        if ($row) {
            if ((string) $row->status === 'pending') {
                return ['record' => $row, 'changed' => false];
            }
            $table->where('id', $row->id)->update([
                'inviter_user_id' => $inviterUserId,
                'message' => $message,
                'status' => 'pending',
                'updated_at' => $now,
                'responded_at' => '',
            ]);
            return ['record' => $table->where('id', $row->id)->first(), 'changed' => true];
        }
        $id = $table->insertGetId([
            'public_id' => $this->publicId('invite'),
            'question_id' => $questionId,
            'inviter_user_id' => $inviterUserId,
            'invitee_user_id' => $inviteeUserId,
            'message' => $message,
            'status' => 'pending',
            'created_at' => $now,
            'updated_at' => $now,
            'responded_at' => '',
        ]);
        return ['record' => $table->where('id', $id)->first(), 'changed' => true];
    }

    public function answerInvite(string $publicId): ?object
    {
        return $this->connection()->table('community_answer_invites')->where('public_id', trim($publicId))->first();
    }

    public function answerInvitePage(int $questionId, int $page = 1, int $limit = 8, ?int $inviteeUserId = null): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_answer_invites as i')
            ->join('users as inviter', 'inviter.id', '=', 'i.inviter_user_id')
            ->join('users as invitee', 'invitee.id', '=', 'i.invitee_user_id')
            ->where('i.question_id', $questionId)
            ->select('i.*', 'inviter.username as inviter_username', 'inviter.display_name as inviter_display_name',
                'invitee.username as invitee_username', 'invitee.display_name as invitee_display_name', 'invitee.avatar_url as invitee_avatar_url');
        if ($inviteeUserId !== null) {
            $query->where('i.invitee_user_id', $inviteeUserId);
        }
        $total = (clone $query)->count('i.id');
        $rows = $query->orderByRaw("CASE i.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END")
            ->orderByDesc('i.created_at')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        return $this->page(array_map(static fn (object $row): array => [
            'id' => (string) $row->public_id,
            'status' => (string) $row->status,
            'message' => (string) $row->message,
            'inviter' => ['id' => (int) $row->inviter_user_id, 'username' => (string) $row->inviter_username, 'displayName' => (string) $row->inviter_display_name],
            'invitee' => ['id' => (int) $row->invitee_user_id, 'username' => (string) $row->invitee_username, 'displayName' => (string) $row->invitee_display_name, 'avatarUrl' => (string) $row->invitee_avatar_url],
            'createdAt' => (string) $row->created_at,
            'respondedAt' => (string) $row->responded_at,
        ], $rows), $page, $limit, $total);
    }

    public function decideAnswerInvite(string $publicId, int $inviteeUserId, string $status): ?object
    {
        $now = gmdate('c');
        $this->connection()->table('community_answer_invites')
            ->where('public_id', $publicId)->where('invitee_user_id', $inviteeUserId)->where('status', 'pending')
            ->update(['status' => $status, 'updated_at' => $now, 'responded_at' => $now]);
        return $this->answerInvite($publicId);
    }

    public function completeAnswerInvite(int $questionId, int $inviteeUserId): void
    {
        $now = gmdate('c');
        $this->connection()->table('community_answer_invites')
            ->where(['question_id' => $questionId, 'invitee_user_id' => $inviteeUserId, 'status' => 'pending'])
            ->update(['status' => 'accepted', 'updated_at' => $now, 'responded_at' => $now]);
    }

    public function followerIds(string $objectType, int $objectId): array
    {
        return array_values(array_map('intval', $this->connection()->table('community_follows')
            ->where('object_type', $objectType)->where('object_id', $objectId)
            ->where('notification_level', '!=', 'none')->pluck('user_id')->all()));
    }

    public function tagFollowerIds(array $tags): array
    {
        $slugs = array_values(array_unique(array_filter(array_map(fn (mixed $tag): string => $this->tagSlug((string) $tag), $tags))));
        if ($slugs === []) {
            return [];
        }
        return array_values(array_map('intval', $this->connection()->table('community_follows as f')
            ->join('community_tags as t', 't.id', '=', 'f.object_id')
            ->where('f.object_type', 'tag')->where('f.notification_level', '!=', 'none')
            ->whereIn('t.slug', $slugs)->distinct()->pluck('f.user_id')->all()));
    }

    public function readableRecipientIds(object $question, array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds), static fn (int $id): bool => $id > 0)));
        if ($userIds === [] || !$question->organization_id || (string) $question->visibility === 'public') {
            return $userIds;
        }
        $memberIds = array_map('intval', $this->connection()->table('organization_members')
            ->where('organization_id', (int) $question->organization_id)->where('status', 'active')
            ->whereIn('user_id', $userIds)->pluck('user_id')->all());
        $moderatorIds = array_map('intval', $this->connection()->table('users')
            ->whereIn('id', $userIds)->whereIn('role', ['senior_editor', 'admin'])->pluck('id')->all());
        return array_values(array_unique(array_merge($memberIds, $moderatorIds)));
    }

    public function insertRevision(array $data): object
    {
        $next = (int) $this->connection()->table('community_revisions')
            ->where('object_type', $data['objectType'])->where('object_id', $data['objectId'])->max('revision_no') + 1;
        $id = $this->connection()->table('community_revisions')->insertGetId([
            'public_id' => $this->publicId('rev'),
            'object_type' => (string) $data['objectType'],
            'object_id' => (int) $data['objectId'],
            'revision_no' => $next,
            'editor_user_id' => (int) $data['editorUserId'],
            'title' => (string) ($data['title'] ?? ''),
            'body_md' => (string) $data['bodyMd'],
            'tags_json' => $this->json($data['tags'] ?? []),
            'summary' => mb_substr(trim((string) ($data['summary'] ?? '')), 0, 500),
            'status' => (string) ($data['status'] ?? 'approved'),
            'reviewer_user_id' => null,
            'review_opinion' => '',
            'created_at' => gmdate('c'),
            'reviewed_at' => '',
        ]);
        if ((string) ($data['status'] ?? 'approved') === 'approved') {
            $table = $data['objectType'] === 'question' ? 'community_questions' : 'community_answers';
            $this->connection()->table($table)->where('id', $data['objectId'])->update(['current_revision_id' => $id]);
        }
        return $this->connection()->table('community_revisions')->where('id', $id)->first();
    }

    public function revision(string|int $identifier): ?object
    {
        $query = $this->connection()->table('community_revisions');
        return $this->whereIdentifier($query, 'community_revisions', $identifier)->first();
    }

    public function reviewRevision(int $revisionId, int $reviewerId, string $status, string $opinion): void
    {
        $this->connection()->table('community_revisions')->where('id', $revisionId)->update([
            'status' => $status,
            'reviewer_user_id' => $reviewerId,
            'review_opinion' => mb_substr(trim($opinion), 0, 1000),
            'reviewed_at' => gmdate('c'),
        ]);
    }

    public function revisionPage(string $objectType, int $objectId, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_revisions as r')
            ->join('users as u', 'u.id', '=', 'r.editor_user_id')
            ->leftJoin('users as reviewer', 'reviewer.id', '=', 'r.reviewer_user_id')
            ->where('r.object_type', $objectType)->where('r.object_id', $objectId)
            ->select('r.*', 'u.username as editor_username', 'u.display_name as editor_display_name',
                'reviewer.username as reviewer_username', 'reviewer.display_name as reviewer_display_name');
        $total = (clone $query)->count('r.id');
        $rows = $query->orderByDesc('r.revision_no')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = array_map(fn (object $row): array => [
            'id' => (string) $row->public_id,
            'number' => (int) $row->revision_no,
            'title' => (string) $row->title,
            'bodyMd' => (string) $row->body_md,
            'tags' => $this->decode((string) $row->tags_json),
            'summary' => (string) $row->summary,
            'status' => (string) $row->status,
            'editor' => ['username' => (string) $row->editor_username, 'displayName' => (string) $row->editor_display_name],
            'reviewer' => $row->reviewer_user_id ? ['username' => (string) $row->reviewer_username, 'displayName' => (string) $row->reviewer_display_name] : null,
            'reviewOpinion' => (string) $row->review_opinion,
            'createdAt' => (string) $row->created_at,
            'reviewedAt' => (string) $row->reviewed_at,
        ], $rows);
        return $this->page($items, $page, $limit, $total);
    }

    public function recordActivity(array $data): int
    {
        return (int) $this->connection()->table('community_activity')->insertGetId([
            'event_id' => (string) ($data['eventId'] ?? $this->publicId('evt')),
            'actor_user_id' => $data['actorUserId'] ?? null,
            'event_type' => (string) $data['eventType'],
            'object_type' => (string) $data['objectType'],
            'object_id' => (int) $data['objectId'],
            'parent_type' => (string) ($data['parentType'] ?? ''),
            'parent_id' => $data['parentId'] ?? null,
            'space_id' => $data['spaceId'] ?? null,
            'organization_id' => $data['organizationId'] ?? null,
            'reputation_delta' => (int) ($data['reputationDelta'] ?? 0),
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'created_at' => gmdate('c'),
            'canceled_at' => '',
        ]);
    }

    public function activityPage(?UserIdentity $viewer, array $filters): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $limit = max(1, min(50, (int) ($filters['limit'] ?? 20)));
        $query = $this->connection()->table('community_activity as ca')
            ->leftJoin('users as u', 'u.id', '=', 'ca.actor_user_id')
            ->leftJoin('community_spaces as s', 's.id', '=', 'ca.space_id')
            ->where('ca.canceled_at', '')
            ->where('ca.event_type', 'not like', '%.reaction.%')
            ->select('ca.*', 'u.username as actor_username', 'u.display_name as actor_display_name', 'u.avatar_url as actor_avatar_url',
                's.visibility as space_visibility', 's.scope as space_scope');
        if (!empty($filters['userId'])) {
            $query->where('ca.actor_user_id', (int) $filters['userId']);
        }
        $total = (clone $query)->count('ca.id');
        $rows = $query->orderByDesc('ca.created_at')->orderByDesc('ca.id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = array_map(fn (object $row): array => [
            'id' => (string) $row->event_id,
            'eventType' => (string) $row->event_type,
            'objectType' => (string) $row->object_type,
            'objectId' => (int) $row->object_id,
            'parentType' => (string) $row->parent_type,
            'parentId' => $row->parent_id ? (int) $row->parent_id : null,
            'actor' => $row->actor_user_id ? ['id' => (int) $row->actor_user_id, 'username' => (string) $row->actor_username, 'displayName' => (string) $row->actor_display_name, 'avatarUrl' => (string) $row->actor_avatar_url] : null,
            'metadata' => $this->decode((string) $row->metadata_json),
            'createdAt' => (string) $row->created_at,
        ], $rows);
        return $this->page($items, $page, $limit, $total);
    }

    public function addReputation(int $userId, int $actorId, int $activityId, string $reason, int $delta, string $objectType, int $objectId): void
    {
        if ($delta === 0) {
            return;
        }
        $now = gmdate('c');
        $table = $this->connection()->table('community_reputation');
        $row = $table->where('user_id', $userId)->first();
        if ($row) {
            $table->where('user_id', $userId)->update(['score' => (int) $row->score + $delta, 'updated_at' => $now]);
        } else {
            $table->insert(['user_id' => $userId, 'score' => $delta, 'rank_position' => 0, 'updated_at' => $now]);
        }
        $this->connection()->table('community_reputation_events')->insert([
            'user_id' => $userId,
            'actor_user_id' => $actorId,
            'activity_id' => $activityId,
            'reason' => $reason,
            'delta' => $delta,
            'object_type' => $objectType,
            'object_id' => $objectId,
            'created_at' => $now,
            'canceled_at' => '',
        ]);
    }

    public function reputation(int $userId, int $page = 1, int $limit = 20): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $score = (int) ($this->connection()->table('community_reputation')->where('user_id', $userId)->value('score') ?? 0);
        $rank = (int) $this->connection()->table('community_reputation')->where('score', '>', $score)->count() + 1;
        $query = $this->connection()->table('community_reputation_events')->where('user_id', $userId)->where('canceled_at', '');
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $pageData = $this->page(array_map(fn (object $row): array => [
            'reason' => (string) $row->reason,
            'delta' => (int) $row->delta,
            'objectType' => (string) $row->object_type,
            'objectId' => (int) $row->object_id,
            'createdAt' => (string) $row->created_at,
        ], $rows), $page, $limit, $total);
        return ['score' => $score, 'rank' => $rank, 'events' => $pageData];
    }

    public function awardEligibleBadges(int $userId): array
    {
        $stats = [
            'questions_created' => $this->connection()->table('community_questions')->where('author_user_id', $userId)->where('status', 'published')->count(),
            'answers_created' => $this->connection()->table('community_answers')->where('author_user_id', $userId)->where('status', 'published')->count(),
            'accepted_answers' => $this->connection()->table('community_answers')->where('author_user_id', $userId)->where('is_accepted', 1)->where('status', 'published')->count(),
            'reputation' => (int) ($this->connection()->table('community_reputation')->where('user_id', $userId)->value('score') ?? 0),
        ];
        $awarded = [];
        foreach ($this->connection()->table('community_badges')->where('status', 'active')->get()->all() as $badge) {
            if (!isset($stats[(string) $badge->rule_key]) || $stats[(string) $badge->rule_key] < (int) $badge->threshold) {
                continue;
            }
            $existing = $this->connection()->table('community_badge_awards')->where(['badge_id' => $badge->id, 'user_id' => $userId])->first();
            if (!$existing) {
                $now = gmdate('c');
                $this->connection()->table('community_badge_awards')->insert([
                    'badge_id' => (int) $badge->id, 'user_id' => $userId, 'award_count' => 1,
                    'reason' => (string) $badge->description, 'awarded_at' => $now, 'updated_at' => $now,
                ]);
                $awarded[] = ['slug' => (string) $badge->slug, 'name' => (string) $badge->name, 'level' => (string) $badge->level, 'icon' => (string) $badge->icon];
            }
        }
        return $awarded;
    }

    public function badges(int $userId): array
    {
        return array_map(static fn (object $row): array => [
            'slug' => (string) $row->slug,
            'name' => (string) $row->name,
            'description' => (string) $row->description,
            'level' => (string) $row->level,
            'icon' => (string) $row->icon,
            'awardCount' => (int) $row->award_count,
            'awardedAt' => (string) $row->awarded_at,
        ], $this->connection()->table('community_badge_awards as ba')
            ->join('community_badges as b', 'b.id', '=', 'ba.badge_id')
            ->where('ba.user_id', $userId)->orderByDesc('ba.awarded_at')->get()->all());
    }

    public function collectionPage(int $userId, int $page, int $limit): array
    {
        $this->pruneInvalidEngagements($userId);
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_collections')->where('user_id', $userId);
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $objects = $this->objectSummaries($rows);
        $items = [];
        foreach ($rows as $row) {
            $object = $objects[(string) $row->object_type . ':' . (int) $row->object_id] ?? null;
            if ($object) {
                $items[] = $object + [
                    'collectionName' => (string) $row->collection_name,
                    'note' => (string) $row->note,
                    'collectedAt' => (string) $row->created_at,
                ];
            }
        }
        return $this->page($items, $page, $limit, $total);
    }

    public function followPage(int $userId, int $page, int $limit): array
    {
        $this->pruneInvalidEngagements($userId);
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('community_follows')->where('user_id', $userId)
            ->whereIn('object_type', ['question', 'tag']);
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $objects = $this->objectSummaries($rows);
        $items = [];
        foreach ($rows as $row) {
            $object = $objects[(string) $row->object_type . ':' . (int) $row->object_id] ?? null;
            if ($object) {
                $items[] = $object + [
                    'notificationLevel' => (string) $row->notification_level,
                    'followedAt' => (string) $row->created_at,
                ];
            }
        }
        return $this->page($items, $page, $limit, $total);
    }

    public function visibleOrganizationIds(?UserIdentity $viewer): ?array
    {
        return null;
    }

    public function insertReport(array $data): object
    {
        $now = gmdate('c');
        $id = $this->connection()->table('community_reports')->insertGetId([
            'public_id' => $this->publicId('report'),
            'reporter_user_id' => (int) $data['reporterUserId'],
            'object_type' => (string) $data['objectType'],
            'object_id' => (int) $data['objectId'],
            'organization_id' => $data['organizationId'] ?? null,
            'reason' => (string) $data['reason'],
            'details' => mb_substr(trim((string) ($data['details'] ?? '')), 0, 1000),
            'status' => 'pending',
            'assignee_user_id' => null,
            'resolution' => '',
            'created_at' => $now,
            'updated_at' => $now,
            'resolved_at' => '',
        ]);
        return $this->connection()->table('community_reports')->where('id', $id)->first();
    }

    public function reportPage(string $status, int $page, int $limit, ?int $organizationId = null): array
    {
        $page = max(1, $page);
        $limit = max(1, min(100, $limit));
        $query = $this->connection()->table('community_reports as r')
            ->join('users as u', 'u.id', '=', 'r.reporter_user_id')
            ->select('r.*', 'u.username as reporter_username', 'u.display_name as reporter_display_name');
        if ($status !== '') {
            $query->where('r.status', $status);
        }
        if ($organizationId !== null) {
            $query->where('r.organization_id', $organizationId);
        }
        $total = (clone $query)->count('r.id');
        $rows = $query->orderBy('r.status')->orderBy('r.created_at')->orderBy('r.id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $objects = $this->objectSummaries($rows);
        return $this->page(array_map(fn (object $row): array => [
            'id' => (string) $row->public_id,
            'objectType' => (string) $row->object_type,
            'objectId' => (int) $row->object_id,
            'object' => $objects[(string) $row->object_type . ':' . (int) $row->object_id] ?? null,
            'reason' => (string) $row->reason,
            'details' => (string) $row->details,
            'status' => (string) $row->status,
            'reporter' => ['username' => (string) $row->reporter_username, 'displayName' => (string) $row->reporter_display_name],
            'resolution' => (string) $row->resolution,
            'createdAt' => (string) $row->created_at,
            'resolvedAt' => (string) $row->resolved_at,
        ], $rows), $page, $limit, $total);
    }

    public function resolveReport(string $publicId, int $actorId, string $status, string $resolution): void
    {
        $now = gmdate('c');
        $this->connection()->table('community_reports')->where('public_id', $publicId)->update([
            'status' => $status,
            'assignee_user_id' => $actorId,
            'resolution' => mb_substr(trim($resolution), 0, 1000),
            'updated_at' => $now,
            'resolved_at' => $now,
        ]);
    }

    public function reviewPage(string $status, int $page, int $limit, ?int $organizationId = null): array
    {
        $page = max(1, $page);
        $limit = max(1, min(100, $limit));
        $query = $this->connection()->table('community_reviews as cr')
            ->leftJoin('users as requester', 'requester.id', '=', 'cr.requested_by')
            ->leftJoin('users as reviewer', 'reviewer.id', '=', 'cr.reviewer_user_id')
            ->where('cr.status', $status ?: 'pending')
            ->select('cr.*', 'requester.username as requester_username', 'requester.display_name as requester_display_name',
                'reviewer.username as reviewer_username', 'reviewer.display_name as reviewer_display_name');
        if ($organizationId !== null) {
            $query->where('cr.organization_id', $organizationId);
        }
        $total = (clone $query)->count('cr.id');
        $rows = $query->orderBy('cr.created_at')->orderBy('cr.id')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $objects = $this->objectSummaries($rows);
        return $this->page(array_map(fn (object $row): array => [
            'id' => (string) $row->public_id,
            'objectType' => (string) $row->object_type,
            'objectId' => (int) $row->object_id,
            'object' => $objects[(string) $row->object_type . ':' . (int) $row->object_id] ?? null,
            'queueType' => (string) $row->queue_type,
            'status' => (string) $row->status,
            'reason' => (string) $row->reason,
            'payload' => $this->decode((string) $row->payload_json),
            'requester' => $row->requested_by ? ['id' => (int) $row->requested_by, 'username' => (string) $row->requester_username, 'displayName' => (string) $row->requester_display_name] : null,
            'reviewer' => $row->reviewer_user_id ? ['id' => (int) $row->reviewer_user_id, 'username' => (string) $row->reviewer_username, 'displayName' => (string) $row->reviewer_display_name] : null,
            'createdAt' => (string) $row->created_at,
            'reviewedAt' => (string) $row->reviewed_at,
        ], $rows), $page, $limit, $total);
    }

    public function insertReview(string $objectType, int $objectId, string $queueType, int $requestedBy, string $reason, array $payload = [], ?int $organizationId = null): object
    {
        $now = gmdate('c');
        $id = $this->connection()->table('community_reviews')->insertGetId([
            'public_id' => $this->publicId('review'), 'object_type' => $objectType, 'object_id' => $objectId,
            'organization_id' => $organizationId,
            'queue_type' => $queueType, 'status' => 'pending', 'requested_by' => $requestedBy,
            'reviewer_user_id' => null, 'reason' => mb_substr($reason, 0, 1000), 'payload_json' => $this->json($payload),
            'created_at' => $now, 'updated_at' => $now, 'reviewed_at' => '',
        ]);
        return $this->connection()->table('community_reviews')->where('id', $id)->first();
    }

    public function decideReview(string $publicId, int $reviewerId, string $status, string $reason): ?object
    {
        $now = gmdate('c');
        $this->connection()->table('community_reviews')->where('public_id', $publicId)->where('status', 'pending')->update([
            'status' => $status, 'reviewer_user_id' => $reviewerId, 'reason' => mb_substr($reason, 0, 1000),
            'updated_at' => $now, 'reviewed_at' => $now,
        ]);
        return $this->connection()->table('community_reviews')->where('public_id', $publicId)->first();
    }

    public function recordView(int $questionId, string $viewerKey, ?int $userId): void
    {
        if ($viewerKey === '') {
            return;
        }
        $now = gmdate('c');
        $table = $this->connection()->table('community_views');
        $row = $table->where(['question_id' => $questionId, 'viewer_key' => $viewerKey])->first();
        if ($row) {
            $table->where(['question_id' => $questionId, 'viewer_key' => $viewerKey])->update([
                'last_viewed_at' => $now, 'view_count' => (int) $row->view_count + 1, 'user_id' => $userId,
            ]);
        } else {
            $table->insert(['question_id' => $questionId, 'viewer_key' => $viewerKey, 'user_id' => $userId, 'first_viewed_at' => $now, 'last_viewed_at' => $now, 'view_count' => 1]);
        }
        $this->connection()->table('community_questions')->where('id', $questionId)->update([
            'view_count' => $this->connection()->table('community_views')->where('question_id', $questionId)->sum('view_count'),
            'unique_view_count' => $this->connection()->table('community_views')->where('question_id', $questionId)->count(),
        ]);
        $this->recalculateQuestion($questionId);
    }

    public function refreshQuestionCounts(int $questionId): void
    {
        $answerCount = $this->connection()->table('community_answers')->where('question_id', $questionId)->where('status', 'published')->count();
        $commentCount = $this->connection()->table('community_comments')->where('question_id', $questionId)->where('status', 'published')->count();
        $this->connection()->table('community_questions')->where('id', $questionId)->update([
            'answer_count' => $answerCount,
            'comment_count' => $commentCount,
            'last_activity_at' => gmdate('c'),
            'updated_at' => gmdate('c'),
        ]);
        $this->recalculateQuestion($questionId);
    }

    public function refreshAnswerCounts(int $answerId): void
    {
        $commentCount = $this->connection()->table('community_comments')->where('target_type', 'answer')->where('target_id', $answerId)->where('status', 'published')->count();
        $this->connection()->table('community_answers')->where('id', $answerId)->update(['comment_count' => $commentCount, 'updated_at' => gmdate('c')]);
    }

    public function objectAuthor(string $objectType, int $objectId): ?int
    {
        $table = match ($objectType) {
            'question' => 'community_questions',
            'answer' => 'community_answers',
            'comment' => 'community_comments',
            default => null,
        };
        return $table ? (($value = $this->connection()->table($table)->where('id', $objectId)->value('author_user_id')) !== null ? (int) $value : null) : null;
    }

    public function createAttachment(array $data): object
    {
        $now = gmdate('c');
        $id = $this->connection()->table('community_attachments')->insertGetId([
            'public_id' => (string) $data['publicId'],
            'owner_user_id' => (int) $data['ownerUserId'],
            'object_type' => '',
            'object_id' => null,
            'storage_disk' => 'local',
            'storage_path' => (string) $data['storagePath'],
            'original_name' => (string) $data['originalName'],
            'mime_type' => (string) $data['mimeType'],
            'size_bytes' => (int) $data['sizeBytes'],
            'sha256' => (string) $data['sha256'],
            'status' => 'pending',
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return $this->connection()->table('community_attachments')->where('id', $id)->first();
    }

    public function attachment(string $publicId): ?object
    {
        return $this->connection()->table('community_attachments')->where('public_id', $publicId)->first();
    }

    public function bindAttachments(int $ownerUserId, array $publicIds, string $objectType, int $objectId): array
    {
        $publicIds = array_values(array_unique(array_filter(array_map('strval', $publicIds))));
        if ($publicIds === []) {
            return [];
        }
        $rows = $this->connection()->table('community_attachments')
            ->whereIn('public_id', $publicIds)->where('owner_user_id', $ownerUserId)->get()->all();
        if (count($rows) !== count($publicIds)) {
            throw new \RuntimeException('社区附件不存在或不属于当前用户。');
        }
        foreach ($rows as $row) {
            if ((string) $row->status !== 'pending' && !((string) $row->object_type === $objectType && (int) $row->object_id === $objectId)) {
                throw new \RuntimeException('社区附件已绑定到其他内容。');
            }
        }
        $this->connection()->table('community_attachments')->whereIn('public_id', $publicIds)->update([
            'object_type' => $objectType,
            'object_id' => $objectId,
            'status' => 'ready',
            'updated_at' => gmdate('c'),
        ]);
        return $rows;
    }

    public function attachmentsFor(string $objectType, array $objectIds): array
    {
        $objectIds = array_values(array_unique(array_map('intval', $objectIds)));
        if ($objectIds === []) {
            return [];
        }
        return $this->connection()->table('community_attachments')
            ->where('object_type', $objectType)->whereIn('object_id', $objectIds)->where('status', 'ready')
            ->orderBy('id')->get()->all();
    }

    public function user(int $id): ?object
    {
        return $this->connection()->table('users')->where('id', $id)->first();
    }

    private function objectSummaries(iterable $sourceRows): array
    {
        $ids = [];
        foreach ($sourceRows as $row) {
            $type = (string) $row->object_type;
            $ids[$type][] = (int) $row->object_id;
        }
        $result = [];
        if (!empty($ids['question'])) {
            foreach ($this->connection()->table('community_questions')->whereIn('id', array_unique($ids['question']))
                ->whereIn('status', ['published', 'closed'])->get()->all() as $row) {
                $result['question:' . (int) $row->id] = [
                    'type' => 'question', 'id' => (string) $row->public_id, 'title' => (string) $row->title,
                    'summary' => mb_substr((string) $row->body_plain, 0, 300),
                    'url' => '#/questions/' . rawurlencode((string) $row->public_id), 'status' => (string) $row->status,
                ];
            }
        }
        if (!empty($ids['tag'])) {
            foreach ($this->connection()->table('community_tags')->whereIn('id', array_unique($ids['tag']))->where('status', 'active')->get()->all() as $row) {
                $result['tag:' . (int) $row->id] = [
                    'type' => 'tag', 'id' => (string) $row->slug, 'title' => (string) $row->name,
                    'summary' => mb_substr((string) $row->description_md, 0, 300),
                    'url' => '#/questions?tag=' . rawurlencode((string) $row->name), 'status' => 'active',
                ];
            }
        }
        if (!empty($ids['answer'])) {
            foreach ($this->connection()->table('community_answers as a')->join('community_questions as q', 'q.id', '=', 'a.question_id')
                ->whereIn('a.id', array_unique($ids['answer']))->where('a.status', 'published')->whereIn('q.status', ['published', 'closed'])
                ->select('a.*', 'q.public_id as question_public_id', 'q.title as question_title')->get()->all() as $row) {
                $result['answer:' . (int) $row->id] = [
                    'type' => 'answer', 'id' => (string) $row->public_id, 'title' => '回答：' . (string) $row->question_title,
                    'summary' => mb_substr((string) $row->body_plain, 0, 300),
                    'url' => '#/questions/' . rawurlencode((string) $row->question_public_id) . '?answer=' . rawurlencode((string) $row->public_id),
                    'status' => (string) $row->status,
                ];
            }
        }
        if (!empty($ids['comment'])) {
            foreach ($this->connection()->table('community_comments as c')->join('community_questions as q', 'q.id', '=', 'c.question_id')
                ->whereIn('c.id', array_unique($ids['comment']))->where('c.status', 'published')->whereIn('q.status', ['published', 'closed'])
                ->select('c.*', 'q.public_id as question_public_id', 'q.title as question_title')->get()->all() as $row) {
                $result['comment:' . (int) $row->id] = [
                    'type' => 'comment', 'id' => (string) $row->public_id, 'title' => '评论：' . (string) $row->question_title,
                    'summary' => mb_substr((string) $row->body_plain, 0, 300),
                    'url' => '#/questions/' . rawurlencode((string) $row->question_public_id) . '?comment=' . rawurlencode((string) $row->public_id),
                    'status' => (string) $row->status,
                ];
            }
        }
        if (!empty($ids['question_revision'])) {
            foreach ($this->connection()->table('community_revisions as r')->join('community_questions as q', function ($join): void {
                $join->on('q.id', '=', 'r.object_id')->where('r.object_type', '=', 'question');
            })->whereIn('r.id', array_unique($ids['question_revision']))
                ->select('r.id', 'r.public_id', 'r.summary', 'r.status', 'q.public_id as question_public_id', 'q.title as question_title')->get()->all() as $row) {
                $result['question_revision:' . (int) $row->id] = [
                    'type' => 'revision', 'id' => (string) $row->public_id, 'title' => '修订：' . (string) $row->question_title,
                    'summary' => (string) $row->summary,
                    'url' => '#/questions/' . rawurlencode((string) $row->question_public_id),
                    'status' => (string) $row->status,
                ];
            }
        }
        return $result;
    }

    private function questionQuery(): Builder
    {
        return $this->connection()->table('community_questions as q')
            ->join('community_spaces as s', 's.id', '=', 'q.space_id')
            ->join('users as u', 'u.id', '=', 'q.author_user_id')
            ->leftJoin('writing_organizations as o', 'o.id', '=', 'q.organization_id')
            ->leftJoin('community_answers as accepted', 'accepted.id', '=', 'q.accepted_answer_id')
            ->select('q.*', 's.scope as space_scope', 's.slug as space_slug', 's.name as space_name',
                'u.username as author_username', 'u.display_name as author_display_name',
                'u.avatar_url as author_avatar_url', 'u.role as author_role', 'u.status as author_status',
                'o.slug as organization_slug', 'o.name as organization_name', 'o.avatar_image as organization_avatar',
                'accepted.public_id as accepted_answer_public_id');
    }

    private function whereIdentifier(Builder $query, string $alias, string|int $identifier): Builder
    {
        $id = trim((string) $identifier);
        return ctype_digit($id)
            ? $query->where(function (Builder $scope) use ($alias, $id): void {
                $scope->where($alias . '.public_id', $id)->orWhere($alias . '.id', (int) $id);
            })
            : $query->where($alias . '.public_id', $id);
    }

    private function questionData(object $row): array
    {
        return [
            'id' => (string) $row->public_id,
            'numericId' => (int) $row->id,
            'title' => (string) $row->title,
            'bodyMd' => (string) $row->body_md,
            'bodyHtml' => '',
            'summary' => mb_substr((string) $row->body_plain, 0, 360),
            'language' => (string) $row->language,
            'status' => (string) $row->status,
            'reviewStatus' => (string) $row->review_status,
            'closed' => (string) $row->status === 'closed',
            'closeReason' => (string) $row->close_reason,
            'viewCount' => (int) $row->view_count,
            'uniqueViewCount' => (int) $row->unique_view_count,
            'answerCount' => (int) $row->answer_count,
            'commentCount' => (int) $row->comment_count,
            'upvoteCount' => (int) $row->upvote_count,
            'downvoteCount' => (int) $row->downvote_count,
            'voteCount' => (int) $row->vote_score,
            'reactionCount' => (int) $row->reaction_count,
            'collectionCount' => (int) $row->collection_count,
            'followerCount' => (int) $row->follower_count,
            'acceptedAnswerId' => (string) ($row->accepted_answer_public_id ?? ''),
            'author' => $this->authorData($row),
            'space' => ['scope' => (string) $row->space_scope, 'slug' => (string) $row->space_slug, 'name' => (string) $row->space_name],
            'organization' => $row->organization_id ? [
                'id' => (int) $row->organization_id,
                'slug' => (string) $row->organization_slug,
                'name' => (string) $row->organization_name,
                'avatarUrl' => (string) $row->organization_avatar,
                'visibility' => (string) $row->visibility,
            ] : null,
            'createdAt' => (string) $row->created_at,
            'updatedAt' => (string) $row->updated_at,
            'lastActivityAt' => (string) $row->last_activity_at,
            'url' => '#/questions/' . rawurlencode((string) $row->public_id),
            'source' => 'wikist',
        ];
    }

    private function answerData(object $row): array
    {
        return [
            'id' => (string) $row->public_id,
            'numericId' => (int) $row->id,
            'questionId' => (string) ($row->question_public_id ?? ''),
            'bodyMd' => (string) $row->body_md,
            'bodyHtml' => '',
            'summary' => mb_substr((string) $row->body_plain, 0, 360),
            'status' => (string) $row->status,
            'reviewStatus' => (string) $row->review_status,
            'accepted' => (bool) $row->is_accepted,
            'commentCount' => (int) $row->comment_count,
            'upvoteCount' => (int) $row->upvote_count,
            'downvoteCount' => (int) $row->downvote_count,
            'voteCount' => (int) $row->vote_score,
            'reactionCount' => (int) $row->reaction_count,
            'collectionCount' => (int) $row->collection_count,
            'author' => $this->authorData($row),
            'createdAt' => (string) $row->created_at,
            'updatedAt' => (string) $row->updated_at,
            'acceptedAt' => (string) $row->accepted_at,
            'url' => '#/questions/' . rawurlencode((string) ($row->question_public_id ?? '')) . '?answer=' . rawurlencode((string) $row->public_id),
            'source' => 'wikist',
        ];
    }

    private function commentData(object $row): array
    {
        return [
            'id' => (string) $row->public_id,
            'numericId' => (int) $row->id,
            'objectType' => (string) $row->target_type,
            'objectId' => (int) $row->target_id,
            'bodyMd' => (string) $row->body_md,
            'bodyHtml' => '',
            'voteCount' => (int) $row->upvote_count,
            'reactionCount' => (int) $row->reaction_count,
            'author' => $this->authorData($row),
            'replyToCommentId' => (string) ($row->reply_comment_public_id ?? ''),
            'replyUser' => $row->reply_user_id ? ['id' => (int) $row->reply_user_id, 'username' => (string) $row->reply_username, 'displayName' => (string) $row->reply_display_name] : null,
            'createdAt' => (string) $row->created_at,
            'updatedAt' => (string) $row->updated_at,
        ];
    }

    private function authorData(object $row): array
    {
        return [
            'id' => (int) $row->author_user_id,
            'username' => (string) $row->author_username,
            'displayName' => (string) $row->author_display_name,
            'avatarUrl' => (string) $row->author_avatar_url,
            'role' => (string) $row->author_role,
            'status' => (string) $row->author_status,
        ];
    }

    private function attachTags(array &$items): void
    {
        $ids = array_values(array_filter(array_map(static fn (array $item): int => (int) ($item['numericId'] ?? 0), $items)));
        if ($ids === []) {
            return;
        }
        $tags = [];
        foreach ($this->connection()->table('community_question_tags as qt')->join('community_tags as t', 't.id', '=', 'qt.tag_id')
            ->whereIn('qt.question_id', $ids)->orderBy('t.name')->select('qt.question_id', 't.slug', 't.name')->get()->all() as $row) {
            $tags[(int) $row->question_id][] = (string) $row->name;
        }
        foreach ($items as &$item) {
            $item['tags'] = $tags[(int) $item['numericId']] ?? [];
        }
    }

    private function attachQuestionOrigins(array &$items): void
    {
        $ids = array_values(array_filter(array_map(static fn (array $item): int => (int) ($item['numericId'] ?? 0), $items)));
        if ($ids === []) {
            return;
        }
        $sources = [];
        foreach ($this->connection()->table('community_question_sources')->whereIn('question_id', $ids)->get()->all() as $row) {
            $sources[(int) $row->question_id] = $row;
        }
        foreach ($items as &$item) {
            $origins = [];
            if (!empty($item['organization'])) {
                $origins[] = [
                    'type' => 'organization',
                    'id' => (string) ($item['organization']['slug'] ?? ''),
                    'label' => (string) ($item['organization']['name'] ?? '协作组织'),
                    'url' => '#/organization/' . rawurlencode((string) ($item['organization']['slug'] ?? '')),
                    'excerpt' => '',
                ];
            }
            $source = $sources[(int) $item['numericId']] ?? null;
            if ($source) {
                $origins[] = [
                    'type' => (string) $source->source_type,
                    'objectType' => (string) $source->object_type,
                    'id' => (string) $source->object_key,
                    'label' => (string) $source->label,
                    'url' => (string) $source->url,
                    'excerpt' => (string) $source->excerpt,
                    'metadata' => json_decode((string) $source->metadata_json, true) ?: [],
                ];
            }
            $item['origins'] = $origins;
            $item['originTypes'] = array_values(array_unique(array_map(static fn (array $origin): string => (string) $origin['type'], $origins)));
        }
    }

    private function tagsForQuestion(int $questionId): array
    {
        return array_values(array_map(static fn (object $row): string => (string) $row->name,
            $this->connection()->table('community_question_tags as qt')->join('community_tags as t', 't.id', '=', 'qt.tag_id')
                ->where('qt.question_id', $questionId)->orderBy('t.name')->select('t.name')->get()->all()));
    }

    private function viewerState(string $objectType, int $objectId, ?int $viewerId): array
    {
        if (!$viewerId) {
            return ['vote' => 0, 'collected' => false, 'followed' => false];
        }
        return [
            'vote' => (int) ($this->connection()->table('community_votes')->where(['user_id' => $viewerId, 'object_type' => $objectType, 'object_id' => $objectId])->value('value') ?? 0),
            'collected' => $this->connection()->table('community_collections')->where(['user_id' => $viewerId, 'object_type' => $objectType, 'object_id' => $objectId])->exists(),
            'followed' => $this->connection()->table('community_follows')->where(['user_id' => $viewerId, 'object_type' => $objectType, 'object_id' => $objectId])->exists(),
        ];
    }

    private function reactionSummary(string $objectType, int $objectId, ?int $viewerId): array
    {
        $rows = $this->connection()->table('community_reactions')->where('object_type', $objectType)->where('object_id', $objectId)
            ->select('reaction')->selectRaw('COUNT(*) as total')->groupBy('reaction')->orderByDesc('total')->get()->all();
        $mine = $viewerId ? $this->connection()->table('community_reactions')->where(['user_id' => $viewerId, 'object_type' => $objectType, 'object_id' => $objectId])->pluck('reaction')->map('strval')->all() : [];
        return array_map(static fn (object $row): array => ['reaction' => (string) $row->reaction, 'count' => (int) $row->total, 'active' => in_array((string) $row->reaction, $mine, true)], $rows);
    }

    private function voteCounts(string $objectType, int $objectId): array
    {
        $up = $this->connection()->table('community_votes')->where(['object_type' => $objectType, 'object_id' => $objectId, 'value' => 1])->count();
        $down = $this->connection()->table('community_votes')->where(['object_type' => $objectType, 'object_id' => $objectId, 'value' => -1])->count();
        return ['upvote_count' => $up, 'downvote_count' => $down, 'vote_score' => $up - $down, 'upvoteCount' => $up, 'downvoteCount' => $down, 'voteCount' => $up - $down];
    }

    private function updateObjectCounts(string $objectType, int $objectId, array $counts): void
    {
        $table = match ($objectType) {
            'question' => 'community_questions',
            'answer' => 'community_answers',
            'comment' => 'community_comments',
            default => null,
        };
        if (!$table) {
            return;
        }
        $allowed = array_intersect_key($counts, array_flip(['upvote_count', 'downvote_count', 'vote_score', 'reaction_count', 'collection_count', 'follower_count']));
        if ($allowed !== []) {
            $this->connection()->table($table)->where('id', $objectId)->update($allowed + ['updated_at' => gmdate('c')]);
        }
        if ($objectType === 'question') {
            $this->recalculateQuestion($objectId);
        } elseif ($objectType === 'answer') {
            $questionId = (int) ($this->connection()->table('community_answers')->where('id', $objectId)->value('question_id') ?? 0);
            if ($questionId) {
                $this->recalculateQuestion($questionId);
            }
        }
    }

    private function recalculateQuestion(int $questionId): void
    {
        $question = $this->connection()->table('community_questions')->where('id', $questionId)->first();
        if (!$question) {
            return;
        }
        $answerScore = (int) $this->connection()->table('community_answers')->where('question_id', $questionId)->where('status', 'published')->sum('vote_score');
        $ageHours = max(0.0, (time() - (strtotime((string) $question->created_at) ?: time())) / 3600);
        $updatedHours = max(0.0, (time() - (strtotime((string) $question->last_activity_at) ?: time())) / 3600);
        $numerator = log(max(1, (int) $question->view_count)) * 4
            + (((int) $question->answer_count * max(0, (int) $question->vote_score)) / 5)
            + max(0, $answerScore) + ((int) $question->follower_count * 1.5);
        // Inspired by Apache Answer's time-decayed hot ranking; independently adapted for Wikist signals.
        $denominator = pow(max(1.0, ($ageHours + 1) - (($ageHours - $updatedHours) / 2)), 1.5);
        $this->connection()->table('community_questions')->where('id', $questionId)->update(['hot_score' => max(0.0, $numerator / $denominator)]);
    }

    private function page(array $items, int $page, int $limit, int $total): array
    {
        return ['items' => $items, 'page' => $page, 'limit' => $limit, 'total' => $total, 'pages' => max(1, (int) ceil($total / $limit))];
    }

    private function tagSlug(string $value): string
    {
        $value = mb_strtolower(trim($value));
        $value = preg_replace('/[^\p{L}\p{N}._-]+/u', '-', $value) ?: '';
        return mb_substr(trim($value, '-'), 0, 100);
    }

    private function publicId(string $prefix): string
    {
        return $prefix . '-' . bin2hex(random_bytes(12));
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function decode(string $value): array
    {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}
