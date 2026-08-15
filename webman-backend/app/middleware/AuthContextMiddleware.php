<?php

namespace app\middleware;

use app\service\AuthService;
use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class AuthContextMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        $request->identity = (new AuthService())->current($request);
        return $handler($request);
    }
}
