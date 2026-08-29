<?php

declare(strict_types=1);

namespace app\service;

final class SeoPageRenderer
{
    public function __construct(private readonly array $site)
    {
    }

    public function wikiIndex(array $payload, int $page): string
    {
        $items = array_values(array_filter((array) ($payload['items'] ?? []), static fn (array $item): bool => ($item['redirectTarget'] ?? '') === ''));
        $content = '<header class="seo-hero"><span class="seo-kicker">Knowledge Index</span><h1>数学知识库</h1><p>浏览已发布的词条、概念、定理与数学专题。</p></header>';
        $content .= '<section class="seo-list" aria-label="词条列表">';
        foreach ($items as $item) {
            $content .= '<article class="seo-list-item"><div><a href="' . $this->e($this->wikiPath((string) ($item['slug'] ?? ''))) . '"><h2>'
                . $this->e((string) ($item['title'] ?? $item['slug'] ?? '未命名词条')) . '</h2></a><p>'
                . $this->e($this->excerpt((string) ($item['summary'] ?? ''), 220)) . '</p><div class="seo-chips">'
                . $this->chip((string) ($item['quality'] ?? ''))
                . $this->chip((string) ($item['status'] ?? ''))
                . implode('', array_map(fn ($category): string => $this->chip((string) $category), array_slice((array) ($item['categories'] ?? []), 0, 4)))
                . '</div></div><time datetime="' . $this->e((string) ($item['updatedAt'] ?? '')) . '">' . $this->e($this->date((string) ($item['updatedAt'] ?? ''))) . '</time></article>';
        }
        $content .= $items === [] ? '<div class="seo-empty">暂时没有可公开收录的词条。</div>' : '';
        $content .= '</section>' . $this->pagination('/wiki', $page, (int) ($payload['pages'] ?? 1));
        return $this->document('数学知识库', '浏览 ' . $this->site['name'] . ' 已发布的数学词条。', $this->pageUrl('/wiki', $page), $content, [
            $this->websiteSchema(),
            $this->collectionSchema('数学知识库', $this->pageUrl('/wiki', $page), $items, 'wiki'),
        ], [], $this->pageLinks('/wiki', $page, (int) ($payload['pages'] ?? 1)));
    }

    public function wiki(array $page, array $translations = [], string $requestedLanguage = ''): string
    {
        $slug = (string) ($page['slug'] ?? '');
        $language = (string) ($page['language'] ?? ($this->site['language'] ?? 'zh-CN'));
        $canonicalPath = $this->wikiPath($slug) . ($requestedLanguage !== '' ? '?lang=' . rawurlencode($language) : '');
        $canonical = $this->absolute($canonicalPath);
        $title = (string) ($page['title'] ?? $slug);
        $description = $this->excerpt((string) ($page['summary'] ?? ''), 260) ?: $title . ' - ' . $this->site['name'];
        $html = $this->removeDuplicateLeadingHeading(
            $this->rewriteContentLinks((string) ($page['html'] ?? '')),
            $title
        );
        $hero = $this->absoluteAsset((string) ($page['heroImage'] ?? ''));
        $author = (string) ($page['authorDisplayName'] ?? $page['author'] ?? $this->site['name']);
        $status = (string) ($page['status'] ?? '');
        $body = '<article class="seo-article">';
        if ($hero !== '') {
            $body .= '<img class="seo-article-hero" src="' . $this->e($hero) . '" alt="' . $this->e($title) . '" loading="eager" />';
        }
        $body .= '<header class="seo-article-head"><nav class="seo-breadcrumb"><a href="/wiki">知识库</a><span>/</span><span>' . $this->e($title) . '</span></nav><h1>' . $this->e($title) . '</h1><p>' . $this->e($description) . '</p><div class="seo-meta">'
            . $this->chip((string) ($page['quality'] ?? '')) . $this->chip($status)
            . '<span>作者 ' . $this->e($author) . '</span><time datetime="' . $this->e((string) ($page['updatedAt'] ?? '')) . '">更新 ' . $this->e($this->date((string) ($page['updatedAt'] ?? ''))) . '</time></div>'
            . '<div class="seo-chips">' . implode('', array_map(fn ($category): string => $this->chip((string) $category), (array) ($page['categories'] ?? []))) . '</div></header>';
        $body .= '<div class="article-body seo-article-body">' . ($html !== '' ? $html : '<p>该词条暂时没有正文。</p>') . '</div>';
        $body .= '<footer class="seo-content-footer"><span>内容许可：' . $this->e((string) $this->site['license']) . '</span><a href="/#/page/' . $this->encodePath($slug) . '">在 Wikist 中打开</a></footer></article>';

        $alternates = [];
        $alternates[] = ['language' => (string) ($this->site['language'] ?? 'zh-CN'), 'url' => $this->absolute($this->wikiPath($slug))];
        foreach ($translations as $translation) {
            if (($translation['status'] ?? '') !== 'published') {
                continue;
            }
            $lang = (string) ($translation['language'] ?? '');
            if ($lang !== '') {
                $alternates[] = ['language' => $lang, 'url' => $this->absolute($this->wikiPath($slug) . '?lang=' . rawurlencode($lang))];
            }
        }
        return $this->document($title, $description, $canonical, $body, [
            $this->articleSchema($page, $canonical, $hero, $author),
            $this->breadcrumbSchema([['知识库', $this->absolute('/wiki')], [$title, $canonical]]),
        ], $alternates, [], $language, $hero, true);
    }

    public function questionIndex(array $payload, int $page): string
    {
        $items = (array) ($payload['items'] ?? []);
        $content = '<header class="seo-hero"><span class="seo-kicker">Wikist Community</span><h1>站内问答</h1><p>公开问题、回答和可验证的知识讨论。</p><a class="seo-primary" href="/#/questions/new">发起问题</a></header><section class="seo-list" aria-label="问题列表">';
        foreach ($items as $item) {
            $content .= $this->questionRow($item);
        }
        $content .= $items === [] ? '<div class="seo-empty">暂时没有公开问题。</div>' : '';
        $content .= '</section>' . $this->pagination('/questions', $page, (int) ($payload['pages'] ?? 1));
        return $this->document('站内问答', '浏览 ' . $this->site['name'] . ' 社区公开问题与回答。', $this->pageUrl('/questions', $page), $content, [
            $this->websiteSchema(),
            $this->collectionSchema('站内问答', $this->pageUrl('/questions', $page), $items, 'question'),
        ], [], $this->pageLinks('/questions', $page, (int) ($payload['pages'] ?? 1)));
    }

    public function question(array $payload, int $answerPage): string
    {
        $question = (array) ($payload['question'] ?? []);
        $answersPayload = (array) ($payload['answers'] ?? []);
        $answers = (array) ($answersPayload['items'] ?? []);
        $id = (string) ($question['id'] ?? '');
        $title = (string) ($question['title'] ?? '问题');
        $canonical = $this->absolute('/questions/' . rawurlencode($id));
        $description = $this->excerpt((string) ($question['summary'] ?? ''), 260);
        $body = '<article class="seo-article seo-question"><header class="seo-article-head"><nav class="seo-breadcrumb"><a href="/questions">站内问答</a><span>/</span><span>问题</span></nav><div class="seo-title-line"><h1>' . $this->e($title) . '</h1>'
            . (($question['closed'] ?? false) ? '<span class="seo-state is-closed">已关闭</span>' : '') . '</div><div class="seo-meta"><span>' . (int) ($question['voteCount'] ?? 0) . ' 赞同</span><span>' . (int) ($question['answerCount'] ?? 0) . ' 回答</span><span>' . (int) ($question['viewCount'] ?? 0) . ' 浏览</span><time datetime="' . $this->e((string) ($question['createdAt'] ?? '')) . '">' . $this->e($this->date((string) ($question['createdAt'] ?? ''))) . '</time></div><div class="seo-chips">'
            . implode('', array_map(fn ($tag): string => $this->chip((string) $tag), (array) ($question['tags'] ?? []))) . '</div></header>';
        $body .= '<div class="article-body seo-article-body">' . $this->rewriteContentLinks((string) ($question['bodyHtml'] ?? '')) . '</div>';
        $body .= $this->authorLine((array) ($question['author'] ?? []), (string) ($question['updatedAt'] ?? ''));
        if ((array) ($question['comments'] ?? []) !== []) {
            $body .= '<section class="seo-comments"><h2>问题评论</h2>';
            foreach ((array) $question['comments'] as $comment) {
                $body .= $this->comment((array) $comment);
            }
            $body .= '</section>';
        }
        $body .= '<section class="seo-answers"><header><h2>' . (int) ($answersPayload['total'] ?? count($answers)) . ' 个回答</h2></header>';
        foreach ($answers as $answer) {
            $body .= '<article class="seo-answer' . (($answer['accepted'] ?? false) ? ' is-accepted' : '') . '" id="answer-' . $this->e((string) ($answer['id'] ?? '')) . '">'
                . (($answer['accepted'] ?? false) ? '<span class="seo-state is-accepted">已采纳</span>' : '')
                . '<div class="article-body">' . $this->rewriteContentLinks((string) ($answer['bodyHtml'] ?? '')) . '</div>'
                . $this->authorLine((array) ($answer['author'] ?? []), (string) ($answer['updatedAt'] ?? '')) . '</article>';
        }
        $body .= $answers === [] ? '<div class="seo-empty">还没有公开回答。</div>' : '';
        $body .= $this->pagination('/questions/' . rawurlencode($id), $answerPage, (int) ($answersPayload['pages'] ?? 1), 'answerPage') . '</section>';
        $body .= '<footer class="seo-content-footer"><a href="/#/questions/' . rawurlencode($id) . '">参与回答与讨论</a></footer></article>';
        return $this->document($title, $description, $canonical, $body, [
            $this->qaSchema($question, $answers, $canonical),
            $this->breadcrumbSchema([['站内问答', $this->absolute('/questions')], [$title, $canonical]]),
        ], [], $this->pageLinks('/questions/' . rawurlencode($id), $answerPage, (int) ($answersPayload['pages'] ?? 1), 'answerPage'), (string) ($question['language'] ?? $this->site['language']), '', true);
    }

    public function discussionIndex(array $payload, int $page): string
    {
        $items = (array) ($payload['items'] ?? []);
        $content = '<header class="seo-hero"><span class="seo-kicker">Collaboration Commons</span><h1>公开讨论</h1><p>协作组织公开发布的学术主题、公告与社区结论。</p></header><section class="seo-list" aria-label="讨论列表">';
        foreach ($items as $item) {
            $content .= '<article class="seo-list-item"><div><div class="seo-chips">' . $this->chip((string) ($item['organizationName'] ?? '协作组织')) . $this->chip($this->discussionType((string) ($item['postType'] ?? ''))) . '</div><a href="/discussions/' . rawurlencode((string) ($item['organizationSlug'] ?? 'organization')) . '/' . (int) ($item['id'] ?? 0) . '"><h2>' . $this->e((string) ($item['title'] ?? '讨论')) . '</h2></a><p>' . $this->e($this->excerpt(strip_tags((string) ($item['bodyHtml'] ?? $item['bodyMd'] ?? '')), 220)) . '</p><div class="seo-meta"><span>' . (int) ($item['replyCount'] ?? 0) . ' 回复</span><span>' . $this->e((string) ($item['authorName'] ?? $item['authorUsername'] ?? '')) . '</span></div></div><time datetime="' . $this->e((string) ($item['updatedAt'] ?? '')) . '">' . $this->e($this->date((string) ($item['updatedAt'] ?? ''))) . '</time></article>';
        }
        $content .= $items === [] ? '<div class="seo-empty">暂时没有公开讨论。</div>' : '';
        $content .= '</section>' . $this->pagination('/discussions', $page, (int) ($payload['pages'] ?? 1));
        return $this->document('公开讨论', '浏览 ' . $this->site['name'] . ' 协作组织的公开讨论。', $this->pageUrl('/discussions', $page), $content, [
            $this->websiteSchema(),
            $this->collectionSchema('公开讨论', $this->pageUrl('/discussions', $page), $items, 'discussion'),
        ], [], $this->pageLinks('/discussions', $page, (int) ($payload['pages'] ?? 1)));
    }

    public function discussion(array $payload, int $replyPage): string
    {
        $post = (array) ($payload['post'] ?? []);
        $replies = (array) ($payload['items'] ?? []);
        $id = (int) ($post['id'] ?? 0);
        $organizationSlug = (string) ($post['organizationSlug'] ?? 'organization');
        $path = '/discussions/' . rawurlencode($organizationSlug) . '/' . $id;
        $canonical = $this->absolute($path);
        $title = (string) ($post['title'] ?? '公开讨论');
        $description = $this->excerpt(strip_tags((string) ($post['bodyHtml'] ?? $post['bodyMd'] ?? '')), 260);
        $body = '<article class="seo-article seo-discussion"><header class="seo-article-head"><nav class="seo-breadcrumb"><a href="/discussions">公开讨论</a><span>/</span><a href="/#/organization/' . rawurlencode($organizationSlug) . '">' . $this->e((string) ($post['organizationName'] ?? $organizationSlug)) . '</a></nav><div class="seo-chips">' . $this->chip($this->discussionType((string) ($post['postType'] ?? ''))) . $this->chip((string) ($post['status'] ?? '')) . '</div><h1>' . $this->e($title) . '</h1></header>';
        $body .= '<div class="article-body seo-article-body">' . $this->rewriteContentLinks((string) ($post['bodyHtml'] ?? '')) . '</div>';
        $body .= $this->forumAuthorLine($post);
        $body .= '<section class="seo-answers"><header><h2>' . (int) ($payload['total'] ?? count($replies)) . ' 条回复</h2></header>';
        foreach ($replies as $reply) {
            $body .= '<article class="seo-answer" id="reply-' . (int) ($reply['id'] ?? 0) . '"><div class="article-body">' . $this->rewriteContentLinks((string) ($reply['contentHtml'] ?? '')) . '</div>' . $this->forumAuthorLine((array) $reply) . '</article>';
        }
        $body .= $replies === [] ? '<div class="seo-empty">还没有公开回复。</div>' : '';
        $body .= $this->pagination($path, $replyPage, (int) ($payload['pages'] ?? 1), 'replyPage') . '</section>';
        $body .= '<footer class="seo-content-footer"><a href="/#/organization/' . rawurlencode($organizationSlug) . '?tab=forum&amp;topic=' . $id . '">参与组织讨论</a></footer></article>';
        return $this->document($title, $description, $canonical, $body, [
            $this->discussionSchema($post, $replies, $canonical),
            $this->breadcrumbSchema([['公开讨论', $this->absolute('/discussions')], [$title, $canonical]]),
        ], [], $this->pageLinks($path, $replyPage, (int) ($payload['pages'] ?? 1), 'replyPage'), (string) ($post['language'] ?? $this->site['language']), '', true);
    }

    public function error(int $status, string $title, string $message): string
    {
        $content = '<section class="seo-error"><span class="seo-error-code">' . $status . '</span><h1>' . $this->e($title) . '</h1><p>' . $this->e($message) . '</p><div><a class="seo-primary" href="/">返回首页</a><a href="/wiki">浏览知识库</a></div></section>';
        return $this->document($title, $message, $this->absolute('/'), $content, [], [], [], (string) $this->site['language'], '', false, true);
    }

    public function decorateHomepage(string $html): string
    {
        $siteName = trim((string) $this->site['name']);
        $tagline = trim((string) $this->site['tagline']);
        $title = $this->e($tagline !== '' ? $siteName . ' - ' . $tagline : $siteName);
        $description = $this->e($tagline);
        $canonical = $this->e($this->absolute('/'));
        $meta = '<meta name="description" content="' . $description . '" />'
            . '<link rel="canonical" href="' . $canonical . '" />'
            . '<link rel="sitemap" type="application/xml" href="' . $this->e($this->absolute('/sitemap.xml')) . '" />'
            . '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />'
            . '<meta property="og:type" content="website" /><meta property="og:site_name" content="' . $this->e($siteName) . '" /><meta property="og:title" content="' . $title . '" />'
            . '<meta property="og:description" content="' . $description . '" /><meta property="og:url" content="' . $canonical . '" />'
            . '<meta name="twitter:card" content="summary" />'
            . $this->jsonLd([$this->websiteSchema(), $this->siteNavigationSchema()]);
        $html = preg_replace('/<title>.*?<\/title>/is', '<title>' . $title . '</title>', $html, 1) ?? $html;
        return str_replace('</head>', $meta . '</head>', $html);
    }

    public function xmlEscape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function absolute(string $path): string
    {
        if (preg_match('#^https?://#i', $path)) {
            return $path;
        }
        return rtrim((string) $this->site['publicUrl'], '/') . '/' . ltrim($path, '/');
    }

    public function wikiPath(string $slug): string
    {
        return '/wiki/' . $this->encodePath($slug);
    }

    private function document(string $title, string $description, string $canonical, string $body, array $schemas = [], array $alternates = [], array $pageLinks = [], string $language = 'zh-CN', string $image = '', bool $article = false, bool $noindex = false): string
    {
        $fullTitle = $title === $this->site['name'] ? $title : $title . ' - ' . $this->site['name'];
        $head = '<meta name="description" content="' . $this->e($description) . '" />'
            . '<link rel="canonical" href="' . $this->e($canonical) . '" />'
            . '<link rel="sitemap" type="application/xml" href="' . $this->e($this->absolute('/sitemap.xml')) . '" />'
            . ($noindex ? '<meta name="robots" content="noindex,nofollow" />' : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />')
            . '<meta property="og:type" content="' . ($article ? 'article' : 'website') . '" /><meta property="og:site_name" content="' . $this->e((string) $this->site['name']) . '" />'
            . '<meta property="og:title" content="' . $this->e($fullTitle) . '" /><meta property="og:description" content="' . $this->e($description) . '" /><meta property="og:url" content="' . $this->e($canonical) . '" />'
            . ($image !== '' ? '<meta property="og:image" content="' . $this->e($image) . '" />' : '')
            . '<meta name="twitter:card" content="' . ($image !== '' ? 'summary_large_image' : 'summary') . '" />';
        foreach ($alternates as $alternate) {
            $head .= '<link rel="alternate" hreflang="' . $this->e((string) $alternate['language']) . '" href="' . $this->e((string) $alternate['url']) . '" />';
        }
        foreach ($pageLinks as $rel => $url) {
            $head .= '<link rel="' . $this->e($rel) . '" href="' . $this->e($url) . '" />';
        }
        $head .= $this->jsonLd($schemas);
        $icon = $this->absoluteAsset((string) $this->site['icon']);
        $math = $article && $this->safeScriptUrl((string) ($this->site['mathCdn'] ?? '')) !== ''
            ? '<script>window.MathJax={tex:{inlineMath:[["$","$"],["\\\\(","\\\\)"]],displayMath:[["$$","$$"],["\\\\[","\\\\]"]]},options:{skipHtmlTags:["script","noscript","style","textarea","pre","code"]}};</script><script src="' . $this->e($this->safeScriptUrl((string) $this->site['mathCdn'])) . '" defer></script>'
            : '';
        $applicationRoute = $noindex ? '' : $this->applicationRoute($canonical);
        if ($applicationRoute !== '') {
            return $this->applicationDocument($fullTitle, $language, $head, $body, $applicationRoute, $math);
        }
        return '<!doctype html><html class="seo-standalone" lang="' . $this->e($language ?: 'zh-CN') . '" data-theme="light"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="theme-color" content="#f6fbfa" /><title>' . $this->e($fullTitle) . '</title>'
            . ($icon !== '' ? '<link rel="icon" href="' . $this->e($icon) . '" />' : '') . $head
            . '<link rel="stylesheet" href="/assets/design-system.css?v=wikist-seo-1001" /><link rel="stylesheet" href="/assets/seo-reader.css?v=wikist-seo-1001" /></head><body><header class="seo-site-header"><a class="seo-brand" href="/"><img src="' . $this->e($icon ?: '/assets/wikist-icon.png') . '" alt="" /><span><strong>' . $this->e((string) $this->site['name']) . '</strong><small>' . $this->e((string) $this->site['tagline']) . '</small></span></a><nav aria-label="公开内容导航"><a href="/wiki">知识库</a><a href="/questions">问答</a><a href="/discussions">讨论</a><a href="/#/search/">搜索</a></nav><a class="seo-open-app" href="/">进入 Wikist</a></header><main class="seo-shell">' . $body . '</main><footer class="seo-site-footer"><div><strong>' . $this->e((string) $this->site['name']) . '</strong><span>' . $this->e((string) $this->site['tagline']) . '</span></div><nav><a href="/wiki">知识库</a><a href="/questions">问答</a><a href="/discussions">公开讨论</a><a href="/robots.txt">Robots</a><a href="/sitemap.xml">Sitemap</a></nav><small>内容许可：' . $this->e((string) $this->site['license']) . '</small></footer>' . $math . '</body></html>';
    }

    private function applicationDocument(string $title, string $language, string $head, string $body, string $route, string $math): string
    {
        $path = base_path('../public/index.html');
        $html = is_file($path) ? (string) file_get_contents($path) : '';
        if ($html === '') {
            return '';
        }
        $html = preg_replace('/<html\b[^>]*>/i', '<html lang="' . $this->e($language ?: 'zh-CN') . '" data-theme="light">', $html, 1) ?? $html;
        $html = preg_replace('/<title>.*?<\/title>/is', '<title>' . $this->e($title) . '</title>', $html, 1) ?? $html;
        $html = str_replace('</head>', $head . '<link rel="stylesheet" href="/assets/seo-reader.css?v=wikist-seo-1003" /></head>', $html);
        $surface = '<section class="content-surface" id="mainContent" aria-live="polite"><div class="seo-prerender" data-seo-prerender>' . $body . '</div></section>';
        $html = preg_replace('/<section class="content-surface" id="mainContent" aria-live="polite"><\/section>/', $surface, $html, 1) ?? $html;
        $icon = $this->absoluteAsset((string) ($this->site['icon'] ?? '')) ?: '/assets/wikist-icon.png';
        $loader = '<div id="wikistRouteLoader" class="wikist-native-route-loader" role="status" aria-live="polite"><div class="wikist-route-loader-core" aria-hidden="true"><i></i><i></i><img src="' . $this->e($icon) . '" alt="" /></div><strong>正在接入知识节点</strong></div><noscript><style>#wikistRouteLoader{display:none!important}</style></noscript>';
        $bootstrap = '<script>window.__WIKIST_INITIAL_ROUTE__=' . json_encode($route, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ';window.__WIKIST_CLEAN_ENTRY__=true;</script>';
        return str_replace('</body>', $loader . $bootstrap . $math . '</body>', $html);
    }

    private function applicationRoute(string $canonical): string
    {
        $path = rawurldecode((string) parse_url($canonical, PHP_URL_PATH));
        $query = (string) parse_url($canonical, PHP_URL_QUERY);
        if (preg_match('#^/wiki/(.+)$#', $path, $match)) {
            $route = '#/page/' . $this->encodePath(trim($match[1], '/'));
            return $route . ($query !== '' ? '?' . $query : '');
        }
        if ($path === '/wiki') {
            return '#/search/' . ($query !== '' ? '?' . $query : '');
        }
        if (preg_match('#^/questions/([^/]+)$#', $path, $match)) {
            return '#/questions/' . rawurlencode($match[1]) . ($query !== '' ? '?' . $query : '');
        }
        if ($path === '/questions') {
            return '#/questions' . ($query !== '' ? '?' . $query : '');
        }
        if (preg_match('#^/discussions/([^/]+)/(\d+)$#', $path, $match)) {
            $parameters = ['tab' => 'forum', 'topic' => $match[2]];
            parse_str($query, $queryParameters);
            foreach ($queryParameters as $name => $value) {
                $parameters[(string) $name] = (string) $value;
            }
            return '#/organization/' . rawurlencode($match[1]) . '?' . http_build_query($parameters);
        }
        if ($path === '/discussions') {
            return '#/community' . ($query !== '' ? '?' . $query : '');
        }
        return '';
    }

    private function removeDuplicateLeadingHeading(string $html, string $title): string
    {
        if (!preg_match('/^\s*<h1\b[^>]*>(.*?)<\/h1>\s*/is', $html, $match)) {
            return $html;
        }

        $heading = html_entity_decode(strip_tags((string) $match[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalize = static fn (string $value): string => preg_replace('/\s+/u', ' ', trim($value)) ?? trim($value);
        if ($normalize($heading) !== $normalize($title)) {
            return $html;
        }

        return substr($html, strlen((string) $match[0]));
    }

    private function questionRow(array $item): string
    {
        return '<article class="seo-list-item' . (($item['closed'] ?? false) ? ' is-muted' : '') . '"><div><div class="seo-chips">'
            . (($item['closed'] ?? false) ? '<span class="seo-state is-closed">已关闭</span>' : '')
            . implode('', array_map(fn ($tag): string => $this->chip((string) $tag), array_slice((array) ($item['tags'] ?? []), 0, 5)))
            . '</div><a href="/questions/' . rawurlencode((string) ($item['id'] ?? '')) . '"><h2>' . $this->e((string) ($item['title'] ?? '问题')) . '</h2></a><p>' . $this->e($this->excerpt((string) ($item['summary'] ?? ''), 220)) . '</p><div class="seo-meta"><span>' . (int) ($item['voteCount'] ?? 0) . ' 赞同</span><span>' . (int) ($item['answerCount'] ?? 0) . ' 回答</span><span>' . (int) ($item['viewCount'] ?? 0) . ' 浏览</span></div></div><time datetime="' . $this->e((string) ($item['updatedAt'] ?? '')) . '">' . $this->e($this->date((string) ($item['updatedAt'] ?? ''))) . '</time></article>';
    }

    private function authorLine(array $author, string $date): string
    {
        $username = (string) ($author['username'] ?? '');
        $name = (string) ($author['displayName'] ?? $username ?: 'Wikist 用户');
        $avatar = $this->absoluteAsset((string) ($author['avatarUrl'] ?? ''));
        return '<footer class="seo-author">' . ($avatar !== '' ? '<img src="' . $this->e($avatar) . '" alt="" loading="lazy" />' : '<span class="seo-avatar-fallback">' . $this->e(mb_substr($name, 0, 1)) . '</span>') . '<div><a href="/#/user/' . rawurlencode($username) . '">' . $this->e($name) . '</a><time datetime="' . $this->e($date) . '">' . $this->e($this->date($date)) . '</time></div></footer>';
    }

    private function forumAuthorLine(array $item): string
    {
        return $this->authorLine([
            'username' => (string) ($item['authorUsername'] ?? ''),
            'displayName' => (string) ($item['authorName'] ?? $item['authorUsername'] ?? ''),
            'avatarUrl' => (string) ($item['authorAvatarUrl'] ?? ''),
        ], (string) ($item['updatedAt'] ?? $item['createdAt'] ?? ''));
    }

    private function comment(array $comment): string
    {
        return '<article class="seo-comment"><div class="article-body">' . $this->rewriteContentLinks((string) ($comment['bodyHtml'] ?? '')) . '</div>' . $this->authorLine((array) ($comment['author'] ?? []), (string) ($comment['updatedAt'] ?? $comment['createdAt'] ?? '')) . '</article>';
    }

    private function pagination(string $path, int $page, int $pages, string $parameter = 'page'): string
    {
        $pages = max(1, $pages);
        if ($pages <= 1) {
            return '';
        }
        $links = '';
        $start = max(1, $page - 2);
        $end = min($pages, $page + 2);
        if ($page > 1) {
            $links .= '<a rel="prev" href="' . $this->e($this->paginationUrl($path, $parameter, $page - 1)) . '">上一页</a>';
        }
        for ($index = $start; $index <= $end; $index++) {
            $links .= $index === $page ? '<strong aria-current="page">' . $index . '</strong>' : '<a href="' . $this->e($this->paginationUrl($path, $parameter, $index)) . '">' . $index . '</a>';
        }
        if ($page < $pages) {
            $links .= '<a rel="next" href="' . $this->e($this->paginationUrl($path, $parameter, $page + 1)) . '">下一页</a>';
        }
        return '<nav class="seo-pagination" aria-label="分页">' . $links . '<span>共 ' . $pages . ' 页</span></nav>';
    }

    private function pageLinks(string $path, int $page, int $pages, string $parameter = 'page'): array
    {
        $result = [];
        if ($page > 1) {
            $result['prev'] = $this->absolute($this->paginationUrl($path, $parameter, $page - 1));
        }
        if ($page < $pages) {
            $result['next'] = $this->absolute($this->paginationUrl($path, $parameter, $page + 1));
        }
        return $result;
    }

    private function pageUrl(string $path, int $page): string
    {
        return $this->absolute($page > 1 ? $path . '?page=' . $page : $path);
    }

    private function paginationUrl(string $path, string $parameter, int $page): string
    {
        return $page > 1 ? $path . '?' . rawurlencode($parameter) . '=' . $page : $path;
    }

    private function rewriteContentLinks(string $html): string
    {
        $html = preg_replace_callback('/href=("|\')#\/page\/([^"\'?#]+)(?:\?[^"\']*)?\1/i', function (array $match): string {
            return 'href=' . $match[1] . $this->wikiPath(rawurldecode($match[2])) . $match[1];
        }, $html) ?? $html;
        $html = preg_replace_callback('/href=("|\')#\/questions\/([^"\'?#]+)(?:\?[^"\']*)?\1/i', static function (array $match): string {
            return 'href=' . $match[1] . '/questions/' . rawurlencode(rawurldecode($match[2])) . $match[1];
        }, $html) ?? $html;
        return $html;
    }

    private function articleSchema(array $page, string $canonical, string $image, string $author): array
    {
        $citations = [];
        foreach ((array) ($page['references'] ?? []) as $reference) {
            $url = trim((string) ($reference['url'] ?? ''));
            $doi = trim((string) ($reference['doi'] ?? ''));
            $arxiv = trim((string) ($reference['arxiv'] ?? ''));
            if ($url !== '') $citations[] = $url;
            elseif ($doi !== '') $citations[] = 'https://doi.org/' . $doi;
            elseif ($arxiv !== '') $citations[] = 'https://arxiv.org/abs/' . $arxiv;
        }
        return array_filter([
            '@context' => 'https://schema.org', '@type' => 'Article',
            'headline' => (string) ($page['title'] ?? ''), 'description' => (string) ($page['summary'] ?? ''),
            'mainEntityOfPage' => $canonical, 'url' => $canonical,
            'datePublished' => (string) ($page['createdAt'] ?? ''), 'dateModified' => (string) ($page['updatedAt'] ?? ''),
            'inLanguage' => (string) ($page['language'] ?? $this->site['language']),
            'author' => ['@type' => 'Person', 'name' => $author],
            'publisher' => ['@type' => 'Organization', 'name' => $this->site['name'], 'url' => $this->absolute('/')],
            'image' => $image ?: null, 'license' => (string) $this->site['license'],
            'citation' => $citations ?: null,
        ], static fn ($value): bool => $value !== null && $value !== '');
    }

    private function qaSchema(array $question, array $answers, string $canonical): array
    {
        $answerSchemas = [];
        foreach ($answers as $answer) {
            $answerSchemas[] = [
                '@type' => 'Answer',
                'url' => $canonical . '#answer-' . rawurlencode((string) ($answer['id'] ?? '')),
                'text' => $this->plain((string) ($answer['bodyHtml'] ?? '')),
                'dateCreated' => (string) ($answer['createdAt'] ?? ''),
                'upvoteCount' => (int) ($answer['upvoteCount'] ?? 0),
                'author' => ['@type' => 'Person', 'name' => (string) ($answer['author']['displayName'] ?? $answer['author']['username'] ?? 'Wikist 用户')],
            ];
        }
        $acceptedId = (string) ($question['acceptedAnswerId'] ?? '');
        $accepted = null;
        $suggested = [];
        foreach ($answerSchemas as $index => $answerSchema) {
            if ($acceptedId !== '' && (string) ($answers[$index]['id'] ?? '') === $acceptedId) $accepted = $answerSchema;
            else $suggested[] = $answerSchema;
        }
        $entity = [
            '@type' => 'Question', 'name' => (string) ($question['title'] ?? ''),
            'text' => $this->plain((string) ($question['bodyHtml'] ?? '')), 'url' => $canonical,
            'dateCreated' => (string) ($question['createdAt'] ?? ''), 'dateModified' => (string) ($question['updatedAt'] ?? ''),
            'answerCount' => (int) ($question['answerCount'] ?? count($answers)), 'upvoteCount' => (int) ($question['upvoteCount'] ?? 0),
            'author' => ['@type' => 'Person', 'name' => (string) ($question['author']['displayName'] ?? $question['author']['username'] ?? 'Wikist 用户')],
        ];
        if ($accepted) $entity['acceptedAnswer'] = $accepted;
        if ($suggested !== []) $entity['suggestedAnswer'] = $suggested;
        return ['@context' => 'https://schema.org', '@type' => 'QAPage', 'mainEntity' => $entity];
    }

    private function discussionSchema(array $post, array $replies, string $canonical): array
    {
        $comments = [];
        foreach ($replies as $reply) {
            $comments[] = [
                '@type' => 'Comment', 'text' => $this->plain((string) ($reply['contentHtml'] ?? '')),
                'dateCreated' => (string) ($reply['createdAt'] ?? ''),
                'author' => ['@type' => 'Person', 'name' => (string) ($reply['authorName'] ?? $reply['authorUsername'] ?? 'Wikist 用户')],
            ];
        }
        return [
            '@context' => 'https://schema.org', '@type' => 'DiscussionForumPosting',
            'headline' => (string) ($post['title'] ?? ''), 'text' => $this->plain((string) ($post['bodyHtml'] ?? '')),
            'url' => $canonical, 'datePublished' => (string) ($post['createdAt'] ?? ''), 'dateModified' => (string) ($post['updatedAt'] ?? ''),
            'author' => ['@type' => 'Person', 'name' => (string) ($post['authorName'] ?? $post['authorUsername'] ?? 'Wikist 用户')],
            'publisher' => ['@type' => 'Organization', 'name' => (string) ($post['organizationName'] ?? $this->site['name'])],
            'commentCount' => (int) ($post['replyCount'] ?? count($replies)), 'comment' => $comments,
        ];
    }

    private function websiteSchema(): array
    {
        $siteName = trim((string) $this->site['name']);
        $aliases = [];
        foreach ((array) ($this->site['brandAliases'] ?? []) as $alias) {
            $alias = trim((string) $alias);
            if ($alias !== '' && strcasecmp($alias, $siteName) !== 0 && !in_array($alias, $aliases, true)) {
                $aliases[] = $alias;
            }
        }
        $host = strtolower((string) parse_url((string) ($this->site['publicUrl'] ?? ''), PHP_URL_HOST));
        $compactHost = preg_replace('/[^a-z0-9]/', '', preg_replace('/^www\./', '', $host)) ?: '';
        if ($compactHost !== '' && strcasecmp($compactHost, $siteName) !== 0 && !in_array($compactHost, $aliases, true)) {
            $aliases[] = $compactHost;
        }
        $schema = [
            '@context' => 'https://schema.org', '@type' => 'WebSite',
            '@id' => $this->absolute('/#website'),
            'name' => $siteName, 'description' => (string) $this->site['tagline'],
            'url' => $this->absolute('/'),
            'inLanguage' => (string) ($this->site['language'] ?? 'zh-CN'),
            'potentialAction' => ['@type' => 'SearchAction', 'target' => $this->absolute('/#/search/{search_term_string}'), 'query-input' => 'required name=search_term_string'],
        ];
        if ($aliases !== []) {
            $schema['alternateName'] = array_slice($aliases, 0, 3);
        }
        return $schema;
    }

    private function siteNavigationSchema(): array
    {
        $items = [
            ['知识库', $this->absolute('/wiki')],
            ['站内问答', $this->absolute('/questions')],
            ['协作社区', $this->absolute('/discussions')],
        ];
        return [
            '@context' => 'https://schema.org',
            '@type' => 'ItemList',
            'name' => (string) $this->site['name'] . ' 主要公开入口',
            'itemListElement' => array_map(
                static fn (array $item, int $position): array => [
                    '@type' => 'ListItem',
                    'position' => $position + 1,
                    'item' => ['@type' => 'SiteNavigationElement', 'name' => $item[0], 'url' => $item[1]],
                ],
                $items,
                array_keys($items),
            ),
        ];
    }

    private function collectionSchema(string $name, string $url, array $items, string $type): array
    {
        $elements = [];
        foreach ($items as $index => $item) {
            $itemUrl = match ($type) {
                'wiki' => $this->absolute($this->wikiPath((string) ($item['slug'] ?? ''))),
                'question' => $this->absolute('/questions/' . rawurlencode((string) ($item['id'] ?? ''))),
                default => $this->absolute('/discussions/' . rawurlencode((string) ($item['organizationSlug'] ?? 'organization')) . '/' . (int) ($item['id'] ?? 0)),
            };
            $elements[] = ['@type' => 'ListItem', 'position' => $index + 1, 'url' => $itemUrl, 'name' => (string) ($item['title'] ?? $item['slug'] ?? '')];
        }
        return ['@context' => 'https://schema.org', '@type' => 'CollectionPage', 'name' => $name, 'url' => $url, 'mainEntity' => ['@type' => 'ItemList', 'itemListElement' => $elements]];
    }

    private function breadcrumbSchema(array $items): array
    {
        return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => array_map(static fn (array $item, int $index): array => ['@type' => 'ListItem', 'position' => $index + 1, 'name' => $item[0], 'item' => $item[1]], $items, array_keys($items))];
    }

    private function jsonLd(array $schemas): string
    {
        $output = '';
        foreach ($schemas as $schema) {
            if ($schema === []) continue;
            $json = json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
            if ($json !== false) $output .= '<script type="application/ld+json">' . $json . '</script>';
        }
        return $output;
    }

    private function chip(string $value): string
    {
        return trim($value) === '' ? '' : '<span class="seo-chip">' . $this->e($value) . '</span>';
    }

    private function discussionType(string $type): string
    {
        return ['announcement' => '公告', 'decision' => '社区决议', 'discussion' => '学术讨论'][$type] ?? '学术讨论';
    }

    private function excerpt(string $value, int $limit): string
    {
        $plain = preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '';
        return mb_strlen(trim($plain)) > $limit ? mb_substr(trim($plain), 0, $limit - 1) . '…' : trim($plain);
    }

    private function plain(string $html): string
    {
        return $this->excerpt($html, 10000);
    }

    private function date(string $value): string
    {
        $timestamp = strtotime($value);
        return $timestamp ? date('Y-m-d H:i', $timestamp) : '';
    }

    private function absoluteAsset(string $value): string
    {
        $value = trim($value);
        if ($value === '') return '';
        if (preg_match('#^https?://[^\s"\'<>]+$#i', $value)) return $value;
        return str_starts_with($value, '/') ? $this->absolute($value) : '';
    }

    private function safeScriptUrl(string $value): string
    {
        return preg_match('#^https://[^\s"\'<>]+$#i', trim($value)) ? trim($value) : '';
    }

    private function encodePath(string $value): string
    {
        return implode('/', array_map('rawurlencode', array_filter(explode('/', trim($value, '/')), static fn (string $part): bool => $part !== '')));
    }

    private function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
