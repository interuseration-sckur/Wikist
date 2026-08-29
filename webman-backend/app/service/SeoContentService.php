<?php

declare(strict_types=1);

namespace app\service;

use app\exception\ApiException;
use app\repository\SiteConfigRepository;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;

/**
 * Read-only aggregation for public, crawlable Wikist content.
 *
 * Node remains the source of truth for wiki files and the legacy organization
 * forum during migration. Native Community data is read through its service.
 */
final class SeoContentService
{
    public function __construct(
        private readonly SiteConfigRepository $siteConfig = new SiteConfigRepository(),
        private readonly CommunityQaService $community = new CommunityQaService(),
    ) {
    }

    public function enabled(): bool
    {
        return $this->siteConfig->get('seo.enabled', true) !== false;
    }

    public function indexDrafts(): bool
    {
        return $this->siteConfig->get('seo.indexDrafts', false) === true;
    }

    public function sitemapPageSize(): int
    {
        // The legacy content list API caps a page at 500 records. Keeping this
        // bound here guarantees that index page counts and sitemap payloads use
        // the same page size.
        return max(50, min(500, (int) $this->siteConfig->get('seo.sitemapPageSize', 500)));
    }

    public function site(): array
    {
        $config = $this->siteConfig->all();
        $publicUrl = rtrim((string) config('wikist.url', ''), '/');
        if ($publicUrl === '') {
            $publicUrl = rtrim((string) ($config['publicUrl'] ?? ''), '/');
        }
        return [
            'name' => trim((string) ($config['name'] ?? config('wikist.name', 'Wikist'))) ?: 'Wikist',
            'tagline' => trim((string) ($config['tagline'] ?? '开放、严谨、可验证的知识共同体')),
            'language' => (string) ($config['language'] ?? 'zh-CN'),
            'license' => (string) ($config['license'] ?? 'CC BY-SA 4.0'),
            'publicUrl' => $publicUrl,
            'icon' => (string) ($config['assets']['siteIcon'] ?? '/assets/wikist-icon.png'),
            'mathCdn' => (string) ($config['math']['cdn'] ?? ''),
            'defaultPage' => (string) ($config['defaultPage'] ?? 'home'),
            'brandAliases' => (array) ($config['seo']['brandAliases'] ?? []),
        ];
    }

    public function wikiList(int $page, ?int $limit = null): array
    {
        $limit ??= $this->sitemapPageSize();
        return $this->legacyJson('/api/pages', [
            'page' => max(1, $page),
            'limit' => max(1, min(500, $limit)),
            'indexable' => 1,
            'fresh' => 1,
        ]);
    }

    public function wikiPage(string $slug, string $language = ''): array
    {
        $slug = trim(str_replace('\\', '/', $slug), '/');
        if ($slug === '' || str_contains($slug, '..')) {
            throw new ApiException('词条不存在。', 404, 'seo_wiki_not_found');
        }
        $language = trim(str_replace('_', '-', $language));
        if ($language !== '' && !in_array(strtolower($language), ['zh', 'zh-cn', 'zh-hans'], true)) {
            $translated = $this->legacyJson('/api/pages/' . $this->encodePath($slug) . '/translation', ['lang' => $language]);
            if (is_array($translated['translation'] ?? null) && ($translated['translation']['status'] ?? '') === 'published') {
                return [
                    'page' => array_merge((array) $translated['source'], [
                        'slug' => $slug,
                        'title' => (string) ($translated['translation']['title'] ?? $translated['source']['title'] ?? $slug),
                        'summary' => (string) ($translated['translation']['summary'] ?? $translated['source']['summary'] ?? ''),
                        'html' => (string) ($translated['translation']['html'] ?? ''),
                        'body' => (string) ($translated['translation']['translatedMd'] ?? ''),
                        'language' => (string) ($translated['translation']['language'] ?? $language),
                        'updatedAt' => (string) ($translated['translation']['updatedAt'] ?? $translated['source']['updatedAt'] ?? ''),
                        'translationStatus' => 'published',
                    ]),
                    'translations' => (array) ($translated['translations'] ?? []),
                    'requestedLanguage' => $language,
                ];
            }
        }
        $page = $this->legacyJson('/api/pages/' . $this->encodePath($slug));
        $translations = [];
        try {
            $translationIndex = $this->legacyJson('/api/pages/' . $this->encodePath((string) ($page['slug'] ?? $slug)) . '/translations');
            $translations = (array) ($translationIndex['translations'] ?? []);
        } catch (ApiException) {
            // Translation alternates are optional; the source page remains valid.
        }
        return ['page' => $page, 'translations' => $translations, 'requestedLanguage' => ''];
    }

    public function questionList(int $page, int $limit = 20): array
    {
        return $this->community->questions([
            'page' => max(1, $page),
            'limit' => max(1, min(50, $limit)),
            'order' => 'active',
        ], null);
    }

    public function question(string $id, int $answerPage = 1): array
    {
        return $this->community->question($id, null, max(1, $answerPage));
    }

    public function discussionList(int $page, int $limit = 30): array
    {
        return $this->legacyJson('/api/community/discussions', [
            'page' => max(1, $page),
            'limit' => max(1, min(50, $limit)),
        ]);
    }

    public function discussion(int $id, int $replyPage = 1): array
    {
        return $this->legacyJson('/api/community/discussions/' . max(1, $id), [
            'page' => max(1, $replyPage),
            'limit' => 60,
        ]);
    }

    public function isIndexablePage(array $page): bool
    {
        if (($page['redirectTarget'] ?? '') !== '') {
            return false;
        }
        $status = strtolower(trim((string) ($page['status'] ?? '')));
        if (in_array($status, ['deleted', 'archived', 'hidden', 'private'], true)) {
            return false;
        }
        return $this->indexDrafts() || $status !== 'draft';
    }

    private function legacyJson(string $path, array $query = []): array
    {
        if (!config('wikist.legacy_proxy.enabled')) {
            throw new ApiException('内容兼容服务暂时不可用。', 503, 'seo_content_unavailable');
        }
        $baseUrl = rtrim((string) config('wikist.legacy_proxy.url'), '/');
        $this->assertLoopbackTarget($baseUrl);
        $url = $baseUrl . $path . ($query === [] ? '' : '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
        try {
            $response = (new Client(['http_errors' => false, 'timeout' => 15]))->get($url, [
                'headers' => [
                    'Accept' => 'application/json',
                    'X-Wikist-Internal-Token' => (string) config('wikist.legacy_proxy.token'),
                ],
            ]);
        } catch (ConnectException) {
            throw new ApiException('内容服务暂时不可用。', 503, 'seo_content_unavailable');
        }
        $status = $response->getStatusCode();
        $decoded = json_decode((string) $response->getBody(), true);
        $payload = is_array($decoded) ? $decoded : [];
        if ($status === 404) {
            throw new ApiException((string) ($payload['error'] ?? '内容不存在。'), 404, 'seo_content_not_found');
        }
        if ($status < 200 || $status >= 300) {
            throw new ApiException((string) ($payload['error'] ?? '读取公开内容失败。'), 503, 'seo_content_unavailable');
        }
        return $payload;
    }

    private function assertLoopbackTarget(string $url): void
    {
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (!in_array($host, ['127.0.0.1', '::1', 'localhost'], true)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])) {
            throw new ApiException('内容服务地址必须指向本机回环接口。', 503, 'seo_content_misconfigured');
        }
    }

    private function encodePath(string $value): string
    {
        return implode('/', array_map('rawurlencode', array_filter(explode('/', $value), static fn (string $part): bool => $part !== '')));
    }
}
