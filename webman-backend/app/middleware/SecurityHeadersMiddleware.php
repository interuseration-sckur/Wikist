<?php

namespace app\middleware;

use Webman\Http\Request;
use Webman\Http\Response;
use Webman\MiddlewareInterface;

final class SecurityHeadersMiddleware implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        $headers = [
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'SAMEORIGIN',
            'Referrer-Policy' => 'strict-origin-when-cross-origin',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
            'Cross-Origin-Opener-Policy' => 'same-origin',
            'Content-Security-Policy-Report-Only' => "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; media-src 'self' blob: https:",
        ];
        $forwardedProto = strtolower((string) $request->header('x-forwarded-proto'));
        if ($forwardedProto === 'https' || str_starts_with(strtolower((string) config('wikist.url', '')), 'https://')) {
            $headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
        }
        if (in_array($request->path(), ['/', '/index.html'], true)) {
            $headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            $headers['Pragma'] = 'no-cache';
            $headers['Expires'] = '0';
        }
        return $handler($request)->withHeaders($headers);
    }
}
