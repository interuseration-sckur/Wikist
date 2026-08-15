<?php

declare(strict_types=1);

namespace app\service;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\ExternalLink\ExternalLinkExtension;
use League\CommonMark\Extension\GithubFlavoredMarkdownExtension;
use League\CommonMark\MarkdownConverter;
use League\CommonMark\Util\HtmlFilter;

/**
 * Safe server-side renderer for native Community content.
 *
 * The rendered HTML intentionally keeps Wikist math delimiters and knowledge
 * references intact. MathJax and the shared reference decorator finish those
 * two presentation steps in the browser.
 */
final class CommunityMarkdownService
{
    private const CONTAINER_LABELS = [
        'note' => '说明',
        'info' => '信息',
        'tip' => '提示',
        'warning' => '警告',
        'caution' => '注意',
        'danger' => '危险',
        'definition' => '定义',
        'theorem' => '定理',
        'proof' => '证明',
        'example' => '例',
    ];

    private MarkdownConverter $converter;

    public function __construct()
    {
        $host = (string) (parse_url((string) config('wikist.url', ''), PHP_URL_HOST) ?: 'localhost');
        $environment = new Environment([
            'html_input' => HtmlFilter::STRIP,
            'allow_unsafe_links' => false,
            'max_nesting_level' => 50,
            'renderer' => ['soft_break' => "\n"],
            'external_link' => [
                'internal_hosts' => array_values(array_unique([$host, 'localhost', '127.0.0.1'])),
                'open_in_new_window' => true,
                'html_class' => 'external-link',
                'nofollow' => '',
                'noopener' => 'external',
                'noreferrer' => 'external',
            ],
        ]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new GithubFlavoredMarkdownExtension());
        $environment->addExtension(new ExternalLinkExtension());
        $this->converter = new MarkdownConverter($environment);
    }

    public function render(string $markdown): string
    {
        $markdown = str_replace(["\r\n", "\r", "\0"], ["\n", "\n", ''], $markdown);
        if (trim($markdown) === '') {
            return '';
        }
        return $this->renderInternal($markdown, 0);
    }

    private function renderInternal(string $markdown, int $depth): string
    {
        if ($depth > 8) {
            return '<p>' . $this->escape($markdown) . '</p>';
        }

        [$markdown, $containers] = $this->extractContainers($markdown, $depth);
        [$markdown, $math] = $this->extractMath($markdown);
        $html = (string) $this->converter->convert($markdown);

        foreach ($math as $token => $replacement) {
            $html = str_replace($token, $replacement, $html);
        }
        foreach ($containers as $token => $replacement) {
            $html = str_replace(["<p>{$token}</p>\n", "<p>{$token}</p>", $token], $replacement, $html);
        }
        return trim($html);
    }

    /** @return array{0:string,1:array<string,string>} */
    private function extractContainers(string $markdown, int $depth): array
    {
        $lines = explode("\n", $markdown);
        $output = [];
        $replacements = [];
        $count = count($lines);
        $index = 0;
        $fence = '';

        while ($index < $count) {
            $line = $lines[$index];
            if ($this->fenceMarker($line, $fence)) {
                $output[] = $line;
                $index++;
                continue;
            }
            if ($fence !== '' || !preg_match('/^\s*:::\s*([a-z][a-z0-9_-]*)(?:\s+(.+?))?\s*$/iu', $line, $match)) {
                $output[] = $line;
                $index++;
                continue;
            }

            $kind = strtolower((string) $match[1]);
            if (!array_key_exists($kind, self::CONTAINER_LABELS)) {
                $output[] = $line;
                $index++;
                continue;
            }

            $inner = [];
            $nested = 1;
            $cursor = $index + 1;
            $innerFence = '';
            for (; $cursor < $count; $cursor++) {
                $candidate = $lines[$cursor];
                if ($this->fenceMarker($candidate, $innerFence)) {
                    $inner[] = $candidate;
                    continue;
                }
                if ($innerFence === '' && preg_match('/^\s*:::\s*[a-z][a-z0-9_-]*(?:\s+.*?)?\s*$/iu', $candidate)) {
                    $nested++;
                } elseif ($innerFence === '' && preg_match('/^\s*:::\s*$/u', $candidate)) {
                    $nested--;
                    if ($nested === 0) {
                        break;
                    }
                }
                $inner[] = $candidate;
            }
            if ($nested !== 0) {
                $output[] = $line;
                $index++;
                continue;
            }

            $token = 'WIKISTCONTAINER' . $depth . 'X' . count($replacements) . 'TOKEN';
            $title = trim((string) ($match[2] ?? '')) ?: self::CONTAINER_LABELS[$kind];
            $body = $this->renderInternal(implode("\n", $inner), $depth + 1);
            $replacements[$token] = '<aside class="wikist-container math-note math-note-' . $kind . '">'
                . '<div class="wikist-container-label math-note-label">' . $this->escape(mb_substr($title, 0, 100)) . '</div>'
                . $body . '</aside>';
            $output[] = '';
            $output[] = $token;
            $output[] = '';
            $index = $cursor + 1;
        }

        return [implode("\n", $output), $replacements];
    }

    /** @return array{0:string,1:array<string,string>} */
    private function extractMath(string $markdown): array
    {
        [$markdown, $protected] = $this->protectFencedCode($markdown);
        $markdown = preg_replace_callback('/(`+)([^\n]*?)\1/u', function (array $match) use (&$protected): string {
            $token = 'WIKISTCODE' . count($protected) . 'TOKEN';
            $protected[$token] = $match[0];
            return $token;
        }, $markdown) ?? $markdown;

        $replacements = [];
        $blockPattern = '/(?<!\\\\)\$\$\s*([\s\S]*?)\s*(?<!\\\\)\$\$|\\\\\[\s*([\s\S]*?)\s*\\\\\]/u';
        $markdown = preg_replace_callback($blockPattern, function (array $match) use (&$replacements): string {
            $equation = (string) (($match[1] ?? '') !== '' ? $match[1] : ($match[2] ?? ''));
            $token = 'WIKISTMATHBLOCK' . count($replacements) . 'TOKEN';
            $replacements[$token] = '<div class="math-block">\\[' . "\n" . $this->escape(trim($equation)) . "\n" . '\\]</div>';
            return "\n\n{$token}\n\n";
        }, $markdown) ?? $markdown;

        $inlinePattern = '/(?<![\\\\$])\$(?![\s$])([^\n$]+?)(?<![\s\\\\])\$(?!\$)|\\\\\(([^\n]+?)\\\\\)/u';
        $markdown = preg_replace_callback($inlinePattern, function (array $match) use (&$replacements): string {
            $equation = (string) (($match[1] ?? '') !== '' ? $match[1] : ($match[2] ?? ''));
            $token = 'WIKISTMATHINLINE' . count($replacements) . 'TOKEN';
            $replacements[$token] = '<span class="math-inline">\\(' . $this->escape(trim($equation)) . '\\)</span>';
            return $token;
        }, $markdown) ?? $markdown;

        foreach ($protected as $token => $source) {
            $markdown = str_replace($token, $source, $markdown);
        }
        return [$markdown, $replacements];
    }

    /** @return array{0:string,1:array<string,string>} */
    private function protectFencedCode(string $markdown): array
    {
        $lines = explode("\n", $markdown);
        $output = [];
        $protected = [];
        $buffer = [];
        $fence = '';

        foreach ($lines as $line) {
            if ($fence === '') {
                $candidate = '';
                if ($this->fenceMarker($line, $candidate) && $candidate !== '') {
                    $fence = $candidate;
                    $buffer = [$line];
                    continue;
                }
                $output[] = $line;
                continue;
            }
            $buffer[] = $line;
            $before = $fence;
            $this->fenceMarker($line, $fence);
            if ($before !== '' && $fence === '') {
                $token = 'WIKISTFENCE' . count($protected) . 'TOKEN';
                $protected[$token] = implode("\n", $buffer);
                $output[] = $token;
                $buffer = [];
            }
        }
        if ($buffer !== []) {
            $output = array_merge($output, $buffer);
        }
        return [implode("\n", $output), $protected];
    }

    private function fenceMarker(string $line, string &$active): bool
    {
        if (!preg_match('/^\s*(`{3,}|~{3,})/u', $line, $match)) {
            return false;
        }
        $marker = (string) $match[1];
        if ($active === '') {
            $active = $marker[0];
            return true;
        }
        if ($marker[0] === $active) {
            $active = '';
        }
        return true;
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_NOQUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
