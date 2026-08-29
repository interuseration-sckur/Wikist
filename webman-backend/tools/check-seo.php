<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use app\service\SeoPageRenderer;

$renderer = new SeoPageRenderer([
    'name' => 'Wikist Test',
    'tagline' => 'Test knowledge platform',
    'language' => 'zh-CN',
    'license' => 'CC BY-SA 4.0',
    'publicUrl' => 'https://wiki.example.test',
    'icon' => '/assets/wikist-icon.png',
    'mathCdn' => '',
    'defaultPage' => 'home',
    'brandAliases' => ['MathSX'],
]);

$wiki = $renderer->wiki([
    'slug' => 'abstract-algebra/group',
    'title' => '群',
    'summary' => '群是带有二元运算的代数结构。',
    'html' => '<h1 id="群">群</h1><p>参见 <a href="#/page/abstract-algebra">抽象代数</a>。</p>',
    'status' => 'stable',
    'quality' => 'A',
    'language' => 'zh-CN',
    'author' => 'Wikist Core',
    'createdAt' => '2026-01-01T00:00:00Z',
    'updatedAt' => '2026-08-16T00:00:00Z',
], [], '');

$question = $renderer->question([
    'question' => [
        'id' => 'q-test', 'title' => '有限群为何重要？', 'summary' => '讨论有限群。',
        'bodyHtml' => '<p>问题正文</p>', 'answerCount' => 1, 'voteCount' => 2,
        'author' => ['username' => 'alice', 'displayName' => 'Alice'],
        'createdAt' => '2026-01-01T00:00:00Z', 'updatedAt' => '2026-01-02T00:00:00Z',
    ],
    'answers' => ['items' => [[
        'id' => 'a-test', 'bodyHtml' => '<p>回答正文</p>', 'accepted' => true,
        'author' => ['username' => 'bob', 'displayName' => 'Bob'],
        'createdAt' => '2026-01-02T00:00:00Z', 'updatedAt' => '2026-01-02T00:00:00Z',
    ]], 'total' => 1, 'pages' => 1],
], 1);

$discussion = $renderer->discussion([
    'post' => [
        'id' => 7, 'organizationSlug' => 'algebra', 'organizationName' => '代数协作组',
        'title' => '群论词条讨论', 'bodyHtml' => '<p>讨论正文</p>', 'postType' => 'discussion',
        'status' => 'open', 'authorUsername' => 'alice', 'authorName' => 'Alice',
        'createdAt' => '2026-01-01T00:00:00Z', 'updatedAt' => '2026-01-02T00:00:00Z',
    ],
    'items' => [], 'total' => 0, 'pages' => 1,
], 1);

$homepage = $renderer->decorateHomepage('<!doctype html><html><head><title>Wikist</title></head><body><footer><a href="/wiki">知识库</a><a href="/questions">站内问答</a><a href="/discussions">协作社区</a></footer></body></html>');

$checks = [
    'wiki canonical' => str_contains($wiki, '<link rel="canonical" href="https://wiki.example.test/wiki/abstract-algebra/group"'),
    'wiki internal link' => str_contains($wiki, 'href="/wiki/abstract-algebra"'),
    'article schema' => str_contains($wiki, '"@type":"Article"'),
    'application shell' => str_contains($wiki, 'class="app-grid"'),
    'prerender content' => str_contains($wiki, 'data-seo-prerender'),
    'native loading transition' => str_contains($wiki, 'id="wikistRouteLoader" class="wikist-native-route-loader"'),
    'wiki application route' => str_contains($wiki, 'window.__WIKIST_INITIAL_ROUTE__="#/page/abstract-algebra/group"'),
    'single wiki h1' => preg_match_all('/<h1\b/i', $wiki) === 1,
    'application assets' => str_contains($wiki, '/assets/app.js?v='),
    'question schema' => str_contains($question, '"@type":"QAPage"'),
    'answer schema' => str_contains($question, '"@type":"Answer"'),
    'question application route' => str_contains($question, 'window.__WIKIST_INITIAL_ROUTE__="#/questions/q-test"'),
    'discussion schema' => str_contains($discussion, '"@type":"DiscussionForumPosting"'),
    'discussion participation link' => str_contains($discussion, '/#/organization/algebra?tab=forum&amp;topic=7'),
    'discussion application route' => str_contains($discussion, 'window.__WIKIST_INITIAL_ROUTE__="#/organization/algebra?tab=forum&topic=7"'),
    'homepage canonical' => str_contains($homepage, '<link rel="canonical" href="https://wiki.example.test/"'),
    'homepage primary navigation schema' => str_contains($homepage, 'SiteNavigationElement') && str_contains($homepage, 'https://wiki.example.test/questions'),
    'homepage brand alias' => str_contains($homepage, 'MathSX'),
    'homepage crawl directives' => str_contains($homepage, '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"'),
];

if (in_array(false, $checks, true)) {
    $failed = array_keys(array_filter($checks, static fn (bool $passed): bool => !$passed));
    fwrite(STDERR, "SEO renderer check failed: " . implode(', ', $failed) . ".\n");
    exit(1);
}

fwrite(STDOUT, "OK    Crawlable Wiki, Q&A and discussion rendering checks passed.\n");
