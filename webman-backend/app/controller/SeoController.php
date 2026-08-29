<?php

declare(strict_types=1);

namespace app\controller;

use app\exception\ApiException;
use app\service\SeoContentService;
use app\service\SeoPageRenderer;
use support\Request;
use support\Response;

final class SeoController
{
    private SeoContentService $content;
    private SeoPageRenderer $renderer;

    public function __construct()
    {
        $this->content = new SeoContentService();
        $this->renderer = new SeoPageRenderer($this->content->site());
    }

    public function wikiIndex(Request $request): Response
    {
        return $this->guard($request, function () use ($request): string {
            $page = $this->page($request, 'page');
            return $this->renderer->wikiIndex($this->content->wikiList($page, 30), $page);
        });
    }

    public function wiki(Request $request, string $slug): Response
    {
        try {
            $language = trim((string) $request->get('lang', ''));
            $payload = $this->content->wikiPage(rawurldecode($slug), $language);
            $page = (array) ($payload['page'] ?? []);
            if (!$this->content->isIndexablePage($page)) {
                return $this->html($request, $this->renderer->error(404, '词条尚未公开', '该词条尚未进入可公开收录状态。'), 404, true);
            }
            $canonicalSlug = (string) ($page['canonicalSlug'] ?? $page['slug'] ?? '');
            $requestedSlug = trim(rawurldecode($slug), '/');
            if ($canonicalSlug !== '' && $requestedSlug !== $canonicalSlug) {
                $target = $this->renderer->wikiPath($canonicalSlug) . ($language !== '' ? '?lang=' . rawurlencode($language) : '');
                return new Response(301, ['Location' => $target, 'Cache-Control' => 'public, max-age=3600'], '');
            }
            return $this->html($request, $this->renderer->wiki(
                $page,
                (array) ($payload['translations'] ?? []),
                (string) ($payload['requestedLanguage'] ?? ''),
            ), 200);
        } catch (ApiException $error) {
            return $this->apiError($request, $error, '词条不存在');
        } catch (\Throwable) {
            return $this->html($request, $this->renderer->error(503, '内容暂时不可用', '公开词条服务暂时不可用，请稍后重试。'), 503, true);
        }
    }

    public function questionIndex(Request $request): Response
    {
        return $this->guard($request, function () use ($request): string {
            $page = $this->page($request, 'page');
            return $this->renderer->questionIndex($this->content->questionList($page, 20), $page);
        });
    }

    public function question(Request $request, string $id): Response
    {
        try {
            $page = $this->page($request, 'answerPage');
            return $this->html($request, $this->renderer->question($this->content->question(rawurldecode($id), $page), $page), 200);
        } catch (ApiException $error) {
            return $this->apiError($request, $error, '问题不存在');
        } catch (\Throwable) {
            return $this->html($request, $this->renderer->error(503, '问答暂时不可用', '公开问答服务暂时不可用，请稍后重试。'), 503, true);
        }
    }

    public function discussionIndex(Request $request): Response
    {
        return $this->guard($request, function () use ($request): string {
            $page = $this->page($request, 'page');
            return $this->renderer->discussionIndex($this->content->discussionList($page, 30), $page);
        });
    }

    public function discussion(Request $request, string $organization, string $id): Response
    {
        try {
            $page = $this->page($request, 'replyPage');
            $payload = $this->content->discussion((int) $id, $page);
            $post = (array) ($payload['post'] ?? []);
            $canonicalOrganization = (string) ($post['organizationSlug'] ?? '');
            if ($canonicalOrganization !== '' && rawurldecode($organization) !== $canonicalOrganization) {
                return new Response(301, ['Location' => '/discussions/' . rawurlencode($canonicalOrganization) . '/' . (int) $id, 'Cache-Control' => 'public, max-age=3600'], '');
            }
            return $this->html($request, $this->renderer->discussion($payload, $page), 200);
        } catch (ApiException $error) {
            return $this->apiError($request, $error, '讨论不存在');
        } catch (\Throwable) {
            return $this->html($request, $this->renderer->error(503, '讨论暂时不可用', '公开讨论服务暂时不可用，请稍后重试。'), 503, true);
        }
    }

    public function robots(Request $request): Response
    {
        $site = $this->content->site();
        $body = $this->content->enabled()
            ? "User-agent: *\nAllow: /wiki/\nAllow: /questions\nAllow: /discussions\nDisallow: /api/\nDisallow: /admin\nDisallow: /passport\nDisallow: /install.html\nSitemap: " . rtrim((string) $site['publicUrl'], '/') . "/sitemap.xml\n"
            : "User-agent: *\nDisallow: /\n";
        return new Response(200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'Cache-Control' => 'public, max-age=3600',
        ], $body);
    }

    public function sitemapIndex(Request $request): Response
    {
        if (!$this->content->enabled()) {
            return new Response(404, ['Content-Type' => 'application/xml; charset=utf-8', 'X-Robots-Tag' => 'noindex'], '<?xml version="1.0" encoding="UTF-8"?><error>SEO disabled</error>');
        }
        try {
            $wikiPageSize = $this->content->sitemapPageSize();
            $wiki = $this->content->wikiList(1, 1);
            $questions = $this->content->questionList(1, 1);
            $discussions = $this->content->discussionList(1, 1);
            $sections = [
                'wiki' => (int) ceil(((int) ($wiki['total'] ?? 0)) / $wikiPageSize),
                'questions' => (int) ceil(((int) ($questions['total'] ?? 0)) / 50),
                'discussions' => (int) ceil(((int) ($discussions['total'] ?? 0)) / 50),
            ];
            $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
            foreach ($sections as $section => $pages) {
                for ($page = 1; $page <= max(1, $pages); $page++) {
                    $xml .= '<sitemap><loc>' . $this->renderer->xmlEscape($this->renderer->absolute('/sitemaps/' . $section . '-' . $page . '.xml')) . '</loc></sitemap>';
                }
            }
            $xml .= '</sitemapindex>';
            return $this->xml($request, $xml);
        } catch (\Throwable) {
            return new Response(503, ['Content-Type' => 'application/xml; charset=utf-8', 'Retry-After' => '60', 'X-Robots-Tag' => 'noindex'], '<?xml version="1.0" encoding="UTF-8"?><error>temporarily unavailable</error>');
        }
    }

    public function sitemap(Request $request, string $section, string $page): Response
    {
        if (!$this->content->enabled()) {
            return new Response(404, ['Content-Type' => 'application/xml; charset=utf-8', 'X-Robots-Tag' => 'noindex'], '');
        }
        $number = max(1, (int) $page);
        try {
            $urls = [];
            if ($section === 'wiki') {
                $payload = $this->content->wikiList($number, $this->content->sitemapPageSize());
                foreach ((array) ($payload['items'] ?? []) as $item) {
                    if ($this->content->isIndexablePage((array) $item)) {
                        $urls[] = [$this->renderer->absolute($this->renderer->wikiPath((string) ($item['slug'] ?? ''))), (string) ($item['updatedAt'] ?? '')];
                    }
                }
            } elseif ($section === 'questions') {
                $payload = $this->content->questionList($number, 50);
                foreach ((array) ($payload['items'] ?? []) as $item) {
                    $urls[] = [$this->renderer->absolute('/questions/' . rawurlencode((string) ($item['id'] ?? ''))), (string) ($item['updatedAt'] ?? '')];
                }
            } elseif ($section === 'discussions') {
                $payload = $this->content->discussionList($number, 50);
                foreach ((array) ($payload['items'] ?? []) as $item) {
                    $urls[] = [$this->renderer->absolute('/discussions/' . rawurlencode((string) ($item['organizationSlug'] ?? 'organization')) . '/' . (int) ($item['id'] ?? 0)), (string) ($item['updatedAt'] ?? '')];
                }
            } else {
                return new Response(404, ['Content-Type' => 'application/xml; charset=utf-8', 'X-Robots-Tag' => 'noindex'], '');
            }
            if ($number === 1) {
                $listPath = $section === 'wiki' ? '/wiki' : '/' . $section;
                array_unshift($urls, [$this->renderer->absolute($listPath), '']);
                if ($section === 'wiki') array_unshift($urls, [$this->renderer->absolute('/'), '']);
            }
            $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
            foreach ($urls as [$url, $lastModified]) {
                $xml .= '<url><loc>' . $this->renderer->xmlEscape($url) . '</loc>';
                if ($lastModified !== '' && strtotime($lastModified)) {
                    $xml .= '<lastmod>' . gmdate('c', (int) strtotime($lastModified)) . '</lastmod>';
                }
                $xml .= '</url>';
            }
            $xml .= '</urlset>';
            return $this->xml($request, $xml);
        } catch (\Throwable) {
            return new Response(503, ['Content-Type' => 'application/xml; charset=utf-8', 'Retry-After' => '60', 'X-Robots-Tag' => 'noindex'], '<?xml version="1.0" encoding="UTF-8"?><error>temporarily unavailable</error>');
        }
    }

    private function guard(Request $request, callable $render): Response
    {
        if (!$this->content->enabled()) {
            return $this->html($request, $this->renderer->error(404, '公开索引已关闭', '站点当前未开放搜索引擎索引。'), 404, true);
        }
        try {
            return $this->html($request, $render(), 200);
        } catch (ApiException $error) {
            return $this->apiError($request, $error, '页面不存在');
        } catch (\Throwable) {
            return $this->html($request, $this->renderer->error(503, '内容暂时不可用', '公开内容服务暂时不可用，请稍后重试。'), 503, true);
        }
    }

    private function apiError(Request $request, ApiException $error, string $title): Response
    {
        $status = max(400, min(599, $error->status()));
        return $this->html($request, $this->renderer->error($status, $title, $error->getMessage()), $status, true);
    }

    private function html(Request $request, string $body, int $status, bool $noindex = false): Response
    {
        $etag = '"' . hash('sha256', $body) . '"';
        $headers = [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => $status === 200 ? 'public, max-age=60, stale-while-revalidate=300' : 'no-store',
            'ETag' => $etag,
            'Vary' => 'Accept-Encoding',
        ];
        if ($noindex || $status >= 400) $headers['X-Robots-Tag'] = 'noindex, nofollow';
        if ($status === 200 && trim((string) $request->header('if-none-match')) === $etag) {
            return new Response(304, $headers, '');
        }
        return new Response($status, $headers, $body);
    }

    private function xml(Request $request, string $body): Response
    {
        // A Sitemap is generated from current content on every request. Do not
        // serve a stale XML document after an import, publish, restore, or
        // deletion. This also tells reverse proxies not to retain an old copy.
        return new Response(200, [
            'Content-Type' => 'application/xml; charset=utf-8',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ], $body);
    }

    private function page(Request $request, string $name): int
    {
        return max(1, min(100000, (int) $request->get($name, 1)));
    }
}
