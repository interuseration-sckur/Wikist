<?php

namespace app\middleware;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class RequireAuthMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        if (!$request->identity instanceof UserIdentity) {
            throw new ApiException('请先登录。', 401, 'authentication_required');
        }
        return $handler($request);
    }
}
