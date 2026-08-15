<?php

namespace app\middleware;

use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class RequestContextMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        $request->requestId = $this->requestId((string) $request->header('x-request-id'));
        $request->requestStartedAt = hrtime(true);
        $response = $handler($request);
        $elapsed = (hrtime(true) - $request->requestStartedAt) / 1_000_000;
        return $response->withHeaders([
            'X-Request-Id' => $request->requestId,
            'Server-Timing' => 'app;dur=' . number_format($elapsed, 2, '.', ''),
        ]);
    }

    private function requestId(string $candidate): string
    {
        if (preg_match('/^[A-Za-z0-9._-]{8,80}$/', $candidate)) {
            return $candidate;
        }
        return bin2hex(random_bytes(12));
    }
}
