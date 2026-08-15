<?php

namespace app\middleware;

use app\domain\passport\RolePolicy;
use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class RequireAdminMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        if (!$request->identity instanceof UserIdentity || !RolePolicy::allows($request->identity->role, 'admin')) {
            throw new ApiException('需要管理员权限。', 403, 'admin_required');
        }
        return $handler($request);
    }
}
