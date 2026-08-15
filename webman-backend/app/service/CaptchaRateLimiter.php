<?php

namespace app\service;

use app\exception\ApiException;

final class CaptchaRateLimiter
{
    /** @var array<string, array{start:int,count:int}> */
    private static array $attempts = [];

    public function hit(string $ip): void
    {
        $key = hash('sha256', $ip);
        $now = time();
        $window = self::$attempts[$key] ?? ['start' => $now, 'count' => 0];
        if ($now - $window['start'] >= 60) {
            $window = ['start' => $now, 'count' => 0];
        }
        $window['count']++;
        self::$attempts[$key] = $window;
        $limit = max(12, (int) config('wikist.security.captcha_attempts', 40));
        if ($window['count'] > $limit) {
            throw new ApiException('验证码请求过于频繁，请稍后再试。', 429, 'captcha_rate_limited', [
                'retryAfter' => max(1, 60 - ($now - $window['start'])),
            ]);
        }
        if (count(self::$attempts) > 10000) {
            self::$attempts = array_filter(self::$attempts, static fn (array $entry): bool => $now - $entry['start'] < 60);
        }
    }
}
