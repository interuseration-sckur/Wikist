<?php

namespace app\service;

use support\Db;

final class AchievementService
{
    private const SYNC_INTERVAL_SECONDS = 45;

    private string $connection;

    public function __construct()
    {
        $this->connection = (string) config('wikist.passport.connection', 'wikist');
    }

    public function sync(int $userId, bool $force = false): array
    {
        if ($userId <= 0) {
            return [];
        }
        $db = Db::connection($this->connection);
        if (!$force) {
            $state = $db->table('achievement_sync_state')->where('user_id', $userId)->first();
            if ($state && strtotime((string) $state->evaluated_at) >= time() - self::SYNC_INTERVAL_SECONDS) {
                return [];
            }
        }

        $stats = $this->stats($userId);
        $awarded = [];
        $now = gmdate('c');
        $db->transaction(function () use ($db, $userId, $stats, $now, &$awarded): void {
            $badges = $db->table('community_badges')->where('status', 'active')->orderBy('id')->get()->all();
            foreach ($badges as $badge) {
                $rule = (string) $badge->rule_key;
                if (!array_key_exists($rule, $stats) || (int) $stats[$rule] < (int) $badge->threshold) {
                    continue;
                }
                $exists = $db->table('community_badge_awards')->where('badge_id', (int) $badge->id)->where('user_id', $userId)->exists();
                if ($exists) {
                    continue;
                }
                $db->table('community_badge_awards')->insert([
                    'badge_id' => (int) $badge->id,
                    'user_id' => $userId,
                    'award_count' => 1,
                    'reason' => (string) $badge->description,
                    'awarded_at' => $now,
                    'updated_at' => $now,
                ]);
                $awarded[] = $this->badgePayload($badge, $stats, true, $now, 1);
            }
            $db->table('achievement_sync_state')->updateOrInsert(
                ['user_id' => $userId],
                ['stats_json' => json_encode($stats, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'evaluated_at' => $now, 'updated_at' => $now],
            );
        });
        return $awarded;
    }

    public function overview(int $userId, int $page = 1, int $limit = 12): array
    {
        $page = max(1, $page);
        $limit = max(1, min(24, $limit));
        $db = Db::connection($this->connection);
        $stats = $this->stats($userId);
        $awards = [];
        foreach ($db->table('community_badge_awards')->where('user_id', $userId)->get()->all() as $award) {
            $awards[(int) $award->badge_id] = $award;
        }
        $items = [];
        $earned = 0;
        $points = 0;
        foreach ($db->table('community_badges')->where('status', 'active')->orderBy('threshold')->orderBy('id')->get()->all() as $badge) {
            $award = $awards[(int) $badge->id] ?? null;
            $item = $this->badgePayload($badge, $stats, (bool) $award, (string) ($award->awarded_at ?? ''), (int) ($award->award_count ?? 0));
            if ($item['earned']) {
                $earned++;
                $points += $item['points'];
            }
            $items[] = $item;
        }

        usort($items, static function (array $left, array $right): int {
            if ($left['earned'] !== $right['earned']) {
                return $left['earned'] ? -1 : 1;
            }
            return ($right['awardedAt'] <=> $left['awardedAt']) ?: ($right['progress'] <=> $left['progress']);
        });

        $timelineQuery = $db->table('community_badge_awards as awards')
            ->join('community_badges as badges', 'badges.id', '=', 'awards.badge_id')
            ->where('awards.user_id', $userId);
        $totalTimeline = (clone $timelineQuery)->count();
        $timeline = array_map(function (object $row): array {
            return [
                'slug' => (string) $row->slug,
                'name' => (string) $row->name,
                'description' => (string) $row->description,
                'level' => (string) $row->level,
                'icon' => (string) $row->icon,
                'category' => $this->category((string) $row->rule_key),
                'points' => $this->points((string) $row->level),
                'awardedAt' => (string) $row->awarded_at,
            ];
        }, $timelineQuery->select(['badges.slug', 'badges.name', 'badges.description', 'badges.level', 'badges.icon', 'badges.rule_key', 'awards.awarded_at'])
            ->orderByDesc('awards.awarded_at')->orderByDesc('awards.id')
            ->offset(($page - 1) * $limit)->limit($limit)->get()->all());

        return [
            'summary' => [
                'earned' => $earned,
                'total' => count($items),
                'points' => $points,
                'completion' => count($items) ? (int) round($earned * 100 / count($items)) : 0,
            ],
            'stats' => $stats,
            'items' => $items,
            'timeline' => [
                'items' => $timeline,
                'page' => $page,
                'limit' => $limit,
                'total' => $totalTimeline,
                'pages' => max(1, (int) ceil($totalTimeline / $limit)),
            ],
        ];
    }

    public function publicSummary(int $userId): array
    {
        if ($userId <= 0) {
            return ['summary' => ['earned' => 0, 'total' => 0, 'points' => 0, 'completion' => 0]];
        }
        $db = Db::connection($this->connection);
        $state = $db->table('achievement_sync_state')->where('user_id', $userId)->first();
        $cachedStats = $state ? json_decode((string) $state->stats_json, true) : null;
        $cacheIsFresh = $state && strtotime((string) $state->evaluated_at) >= time() - 300;
        $stats = $cacheIsFresh && is_array($cachedStats) ? $cachedStats : $this->stats($userId);
        $earned = 0;
        $points = 0;
        $badges = $db->table('community_badges')->where('status', 'active')->get()->all();
        foreach ($badges as $badge) {
            $rule = (string) $badge->rule_key;
            if (!array_key_exists($rule, $stats) || (int) $stats[$rule] < (int) $badge->threshold) {
                continue;
            }
            $earned++;
            $points += $this->points((string) $badge->level);
        }
        $total = count($badges);
        return ['summary' => [
            'earned' => $earned,
            'total' => $total,
            'points' => $points,
            'completion' => $total ? (int) round($earned * 100 / $total) : 0,
        ]];
    }

    private function stats(int $userId): array
    {
        $db = Db::connection($this->connection);
        $user = $db->table('users')->where('id', $userId)->first();
        $profileComplete = $user
            && trim((string) ($user->display_name ?? '')) !== ''
            && trim((string) ($user->bio ?? '')) !== ''
            && trim((string) ($user->avatar_url ?? '')) !== '';
        return [
            'profile_complete' => $profileComplete ? 1 : 0,
            'edits' => $this->count('page_edit_events', 'user_id', $userId),
            'comments' => $this->count('page_comments', 'user_id', $userId, ['status' => 'published']),
            'favorites' => $this->count('page_favorites', 'user_id', $userId),
            'watches' => $this->count('watch_subscriptions', 'user_id', $userId),
            'followers' => $this->count('user_follows', 'following_user_id', $userId),
            'following' => $this->count('user_follows', 'follower_user_id', $userId),
            'organizations' => $this->count('organization_members', 'user_id', $userId, ['status' => 'active']),
            'translations' => $this->count('page_translations', 'translator_user_id', $userId),
            'annotations' => $this->count('content_selection_comments', 'user_id', $userId, ['status' => 'published']),
            'messages' => $this->count('messaging_messages', 'sender_user_id', $userId, ['status' => 'published']),
            'questions_created' => $this->count('community_questions', 'author_user_id', $userId, ['status' => 'published']),
            'answers_created' => $this->count('community_answers', 'author_user_id', $userId, ['status' => 'published']),
            'accepted_answers' => $this->count('community_answers', 'author_user_id', $userId, ['status' => 'published', 'is_accepted' => 1]),
            'reputation' => (int) ($db->table('community_reputation')->where('user_id', $userId)->value('score') ?? 0),
        ];
    }

    private function count(string $table, string $column, int $userId, array $conditions = []): int
    {
        try {
            $query = Db::connection($this->connection)->table($table)->where($column, $userId);
            foreach ($conditions as $key => $value) {
                $query->where($key, $value);
            }
            return (int) $query->count();
        } catch (\Throwable) {
            return 0;
        }
    }

    private function badgePayload(object $badge, array $stats, bool $earned, string $awardedAt, int $awardCount): array
    {
        $rule = (string) $badge->rule_key;
        $threshold = max(1, (int) $badge->threshold);
        $current = max(0, (int) ($stats[$rule] ?? 0));
        return [
            'slug' => (string) $badge->slug,
            'name' => (string) $badge->name,
            'description' => (string) $badge->description,
            'level' => (string) $badge->level,
            'icon' => (string) $badge->icon,
            'rule' => $rule,
            'category' => $this->category($rule),
            'points' => $this->points((string) $badge->level),
            'current' => min($current, $threshold),
            'threshold' => $threshold,
            'progress' => min(100, (int) floor($current * 100 / $threshold)),
            'earned' => $earned,
            'awardCount' => $awardCount,
            'awardedAt' => $awardedAt,
        ];
    }

    private function category(string $rule): string
    {
        return match ($rule) {
            'edits', 'favorites', 'watches' => '知识建设',
            'translations', 'annotations' => '内容协作',
            'following', 'followers', 'organizations', 'messages', 'profile_complete' => '社区成长',
            default => '问答贡献',
        };
    }

    private function points(string $level): int
    {
        return match (strtolower($level)) {
            'gold' => 100,
            'silver' => 50,
            default => 20,
        };
    }
}
