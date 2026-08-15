<?php

namespace app\repository;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use support\Db;

final class SelectionRepository
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

    public function findByAnchor(string $objectType, string $objectId, string $anchorHash): ?object
    {
        $pointer = $this->connection()->table('content_selections')
            ->where('object_type', $objectType)
            ->where('object_id', $objectId)
            ->where('anchor_hash', $anchorHash)
            ->select(['id', 'status'])
            ->first();
        return $pointer ? $this->find((int) $pointer->id) : null;
    }

    public function find(int $selectionId): ?object
    {
        $visited = [];
        for ($depth = 0; $depth < 8 && $selectionId > 0; $depth++) {
            if (isset($visited[$selectionId])) {
                return null;
            }
            $visited[$selectionId] = true;
            $pointer = $this->connection()->table('content_selections')
                ->where('id', $selectionId)
                ->select(['id', 'status'])
                ->first();
            if (!$pointer) {
                return null;
            }
            if ((string) $pointer->status === 'active') {
                return $this->baseSelectionQuery()
                    ->where('s.id', $selectionId)
                    ->where('s.status', 'active')
                    ->first();
            }
            if (!preg_match('/^merged:(\d+)$/', (string) $pointer->status, $match)) {
                return null;
            }
            $selectionId = (int) $match[1];
        }
        return null;
    }

    public function createOrRefresh(array $selection, int $userId): object
    {
        return $this->transaction(function () use ($selection, $userId): object {
            $anchorPointer = $this->connection()->table('content_selections')
                ->where('object_type', $selection['objectType'])
                ->where('object_id', $selection['objectId'])
                ->where('anchor_hash', $selection['anchorHash'])
                ->select(['id', 'status'])
                ->first();
            $exact = $anchorPointer ? $this->find((int) $anchorPointer->id) : null;
            $candidates = $this->equivalentSelections($selection);
            if ($exact && !array_filter($candidates, static fn (object $row): bool => (int) $row->id === (int) $exact->id)) {
                $candidates[] = $exact;
            }
            usort($candidates, static fn (object $left, object $right): int => (int) $left->id <=> (int) $right->id);
            $existing = $candidates[0] ?? null;
            $now = gmdate('c');
            if (!$existing) {
                $values = [
                    'object_type' => $selection['objectType'],
                    'object_id' => $selection['objectId'],
                    'object_label' => $selection['objectLabel'],
                    'object_url' => $selection['objectUrl'],
                    'selected_text' => $selection['selectedText'],
                    'prefix_text' => $selection['prefixText'],
                    'suffix_text' => $selection['suffixText'],
                    'start_offset' => $selection['startOffset'],
                    'end_offset' => $selection['endOffset'],
                    'anchor_hash' => $selection['anchorHash'],
                    'creator_user_id' => $userId,
                    'status' => 'active',
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
                if ($anchorPointer && (string) $anchorPointer->status === 'deleted') {
                    $this->connection()->table('content_selections')->where('id', $anchorPointer->id)->update($values);
                } else {
                    $this->connection()->table('content_selections')->insertOrIgnore($values);
                }
                $existing = $this->findByAnchor($selection['objectType'], $selection['objectId'], $selection['anchorHash']);
                if (!$existing) {
                    throw new \RuntimeException('Unable to create the selection anchor.');
                }
                return $existing;
            }

            foreach ($candidates as $candidate) {
                if ((int) $candidate->id !== (int) $existing->id) {
                    $this->mergeInto((int) $existing->id, (int) $candidate->id, $now);
                }
            }

            $this->connection()->table('content_selections')->where('id', $existing->id)->update([
                'object_label' => $selection['objectLabel'],
                'object_url' => $selection['objectUrl'],
                'selected_text' => $selection['selectedText'],
                'prefix_text' => $selection['prefixText'],
                'suffix_text' => $selection['suffixText'],
                'start_offset' => $selection['startOffset'],
                'end_offset' => $selection['endOffset'],
                'updated_at' => $now,
            ]);
            return $this->find((int) $existing->id);
        });
    }

    public function selection(int $selectionId, int $viewerId = 0): ?array
    {
        $row = $this->find($selectionId);
        if (!$row) {
            return null;
        }
        return $this->decorate([$row], $viewerId)[0] ?? null;
    }

    public function markers(string $objectType, string $objectId, int $viewerId = 0): array
    {
        $query = $this->baseSelectionQuery()
            ->where('s.object_type', $objectType)
            ->where('s.object_id', $objectId)
            ->where('s.status', 'active')
            ->where(function (Builder $scope): void {
                $scope->whereExists(function (Builder $subquery): void {
                    $subquery->selectRaw('1')->from('content_selection_likes as marker_likes')
                        ->whereColumn('marker_likes.selection_id', 's.id');
                })->orWhereExists(function (Builder $subquery): void {
                    $subquery->selectRaw('1')->from('content_selection_comments as marker_comments')
                        ->whereColumn('marker_comments.selection_id', 's.id')
                        ->where('marker_comments.status', 'published');
                })->orWhereExists(function (Builder $subquery): void {
                    $subquery->selectRaw('1')->from('content_selection_activities as marker_activities')
                        ->whereColumn('marker_activities.selection_id', 's.id')
                        ->where('marker_activities.activity_type', 'quote');
                });
            });
        $rows = $query->orderBy('s.start_offset')->orderBy('s.id')->limit(500)->get()->all();
        return $this->decorate($rows, $viewerId);
    }

    public function comments(int $selectionId, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('content_selection_comments as c')
            ->join('users as u', 'u.id', '=', 'c.user_id')
            ->leftJoin('content_selection_comments as reply', 'reply.id', '=', 'c.reply_to_comment_id')
            ->leftJoin('users as reply_user', 'reply_user.id', '=', 'reply.user_id')
            ->where('c.selection_id', $selectionId)
            ->where('c.status', 'published');
        $total = (clone $query)->count();
        $rows = $query->select([
            'c.id', 'c.selection_id', 'c.user_id', 'c.reply_to_comment_id', 'c.body_md', 'c.body_plain', 'c.created_at', 'c.updated_at',
            'u.username', 'u.display_name', 'u.avatar_url', 'u.status as user_status',
            'reply.user_id as reply_user_id', 'reply_user.username as reply_username',
            'reply_user.display_name as reply_display_name',
        ])->orderByDesc('c.id')->limit($limit)->offset(($page - 1) * $limit)->get()->all();
        return [
            'items' => array_map(fn (object $row): array => $this->commentArray($row), $rows),
            'pagination' => $this->pagination($page, $limit, $total),
        ];
    }

    public function addComment(int $selectionId, int $userId, string $bodyMd, string $bodyPlain, int $replyToCommentId = 0): array
    {
        $now = gmdate('c');
        $id = (int) $this->transaction(function () use ($selectionId, $userId, $bodyMd, $bodyPlain, $replyToCommentId, $now): int {
            $id = (int) $this->connection()->table('content_selection_comments')->insertGetId([
                'selection_id' => $selectionId,
                'user_id' => $userId,
                'reply_to_comment_id' => $replyToCommentId,
                'body_md' => $bodyMd,
                'body_plain' => $bodyPlain,
                'status' => 'published',
                'created_at' => $now,
                'updated_at' => $now,
                'deleted_at' => '',
            ]);
            $this->touch($selectionId, $now);
            return $id;
        });
        $row = $this->connection()->table('content_selection_comments as c')
            ->join('users as u', 'u.id', '=', 'c.user_id')
            ->leftJoin('content_selection_comments as reply', 'reply.id', '=', 'c.reply_to_comment_id')
            ->leftJoin('users as reply_user', 'reply_user.id', '=', 'reply.user_id')
            ->where('c.id', $id)
            ->select([
                'c.id', 'c.selection_id', 'c.user_id', 'c.reply_to_comment_id', 'c.body_md', 'c.body_plain', 'c.created_at', 'c.updated_at',
                'u.username', 'u.display_name', 'u.avatar_url', 'u.status as user_status',
                'reply.user_id as reply_user_id', 'reply_user.username as reply_username',
                'reply_user.display_name as reply_display_name',
            ])->first();
        return $this->commentArray($row);
    }

    public function comment(int $commentId): ?object
    {
        return $this->connection()->table('content_selection_comments')
            ->where('id', $commentId)
            ->where('status', 'published')
            ->first();
    }

    public function deleteComment(int $commentId): void
    {
        $comment = $this->comment($commentId);
        if (!$comment) {
            return;
        }
        $now = gmdate('c');
        $this->transaction(function () use ($comment, $now): void {
            $this->connection()->table('content_selection_comments')->where('id', $comment->id)->update([
                'status' => 'deleted',
                'body_md' => '',
                'body_plain' => '',
                'updated_at' => $now,
                'deleted_at' => $now,
            ]);
            $this->touch((int) $comment->selection_id, $now);
        });
    }

    public function setLike(int $selectionId, int $userId, bool $enabled): array
    {
        $now = gmdate('c');
        return $this->transaction(function () use ($selectionId, $userId, $enabled, $now): array {
            $table = $this->connection()->table('content_selection_likes');
            if ($enabled) {
                $table->insertOrIgnore(['selection_id' => $selectionId, 'user_id' => $userId, 'created_at' => $now]);
            } else {
                $table->where('selection_id', $selectionId)->where('user_id', $userId)->delete();
            }
            $likeCount = (int) $this->connection()->table('content_selection_likes')->where('selection_id', $selectionId)->count();
            $deleted = !$enabled && $likeCount === 0 && $this->pruneIfUnengaged($selectionId, $now);
            if (!$deleted) {
                $this->touch($selectionId, $now);
            }
            return [
                'selectionId' => $selectionId,
                'liked' => $enabled,
                'likeCount' => $likeCount,
                'deleted' => $deleted,
            ];
        });
    }

    public function recordActivity(int $selectionId, int $userId, array $activity): array
    {
        $now = gmdate('c');
        $id = (int) $this->transaction(function () use ($selectionId, $userId, $activity, $now): int {
            $id = (int) $this->connection()->table('content_selection_activities')->insertGetId([
                'selection_id' => $selectionId,
                'user_id' => $userId,
                'activity_type' => $activity['activityType'],
                'target_type' => $activity['targetType'],
                'target_id' => $activity['targetId'],
                'target_label' => $activity['targetLabel'],
                'metadata_json' => json_encode($activity['metadata'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                'created_at' => $now,
            ]);
            $this->touch($selectionId, $now);
            return $id;
        });
        return [
            'id' => $id,
            'type' => $activity['activityType'],
            'targetType' => $activity['targetType'],
            'targetId' => $activity['targetId'],
            'targetLabel' => $activity['targetLabel'],
            'metadata' => $activity['metadata'],
            'createdAt' => $now,
        ];
    }

    public function deleteOwned(int $selectionId, int $userId): array
    {
        return $this->transaction(function () use ($selectionId, $userId): array {
            $selection = $this->connection()->table('content_selections')
                ->where('id', $selectionId)
                ->where('status', 'active')
                ->first();
            if (!$selection || (int) $selection->creator_user_id !== $userId) {
                return ['deleted' => false, 'preserved' => false];
            }

            $candidates = [];
            foreach ([
                $this->connection()->table('content_selection_likes')
                    ->where('selection_id', $selectionId)->where('user_id', '<>', $userId)
                    ->select(['user_id', 'created_at'])->orderBy('created_at')->first(),
                $this->connection()->table('content_selection_comments')
                    ->where('selection_id', $selectionId)->where('user_id', '<>', $userId)
                    ->where('status', 'published')->select(['user_id', 'created_at'])->orderBy('created_at')->first(),
                $this->connection()->table('content_selection_activities')
                    ->where('selection_id', $selectionId)->where('user_id', '<>', $userId)
                    ->select(['user_id', 'created_at'])->orderBy('created_at')->first(),
            ] as $candidate) {
                if ($candidate) {
                    $candidates[] = $candidate;
                }
            }
            usort($candidates, static fn (object $left, object $right): int => strcmp((string) $left->created_at, (string) $right->created_at));

            $now = gmdate('c');
            $this->connection()->table('content_selection_likes')
                ->where('selection_id', $selectionId)->where('user_id', $userId)->delete();
            $this->connection()->table('content_selection_activities')
                ->where('selection_id', $selectionId)->where('user_id', $userId)->delete();
            $this->connection()->table('content_selection_comments')
                ->where('selection_id', $selectionId)->where('user_id', $userId)->where('status', 'published')
                ->update([
                    'status' => 'deleted',
                    'body_md' => '',
                    'body_plain' => '',
                    'updated_at' => $now,
                    'deleted_at' => $now,
                ]);

            if ($candidates !== []) {
                $this->connection()->table('content_selections')->where('id', $selectionId)->update([
                    'creator_user_id' => (int) $candidates[0]->user_id,
                    'updated_at' => $now,
                ]);
                return ['deleted' => true, 'preserved' => true];
            }

            $this->connection()->table('content_selections')->where('id', $selectionId)->update([
                'status' => 'deleted',
                'updated_at' => $now,
            ]);
            return ['deleted' => true, 'preserved' => false];
        });
    }

    public function mine(int $userId, string $mode, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $likes = fn (): Builder => $this->connection()->table('content_selection_likes as personal_likes')
            ->where('personal_likes.user_id', $userId)
            ->selectRaw("personal_likes.selection_id, personal_likes.selection_id AS activity_id, 'like' AS activity_type, '' AS target_type, '' AS target_id, '' AS target_label, '{}' AS metadata_json, personal_likes.created_at AS activity_at");
        $comments = fn (): Builder => $this->connection()->table('content_selection_comments as personal_comments')
            ->where('personal_comments.user_id', $userId)
            ->where('personal_comments.status', 'published')
            ->selectRaw("personal_comments.selection_id, personal_comments.id AS activity_id, 'comment' AS activity_type, 'annotation' AS target_type, personal_comments.id AS target_id, personal_comments.body_plain AS target_label, '{}' AS metadata_json, personal_comments.created_at AS activity_at");
        $activity = match ($mode) {
            'liked' => $likes(),
            'commented' => $comments(),
            default => $likes()->unionAll($comments()),
        };
        $query = $this->connection()->query()->fromSub($activity, 'personal_selection_activity')
            ->join('content_selections as personal_selection', 'personal_selection.id', '=', 'personal_selection_activity.selection_id')
            ->where('personal_selection.status', 'active')
            ->select('personal_selection_activity.*');
        $total = (clone $query)->count();
        $activityRows = $query->orderByDesc('activity_at')->orderByDesc('activity_id')
            ->limit($limit)->offset(($page - 1) * $limit)->get()->all();
        $selectionIds = array_values(array_unique(array_map(static fn (object $row): int => (int) $row->selection_id, $activityRows)));
        $selectionRows = $selectionIds === [] ? [] : $this->baseSelectionQuery()->whereIn('s.id', $selectionIds)->where('s.status', 'active')->get()->all();
        $selectionMap = [];
        foreach ($this->decorate($selectionRows, $userId) as $selection) {
            $selectionMap[(int) $selection['id']] = $selection;
        }
        $items = [];
        foreach ($activityRows as $row) {
            $selection = $selectionMap[(int) $row->selection_id] ?? null;
            if (!$selection) {
                continue;
            }
            $metadata = json_decode((string) $row->metadata_json, true);
            $selection['activity'] = [
                'id' => (int) $row->activity_id,
                'type' => (string) $row->activity_type,
                'targetType' => (string) $row->target_type,
                'targetId' => (string) $row->target_id,
                'targetLabel' => (string) $row->target_label,
                'metadata' => is_array($metadata) ? $metadata : [],
                'createdAt' => (string) $row->activity_at,
            ];
            $items[] = $selection;
        }
        return [
            'items' => $items,
            'pagination' => $this->pagination($page, $limit, $total),
            'mode' => $mode,
        ];
    }

    private function baseSelectionQuery(): Builder
    {
        return $this->connection()->table('content_selections as s')
            ->join('users as creator', 'creator.id', '=', 's.creator_user_id')
            ->select([
                's.*', 'creator.username as creator_username', 'creator.display_name as creator_display_name',
                'creator.avatar_url as creator_avatar_url',
            ]);
    }

    private function equivalentSelections(array $selection): array
    {
        $rows = $this->connection()->table('content_selections')
            ->where('object_type', $selection['objectType'])
            ->where('object_id', $selection['objectId'])
            ->where('selected_text', $selection['selectedText'])
            ->where('status', 'active')
            ->orderBy('id')
            ->limit(32)
            ->get()
            ->all();
        return array_values(array_filter(
            $rows,
            fn (object $row): bool => $this->anchorsEquivalent($selection, $row),
        ));
    }

    private function anchorsEquivalent(array $selection, object $row): bool
    {
        if ((string) $row->anchor_hash === $selection['anchorHash']) {
            return true;
        }
        $startShift = $selection['startOffset'] - (int) $row->start_offset;
        $endShift = $selection['endOffset'] - (int) $row->end_offset;
        if ($startShift === 0 && $endShift === 0) {
            return true;
        }
        $length = mb_strlen($selection['selectedText']);
        $nearLimit = min(96, max(12, $length * 2));
        if ($length >= 8 && abs($startShift - $endShift) <= 2 && max(abs($startShift), abs($endShift)) <= $nearLimit) {
            return true;
        }
        $contextThreshold = min(24, max(8, (int) ceil($length / 2)));
        $prefixOverlap = $this->commonSuffixLength($selection['prefixText'], (string) $row->prefix_text);
        $suffixOverlap = $this->commonPrefixLength($selection['suffixText'], (string) $row->suffix_text);
        return abs($startShift - $endShift) <= 2
            && ($prefixOverlap >= $contextThreshold || $suffixOverlap >= $contextThreshold);
    }

    private function mergeInto(int $canonicalId, int $duplicateId, string $now): void
    {
        if ($canonicalId <= 0 || $duplicateId <= 0 || $canonicalId === $duplicateId) {
            return;
        }
        $duplicate = $this->connection()->table('content_selections')
            ->where('id', $duplicateId)
            ->where('status', 'active')
            ->first();
        if (!$duplicate) {
            return;
        }
        foreach ($this->connection()->table('content_selection_likes')->where('selection_id', $duplicateId)->get()->all() as $like) {
            $this->connection()->table('content_selection_likes')->insertOrIgnore([
                'selection_id' => $canonicalId,
                'user_id' => (int) $like->user_id,
                'created_at' => (string) $like->created_at,
            ]);
        }
        $this->connection()->table('content_selection_likes')->where('selection_id', $duplicateId)->delete();
        $this->connection()->table('content_selection_comments')->where('selection_id', $duplicateId)->update(['selection_id' => $canonicalId]);
        $this->connection()->table('content_selection_activities')->where('selection_id', $duplicateId)->update(['selection_id' => $canonicalId]);
        $this->connection()->table('content_selections')->where('id', $duplicateId)->update([
            'status' => 'merged:' . $canonicalId,
            'updated_at' => $now,
        ]);
    }

    private function commonPrefixLength(string $left, string $right): int
    {
        $limit = min(64, mb_strlen($left), mb_strlen($right));
        for ($index = 0; $index < $limit; $index++) {
            if (mb_substr($left, $index, 1) !== mb_substr($right, $index, 1)) {
                return $index;
            }
        }
        return $limit;
    }

    private function commonSuffixLength(string $left, string $right): int
    {
        $limit = min(64, mb_strlen($left), mb_strlen($right));
        for ($index = 1; $index <= $limit; $index++) {
            if (mb_substr($left, -$index, 1) !== mb_substr($right, -$index, 1)) {
                return $index - 1;
            }
        }
        return $limit;
    }

    private function decorate(array $rows, int $viewerId): array
    {
        if ($rows === []) {
            return [];
        }
        $ids = array_values(array_unique(array_map(static fn (object $row): int => (int) $row->id, $rows)));
        $comments = $this->connection()->table('content_selection_comments')
            ->select('selection_id')->selectRaw('COUNT(*) AS total')
            ->whereIn('selection_id', $ids)->where('status', 'published')->groupBy('selection_id')
            ->pluck('total', 'selection_id')->all();
        $likes = $this->connection()->table('content_selection_likes')
            ->select('selection_id')->selectRaw('COUNT(*) AS total')
            ->whereIn('selection_id', $ids)->groupBy('selection_id')
            ->pluck('total', 'selection_id')->all();
        $quotes = $this->connection()->table('content_selection_activities')
            ->select('selection_id')->selectRaw('COUNT(*) AS total')
            ->whereIn('selection_id', $ids)->where('activity_type', 'quote')->groupBy('selection_id')
            ->pluck('total', 'selection_id')->all();
        $liked = $viewerId > 0
            ? array_fill_keys(array_map('intval', $this->connection()->table('content_selection_likes')
                ->where('user_id', $viewerId)->whereIn('selection_id', $ids)->pluck('selection_id')->all()), true)
            : [];
        $commented = $viewerId > 0
            ? array_fill_keys(array_map('intval', $this->connection()->table('content_selection_comments')
                ->where('user_id', $viewerId)->where('status', 'published')->whereIn('selection_id', $ids)
                ->distinct()->pluck('selection_id')->all()), true)
            : [];

        return array_map(static fn (object $row): array => [
            'id' => (int) $row->id,
            'objectType' => (string) $row->object_type,
            'objectId' => (string) $row->object_id,
            'objectLabel' => (string) $row->object_label,
            'objectUrl' => (string) $row->object_url,
            'selectedText' => (string) $row->selected_text,
            'prefixText' => (string) $row->prefix_text,
            'suffixText' => (string) $row->suffix_text,
            'startOffset' => (int) $row->start_offset,
            'endOffset' => (int) $row->end_offset,
            'anchorHash' => (string) $row->anchor_hash,
            'creator' => [
                'id' => (int) $row->creator_user_id,
                'username' => (string) $row->creator_username,
                'displayName' => (string) $row->creator_display_name,
                'avatarUrl' => (string) $row->creator_avatar_url,
            ],
            'commentCount' => (int) ($comments[(int) $row->id] ?? 0),
            'likeCount' => (int) ($likes[(int) $row->id] ?? 0),
            'quoteCount' => (int) ($quotes[(int) $row->id] ?? 0),
            'liked' => isset($liked[(int) $row->id]),
            'commented' => isset($commented[(int) $row->id]),
            'owned' => $viewerId > 0 && (int) $row->creator_user_id === $viewerId,
            'canDelete' => $viewerId > 0
                && (int) $row->creator_user_id === $viewerId
                && (isset($liked[(int) $row->id]) || isset($commented[(int) $row->id])),
            'createdAt' => (string) $row->created_at,
            'updatedAt' => (string) $row->updated_at,
        ], $rows);
    }

    private function commentArray(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'selectionId' => (int) $row->selection_id,
            'userId' => (int) $row->user_id,
            'replyToCommentId' => (int) ($row->reply_to_comment_id ?? 0),
            'bodyMd' => (string) $row->body_md,
            'bodyPlain' => (string) $row->body_plain,
            'author' => [
                'id' => (int) $row->user_id,
                'username' => (string) $row->username,
                'displayName' => (string) $row->display_name,
                'avatarUrl' => (string) $row->avatar_url,
                'status' => (string) $row->user_status,
            ],
            'replyTo' => (int) ($row->reply_to_comment_id ?? 0) > 0 ? [
                'commentId' => (int) $row->reply_to_comment_id,
                'userId' => (int) ($row->reply_user_id ?? 0),
                'username' => (string) ($row->reply_username ?? ''),
                'displayName' => (string) ($row->reply_display_name ?? $row->reply_username ?? ''),
            ] : null,
            'createdAt' => (string) $row->created_at,
            'updatedAt' => (string) $row->updated_at,
        ];
    }

    private function pruneIfUnengaged(int $selectionId, string $time): bool
    {
        $hasLikes = $this->connection()->table('content_selection_likes')->where('selection_id', $selectionId)->exists();
        $hasComments = $this->connection()->table('content_selection_comments')
            ->where('selection_id', $selectionId)->where('status', 'published')->exists();
        $hasActivities = $this->connection()->table('content_selection_activities')
            ->where('selection_id', $selectionId)->exists();
        if ($hasLikes || $hasComments || $hasActivities) {
            return false;
        }
        return $this->connection()->table('content_selections')
            ->where('id', $selectionId)
            ->where('status', 'active')
            ->update(['status' => 'deleted', 'updated_at' => $time]) > 0;
    }

    private function touch(int $selectionId, string $time): void
    {
        $this->connection()->table('content_selections')->where('id', $selectionId)->update(['updated_at' => $time]);
    }

    private function pagination(int $page, int $limit, int $total): array
    {
        $totalPages = max(1, (int) ceil($total / $limit));
        return [
            'page' => min($page, $totalPages),
            'pageSize' => $limit,
            'total' => $total,
            'totalPages' => $totalPages,
            'hasPrev' => $page > 1,
            'hasNext' => $page < $totalPages,
        ];
    }
}
