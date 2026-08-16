<?php

namespace app\middleware;

use app\exception\ApiException;
use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class TrustedOriginMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        if (in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $origin = rtrim((string) $request->header('origin'), '/');
            $referer = (string) $request->header('referer');
            $trusted = array_map(static fn ($item) => rtrim($item, '/'), config('wikist.security.trusted_origins', []));
            if ($origin !== '' && !in_array($origin, $trusted, true)) {
                throw new ApiException('请求来源不受信任。', 403, 'untrusted_origin');
            }
            if ($origin === '' && $referer !== '') {
                $parts = parse_url($referer);
                $refererOrigin = isset($parts['scheme'], $parts['host'])
                    ? $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '')
                    : '';
                if ($refererOrigin === '' || !in_array(rtrim($refererOrigin, '/'), $trusted, true)) {
                    throw new ApiException('请求来源不受信任。', 403, 'untrusted_origin');
                }
            }
            $internalSecret = (string) config('wikist.legacy_proxy.token', '');
            $internalProvided = (string) $request->header('x-wikist-internal-token');
            $isInternal = $internalSecret !== ''
                && $internalProvided !== ''
                && hash_equals($internalSecret, $internalProvided);
            if ($origin === '' && $referer === '' && !$isInternal) {
                throw new ApiException('请求缺少来源信息。', 403, 'origin_required');
            }
            $userId = (int) $request->session()->get('passport.user_id', 0);
            if ($userId > 0) {
                $expected = (string) $request->session()->get('passport.csrf_token', '');
                $provided = (string) $request->header('x-csrf-token');
                if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
                    throw new ApiException('安全令牌已失效，请刷新页面后重试。', 419, 'csrf_token_invalid');
                }
            }
        }
        return $handler($request);
    }
}
