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
        if (in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)
            && !str_starts_with((string) $request->header('authorization'), 'Bearer ')) {
            $origin = rtrim((string) $request->header('origin'), '/');
            $trusted = array_map(static fn ($item) => rtrim($item, '/'), config('wikist.security.trusted_origins', []));
            if ($origin !== '' && !in_array($origin, $trusted, true)) {
                throw new ApiException('请求来源不受信任。', 403, 'untrusted_origin');
            }
        }
        return $handler($request);
    }
}
