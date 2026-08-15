<?php

namespace app\service;

use app\repository\SelectionRepository;
use app\exception\ApiException;
use app\repository\MessagingRepository;
use app\repository\CommunityRepository;
use app\repository\KnowledgeGraphRepository;
use app\repository\UserRepository;
use Illuminate\Database\Query\Builder;

final class KnowledgeObjectResolver
{
    private const TYPES = [
        'wiki_entry' => 'wiki_entry',
        'page' => 'wiki_entry',
        'question' => 'question',
        'answer' => 'answer',
        'organization' => 'organization',
        'user' => 'user',
        'revision' => 'revision',
        'selection' => 'selection',
        'comment' => 'comment',
        'chat_message' => 'chat_message',
    ];

    private static array $pageCatalog = [];
    private static int $pageCatalogExpiresAt = 0;

    public function __construct(private readonly MessagingRepository $messages = new MessagingRepository())
    {
    }

    public function resolveMany(array $input): array
    {
        if (count($input) > 8) {
            throw new ApiException('一条消息最多引用 8 个知识对象。', 422, 'too_many_object_references');
        }
        $seen = [];
        $result = [];
        foreach ($input as $item) {
            if (!is_array($item)) {
                continue;
            }
            $reference = $this->resolve($item);
            $key = implode(':', [$reference['type'], $reference['id'], $reference['revision'], $reference['relation']]);
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $result[] = $reference;
            }
        }
        return $result;
    }

    public function resolve(array $input): array
    {
        $requestedType = mb_strtolower(trim((string) ($input['type'] ?? '')));
        $type = self::TYPES[$requestedType] ?? null;
        if (!$type) {
            throw new ApiException('不支持的知识对象类型。', 422, 'invalid_object_reference_type');
        }
        $relation = mb_strtolower(trim((string) ($input['relation'] ?? 'context')));
        if (!in_array($relation, ['context', 'reply', 'source', 'task', 'mention', 'quote', 'share'], true)) {
            $relation = 'context';
        }
        $id = trim((string) ($input['id'] ?? ''));
        if ($id === '' || mb_strlen($id) > 190) {
            throw new ApiException('知识对象标识无效。', 422, 'invalid_object_reference_id');
        }
        $revision = mb_substr(trim((string) ($input['revision'] ?? '')), 0, 100);

        $resolved = match ($type) {
            'wiki_entry' => $this->page($id),
            'revision' => $this->revision($id, $revision),
            'user' => $this->user($id),
            'organization' => $this->organization($id),
            'question' => $this->futureObject('question', $id),
            'answer' => $this->futureObject('answer', $id),
            'selection' => $this->selection($id),
            'comment' => $this->futureObject('comment', $id),
            'chat_message' => $this->futureObject('chat_message', $id),
        };
        $resolved['relation'] = $relation;
        if (trim((string) ($input['label'] ?? '')) !== '') {
            $resolved['label'] = mb_substr(trim(strip_tags((string) $input['label'])), 0, 255);
        }
        $resolved['metadata'] = array_merge(
            $resolved['metadata'] ?? [],
            is_array($input['metadata'] ?? null) ? array_slice($input['metadata'], 0, 12, true) : [],
        );
        return $resolved;
    }

    public function suggest(string $type, string $query, int $viewerId, int $limit = 12): array
    {
        $type = self::TYPES[mb_strtolower(trim($type))] ?? 'wiki_entry';
        $query = mb_strtolower(trim($query));
        if ($query === '') {
            return [];
        }
        $limit = max(1, min(24, $limit));
        if ($type === 'user') {
            return array_map(static fn (array $user): array => [
                'type' => 'user', 'id' => (string) $user['id'],
                'label' => $user['displayName'] ?: $user['username'],
                'summary' => '@' . $user['username'],
                'url' => '#/user/' . rawurlencode($user['username']),
                'avatarUrl' => $user['avatarUrl'],
            ], $this->messages->searchUsers($query, $viewerId, $limit));
        }
        if ($type === 'organization') {
            $like = '%' . $this->escapeLike($query) . '%';
            $rows = $this->messages->connection()->table('writing_organizations')
                ->where('status', 'active')
                ->where(function (Builder $builder) use ($like): void {
                    $builder->whereRaw('LOWER(name) LIKE ? ESCAPE \'\\\'', [$like])
                        ->orWhereRaw('LOWER(slug) LIKE ? ESCAPE \'\\\'', [$like]);
                })
                ->orderBy('name')->limit($limit)->get()->all();
            return array_map(static fn (object $row): array => [
                'type' => 'organization', 'id' => (string) $row->id, 'label' => (string) $row->name,
                'summary' => (string) $row->description, 'url' => '#/organization/' . rawurlencode((string) $row->slug),
                'avatarUrl' => (string) ($row->avatar_image ?? ''),
            ], $rows);
        }
        if ($type === 'wiki_entry' || $type === 'revision') {
            $matches = [];
            foreach ($this->pageCatalog() as $page) {
                $haystack = mb_strtolower($page['slug'] . ' ' . $page['title'] . ' ' . $page['summary']);
                if (str_contains($haystack, $query)) {
                    $matches[] = [
                        'type' => $type,
                        'id' => $page['slug'],
                        'label' => $page['title'],
                        'summary' => $page['summary'],
                        'url' => '#/page/' . str_replace('%2F', '/', rawurlencode($page['slug'])),
                    ];
                    if (count($matches) >= $limit) {
                        break;
                    }
                }
            }
            return $matches;
        }
        if (in_array($type, ['question', 'answer', 'comment'], true)) {
            $viewer = (new UserRepository())->findById($viewerId);
            $page = (new KnowledgeGraphRepository())->search(
                $query,
                [$type],
                1,
                $limit,
                (new CommunityRepository())->visibleOrganizationIds($viewer),
            );
            return array_map(static fn (array $item): array => [
                'type' => (string) $item['type'],
                'id' => (string) $item['key'],
                'label' => (string) ($item['title'] ?: $item['key']),
                'summary' => (string) $item['summary'],
                'url' => (string) $item['url'],
            ], $page['items']);
        }
        return [];
    }

    private function page(string $rawSlug): array
    {
        $slug = $this->normalizeSlug($rawSlug);
        $path = $this->pagePath($slug);
        if (!is_file($path)) {
            throw new ApiException('引用的词条不存在。', 422, 'referenced_page_not_found', ['slug' => $slug]);
        }
        $meta = $this->pageMetadata($path, $slug);
        return [
            'type' => 'wiki_entry', 'id' => $slug, 'revision' => '',
            'label' => $meta['title'],
            'url' => '#/page/' . str_replace('%2F', '/', rawurlencode($slug)),
            'metadata' => ['summary' => $meta['summary']],
        ];
    }

    private function revision(string $rawSlug, string $revision): array
    {
        $slug = $this->normalizeSlug($rawSlug);
        if ($revision === '' || !preg_match('/^[A-Za-z0-9._:-]{1,100}$/', $revision)) {
            throw new ApiException('修订版本标识无效。', 422, 'invalid_revision_reference');
        }
        $base = rtrim((string) config('wikist.messaging.content_root', dirname(base_path())), '/\\');
        $directory = $base . DIRECTORY_SEPARATOR . 'content' . DIRECTORY_SEPARATOR . 'revisions' . DIRECTORY_SEPARATOR
            . str_replace('/', DIRECTORY_SEPARATOR, $slug);
        $exists = is_file($directory . DIRECTORY_SEPARATOR . $revision . '.md')
            || is_file($directory . DIRECTORY_SEPARATOR . str_replace(':', '-', $revision) . '.md');
        if (!$exists) {
            throw new ApiException('引用的修订版本不存在。', 422, 'referenced_revision_not_found');
        }
        $page = $this->page($slug);
        return [
            'type' => 'revision', 'id' => $slug, 'revision' => $revision,
            'label' => $page['label'] . ' · ' . $revision,
            'url' => '#/history/' . str_replace('%2F', '/', rawurlencode($slug)),
            'metadata' => ['pageSlug' => $slug, 'summary' => (string) ($page['metadata']['summary'] ?? '')],
        ];
    }

    private function user(string $id): array
    {
        $query = $this->messages->connection()->table('users');
        $row = ctype_digit($id) ? $query->where('id', (int) $id)->first() : $query->where('username', $id)->first();
        if (!$row) {
            throw new ApiException('引用的用户不存在。', 422, 'referenced_user_not_found');
        }
        return [
            'type' => 'user', 'id' => (string) $row->id, 'revision' => '',
            'label' => (string) ($row->display_name ?: $row->username),
            'url' => '#/user/' . rawurlencode((string) $row->username),
            'metadata' => [
                'username' => (string) $row->username,
                'avatarUrl' => (string) ($row->avatar_url ?? ''),
                'summary' => (string) ($row->bio ?? ''),
                'role' => (string) ($row->role ?? 'member'),
                'status' => (string) ($row->status ?? 'active'),
            ],
        ];
    }

    private function organization(string $id): array
    {
        $row = $this->messages->organization($id);
        if (!$row || (string) $row->status !== 'active') {
            throw new ApiException('引用的协作组织不存在。', 422, 'referenced_organization_not_found');
        }
        return [
            'type' => 'organization', 'id' => (string) $row->id, 'revision' => '',
            'label' => (string) $row->name,
            'url' => '#/organization/' . rawurlencode((string) $row->slug),
            'metadata' => [
                'slug' => (string) $row->slug,
                'summary' => (string) $row->description,
                'avatarUrl' => (string) ($row->avatar_image ?? ''),
                'status' => (string) ($row->status ?? 'active'),
            ],
        ];
    }

    private function futureObject(string $type, string $id): array
    {
        if (!preg_match('/^[A-Za-z0-9._:-]{1,190}$/', $id)) {
            throw new ApiException('知识对象标识无效。', 422, 'invalid_object_reference_id');
        }
        $graph = new KnowledgeGraphRepository();
        $indexed = $graph->findBySource('wikist', $type, $id)
            ?? $graph->findBySource('organization_forum', $type, $id)
            ?? $graph->findBySource('answer', $type, $id);
        return [
            'type' => $type, 'id' => $id, 'revision' => '',
            'label' => (string) ($indexed['title'] ?? (ucfirst($type) . ' #' . $id)),
            'url' => (string) ($indexed['url'] ?? ($type === 'question' ? '#/questions/' . rawurlencode($id) : '#/answers/' . rawurlencode($id))),
            'metadata' => ['resolver' => $indexed ? 'knowledge_graph' : 'deferred', 'globalId' => $indexed['globalId'] ?? ''],
        ];
    }

    private function selection(string $id): array
    {
        if (!ctype_digit($id) || (int) $id <= 0) {
            throw new ApiException('划词引用标识无效。', 422, 'invalid_selection_reference');
        }
        $row = (new SelectionRepository())->find((int) $id);
        if (!$row) {
            throw new ApiException('引用的划词记录不存在。', 422, 'referenced_selection_not_found');
        }
        return [
            'type' => 'selection',
            'id' => (string) $row->id,
            'revision' => '',
            'label' => '划词 · ' . ((string) $row->object_label ?: (string) $row->object_id),
            'url' => (string) $row->object_url,
            'metadata' => [
                'quote' => (string) $row->selected_text,
                'objectType' => (string) $row->object_type,
                'objectId' => (string) $row->object_id,
                'objectLabel' => (string) $row->object_label,
            ],
        ];
    }

    private function pageCatalog(): array
    {
        if (self::$pageCatalogExpiresAt > time()) {
            return self::$pageCatalog;
        }
        $root = rtrim((string) config('wikist.messaging.content_root', dirname(base_path())), '/\\')
            . DIRECTORY_SEPARATOR . 'content' . DIRECTORY_SEPARATOR . 'pages';
        $catalog = [];
        if (is_dir($root)) {
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                if (!$file->isFile() || strtolower($file->getExtension()) !== 'md') {
                    continue;
                }
                $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
                $slug = preg_replace('/\.md$/i', '', $relative) ?: '';
                if ($slug !== '') {
                    $catalog[] = $this->pageMetadata($file->getPathname(), $slug);
                }
            }
        }
        usort($catalog, static fn (array $a, array $b): int => strcasecmp($a['title'], $b['title']));
        self::$pageCatalog = $catalog;
        self::$pageCatalogExpiresAt = time() + 15;
        return $catalog;
    }

    private function pageMetadata(string $path, string $slug): array
    {
        $head = file_get_contents($path, false, null, 0, 16384) ?: '';
        $title = $this->frontMatterValue($head, 'title') ?: $slug;
        $summary = $this->frontMatterValue($head, 'summary');
        return ['slug' => $slug, 'title' => $title, 'summary' => $summary];
    }

    private function frontMatterValue(string $source, string $key): string
    {
        if (!str_starts_with(ltrim($source), '---')) {
            return '';
        }
        if (!preg_match('/^' . preg_quote($key, '/') . '\s*:\s*(.+)$/mi', $source, $match)) {
            return '';
        }
        return trim((string) $match[1], " \t\r\n\"'");
    }

    private function normalizeSlug(string $input): string
    {
        $slug = trim(str_replace('\\', '/', $input), '/ ');
        $slug = preg_replace('/\s+/u', '-', $slug) ?: '';
        $parts = array_values(array_filter(explode('/', $slug), static fn (string $part): bool => $part !== ''));
        if ($parts === []) {
            throw new ApiException('词条 slug 无效。', 422, 'invalid_page_slug');
        }
        foreach ($parts as $part) {
            if ($part === '.' || $part === '..' || preg_match('/[\x00-\x1f<>:"|?*]/u', $part)) {
                throw new ApiException('词条 slug 无效。', 422, 'invalid_page_slug');
            }
        }
        return implode('/', $parts);
    }

    private function pagePath(string $slug): string
    {
        $base = rtrim((string) config('wikist.messaging.content_root', dirname(base_path())), '/\\');
        return $base . DIRECTORY_SEPARATOR . 'content' . DIRECTORY_SEPARATOR . 'pages' . DIRECTORY_SEPARATOR
            . str_replace('/', DIRECTORY_SEPARATOR, $slug) . '.md';
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
