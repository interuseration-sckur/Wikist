<?php

namespace app\service;

use app\exception\ApiException;
use support\Db;

final class LoginRateLimiter
{
    public function hit(string $ip): void
    {
        $key = hash_hmac('sha256', 'login:' . $ip, (string) config('wikist.secret'));
        $now = time();
        $limit = max(3, (int) config('wikist.security.login_attempts', 10));
        $connection = Db::connection(config('wikist.passport.connection', 'wikist'));
        $result = $connection->transaction(function () use ($connection, $key, $now, $limit): array {
            $query = $connection->table('security_rate_limits')->where('key_hash', $key);
            if ($connection->getDriverName() !== 'sqlite') {
                $query->lockForUpdate();
            }
            $row = $query->first();
            $start = $row ? (int) $row->window_started_at : $now;
            $count = $row ? (int) $row->attempt_count : 0;
            $blockedUntil = $row ? (int) $row->blocked_until : 0;
            if ($blockedUntil > $now) {
                return ['blocked' => true, 'retryAfter' => $blockedUntil - $now];
            }
            if ($now - $start >= 60) {
                $start = $now;
                $count = 0;
            }
            $count++;
            if ($count > $limit) {
                $blockedUntil = $now + 60;
            }
            $connection->table('security_rate_limits')->updateOrInsert(['key_hash' => $key], [
                'scope' => 'login',
                'window_started_at' => $start,
                'attempt_count' => $count,
                'blocked_until' => $blockedUntil,
                'updated_at' => $now,
            ]);
            if (random_int(1, 200) === 1) {
                $connection->table('security_rate_limits')->where('updated_at', '<', $now - 86400)->delete();
            }
            return ['blocked' => $blockedUntil > $now, 'retryAfter' => max(1, $blockedUntil - $now)];
        });
        if ($result['blocked']) {
            throw new ApiException('登录尝试过于频繁，请稍后再试。', 429, 'login_rate_limited', [
                'retryAfter' => $result['retryAfter'],
            ]);
        }
    }
}
