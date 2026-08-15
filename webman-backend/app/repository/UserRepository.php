<?php

namespace app\repository;

use app\domain\passport\RolePolicy;
use app\domain\passport\UserIdentity;
use Illuminate\Database\Query\Builder;
use support\Db;

final class UserRepository
{
    private string $connection;
    private string $table;

    public function __construct()
    {
        $this->connection = config('wikist.passport.connection', 'wikist');
        $this->table = config('wikist.passport.table', 'users');
    }

    private function query(): Builder
    {
        return Db::connection($this->connection)->table($this->table);
    }

    private function hasTable(string $table): bool
    {
        static $cache = [];
        $key = $this->connection . ':' . $table;
        return $cache[$key] ??= Db::connection($this->connection)->getSchemaBuilder()->hasTable($table);
    }

    public function findById(int $id): ?UserIdentity
    {
        return $this->identity($this->query()->where('id', $id)->first());
    }

    public function findRawById(int $id): ?object
    {
        return $this->query()->where('id', $id)->first();
    }

    public function findByIdentifier(string $identifier): ?object
    {
        $identifier = trim($identifier);
        if ($identifier === '') {
            return null;
        }
        return $this->query()
            ->where('username', $identifier)
            ->orWhereRaw('LOWER(email) = ?', [mb_strtolower($identifier)])
            ->first();
    }

    public function identity(object|array|null $row): ?UserIdentity
    {
        if ($row === null) {
            return null;
        }
        $data = (array) $row;
        $role = RolePolicy::normalize((string) ($data['role'] ?? 'member'));
        if (in_array((string) ($data['username'] ?? ''), config('wikist.passport.admin_usernames', []), true)) {
            $role = 'admin';
        }
        $status = in_array(($data['status'] ?? 'active'), ['active', 'ok'], true) ? 'active' : 'disabled';
        $links = json_decode((string) ($data['social_links_json'] ?? '{}'), true);

        return new UserIdentity(
            id: (int) $data['id'],
            username: (string) $data['username'],
            email: (string) ($data['email'] ?? ''),
            displayName: (string) ($data['display_name'] ?? $data['nickname'] ?? $data['username']),
            role: $role,
            status: $status,
            bio: (string) ($data['bio'] ?? ''),
            avatarUrl: (string) ($data['avatar_url'] ?? $data['avatar'] ?? ''),
            socialLinks: is_array($links) ? $links : [],
            pageMd: (string) ($data['page_md'] ?? ''),
            createdAt: (string) ($data['created_at'] ?? ''),
            updatedAt: (string) ($data['updated_at'] ?? ''),
            emailVerifiedAt: (string) ($data['email_verified_at'] ?? ''),
            twoFactorEnabled: (bool) ($data['two_factor_enabled'] ?? false),
        );
    }

    public function count(): int
    {
        return $this->query()->count();
    }

    public function profile(int $id): ?array
    {
        $identity = $this->findById($id);
        if (!$identity) {
            return null;
        }
        $raw = $this->findRawById($id);
        $profile = $identity->toArray();
        $profile['lastSyncAt'] = (string) ($raw->last_sync_at ?? $identity->updatedAt);
        $profile['stats'] = $this->statsForUser($id);
        $profile['recentEdits'] = $this->recentEdits($id, 10);
        $profile['favorites'] = $this->favorites($id, 10);
        $profile['translator'] = $this->translator($id);
        $profile['organizations'] = $this->organizations($id, 6, true);
        return $profile;
    }

    public function listForAdmin(string $search, int $limit, int $offset): array
    {
        $limit = max(1, min($limit, 100));
        $offset = max(0, $offset);
        $query = $this->query()->select("{$this->table}.*");
        $this->applySearch($query, $search);
        $rows = $query->orderBy('id')->limit($limit)->offset($offset)->get();
        $ids = array_map(static fn (object $row): int => (int) $row->id, $rows->all());
        $stats = $this->statsForUsers($ids);
        return array_map(function (object $row) use ($stats): array {
            $identity = $this->identity($row);
            return $identity->toArray() + [
                'lastSyncAt' => (string) ($row->last_sync_at ?? $row->updated_at ?? ''),
                'stats' => $stats[(int) $row->id] ?? $this->emptyStats(),
            ];
        }, $rows->all());
    }

    public function countForAdmin(string $search): int
    {
        $query = $this->query();
        $this->applySearch($query, $search);
        return $query->count();
    }

    public function updateByAdmin(int $id, array $input): array
    {
        $current = $this->findRawById($id);
        if (!$current) {
            throw new \InvalidArgumentException('账号不存在。');
        }
        $displayName = trim((string) ($input['displayName'] ?? $current->display_name ?? $current->username));
        $email = mb_strtolower(trim((string) ($input['email'] ?? $current->email ?? '')));
        $bio = trim((string) ($input['bio'] ?? $current->bio ?? ''));
        $avatar = trim((string) ($input['avatarUrl'] ?? $input['avatar_url'] ?? $current->avatar_url ?? ''));
        $pageMd = array_key_exists('pageMd', $input) ? trim((string) $input['pageMd']) : (string) ($current->page_md ?? '');
        $roleInput = (string) ($input['role'] ?? $current->role ?? 'member');
        if (!RolePolicy::isValid($roleInput)) {
            throw new \InvalidArgumentException('用户组无效。');
        }
        $role = RolePolicy::normalize($roleInput);
        $status = (string) ($input['status'] ?? $current->status ?? 'active');
        if (!in_array($status, ['active', 'disabled'], true)) {
            throw new \InvalidArgumentException('账号状态无效。');
        }
        if ($displayName === '' || mb_strlen($displayName) > 80 || mb_strlen($bio) > 500 || mb_strlen($pageMd) > 20000) {
            throw new \InvalidArgumentException('用户资料字段长度不符合要求。');
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('邮箱格式不正确。');
        }
        if ($email !== '' && $this->query()->whereRaw('LOWER(email) = ?', [$email])->where('id', '!=', $id)->exists()) {
            throw new \InvalidArgumentException('邮箱已被其他账号使用。');
        }
        if ($avatar !== '' && !preg_match('#^(https?://|data:image/)#i', $avatar)) {
            throw new \InvalidArgumentException('头像地址必须是 http(s) 或 data:image。');
        }
        $wasActiveAdmin = RolePolicy::normalize((string) $current->role) === 'admin' && (string) $current->status === 'active';
        if ($wasActiveAdmin && ($role !== 'admin' || $status !== 'active') && $this->activeAdminCount() <= 1) {
            throw new \InvalidArgumentException('不能降级或封禁最后一个有效管理员。');
        }
        $emailChanged = mb_strtolower((string) ($current->email ?? '')) !== $email;
        $verifiedAt = ($input['emailVerified'] ?? null) === true
            ? gmdate('c')
            : ($emailChanged ? '' : (string) ($current->email_verified_at ?? ''));
        $now = gmdate('c');
        $this->query()->where('id', $id)->update([
            'display_name' => $displayName,
            'email' => $email !== '' ? $email : null,
            'email_verified_at' => $verifiedAt,
            'role' => $role,
            'status' => $status,
            'bio' => $bio,
            'avatar_url' => $avatar,
            'page_md' => $pageMd,
            'updated_at' => $now,
            'last_sync_at' => $now,
        ]);
        if ($status === 'disabled') {
            $this->deleteSessions($id);
        }
        return $this->profile($id);
    }

    public function create(array $input, string $passwordHash, string $passwordSalt): UserIdentity
    {
        $now = gmdate('c');
        $role = $this->count() === 0 ? 'admin' : 'member';
        $id = $this->query()->insertGetId([
            'username' => $input['username'],
            'email' => $input['email'] !== '' ? $input['email'] : null,
            'display_name' => $input['displayName'],
            'password_hash' => $passwordHash,
            'password_salt' => $passwordSalt,
            'role' => $role,
            'status' => 'active',
            'bio' => '',
            'avatar_url' => '',
            'social_links_json' => '{}',
            'page_md' => '',
            'email_verified_at' => $role === 'admin' ? $now : '',
            'two_factor_secret' => '',
            'two_factor_enabled' => 0,
            'two_factor_confirmed_at' => '',
            'two_factor_recovery_json' => '[]',
            'last_security_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
            'password_updated_at' => $now,
            'last_sync_at' => $now,
        ]);
        return $this->findById((int) $id);
    }

    public function usernameExists(string $username): bool
    {
        return $this->query()->where('username', $username)->exists();
    }

    public function emailExists(string $email): bool
    {
        return $email !== '' && $this->query()->whereRaw('LOWER(email) = ?', [mb_strtolower($email)])->exists();
    }

    public function replacePassword(int $id, string $hash): void
    {
        $now = gmdate('c');
        $this->query()->where('id', $id)->update([
            'password_hash' => $hash,
            'password_salt' => '',
            'updated_at' => $now,
            'password_updated_at' => $now,
            'last_security_at' => $now,
            'last_sync_at' => $now,
        ]);
    }

    public function updateProfile(int $id, array $input): UserIdentity
    {
        $current = $this->findRawById($id);
        if (!$current) {
            throw new \RuntimeException('账号不存在。');
        }
        $email = mb_strtolower(trim((string) ($input['email'] ?? $current->email ?? '')));
        $displayName = trim((string) ($input['displayName'] ?? $current->display_name));
        $bio = trim((string) ($input['bio'] ?? $current->bio ?? ''));
        $avatar = trim((string) ($input['avatarUrl'] ?? $input['avatar_url'] ?? $current->avatar_url ?? ''));
        $pageMd = trim((string) ($input['pageMd'] ?? $current->page_md ?? ''));
        if ($displayName === '' || mb_strlen($displayName) > 80 || mb_strlen($bio) > 500 || mb_strlen($pageMd) > 20000) {
            throw new \InvalidArgumentException('个人资料字段长度不符合要求。');
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('邮箱格式不正确。');
        }
        if ($avatar !== '' && !preg_match('#^(https?://|data:image/)#i', $avatar)) {
            throw new \InvalidArgumentException('头像地址必须是 http(s) 或 data:image。');
        }
        if ($email !== '' && $this->query()->whereRaw('LOWER(email) = ?', [$email])->where('id', '!=', $id)->exists()) {
            throw new \InvalidArgumentException('邮箱已被其他账号使用。');
        }
        $allowedSocial = ['website', 'blog', 'github', 'zhihu', 'bilibili', 'x', 'mastodon'];
        $social = [];
        foreach ((array) ($input['socialLinks'] ?? json_decode((string) ($current->social_links_json ?? '{}'), true)) as $key => $url) {
            $url = trim((string) $url);
            if (in_array($key, $allowedSocial, true) && ($url === '' || preg_match('#^https?://#i', $url))) {
                if ($url !== '') {
                    $social[$key] = mb_substr($url, 0, 500);
                }
            }
        }
        $now = gmdate('c');
        $emailChanged = mb_strtolower((string) ($current->email ?? '')) !== $email;
        $this->query()->where('id', $id)->update([
            'email' => $email !== '' ? $email : null,
            'email_verified_at' => $emailChanged ? '' : (string) ($current->email_verified_at ?? ''),
            'display_name' => $displayName,
            'bio' => $bio,
            'avatar_url' => $avatar,
            'social_links_json' => json_encode($social, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'page_md' => $pageMd,
            'updated_at' => $now,
            'last_sync_at' => $now,
        ]);
        return $this->findById($id);
    }

    public function markEmailVerified(int $id, string $email): UserIdentity
    {
        $current = $this->findRawById($id);
        if (!$current || mb_strtolower((string) $current->email) !== mb_strtolower($email)) {
            throw new \InvalidArgumentException('邮箱已变更，请重新发送验证邮件。');
        }
        $now = gmdate('c');
        $this->query()->where('id', $id)->update(['email_verified_at' => $now, 'updated_at' => $now, 'last_security_at' => $now]);
        return $this->findById($id);
    }

    public function updateTwoFactor(int $id, array $values): void
    {
        $values['last_security_at'] = gmdate('c');
        $this->query()->where('id', $id)->update($values);
    }

    public function deleteSessions(int $id): void
    {
        Db::connection($this->connection)->table('sessions')->where('user_id', $id)->delete();
    }

    private function applySearch(Builder $query, string $search): void
    {
        $search = mb_strtolower(trim(mb_substr($search, 0, 120)));
        if ($search === '') {
            return;
        }
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search) . '%';
        $query->where(static function (Builder $nested) use ($like): void {
            $nested->whereRaw('LOWER(username) LIKE ?', [$like])
                ->orWhereRaw('LOWER(display_name) LIKE ?', [$like])
                ->orWhereRaw("LOWER(COALESCE(email, '')) LIKE ?", [$like]);
        });
    }

    private function activeAdminCount(): int
    {
        return $this->query()->where('role', 'admin')->where('status', 'active')->count();
    }

    private function emptyStats(): array
    {
        return ['edits' => 0, 'comments' => 0, 'favorites' => 0, 'watches' => 0, 'followers' => 0, 'following' => 0, 'organizations' => 0];
    }

    private function statsForUser(int $id): array
    {
        return $this->statsForUsers([$id])[$id] ?? $this->emptyStats();
    }

    private function statsForUsers(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if ($ids === []) {
            return [];
        }
        $stats = array_fill_keys($ids, $this->emptyStats());
        $sources = [
            ['page_edit_events', 'user_id', null, 'edits'],
            ['page_comments', 'user_id', ['status', 'published'], 'comments'],
            ['page_favorites', 'user_id', null, 'favorites'],
            ['watch_subscriptions', 'user_id', null, 'watches'],
            ['user_follows', 'following_user_id', null, 'followers'],
            ['user_follows', 'follower_user_id', null, 'following'],
            ['organization_members', 'user_id', ['status', 'removed', '!='], 'organizations'],
        ];
        foreach ($sources as [$table, $userColumn, $condition, $key]) {
            if (!$this->hasTable($table)) {
                continue;
            }
            $query = Db::connection($this->connection)->table($table)
                ->selectRaw("{$userColumn} AS user_id, COUNT(*) AS aggregate")
                ->whereIn($userColumn, $ids);
            if ($condition) {
                $query->where($condition[0], $condition[2] ?? '=', $condition[1]);
            }
            foreach ($query->groupBy($userColumn)->get() as $row) {
                $stats[(int) $row->user_id][$key] = (int) $row->aggregate;
            }
        }
        return $stats;
    }

    private function recentEdits(int $id, int $limit): array
    {
        if (!$this->hasTable('page_edit_events')) {
            return [];
        }
        return array_map(static fn (object $row): array => [
            'id' => (int) $row->id,
            'pageSlug' => (string) $row->page_slug,
            'pageTitle' => (string) $row->page_title,
            'action' => (string) $row->action,
            'editorName' => (string) $row->editor_name,
            'createdAt' => (string) $row->created_at,
        ], Db::connection($this->connection)->table('page_edit_events')
            ->where('user_id', $id)->orderByDesc('id')->limit($limit)->get()->all());
    }

    private function favorites(int $id, int $limit): array
    {
        if (!$this->hasTable('page_favorites')) {
            return [];
        }
        return array_map(static fn (object $row): array => [
            'id' => (int) $row->id,
            'userId' => (int) $row->user_id,
            'pageSlug' => (string) $row->page_slug,
            'pageTitle' => (string) $row->page_title,
            'createdAt' => (string) $row->created_at,
        ], Db::connection($this->connection)->table('page_favorites')
            ->where('user_id', $id)->orderByDesc('created_at')->orderByDesc('id')->limit($limit)->get()->all());
    }

    private function translator(int $id): ?array
    {
        if (!$this->hasTable('translator_members')) {
            return null;
        }
        $row = Db::connection($this->connection)->table('translator_members')->where('user_id', $id)->first();
        if (!$row) {
            return null;
        }
        $languages = json_decode((string) $row->languages_json, true);
        return ['userId' => $id, 'languages' => is_array($languages) ? $languages : [], 'joinedAt' => (string) $row->joined_at, 'updatedAt' => (string) $row->updated_at];
    }

    private function organizations(int $id, int $limit, bool $includePending): array
    {
        if (!$this->hasTable('organization_members') || !$this->hasTable('writing_organizations')) {
            return [];
        }
        $query = Db::connection($this->connection)->table('organization_members as m')
            ->join('writing_organizations as o', 'o.id', '=', 'm.organization_id')
            ->where('m.user_id', $id)->where('o.status', 'active');
        $includePending ? $query->where('m.status', '!=', 'removed') : $query->where('m.status', 'active');
        return array_map(static function (object $row): array {
            $focus = json_decode((string) $row->organization_focus_json, true);
            return [
                'organizationId' => (int) $row->organization_id,
                'userId' => (int) $row->user_id,
                'role' => (string) $row->role,
                'status' => (string) $row->status,
                'intro' => (string) $row->intro,
                'joinedAt' => (string) $row->joined_at,
                'updatedAt' => (string) $row->updated_at,
                'organizationSlug' => (string) $row->organization_slug,
                'organizationName' => (string) $row->organization_name,
                'organizationDescription' => (string) $row->organization_description,
                'organizationFocus' => is_array($focus) ? $focus : [],
                'organizationVisibility' => (string) $row->organization_visibility,
                'openTaskCount' => 0,
                'assignedTaskCount' => 0,
                'topicCount' => 0,
            ];
        }, $query->select([
            'm.*', 'o.slug as organization_slug', 'o.name as organization_name',
            'o.description as organization_description', 'o.focus_json as organization_focus_json',
            'o.visibility as organization_visibility',
        ])->orderByDesc('m.updated_at')->limit($limit)->get()->all());
    }
}
