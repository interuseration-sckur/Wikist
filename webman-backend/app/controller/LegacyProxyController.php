<?php

namespace app\controller;

use app\exception\ApiException;
use app\service\AuthService;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use support\Request;
use support\Response;

final class LegacyProxyController
{
    public function forward(Request $request): Response
    {
        if (str_starts_with($request->path(), '/api/internal/')) {
            throw new ApiException('页面不存在。', 404, 'not_found');
        }
        if (!config('wikist.legacy_proxy.enabled')) {
            throw new ApiException('该 API 尚未迁移。', 501, 'api_not_migrated');
        }
        $target = config('wikist.legacy_proxy.url') . $request->uri();
        $headers = [];
        foreach ($request->header() as $name => $value) {
            if (!in_array(strtolower($name), ['connection', 'content-length', 'x-wikist-user-id'], true)) {
                $headers[$name] = $value;
            }
        }
        $headers['X-Wikist-Internal-Token'] = (string) config('wikist.legacy_proxy.token');
        $identity = (new AuthService())->current($request);
        if ($identity !== null) {
            $headers['X-Wikist-User-Id'] = (string) $identity->id;
        }
        $headers['X-Forwarded-Host'] = (string) $request->header('host');
        $headers['X-Forwarded-Proto'] = (string) ($request->header('x-forwarded-proto') ?: 'http');
        try {
            $response = (new Client(['http_errors' => false, 'timeout' => config('wikist.legacy_proxy.timeout', 30)]))->request(
                $request->method(),
                $target,
                ['headers' => $headers, 'body' => $request->rawBody(), 'allow_redirects' => false],
            );
        } catch (ConnectException) {
            throw new ApiException('兼容服务暂时不可用，请稍后重试。', 503, 'legacy_service_unavailable');
        }
        $outputHeaders = [];
        foreach (['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Set-Cookie'] as $name) {
            if ($response->hasHeader($name)) {
                $outputHeaders[$name] = implode(', ', $response->getHeader($name));
            }
        }
        $outputHeaders['X-Wikist-Backend'] = 'legacy-node';
        return new Response($response->getStatusCode(), $outputHeaders, (string) $response->getBody());
    }
}
