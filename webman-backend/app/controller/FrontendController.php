<?php

namespace app\controller;

use app\repository\SiteConfigRepository;
use app\service\SeoPageRenderer;
use support\Request;
use support\Response;

final class FrontendController
{
    public function index(Request $request): Response
    {
        if (!is_file(base_path('../config/site.config.json'))) {
            return redirect('/install.html');
        }
        $path = base_path('../public/index.html');
        $siteConfig = (new SiteConfigRepository())->all();
        $site = [
            'name' => trim((string) ($siteConfig['name'] ?? config('wikist.name', 'Wikist'))) ?: 'Wikist',
            'tagline' => trim((string) ($siteConfig['tagline'] ?? '开放、严谨、可验证的知识共同体')),
            'language' => (string) ($siteConfig['language'] ?? 'zh-CN'),
            'license' => (string) ($siteConfig['license'] ?? 'CC BY-SA 4.0'),
            'publicUrl' => rtrim((string) config('wikist.url', ''), '/'),
            'icon' => (string) ($siteConfig['assets']['siteIcon'] ?? '/assets/wikist-icon.png'),
            'mathCdn' => (string) ($siteConfig['math']['cdn'] ?? ''),
            'defaultPage' => (string) ($siteConfig['defaultPage'] ?? 'home'),
            'brandAliases' => (array) ($siteConfig['seo']['brandAliases'] ?? []),
        ];
        $html = (new SeoPageRenderer($site))->decorateHomepage((string) file_get_contents($path));
        return new Response(200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-cache, no-store, must-revalidate'], $html);
    }
}
