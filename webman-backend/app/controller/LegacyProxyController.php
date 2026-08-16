<?php

namespace app\controller;

use app\exception\ApiException;
use app\service\AuthService;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use support\Request;
use support\Response;
use Workerman\Timer;

final class LegacyProxyController
{
    private const MIGRATED_PREFIXES = [
        '/api/messaging', '/api/community/qa', '/api/selections',
        '/api/achievements', '/api/realtime/events', '/api/health', '/api/admin/users',
    ];

    public function forward(Request $request): Response
    {
        $path = $request->path();
        if (str_starts_with($path, '/api/internal/') || $this->isMigratedPath($path)) {
            throw new ApiException('页面不存在。', 404, 'not_found');
        }
        if (!config('wikist.legacy_proxy.enabled')) {
            throw new ApiException('该 API 尚未迁移。', 501, 'api_not_migrated');
        }
        $baseUrl = (string) config('wikist.legacy_proxy.url');
        $this->assertLoopbackTarget($baseUrl);
        $identity = (new AuthService())->current($request);
        if ($this->requiresSystemAdmin($path)) {
            if (!$identity || $identity->role !== 'admin') {
                throw new ApiException('该操作仅允许系统管理员执行。', 403, 'system_admin_required');
            }
            if ($this->requiresRecentAuthentication($path, $request->method())) {
                $authenticatedAt = (int) $request->session()->get('passport.authenticated_at', 0);
                if ($authenticatedAt < time() - 600) {
                    throw new ApiException('请重新登录后再执行敏感操作。', 403, 'step_up_required');
                }
            }
        }
        $target = rtrim($baseUrl, '/') . $request->uri();
        $requestBody = $request->rawBody();
        $requestLimit = $this->bodyLimit($path, 'request');
        if (strlen($requestBody) > $requestLimit) {
            throw new ApiException('请求内容超过兼容接口允许的大小。', 413, 'legacy_request_too_large');
        }
        $headers = [];
        foreach ($request->header() as $name => $value) {
            if (!in_array(strtolower($name), [
                'authorization', 'connection', 'content-length', 'cookie', 'host',
                'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
                'x-wikist-internal-token', 'x-wikist-user-id',
            ], true)) {
                $headers[$name] = $value;
            }
        }
        $headers['X-Wikist-Internal-Token'] = (string) config('wikist.legacy_proxy.token');
        if ($identity !== null) {
            $headers['X-Wikist-User-Id'] = (string) $identity->id;
        }
        $public = parse_url((string) config('wikist.url')) ?: [];
        $headers['X-Forwarded-Host'] = (string) ($public['host'] ?? $request->header('host'))
            . (isset($public['port']) ? ':' . (int) $public['port'] : '');
        $headers['X-Forwarded-Proto'] = (string) ($public['scheme'] ?? 'http');
        $streamedDownload = $request->method() === 'GET' && $path === '/api/admin/backup';
        $downloadPath = $streamedDownload ? $this->temporaryDownloadPath() : null;
        $requestOptions = ['headers' => $headers, 'body' => $requestBody, 'allow_redirects' => false];
        if ($downloadPath !== null) {
            $requestOptions['sink'] = $downloadPath;
        }
        try {
            $timeout = $streamedDownload ? max(300, (int) config('wikist.legacy_proxy.timeout', 30)) : config('wikist.legacy_proxy.timeout', 30);
            $response = (new Client(['http_errors' => false, 'timeout' => $timeout]))->request(
                $request->method(),
                $target,
                $requestOptions,
            );
        } catch (ConnectException) {
            if ($downloadPath !== null) {
                @unlink($downloadPath);
            }
            throw new ApiException('兼容服务暂时不可用，请稍后重试。', 503, 'legacy_service_unavailable');
        } catch (\Throwable $error) {
            if ($downloadPath !== null) {
                @unlink($downloadPath);
            }
            throw $error;
        }
        $outputHeaders = [];
        foreach (['Content-Type', 'Content-Length', 'Content-Disposition', 'Cache-Control', 'ETag', 'Last-Modified', 'X-Content-Type-Options', 'X-Wikist-Backup-Manifest'] as $name) {
            if ($response->hasHeader($name)) {
                $outputHeaders[$name] = implode(', ', $response->getHeader($name));
            }
        }
        if ($response->hasHeader('Set-Cookie')) {
            // Workerman supports repeated response headers as arrays. Never comma-join
            // Set-Cookie because Expires attributes contain commas.
            $outputHeaders['Set-Cookie'] = $response->getHeader('Set-Cookie');
        }
        if ($downloadPath !== null && $response->getStatusCode() >= 200 && $response->getStatusCode() < 300) {
            @chmod($downloadPath, 0600);
            Timer::add(3600, static function () use ($downloadPath): void {
                @unlink($downloadPath);
            }, [], false);
            $outputHeaders['X-Wikist-Backend'] = 'legacy-node';
            return (new Response($response->getStatusCode(), $outputHeaders))->withFile($downloadPath);
        }
        if ($downloadPath !== null) {
            $body = is_file($downloadPath) ? (string) file_get_contents($downloadPath, false, null, 0, $this->bodyLimit($path, 'response') + 1) : '';
            @unlink($downloadPath);
        } else {
            $body = (string) $response->getBody();
        }
        if (strlen($body) > $this->bodyLimit($path, 'response')) {
            throw new ApiException('兼容服务响应超过允许的大小。', 502, 'legacy_response_too_large');
        }
        $outputHeaders['X-Wikist-Backend'] = 'legacy-node';
        return new Response($response->getStatusCode(), $outputHeaders, $body);
    }

    private function isMigratedPath(string $path): bool
    {
        foreach (self::MIGRATED_PREFIXES as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
                return true;
            }
        }
        return false;
    }

    private function requiresSystemAdmin(string $path): bool
    {
        return $path === '/api/install/uninstall'
            || preg_match('#^/api/admin/(?:backup(?:/|$)|runtime/firewall(?:/|$)|plugins(?:/|$)|settings(?:/|$)|messages(?:/|$)|logs(?:/|$)|health(?:/|$))#', $path) === 1;
    }

    private function requiresRecentAuthentication(string $path, string $method): bool
    {
        $method = strtoupper($method);
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            // Creating and downloading a full-site backup is a sensitive action
            // even though the legacy endpoint uses GET. Ordinary admin reads
            // remain available for an otherwise valid administrator session.
            return $path === '/api/admin/backup';
        }
        return true;
    }

    private function assertLoopbackTarget(string $url): void
    {
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (!in_array($host, ['127.0.0.1', '::1', 'localhost'], true)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])) {
            throw new ApiException('兼容服务地址必须指向本机回环接口。', 503, 'legacy_service_misconfigured');
        }
    }

    private function bodyLimit(string $path, string $direction): int
    {
        $largeTransfer = preg_match('#^/api/(?:admin/backup|backup|import|export)(?:/|$)#', $path) === 1;
        $key = $largeTransfer ? "{$direction}_large_max_bytes" : "{$direction}_max_bytes";
        $fallback = $largeTransfer ? 268435456 : 16777216;
        return max(1048576, (int) config("wikist.legacy_proxy.{$key}", $fallback));
    }

    private function temporaryDownloadPath(): string
    {
        $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'wikist-proxy-downloads';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new ApiException('无法创建备份暂存目录。', 503, 'backup_staging_unavailable');
        }
        foreach (glob($directory . DIRECTORY_SEPARATOR . '*.tmp') ?: [] as $candidate) {
            if (is_file($candidate) && filemtime($candidate) < time() - 86400) {
                @unlink($candidate);
            }
        }
        return $directory . DIRECTORY_SEPARATOR . 'wikist-' . bin2hex(random_bytes(16)) . '.tmp';
    }
}
